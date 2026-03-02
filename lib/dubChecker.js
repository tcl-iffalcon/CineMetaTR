const fetch = require('node-fetch');
const cache = require('./cache');

const SINEWIX_BASE = 'https://sinewix.onrender.com';

// Sinewix'in tüm içerik ID'lerini çek ve cache'le
async function getSinewixIds(type) {
  const sinewixType = type === 'movie' ? 'movie' : 'series';
  const catalogId = type === 'movie' ? 'sinewix-movies' : 'sinewix-series';
  const cacheKey = `sinewix-ids:${type}`;

  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const ids = new Set();
  let skip = 0;
  let hasMore = true;

  // Tüm sayfaları çek (her sayfa genellikle 100 içerik)
  while (hasMore) {
    try {
      const url = skip === 0
        ? `${SINEWIX_BASE}/catalog/${sinewixType}/${catalogId}.json`
        : `${SINEWIX_BASE}/catalog/${sinewixType}/${catalogId}/skip=${skip}.json`;

      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        timeout: 10000,
      });

      if (!res.ok) break;
      const data = await res.json();
      const metas = data.metas || [];

      if (metas.length === 0) {
        hasMore = false;
        break;
      }

      // Sinewix kendi ID'lerini kullanıyor, IMDB ID'yi meta'dan al
      metas.forEach((m) => {
        // Sinewix meta'sında imdb_id veya id alanı olabilir
        if (m.imdb_id) ids.add(m.imdb_id);
        if (m.id && m.id.startsWith('tt')) ids.add(m.id);
      });

      skip += metas.length;
      if (metas.length < 100) hasMore = false;
    } catch (err) {
      console.error(`Sinewix catalog fetch error (${type}, skip=${skip}):`, err.message);
      hasMore = false;
    }
  }

  console.log(`[Sinewix] ${type} - ${ids.size} içerik bulundu`);

  // 6 saat cache'le
  cache.set(cacheKey, ids, 60 * 60 * 6);
  return ids;
}

// IMDB ID'nin Sinewix'te olup olmadığını kontrol et
// Sinewix kendi ID sistemi kullandığı için başlık araması da yapar
async function checkSinewixByTitle(imdbId, type) {
  const TMDB_API_KEY = process.env.TMDB_API_KEY;
  if (!TMDB_API_KEY) return false;

  try {
    // TMDB'den Türkçe başlığı al
    const tmdbType = type === 'movie' ? 'movie' : 'tv';
    const findRes = await fetch(
      `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`,
      { timeout: 8000 }
    );
    if (!findRes.ok) return false;
    const findData = await findRes.json();
    const results = type === 'movie' ? findData.movie_results : findData.tv_results;
    if (!results || results.length === 0) return false;

    const title = results[0].title || results[0].name || '';
    if (!title) return false;

    // Sinewix'te ara
    const sinewixType = type === 'movie' ? 'movie' : 'series';
    const catalogId = type === 'movie' ? 'sinewix-movies' : 'sinewix-series';
    const searchUrl = `${SINEWIX_BASE}/catalog/${sinewixType}/${catalogId}/search=${encodeURIComponent(title)}.json`;

    const searchRes = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      timeout: 8000,
    });
    if (!searchRes.ok) return false;
    const searchData = await searchRes.json();

    return !!(searchData.metas && searchData.metas.length > 0);
  } catch (err) {
    console.error('Sinewix title check error:', err.message);
    return false;
  }
}

// Ana kontrol fonksiyonu
async function checkTurkishDub(imdbId, type) {
  const cacheKey = `dub:${imdbId}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Önce katalog ID listesinde ara (hızlı)
  const sinewixIds = await getSinewixIds(type);
  if (sinewixIds.has(imdbId)) {
    cache.set(cacheKey, true, 60 * 60 * 24);
    return true;
  }

  // Katalogda bulamazsak başlıkla ara (yedek)
  const result = await checkSinewixByTitle(imdbId, type);
  cache.set(cacheKey, result, 60 * 60 * 24);
  return result;
}

// Başlangıçta her iki kataloğu da yükle
async function preloadSinewix() {
  await getSinewixIds('movie');
  await getSinewixIds('series');
  console.log('[Sinewix] Ön yükleme tamamlandı');
}

module.exports = { checkTurkishDub, preloadSinewix };

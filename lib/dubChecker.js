const fetch = require('node-fetch');
const cache = require('./cache');

const SINEWIX_BASE = 'https://sinewix.onrender.com';
const TMDB_BASE = 'https://api.themoviedb.org/3';

// "sinewix:4064:movie" → "4064"
function parseTmdbId(sinewixId) {
  const parts = sinewixId.split(':');
  return parts.length >= 2 ? parts[1] : null;
}

// TMDB ID → IMDb ID (örn: 4064 → tt0452694)
async function tmdbToImdb(tmdbId, type) {
  const TMDB_API_KEY = process.env.TMDB_API_KEY;
  if (!TMDB_API_KEY) return null;

  const cacheKey = `tmdb2imdb:${tmdbId}:${type}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const tmdbType = type === 'movie' ? 'movie' : 'tv';
    const res = await fetch(
      `${TMDB_BASE}/${tmdbType}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`,
      { timeout: 8000 }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const imdbId = data.imdb_id || null;
    cache.set(cacheKey, imdbId, 60 * 60 * 24); // 24 saat
    return imdbId;
  } catch (err) {
    console.error(`TMDB external_ids error (${tmdbId}):`, err.message);
    return null;
  }
}

// Sinewix kataloğundaki tüm içerikleri IMDb ID'ye dönüştürüp Set olarak döndür
async function getSinewixImdbIds(type) {
  const cacheKey = `sinewix-imdb-ids:${type}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const sinewixType = type === 'movie' ? 'movie' : 'series';
  const catalogId = type === 'movie' ? 'sinewix-movies' : 'sinewix-series';

  const imdbIds = new Set();
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    try {
      const url = skip === 0
        ? `${SINEWIX_BASE}/catalog/${sinewixType}/${catalogId}.json`
        : `${SINEWIX_BASE}/catalog/${sinewixType}/${catalogId}/skip=${skip}.json`;

      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        timeout: 10000,
      });

      if (!res.ok) break;
      const data = await res.json();
      const metas = data.metas || [];
      if (metas.length === 0) { hasMore = false; break; }

      // 10'arlı paralel batch ile TMDB → IMDb dönüşümü
      for (let i = 0; i < metas.length; i += 10) {
        const batch = metas.slice(i, i + 10);
        await Promise.all(batch.map(async (m) => {
          // Zaten imdb_id alanı varsa direkt kullan
          if (m.imdb_id) { imdbIds.add(m.imdb_id); return; }
          if (m.id && m.id.startsWith('tt')) { imdbIds.add(m.id); return; }

          // sinewix:TMDBID:type → TMDB ID çıkar → IMDb ID'ye çevir
          const tmdbId = parseTmdbId(m.id);
          if (!tmdbId) return;

          const imdbId = await tmdbToImdb(tmdbId, type);
          if (imdbId) imdbIds.add(imdbId);
        }));
      }

      skip += metas.length;
      if (metas.length < 100) hasMore = false;
    } catch (err) {
      console.error(`Sinewix catalog fetch error (${type}, skip=${skip}):`, err.message);
      hasMore = false;
    }
  }

  console.log(`[Sinewix] ${type} - ${imdbIds.size} IMDb ID eşleştirildi`);
  cache.set(cacheKey, imdbIds, 60 * 60 * 6); // 6 saat
  return imdbIds;
}

// Ana kontrol — tt... ID'sinin Sinewix'te olup olmadığını kontrol eder
async function checkTurkishDub(imdbId, type) {
  const cacheKey = `dub:${imdbId}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const sinewixIds = await getSinewixImdbIds(type);
  const result = sinewixIds.has(imdbId);

  cache.set(cacheKey, result, 60 * 60 * 24);
  return result;
}

// Başlangıçta her iki kataloğu arka planda yükle
async function preloadSinewix() {
  await getSinewixImdbIds('movie');
  await getSinewixImdbIds('series');
  console.log('[Sinewix] Ön yükleme tamamlandı');
}

module.exports = { checkTurkishDub, preloadSinewix };

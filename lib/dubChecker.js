const fetch = require('node-fetch');
const cache = require('./cache');

const TMDB_BASE = 'https://api.themoviedb.org/3';

// TMDB'den filmin Türkçe dublaj olup olmadığını kontrol et
// Yöntem: /watch/providers endpoint'i — TR'de streaming/satın alma varsa dublaj var demektir
// + /translations endpoint'i — Türkçe çeviri varsa içerik yerelleştirilmiş demektir
async function checkTurkishDub(imdbId, type) {
  const cacheKey = `dub:${imdbId}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const TMDB_API_KEY = process.env.TMDB_API_KEY;
  if (!TMDB_API_KEY) {
    console.warn('[TMDB] TMDB_API_KEY eksik!');
    return false;
  }

  try {
    // 1. IMDB ID'den TMDB ID'sini bul
    const findRes = await fetch(
      `${TMDB_BASE}/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`,
      { timeout: 8000 }
    );
    if (!findRes.ok) throw new Error(`TMDB find HTTP ${findRes.status}`);
    const findData = await findRes.json();

    const tmdbType = type === 'movie' ? 'movie' : 'tv';
    const results = type === 'movie' ? findData.movie_results : findData.tv_results;
    if (!results || results.length === 0) {
      cache.set(cacheKey, false, 60 * 60 * 12);
      return false;
    }

    const tmdbId = results[0].id;

    // 2. Watch providers'dan TR'de mevcut mu kontrol et
    const providerRes = await fetch(
      `${TMDB_BASE}/${tmdbType}/${tmdbId}/watch/providers?api_key=${TMDB_API_KEY}`,
      { timeout: 8000 }
    );
    if (!providerRes.ok) throw new Error(`TMDB providers HTTP ${providerRes.status}`);
    const providerData = await providerRes.json();

    const trProviders = providerData.results?.TR;
    const hasInTR = !!(trProviders?.flatrate || trProviders?.buy || trProviders?.free || trProviders?.ads);

    if (!hasInTR) {
      // TR'de hiç yok, kesinlikle Türkçe dublaj yok
      cache.set(cacheKey, false, 60 * 60 * 24);
      return false;
    }

    // 3. TR'de varsa, Türkçe çeviri/dublaj kontrolü — translations endpoint
    const transRes = await fetch(
      `${TMDB_BASE}/${tmdbType}/${tmdbId}/translations?api_key=${TMDB_API_KEY}`,
      { timeout: 8000 }
    );
    if (!transRes.ok) throw new Error(`TMDB translations HTTP ${transRes.status}`);
    const transData = await transRes.json();

    const hasTurkishTranslation = transData.translations?.some(
      (t) => t.iso_639_1 === 'tr' && (t.data?.title || t.data?.name || t.data?.overview)
    );

    // TR'de provider var VE Türkçe çeviri/lokalizasyon varsa = Türkçe dublaj mevcut
    const result = !!(hasInTR && hasTurkishTranslation);

    console.log(
      `[TMDB] ${imdbId} → TR provider: ${hasInTR}, TR translation: ${hasTurkishTranslation} → DUB: ${result}`
    );

    cache.set(cacheKey, result, 60 * 60 * 24);
    return result;
  } catch (err) {
    console.error(`[TMDB] checkTurkishDub error (${imdbId}):`, err.message);
    cache.set(cacheKey, false, 60 * 60 * 1); // hata durumunda 1 saat cache
    return false;
  }
}

// Eski Sinewix preload — artık gerek yok ama index.js uyumluluğu için boş bırakıyoruz
async function preloadSinewix() {
  console.log('[TMDB] Sinewix yerine TMDB kullanılıyor, preload gerekmiyor.');
}

module.exports = { checkTurkishDub, preloadSinewix };

const fetch = require('node-fetch');
const cache = require('./cache');

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE = 'https://api.themoviedb.org/3';
const OPENSUB_BASE = 'https://rest.opensubtitles.org';

// TMDB: İçeriğin Türkçe çevirisi (dub) var mı kontrol et
async function checkTMDB(imdbId, type) {
  if (!TMDB_API_KEY) return false;

  try {
    // IMDB ID'den TMDB ID'ye çevir
    const findRes = await fetch(
      `${TMDB_BASE}/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`,
      { timeout: 8000 }
    );
    if (!findRes.ok) return false;
    const findData = await findRes.json();

    const results =
      type === 'movie'
        ? findData.movie_results
        : findData.tv_results;

    if (!results || results.length === 0) return false;
    const tmdbId = results[0].id;
    const tmdbType = type === 'movie' ? 'movie' : 'tv';

    // Türkçe translations kontrolü
    const transRes = await fetch(
      `${TMDB_BASE}/${tmdbType}/${tmdbId}/translations?api_key=${TMDB_API_KEY}`,
      { timeout: 8000 }
    );
    if (!transRes.ok) return false;
    const transData = await transRes.json();

    const trTranslation = transData.translations?.find(
      (t) => t.iso_639_1 === 'tr' && t.data?.overview?.length > 10
    );

    // Alternatif: Release dates kontrolü (Türkiye'de yayınlandı mı)
    if (type === 'movie') {
      const relRes = await fetch(
        `${TMDB_BASE}/movie/${tmdbId}/release_dates?api_key=${TMDB_API_KEY}`,
        { timeout: 8000 }
      );
      if (relRes.ok) {
        const relData = await relRes.json();
        const trRelease = relData.results?.find((r) => r.iso_3166_1 === 'TR');
        // Türkiye'de theatrical veya dijital yayın varsa dublaj ihtimali yüksek
        if (trRelease?.release_dates?.some((d) => [1, 2, 3, 4].includes(d.type))) {
          return true;
        }
      }
    }

    return !!trTranslation;
  } catch (err) {
    console.error('TMDB check error:', err.message);
    return false;
  }
}

// OpenSubtitles: Türkçe dublaj altyazısı var mı kontrol et
async function checkOpenSubtitles(imdbId) {
  try {
    const cleanId = imdbId.replace('tt', '');
    const res = await fetch(
      `${OPENSUB_BASE}/search/imdbid-${cleanId}/sublanguageid-tur`,
      {
        headers: {
          'User-Agent': 'TRDubAddon v1.0',
          'X-User-Agent': 'TRDubAddon v1.0',
        },
        timeout: 8000,
      }
    );
    if (!res.ok) return false;
    const data = await res.json();

    // Türkçe dublaj altyazısı ara (SubFormat: dvd, bluray içerenler genellikle dub)
    if (!Array.isArray(data) || data.length === 0) return false;

    const hasDub = data.some((sub) => {
      const subType = (sub.SubType || '').toLowerCase();
      const movieRelName = (sub.MovieReleaseName || '').toLowerCase();
      const fileName = (sub.SubFileName || '').toLowerCase();
      return (
        subType.includes('dub') ||
        movieRelName.includes('truefrench') ||
        movieRelName.includes('dubbed') ||
        movieRelName.includes('dublaj') ||
        fileName.includes('dubbed') ||
        fileName.includes('dublaj') ||
        fileName.includes('dub')
      );
    });

    return hasDub;
  } catch (err) {
    console.error('OpenSubtitles check error:', err.message);
    return false;
  }
}

// Ana kontrol fonksiyonu - tüm kaynakları kombine eder
async function checkTurkishDub(imdbId, type) {
  const cacheKey = `dub:${imdbId}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Paralel kontrol
  const [tmdbResult, opensubResult] = await Promise.all([
    checkTMDB(imdbId, type),
    checkOpenSubtitles(imdbId),
  ]);

  // Herhangi biri true dönerse Türkçe dublaj var kabul et
  const result = tmdbResult || opensubResult;

  // Sonucu 24 saat cache'le
  cache.set(cacheKey, result, 60 * 60 * 24);
  return result;
}

module.exports = { checkTurkishDub };

const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const fetch = require('node-fetch');
const cache = require('./lib/cache');

const SINEWIX_BASE = 'https://sinewix.onrender.com';
const TMDB_BASE = 'https://api.themoviedb.org/3';

const manifest = {
  id: 'org.trdub.addon',
  name: 'dublajtr',
  version: '1.2.0',
  description: "Sinewix'teki Türkçe dublaj içeriklere 🇹🇷 bayrağı ekler.",
  logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Flag_of_Turkey.svg/320px-Flag_of_Turkey.svg.png',
  resources: ['catalog', 'meta'],
  types: ['movie', 'series'],
  catalogs: [
    {
      type: 'movie',
      id: 'tr-dub-sinewix-movies',
      name: '🇹🇷 Filmler (Türkçe Dublaj)',
      extra: [{ name: 'skip' }],
    },
    {
      type: 'series',
      id: 'tr-dub-sinewix-series',
      name: '🇹🇷 Diziler (Türkçe Dublaj)',
      extra: [{ name: 'skip' }],
    },
  ],
  idPrefixes: ['tt', 'sinewix'],
};

const builder = new addonBuilder(manifest);

// Sinewix'ten tek sayfa içerik çek
async function fetchSinewixPage(type, skip) {
  const sinewixType = type === 'movie' ? 'movie' : 'series';
  const catalogId = type === 'movie' ? 'sinewix-movies' : 'sinewix-series';
  const url = skip === 0
    ? `${SINEWIX_BASE}/catalog/${sinewixType}/${catalogId}.json`
    : `${SINEWIX_BASE}/catalog/${sinewixType}/${catalogId}/skip=${skip}.json`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      timeout: 12000,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.metas || [];
  } catch (err) {
    console.error(`[Sinewix] Fetch error (${type}, skip=${skip}):`, err.message);
    return [];
  }
}

// TMDB'de başlık + yıl ile ara, IMDB ID döndür
async function getTmdbImdbId(name, type, year) {
  const TMDB_API_KEY = process.env.TMDB_API_KEY;
  if (!TMDB_API_KEY) return null;

  const cacheKey = `tmdb-search:${type}:${name}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const tmdbType = type === 'movie' ? 'movie' : 'tv';
    const yearParam = year ? `&${type === 'movie' ? 'primary_release_year' : 'first_air_date_year'}=${year}` : '';
    const searchRes = await fetch(
      `${TMDB_BASE}/search/${tmdbType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(name)}&language=tr-TR${yearParam}`,
      { timeout: 8000 }
    );
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const result = searchData.results?.[0];
    if (!result) {
      cache.set(cacheKey, null, 60 * 60 * 24);
      return null;
    }

    // TMDB ID'den external IDs al (IMDB ID için)
    const extRes = await fetch(
      `${TMDB_BASE}/${tmdbType}/${result.id}/external_ids?api_key=${TMDB_API_KEY}`,
      { timeout: 8000 }
    );
    if (!extRes.ok) return null;
    const extData = await extRes.json();
    const imdbId = extData.imdb_id || null;

    cache.set(cacheKey, imdbId, 60 * 60 * 24);
    return imdbId;
  } catch (err) {
    console.error(`[TMDB] Search error (${name}):`, err.message);
    return null;
  }
}

// Türkçe dublaj kontrolü
async function checkTurkishDub(name, type, year) {
  const cacheKey = `dub:${type}:${name}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const TMDB_API_KEY = process.env.TMDB_API_KEY;
  if (!TMDB_API_KEY) return false;

  try {
    const imdbId = await getTmdbImdbId(name, type, year);
    if (!imdbId) {
      cache.set(cacheKey, false, 60 * 60 * 12);
      return false;
    }

    const tmdbType = type === 'movie' ? 'movie' : 'tv';

    // TMDB ID bul
    const findRes = await fetch(
      `${TMDB_BASE}/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`,
      { timeout: 8000 }
    );
    if (!findRes.ok) {
      cache.set(cacheKey, false, 60 * 60 * 1);
      return false;
    }
    const findData = await findRes.json();
    const results = type === 'movie' ? findData.movie_results : findData.tv_results;
    if (!results?.length) {
      cache.set(cacheKey, false, 60 * 60 * 12);
      return false;
    }
    const tmdbId = results[0].id;

    // Watch providers — TR'de var mı?
    const [providerRes, transRes] = await Promise.all([
      fetch(`${TMDB_BASE}/${tmdbType}/${tmdbId}/watch/providers?api_key=${TMDB_API_KEY}`, { timeout: 8000 }),
      fetch(`${TMDB_BASE}/${tmdbType}/${tmdbId}/translations?api_key=${TMDB_API_KEY}`, { timeout: 8000 }),
    ]);

    let hasInTR = false;
    if (providerRes.ok) {
      const pd = await providerRes.json();
      const trP = pd.results?.TR;
      hasInTR = !!(trP?.flatrate || trP?.buy || trP?.free || trP?.ads);
    }

    let hasTurkishTranslation = false;
    if (transRes.ok) {
      const td = await transRes.json();
      hasTurkishTranslation = td.translations?.some(
        (t) => t.iso_639_1 === 'tr' && (t.data?.title || t.data?.name || t.data?.overview)
      );
    }

    const result = !!(hasInTR && hasTurkishTranslation);
    console.log(`[DUB] "${name}" → TR provider: ${hasInTR}, TR trans: ${hasTurkishTranslation} → ${result ? '🇹🇷' : '❌'}`);

    cache.set(cacheKey, result, 60 * 60 * 24);
    return result;
  } catch (err) {
    console.error(`[DUB] Error (${name}):`, err.message);
    cache.set(cacheKey, false, 60 * 60 * 1);
    return false;
  }
}

// CATALOG handler
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const skip = parseInt(extra?.skip) || 0;
  const cacheKey = `catalog:${type}:${skip}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const metas = await fetchSinewixPage(type, skip);
  if (!metas.length) return { metas: [] };

  // Paralel dublaj kontrolü (max 10 aynı anda)
  const results = [];
  const batchSize = 10;
  for (let i = 0; i < metas.length; i += batchSize) {
    const batch = metas.slice(i, i + batchSize);
    const checked = await Promise.all(
      batch.map(async (meta) => {
        const year = meta.releaseInfo ? parseInt(meta.releaseInfo) : null;
        const hasTrDub = await checkTurkishDub(meta.name, type, year);
        if (hasTrDub) {
          return { ...meta, name: `🇹🇷 ${meta.name}` };
        }
        return meta;
      })
    );
    results.push(...checked);
  }

  const response = { metas: results };
  cache.set(cacheKey, response, 60 * 60 * 6);
  return response;
});

// META handler
builder.defineMetaHandler(async ({ type, id }) => {
  // Sinewix meta'yı doğrudan Sinewix'ten çek
  try {
    const sinewixType = type === 'movie' ? 'movie' : 'series';
    const res = await fetch(`${SINEWIX_BASE}/meta/${sinewixType}/${id}.json`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    });
    if (!res.ok) return { meta: null };
    const data = await res.json();
    const meta = data.meta;
    if (!meta) return { meta: null };

    const year = meta.releaseInfo ? parseInt(meta.releaseInfo) : null;
    const hasTrDub = await checkTurkishDub(meta.name, type, year);
    if (hasTrDub) {
      meta.name = `🇹🇷 ${meta.name}`;
      meta.description = `🇹🇷 Bu içerik Türkçe dublaj ile mevcut.\n\n${meta.description || ''}`;
    }

    return { meta };
  } catch (err) {
    console.error('[Meta] Error:', err.message);
    return { meta: null };
  }
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
console.log(`🇹🇷 TR Dub Addon çalışıyor: http://localhost:${port}`);

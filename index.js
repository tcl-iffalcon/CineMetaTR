const express = require('express');
const fetch = require('node-fetch');
const cache = require('./lib/cache');

const SINEWIX_BASE = 'https://sinewix.onrender.com';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const PORT = process.env.PORT || 7000;

const app = express();
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

// ── MANIFEST ─────────────────────────────────────────────────────────────────
const manifest = {
  id: 'org.trdub.addon',
  name: 'dublajtr',
  version: '1.4.0',
  description: "Sinewix'teki Türkçe dublaj içeriklere 🇹🇷 bayrağı ekler.",
  logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Flag_of_Turkey.svg/320px-Flag_of_Turkey.svg.png',
  resources: ['catalog', 'meta'],
  types: ['movie', 'series'],
  catalogs: [
    {
      type: 'movie',
      id: 'tr-dub-sinewix-movies',
      name: '🇹🇷 Filmler (Türkçe Dublaj)',
      extra: [
        { name: 'skip', isRequired: false },
        { name: 'search', isRequired: false },
      ],
    },
    {
      type: 'series',
      id: 'tr-dub-sinewix-series',
      name: '🇹🇷 Diziler (Türkçe Dublaj)',
      extra: [
        { name: 'skip', isRequired: false },
        { name: 'search', isRequired: false },
      ],
    },
  ],
  idPrefixes: ['tt', 'sinewix'],
  behaviorHints: { adult: false, p2p: false },
};

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/manifest.json'));
app.get('/manifest.json', (req, res) => res.json(manifest));

app.get('/catalog/:type/:id/:extra.json', handleCatalog);
app.get('/catalog/:type/:id.json', handleCatalog);
app.get('/meta/:type/:id.json', handleMeta);

// ── CATALOG HANDLER ───────────────────────────────────────────────────────────
async function handleCatalog(req, res) {
  const { type, id } = req.params;
  const extraStr = req.params.extra || '';

  let skip = 0;
  let searchQuery = null;

  if (extraStr) {
    for (const part of extraStr.split('&')) {
      const [k, v] = part.split('=');
      if (k === 'skip') skip = parseInt(v) || 0;
      if (k === 'search') searchQuery = decodeURIComponent(v || '');
    }
  }
  if (req.query.skip) skip = parseInt(req.query.skip) || 0;
  if (req.query.search) searchQuery = req.query.search;

  console.log(`[Catalog] type=${type} id=${id} skip=${skip} search=${searchQuery || 'none'}`);

  try {
    if (searchQuery) {
      const cacheKey = `search:${type}:${searchQuery}`;
      const cached = cache.get(cacheKey);
      if (cached) return res.json(cached);

      const metas = await searchCinemeta(type, searchQuery);
      if (!metas.length) return res.json({ metas: [] });

      const results = await applyDubFlags(metas, type);
      const response = { metas: results };
      cache.set(cacheKey, response, 60 * 60 * 3);
      return res.json(response);
    }

    const cacheKey = `catalog:${type}:${skip}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log(`[Catalog] Cache hit: ${cacheKey}`);
      return res.json(cached);
    }

    const metas = await fetchSinewixPages(type, skip);
    if (!metas.length) return res.json({ metas: [] });

    const results = await applyDubFlags(metas, type);
    const response = { metas: results };
    cache.set(cacheKey, response, 60 * 60 * 6);
    return res.json(response);
  } catch (err) {
    console.error('[Catalog] Error:', err.message);
    return res.json({ metas: [] });
  }
}

// ── META HANDLER ──────────────────────────────────────────────────────────────
async function handleMeta(req, res) {
  const { type, id } = req.params;
  try {
    const sinewixType = type === 'movie' ? 'movie' : 'series';
    const r = await fetch(`${SINEWIX_BASE}/meta/${sinewixType}/${id}.json`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    });
    if (!r.ok) return res.json({ meta: null });
    const data = await r.json();
    const meta = data.meta;
    if (!meta) return res.json({ meta: null });

    const year = meta.releaseInfo ? parseInt(meta.releaseInfo) : null;
    const hasTrDub = await checkTurkishDub(meta.name, type, year);
    if (hasTrDub) {
      meta.name = `🇹🇷 ${meta.name}`;
      meta.description = `🇹🇷 Bu içerik Türkçe dublaj ile mevcut.\n\n${meta.description || ''}`;
    }
    return res.json({ meta });
  } catch (err) {
    console.error('[Meta] Error:', err.message);
    return res.json({ meta: null });
  }
}

// ── SİNEWİX ──────────────────────────────────────────────────────────────────
async function fetchSinewixPage(type, sinewixSkip) {
  const sinewixType = type === 'movie' ? 'movie' : 'series';
  const catalogId = type === 'movie' ? 'sinewix-movies' : 'sinewix-series';
  const url = sinewixSkip === 0
    ? `${SINEWIX_BASE}/catalog/${sinewixType}/${catalogId}.json`
    : `${SINEWIX_BASE}/catalog/${sinewixType}/${catalogId}/skip=${sinewixSkip}.json`;

  console.log(`[Sinewix] GET ${url}`);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      timeout: 20000,
    });
    if (!r.ok) { console.error(`[Sinewix] HTTP ${r.status}`); return []; }
    const data = await r.json();
    const metas = data.metas || [];
    console.log(`[Sinewix] ${metas.length} items (skip=${sinewixSkip})`);
    return metas;
  } catch (err) {
    console.error(`[Sinewix] Error (skip=${sinewixSkip}):`, err.message);
    return [];
  }
}

async function fetchSinewixPages(type, nuvioSkip) {
  const [p1, p2] = await Promise.all([
    fetchSinewixPage(type, nuvioSkip),
    fetchSinewixPage(type, nuvioSkip + 12),
  ]);
  return [...p1, ...p2];
}

// ── TMDB ──────────────────────────────────────────────────────────────────────
async function getTmdbImdbId(name, type, year) {
  const TMDB_API_KEY = process.env.TMDB_API_KEY;
  if (!TMDB_API_KEY) return null;

  const cacheKey = `tmdb-search:${type}:${name}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const tmdbType = type === 'movie' ? 'movie' : 'tv';
    const yearParam = year
      ? `&${type === 'movie' ? 'primary_release_year' : 'first_air_date_year'}=${year}`
      : '';
    const r = await fetch(
      `${TMDB_BASE}/search/${tmdbType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(name)}&language=tr-TR${yearParam}`,
      { timeout: 8000 }
    );
    if (!r.ok) return null;
    const d = await r.json();
    const result = d.results?.[0];
    if (!result) { cache.set(cacheKey, null, 86400); return null; }

    const extR = await fetch(
      `${TMDB_BASE}/${tmdbType}/${result.id}/external_ids?api_key=${TMDB_API_KEY}`,
      { timeout: 8000 }
    );
    if (!extR.ok) return null;
    const extD = await extR.json();
    const imdbId = extD.imdb_id || null;
    cache.set(cacheKey, imdbId, 86400);
    return imdbId;
  } catch (err) {
    console.error(`[TMDB] Search error (${name}):`, err.message);
    return null;
  }
}

async function checkTurkishDub(name, type, year) {
  const cacheKey = `dub:${type}:${name}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const TMDB_API_KEY = process.env.TMDB_API_KEY;
  if (!TMDB_API_KEY) return false;

  try {
    const imdbId = await getTmdbImdbId(name, type, year);
    if (!imdbId) { cache.set(cacheKey, false, 43200); return false; }

    const tmdbType = type === 'movie' ? 'movie' : 'tv';
    const findR = await fetch(
      `${TMDB_BASE}/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`,
      { timeout: 8000 }
    );
    if (!findR.ok) { cache.set(cacheKey, false, 3600); return false; }
    const findD = await findR.json();
    const results = type === 'movie' ? findD.movie_results : findD.tv_results;
    if (!results?.length) { cache.set(cacheKey, false, 43200); return false; }
    const tmdbId = results[0].id;

    const [provR, transR] = await Promise.all([
      fetch(`${TMDB_BASE}/${tmdbType}/${tmdbId}/watch/providers?api_key=${TMDB_API_KEY}`, { timeout: 8000 }),
      fetch(`${TMDB_BASE}/${tmdbType}/${tmdbId}/translations?api_key=${TMDB_API_KEY}`, { timeout: 8000 }),
    ]);

    let hasInTR = false;
    if (provR.ok) {
      const pd = await provR.json();
      const trP = pd.results?.TR;
      hasInTR = !!(trP?.flatrate || trP?.buy || trP?.free || trP?.ads);
    }

    let hasTurkishTranslation = false;
    if (transR.ok) {
      const td = await transR.json();
      hasTurkishTranslation = td.translations?.some(
        (t) => t.iso_639_1 === 'tr' && (t.data?.title || t.data?.name || t.data?.overview)
      );
    }

    const result = !!(hasInTR && hasTurkishTranslation);
    console.log(`[DUB] "${name}" → hasInTR:${hasInTR} hasTrans:${hasTurkishTranslation} → ${result ? '🇹🇷' : '❌'}`);
    cache.set(cacheKey, result, 86400);
    return result;
  } catch (err) {
    console.error(`[DUB] Error (${name}):`, err.message);
    cache.set(cacheKey, false, 3600);
    return false;
  }
}

// ── CİNEMETA ─────────────────────────────────────────────────────────────────
async function searchCinemeta(type, query) {
  try {
    const url = `https://v3-cinemeta.strem.io/catalog/${type}/top/search=${encodeURIComponent(query)}.json`;
    const r = await fetch(url, { timeout: 10000 });
    if (!r.ok) return [];
    const d = await r.json();
    return d.metas || [];
  } catch (err) {
    console.error('[Cinemeta] Error:', err.message);
    return [];
  }
}

// ── DUBLAJ BAYRAGI ────────────────────────────────────────────────────────────
async function applyDubFlags(metas, type, batchSize = 10) {
  const results = [];
  for (let i = 0; i < metas.length; i += batchSize) {
    const batch = metas.slice(i, i + batchSize);
    const checked = await Promise.all(
      batch.map(async (meta) => {
        const year = meta.releaseInfo ? parseInt(meta.releaseInfo) : null;
        const hasTrDub = await checkTurkishDub(meta.name, type, year);
        return hasTrDub ? { ...meta, name: `🇹🇷 ${meta.name}` } : meta;
      })
    );
    results.push(...checked);
  }
  return results;
}

// ── BAŞLAT ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🇹🇷 TR Dub Addon çalışıyor: http://localhost:${PORT}`);
  console.log(`   Manifest: http://localhost:${PORT}/manifest.json`);
});

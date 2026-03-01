const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const { fetchCatalog, fetchMeta } = require('./lib/cinemeta');
const { checkTurkishDub } = require('./lib/dubChecker');
const cache = require('./lib/cache');

const manifest = {
  id: 'org.trdub.addon',
  version: '1.0.0',
  name: '🇹🇷 Türkçe Dublaj',
  description: 'Cinemeta katalogunda Türkçe dublaj olan içeriklere 🇹🇷 bayrağı ekler.',
  logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Flag_of_Turkey.svg/320px-Flag_of_Turkey.svg.png',
  resources: ['catalog', 'meta'],
  types: ['movie', 'series'],
  catalogs: [
    {
      type: 'movie',
      id: 'tr-dub-top-movies',
      name: '🇹🇷 Filmler (Türkçe Dublaj)',
      extra: [{ name: 'skip' }],
    },
    {
      type: 'series',
      id: 'tr-dub-top-series',
      name: '🇹🇷 Diziler (Türkçe Dublaj)',
      extra: [{ name: 'skip' }],
    },
  ],
  idPrefixes: ['tt'],
};

const builder = new addonBuilder(manifest);

// CATALOG handler
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const skip = parseInt(extra?.skip) || 0;
  const cacheKey = `catalog:${type}:${skip}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // Cinemeta'dan katalog çek
  const cinemetaType = type === 'movie' ? 'movie' : 'series';
  const cinemetaCatalogId = type === 'movie' ? 'top' : 'top';
  const metas = await fetchCatalog(cinemetaType, cinemetaCatalogId, skip);

  // Her içerik için Türkçe dublaj kontrolü yap (paralel, batch halinde)
  const results = await Promise.all(
    metas.map(async (meta) => {
      const hasTrDub = await checkTurkishDub(meta.id, type);
      if (hasTrDub) {
        return {
          ...meta,
          name: `🇹🇷 ${meta.name}`,
        };
      }
      return meta;
    })
  );

  const response = { metas: results };
  cache.set(cacheKey, response, 60 * 60 * 6); // 6 saat cache
  return response;
});

// META handler
builder.defineMetaHandler(async ({ type, id }) => {
  const cacheKey = `meta:${type}:${id}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const meta = await fetchMeta(type, id);
  if (!meta) return { meta: null };

  const hasTrDub = await checkTurkishDub(id, type);
  if (hasTrDub) {
    meta.name = `🇹🇷 ${meta.name}`;
    meta.description = `🇹🇷 Bu içerik Türkçe dublaj ile mevcut.\n\n${meta.description || ''}`;
  }

  const response = { meta };
  cache.set(cacheKey, response, 60 * 60 * 12); // 12 saat cache
  return response;
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
console.log(`🇹🇷 TR Dub Addon çalışıyor: http://localhost:${port}`);

// Başlangıçta Sinewix kataloglarını arka planda yükle
const { preloadSinewix } = require('./lib/dubChecker');
setTimeout(() => {
  console.log('[Sinewix] Kataloglar arka planda yükleniyor...');
  preloadSinewix();
}, 3000);

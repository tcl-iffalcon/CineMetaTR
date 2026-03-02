const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const { fetchCatalog, fetchMeta } = require('./lib/cinemeta');
const { checkTurkishDub } = require('./lib/dubChecker');
const cache = require('./lib/cache');

const manifest = {
  id: 'org.trdub.addon',
  name: 'dublajtr',
  version: '1.0.0',
  description: 'Sinewix\'te Türkçe dublaj olan içerikleri 🇹🇷 bayrağıyla listeler.',
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

// CATALOG handler — sadece Sinewix'te olan içerikleri göster
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const skip = parseInt(extra?.skip) || 0;
  const cacheKey = `catalog:${type}:${skip}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const metas = await fetchCatalog(type, 'top', skip);

  const results = await Promise.all(
    metas.map(async (meta) => {
      // Poster eksikse Cinemeta meta endpoint'inden tamamla
      let finalMeta = meta;
      if (!meta.poster && meta.id) {
        const fullMeta = await fetchMeta(type, meta.id);
        if (fullMeta) finalMeta = { ...fullMeta, ...meta, poster: fullMeta.poster };
      }

      const hasTrDub = await checkTurkishDub(finalMeta.id, type);
      if (!hasTrDub) return null; // Sinewix'te yoksa kataloğa ekleme

      return {
        ...finalMeta,
        name: `🇹🇷 ${finalMeta.name}`,
      };
    })
  );

  // null olanları filtrele (Sinewix'te olmayan içerikler)
  const filtered = results.filter(Boolean);
  const response = { metas: filtered };
  cache.set(cacheKey, response, 60 * 60 * 6); // 6 saat
  return response;
});

// META handler — içerik detay sayfasında bayrağı göster
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
  cache.set(cacheKey, response, 60 * 60 * 12); // 12 saat
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

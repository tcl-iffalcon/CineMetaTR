const fetch = require('node-fetch');

const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';

async function fetchCatalog(type, catalogId, skip = 0) {
  try {
    const url = `${CINEMETA_BASE}/catalog/${type}/${catalogId}/skip=${skip}.json`;
    const res = await fetch(url, { timeout: 10000 });
    if (!res.ok) throw new Error(`Cinemeta HTTP ${res.status}`);
    const data = await res.json();
    return data.metas || [];
  } catch (err) {
    console.error('Cinemeta catalog fetch error:', err.message);
    return [];
  }
}

async function fetchMeta(type, id) {
  try {
    const url = `${CINEMETA_BASE}/meta/${type}/${id}.json`;
    const res = await fetch(url, { timeout: 10000 });
    if (!res.ok) throw new Error(`Cinemeta HTTP ${res.status}`);
    const data = await res.json();
    return data.meta || null;
  } catch (err) {
    console.error('Cinemeta meta fetch error:', err.message);
    return null;
  }
}

module.exports = { fetchCatalog, fetchMeta };

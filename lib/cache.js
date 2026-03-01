// Basit TTL destekli in-memory cache
const store = new Map();

function get(key) {
  const item = store.get(key);
  if (!item) return undefined;
  if (Date.now() > item.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return item.value;
}

function set(key, value, ttlSeconds = 3600) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

function del(key) {
  store.delete(key);
}

function size() {
  return store.size;
}

// Her saat eski kayıtları temizle
setInterval(() => {
  const now = Date.now();
  for (const [key, item] of store.entries()) {
    if (now > item.expiresAt) store.delete(key);
  }
}, 60 * 60 * 1000);

module.exports = { get, set, del, size };

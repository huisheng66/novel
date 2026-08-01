const { parsePositiveInt } = require('./util');

const DEFAULT_TTL_MS = 10 * 1000;
const defaultTtlMs = parsePositiveInt(process.env.PUBLIC_CACHE_TTL_MS, DEFAULT_TTL_MS);
const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }

  return entry.value;
}

function set(key, value, ttlMs = defaultTtlMs) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

function clear(prefix = '') {
  if (!prefix) {
    store.clear();
    return;
  }

  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

function size() {
  return store.size;
}

module.exports = {
  get,
  set,
  clear,
  size,
  defaultTtlMs
};

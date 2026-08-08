const { parsePositiveInt } = require('./util');

// 前台 HTML 默认缓存 5 分钟（可用 PUBLIC_CACHE_TTL_MS 覆盖）
const DEFAULT_TTL_MS = 5 * 60 * 1000;
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

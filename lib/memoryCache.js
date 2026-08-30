const { parsePositiveInt } = require('./util');

const DEFAULT_TTL_MS = 10 * 1000;
const defaultTtlMs = parsePositiveInt(process.env.PUBLIC_CACHE_TTL_MS, DEFAULT_TTL_MS);
// 条目数上限:过期条目只在 key 被再次 get 时删除,一次性阅读的章节会永久驻留,
// 需要定期清扫 + 容量上限兜底,避免长运行内存无界增长
const MAX_ENTRIES = parsePositiveInt(process.env.PUBLIC_CACHE_MAX_ENTRIES, 2000);
const SWEEP_INTERVAL_MS = 60 * 1000;
const store = new Map();

const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  // 全部未过期但超容量时,按插入序淘汰最旧的(Map 迭代序即插入序)
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}, SWEEP_INTERVAL_MS);
if (sweepTimer.unref) sweepTimer.unref();

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

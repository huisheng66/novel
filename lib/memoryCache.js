const { parsePositiveInt } = require('./util');
const redis = require('./redis');

// 前台 HTML 默认缓存 5 分钟（可用 PUBLIC_CACHE_TTL_MS 覆盖）
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const defaultTtlMs = parsePositiveInt(process.env.PUBLIC_CACHE_TTL_MS, DEFAULT_TTL_MS);

/**
 * 创建一个进程内缓存实例。
 *
 * 之所以做成工厂而不只是模块级单例：多实例场景要验证「A 实例清除后 B 实例的
 * 本地缓存也应失效」，测试里需要同时持有两个互不干扰的实例。
 *
 * @param {{ publish?: (prefix: string) => any }} [options]
 *   publish：清除时对外广播（接 Redis 失效频道）。不传则只影响本机。
 */
function createCacheStore({ publish = null } = {}) {
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

  /** 只清本地、不广播；Redis 订阅回调必须走这里，否则会形成广播回环 */
  function clearLocal(prefix = '') {
    if (!prefix) {
      store.clear();
      return;
    }

    for (const key of store.keys()) {
      if (key.startsWith(prefix)) store.delete(key);
    }
  }

  function clear(prefix = '') {
    clearLocal(prefix);
    if (publish) {
      // 广播是对外副作用：失败不应影响本地已经完成的清除
      Promise.resolve()
        .then(() => publish(prefix))
        .catch(() => {});
    }
  }

  function size() {
    return store.size;
  }

  return { get, set, clear, clearLocal, size };
}

// 默认单例：未配置 REDIS_URL 时 publish 是空操作，行为与纯内存完全一致
const cache = createCacheStore({
  publish: prefix => redis.publishInvalidate(prefix)
});

module.exports = {
  get: cache.get,
  set: cache.set,
  clear: cache.clear,
  clearLocal: cache.clearLocal,
  size: cache.size,
  defaultTtlMs,
  createCacheStore
};

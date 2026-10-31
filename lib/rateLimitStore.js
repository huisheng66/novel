// 限流计数的统一入口：默认进程内滑动窗口，配置 REDIS_URL 后跨实例共享。
//
// 语义保持滑动窗口（不是固定窗口）：被拒的请求不占用配额，
// 因此窗口边界不会出现「整点双倍放行」的问题。
//
// 之前在 routes/web-auth.js、routes/admin/auth.js、lib/api/rateLimit.js 各有一份
// 几乎相同的实现（连清理定时器都各来一个），这里收敛成一处。

const redis = require('./redis');
const logger = require('./logger');

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

/** @type {Map<string, number[]>} */
const windows = new Map();
let seq = 0;

function consumeMemory(key, { max, windowMs }) {
  const now = Date.now();
  let list = windows.get(key);
  if (!list) {
    list = [];
    windows.set(key, list);
  }

  while (list.length && list[0] <= now - windowMs) list.shift();

  if (list.length >= max) {
    const retryAfterSec = Math.max(1, Math.ceil((list[0] + windowMs - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  list.push(now);
  return { allowed: true, remaining: Math.max(0, max - list.length), retryAfterSec: 0 };
}

/**
 * Redis 滑动窗口：ZSET 存时间戳，先裁剪过期再计数，MULTI 保证原子。
 * 超限时把自己的记录移除，避免「被拒的请求也在消耗配额」。
 */
async function consumeRedis(client, key, { max, windowMs }) {
  const now = Date.now();
  const redisKey = `codexnovel:rl:${key}`;
  const member = `${now}-${++seq}`;

  const result = await client
    .multi()
    .zremrangebyscore(redisKey, 0, now - windowMs)
    .zadd(redisKey, now, member)
    .zcard(redisKey)
    .pexpire(redisKey, windowMs)
    .exec();

  const count = Number(result[2] && result[2][1]) || 0;

  if (count > max) {
    await client.zrem(redisKey, member);
    const oldest = await client.zrange(redisKey, 0, 0, 'WITHSCORES');
    const oldestMs = oldest && oldest.length >= 2 ? Number(oldest[1]) : now;
    const retryAfterSec = Math.max(1, Math.ceil((oldestMs + windowMs - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  return { allowed: true, remaining: Math.max(0, max - count), retryAfterSec: 0 };
}

/**
 * 消耗一次配额。
 * @param {string} key 桶名（调用方负责包含 IP / 用户等维度）
 * @param {{ max: number, windowMs: number }} opts
 * @returns {Promise<{allowed: boolean, remaining: number, retryAfterSec: number}>}
 */
async function consume(key, { max, windowMs }) {
  const limit = Math.max(1, Number(max) || 1);
  const window = Math.max(1000, Number(windowMs) || 60000);

  const client = redis.getClient();
  if (client) {
    try {
      return await consumeRedis(client, key, { max: limit, windowMs: window });
    } catch (err) {
      // 限流不该因为 Redis 抖动而拒绝正常请求：降级到本机计数
      logger.warn('Redis 限流失败，降级为进程内计数', { err });
    }
  }
  return consumeMemory(key, { max: limit, windowMs: window });
}

function reset() {
  windows.clear();
}

function stats() {
  return { keys: windows.size, backend: redis.isReady() ? 'redis' : 'memory' };
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, list] of windows) {
    if (!list.length || list[list.length - 1] <= now - CLEANUP_INTERVAL_MS) {
      windows.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS);
if (cleanupTimer.unref) cleanupTimer.unref();

module.exports = {
  consume,
  reset,
  stats
};

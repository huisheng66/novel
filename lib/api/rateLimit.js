// App API 限流中间件（计数后端由 lib/rateLimitStore.js 决定：内存 or Redis）

const { parsePositiveInt } = require('../util');
const { ApiError } = require('./errors');
const store = require('../rateLimitStore');

function clientKey(req, prefix) {
  // 只信任 Express 按 trust proxy 配置解析出的真实地址（req.ip）。
  // 直接取 X-Forwarded-For 首段可被客户端伪造，导致限流被绕过。
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown')
    .replace(/^::ffff:/, '')
    .slice(0, 64) || 'unknown';
  const userPart = req.apiUser && req.apiUser.id ? `u${req.apiUser.id}` : 'anon';
  return `${prefix}:${userPart}:${ip}`;
}

/**
 * @param {object} opts
 * @param {string} opts.name 限流桶名
 * @param {number} opts.max 窗口内最大次数
 * @param {number} opts.windowMs 窗口毫秒
 */
function rateLimit({ name, max, windowMs }) {
  const limit = Math.max(1, Number(max) || 60);
  const window = Math.max(1000, Number(windowMs) || 60000);

  return async function rateLimitMiddleware(req, res, next) {
    try {
      // 注意：/auth/* 的限流在鉴权中间件之前，req.apiUser 此时不存在，
      // 因此桶名是「匿名 + IP」；这对暴力破解防护已足够。
      const result = await store.consume(clientKey(req, name), { max: limit, windowMs: window });

      res.set('X-RateLimit-Limit', String(limit));

      if (!result.allowed) {
        res.set('Retry-After', String(result.retryAfterSec));
        res.set('X-RateLimit-Remaining', '0');
        return next(new ApiError(429, 'RATE_LIMITED', `Too many requests, retry after ${result.retryAfterSec}s`));
      }

      res.set('X-RateLimit-Remaining', String(result.remaining));
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

function authRateLimit() {
  return rateLimit({
    name: 'auth',
    max: parsePositiveInt(process.env.API_RATE_LIMIT_AUTH_MAX, 30),
    windowMs: parsePositiveInt(process.env.API_RATE_LIMIT_AUTH_WINDOW_MS, 15 * 60 * 1000)
  });
}

function chapterRateLimit() {
  return rateLimit({
    name: 'chapter',
    max: parsePositiveInt(process.env.API_RATE_LIMIT_CHAPTER_MAX, 180),
    windowMs: parsePositiveInt(process.env.API_RATE_LIMIT_CHAPTER_WINDOW_MS, 60 * 1000)
  });
}

function progressBatchRateLimit() {
  return rateLimit({
    name: 'progress-batch',
    max: parsePositiveInt(process.env.API_RATE_LIMIT_PROGRESS_BATCH_MAX, 60),
    windowMs: parsePositiveInt(process.env.API_RATE_LIMIT_PROGRESS_BATCH_WINDOW_MS, 60 * 1000)
  });
}

/** 测试或运维用：清空窗口（Redis 后端的计数不在此清理） */
function resetRateLimitWindows() {
  store.reset();
}

module.exports = {
  rateLimit,
  authRateLimit,
  chapterRateLimit,
  progressBatchRateLimit,
  resetRateLimitWindows
};

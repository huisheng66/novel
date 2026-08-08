// 进程内滑动窗口限流（App API 用；多实例部署时每实例独立计数）

const { parsePositiveInt } = require('../util');
const { ApiError } = require('./errors');

/** @type {Map<string, number[]>} */
const windows = new Map();

function prune(timestamps, windowMs, now) {
  const cutoff = now - windowMs;
  let i = 0;
  while (i < timestamps.length && timestamps[i] <= cutoff) i += 1;
  if (i > 0) timestamps.splice(0, i);
}

function clientKey(req, prefix) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = xf || req.ip || req.socket?.remoteAddress || 'unknown';
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

  return function rateLimitMiddleware(req, res, next) {
    try {
      const key = clientKey(req, name);
      const now = Date.now();
      let list = windows.get(key);
      if (!list) {
        list = [];
        windows.set(key, list);
      }
      prune(list, window, now);

      if (list.length >= limit) {
        const retryAfterSec = Math.max(1, Math.ceil((list[0] + window - now) / 1000));
        res.set('Retry-After', String(retryAfterSec));
        res.set('X-RateLimit-Limit', String(limit));
        res.set('X-RateLimit-Remaining', '0');
        return next(new ApiError(429, 'RATE_LIMITED', `Too many requests, retry after ${retryAfterSec}s`));
      }

      list.push(now);
      res.set('X-RateLimit-Limit', String(limit));
      res.set('X-RateLimit-Remaining', String(Math.max(0, limit - list.length)));
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

/** 测试或运维用：清空窗口 */
function resetRateLimitWindows() {
  windows.clear();
}

module.exports = {
  rateLimit,
  authRateLimit,
  chapterRateLimit,
  progressBatchRateLimit,
  resetRateLimitWindows
};

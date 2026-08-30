// 进程内滑动窗口限速器:用于登录、WebDAV 鉴权等凭据类端点的暴力破解防护
// 语义:check 只读判断是否已封禁;record 记录一次失败;reset 在成功后清除

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function createRateLimiter({ windowMs, max }) {
  const hits = new Map();

  // 定期清理空桶,避免大量一次性 IP 导致内存无界增长
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, arr] of hits) {
      if (arr.length === 0 || arr[arr.length - 1] <= now - windowMs) {
        hits.delete(key);
      }
    }
  }, SWEEP_INTERVAL_MS);
  if (timer.unref) timer.unref();

  function prune(key) {
    const now = Date.now();
    const arr = hits.get(key);
    if (!arr) return [];
    while (arr.length > 0 && arr[0] <= now - windowMs) {
      arr.shift();
    }
    return arr;
  }

  function check(key) {
    const arr = prune(key);
    if (arr.length >= max) {
      const retryAfterSec = Math.max(1, Math.ceil((arr[0] + windowMs - Date.now()) / 1000));
      return { blocked: true, retryAfterSec };
    }
    return { blocked: false, retryAfterSec: 0 };
  }

  function record(key) {
    prune(key);
    let arr = hits.get(key);
    if (!arr) {
      arr = [];
      hits.set(key, arr);
    }
    arr.push(Date.now());
  }

  function reset(key) {
    hits.delete(key);
  }

  return { check, record, reset };
}

module.exports = { createRateLimiter };

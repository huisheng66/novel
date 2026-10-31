const { pool } = require('../db');
const { parsePositiveInt } = require('./util');
const logger = require('./logger');

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_FLUSH_INTERVAL_MS = 1000;
const MAX_QUEUE_SIZE = 10000;

const batchSize = parsePositiveInt(process.env.PAGE_VIEW_BATCH_SIZE, DEFAULT_BATCH_SIZE);
const flushIntervalMs = parsePositiveInt(process.env.PAGE_VIEW_FLUSH_INTERVAL_MS, DEFAULT_FLUSH_INTERVAL_MS);
const maxQueueSize = parsePositiveInt(process.env.PAGE_VIEW_MAX_QUEUE_SIZE, MAX_QUEUE_SIZE);

const queue = [];
let timer = null;
let immediate = null;
let isFlushing = false;
let activeFlush = null;
let dropped = 0;

function compactText(value, length, fallback = '') {
  const text = String(value || fallback);
  return text.slice(0, length);
}

// 列顺序是唯一事实来源：既用于拼 INSERT，也用于取值，避免「加了一列但数组没跟着加」的错位。
const COLUMNS = [
  'visitor_uid',
  'access_token_id',
  'user_id',
  'session_id',
  'visitor_ip',
  'user_agent',
  'path',
  'referrer',
  'novel_id',
  'chapter_id'
];

const TOKEN_COL = COLUMNS.indexOf('access_token_id');
const INSERT_SQL = `INSERT INTO page_views (${COLUMNS.join(', ')}) VALUES ?`;

const NORMALIZERS = {
  visitor_uid: event => compactText(event.visitorUid, 64, 'unknown'),
  access_token_id: event => event.accessTokenId || null,
  user_id: event => event.userId || null,
  session_id: event => compactText(event.sessionId, 64, 'unknown'),
  visitor_ip: event => compactText(event.visitorIp, 64, 'unknown'),
  user_agent: event => compactText(event.userAgent, 255, 'unknown'),
  path: event => compactText(event.path, 255, '/'),
  referrer: event => (event.referrer ? compactText(event.referrer, 255) : null),
  novel_id: event => event.novelId || null,
  chapter_id: event => event.chapterId || null
};

function normalizeEvent(event) {
  return COLUMNS.map(column => NORMALIZERS[column](event));
}

function scheduleFlush() {
  if (timer) return;

  timer = setTimeout(() => {
    timer = null;
    void flush().catch(err => logger.error('page view queue flush failed', { err }));
  }, flushIntervalMs);
  if (timer.unref) timer.unref();
}

function scheduleImmediateFlush() {
  if (immediate) return;

  immediate = setImmediate(() => {
    immediate = null;
    void flush().catch(err => logger.error('page view queue flush failed', { err }));
  });
  if (immediate.unref) immediate.unref();
}

function clearFlushTimer() {
  if (!timer) return;
  clearTimeout(timer);
  timer = null;
}

/** 按 access_token_id 汇总本批增量，维护 total_views / last_seen_at */
async function bumpTokenCounters(batch) {
  const counts = new Map();
  for (const row of batch) {
    const tokenId = row[TOKEN_COL];
    if (!tokenId) continue;
    counts.set(tokenId, (counts.get(tokenId) || 0) + 1);
  }
  if (counts.size === 0) return;

  // 逐 token 更新（token 数通常很少，比扫 page_views 便宜）
  for (const [tokenId, n] of counts) {
    await pool.execute(
      `UPDATE access_tokens
       SET total_views = total_views + ?, last_seen_at = NOW()
       WHERE id = ?`,
      [n, tokenId]
    );
  }
}

function enqueue(event) {
  if (queue.length >= maxQueueSize) {
    queue.shift();
    dropped += 1;
  }

  queue.push(normalizeEvent(event));

  if (queue.length >= batchSize) {
    void flush().catch(err => logger.error('page view queue flush failed', { err }));
  } else {
    scheduleFlush();
  }
}

async function flush() {
  if (isFlushing) {
    await activeFlush;
    return;
  }
  if (queue.length === 0) return;

  clearFlushTimer();
  isFlushing = true;
  const batch = queue.splice(0, batchSize);

  activeFlush = (async () => {
    await pool.query(INSERT_SQL, [batch]);
    try {
      await bumpTokenCounters(batch);
    } catch (err) {
      // 计数失败不影响访问写入
      logger.warn('token counter bump failed', { err });
    }
  })();

  try {
    await activeFlush;
  } catch (err) {
    queue.unshift(...batch);
    throw err;
  } finally {
    isFlushing = false;
    activeFlush = null;
    if (queue.length >= batchSize) {
      scheduleImmediateFlush();
    } else if (queue.length > 0) {
      scheduleFlush();
    }
  }
}

async function flushAll() {
  while (queue.length > 0) {
    await flush();
  }
}

function stats() {
  return {
    queued: queue.length,
    dropped,
    batchSize,
    flushIntervalMs,
    maxQueueSize
  };
}

module.exports = {
  enqueue,
  flush,
  flushAll,
  stats,
  // 仅供测试与诊断：列顺序 / 单条归一化（纯函数，不触发 IO）
  COLUMNS,
  normalizeEvent
};

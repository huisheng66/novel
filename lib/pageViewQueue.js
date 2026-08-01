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

function normalizeEvent(event) {
  return [
    compactText(event.visitorUid, 64, 'unknown'),
    event.accessTokenId || null,
    compactText(event.sessionId, 64, 'unknown'),
    compactText(event.visitorIp, 64, 'unknown'),
    compactText(event.userAgent, 255, 'unknown'),
    compactText(event.path, 255, '/'),
    event.referrer ? compactText(event.referrer, 255) : null,
    event.novelId || null,
    event.chapterId || null
  ];
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
    await pool.query(
      `INSERT INTO page_views (visitor_uid, access_token_id, session_id, visitor_ip, user_agent, path, referrer, novel_id, chapter_id)
       VALUES ?`,
      [batch]
    );
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
  stats
};

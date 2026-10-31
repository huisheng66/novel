// page_views → analytics_daily / analytics_totals 定时聚合

const { pool } = require('../db');
const logger = require('./logger');
const { parsePositiveInt } = require('./util');

const aggregateIntervalMs = parsePositiveInt(
  process.env.ANALYTICS_AGGREGATE_INTERVAL_MS,
  60 * 1000
);
const totalsIntervalMs = parsePositiveInt(
  process.env.ANALYTICS_TOTALS_INTERVAL_MS,
  60 * 60 * 1000
);

let timer = null;
let running = false;
let lastTotalsRefresh = 0;

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 聚合单日 page_views 到 analytics_daily。
 *
 * 注意：不要写成 INSERT ... SELECT ... GROUP BY —— 该天没有数据时 SELECT 不返回任何行，
 * ON DUPLICATE KEY 不会触发，日表里会残留上一次的旧值（访问日志被清理后尤其明显）。
 * 这里先算再 upsert，保证「没有流量」也会被写成 0。
 */
async function aggregateDay(day) {
  const [[agg]] = await pool.query(
    `SELECT
       COUNT(*) AS page_views,
       COUNT(DISTINCT session_id) AS sessions,
       COUNT(DISTINCT visitor_uid) AS users,
       COUNT(DISTINCT user_id) AS readers,
       COUNT(DISTINCT visitor_ip) AS unique_ips,
       COUNT(DISTINCT CASE WHEN novel_id IS NOT NULL THEN novel_id END) AS novel_views,
       COUNT(DISTINCT CASE
         WHEN novel_id IS NOT NULL AND chapter_id IS NOT NULL THEN CONCAT(novel_id, ':', chapter_id)
         ELSE NULL
       END) AS chapter_views
     FROM page_views
     WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [day, day]
  );

  const row = agg || {};
  await pool.execute(
    `INSERT INTO analytics_daily (stat_date, sessions, users, readers, page_views, unique_ips, novel_views, chapter_views)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       sessions = VALUES(sessions),
       users = VALUES(users),
       readers = VALUES(readers),
       page_views = VALUES(page_views),
       unique_ips = VALUES(unique_ips),
       novel_views = VALUES(novel_views),
       chapter_views = VALUES(chapter_views)`,
    [
      day,
      Number(row.sessions) || 0,
      Number(row.users) || 0,
      Number(row.readers) || 0,
      Number(row.page_views) || 0,
      Number(row.unique_ips) || 0,
      Number(row.novel_views) || 0,
      Number(row.chapter_views) || 0
    ]
  );
}

/**
 * 全站 lifetime 去重汇总写入 analytics_totals（全表扫一次，低频执行）。
 * page_views 用 COUNT 精确；sessions/users/ips 为真实 DISTINCT。
 */
async function refreshLifetimeTotals() {
  await pool.query(`
    INSERT INTO analytics_totals (id, page_views, sessions, users, readers, unique_ips, novel_views, chapter_views)
    SELECT
      1,
      COUNT(*) AS page_views,
      COUNT(DISTINCT session_id) AS sessions,
      COUNT(DISTINCT visitor_uid) AS users,
      COUNT(DISTINCT user_id) AS readers,
      COUNT(DISTINCT visitor_ip) AS unique_ips,
      COUNT(DISTINCT CASE WHEN novel_id IS NOT NULL THEN novel_id END) AS novel_views,
      COUNT(DISTINCT CASE
        WHEN novel_id IS NOT NULL AND chapter_id IS NOT NULL THEN CONCAT(novel_id, ':', chapter_id)
        ELSE NULL
      END) AS chapter_views
    FROM page_views
    ON DUPLICATE KEY UPDATE
      page_views = VALUES(page_views),
      sessions = VALUES(sessions),
      users = VALUES(users),
      readers = VALUES(readers),
      unique_ips = VALUES(unique_ips),
      novel_views = VALUES(novel_views),
      chapter_views = VALUES(chapter_views)
  `);
  lastTotalsRefresh = Date.now();
}

/**
 * @param {number} days 回溯天数（含今天）
 * @param {{ forceTotals?: boolean }} [options]
 */
async function runAggregation(days = 2, options = {}) {
  if (running) return;
  running = true;
  try {
    const n = Math.max(1, Math.min(Number(days) || 2, 90));
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    for (let i = 0; i < n; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      await aggregateDay(formatDate(d));
    }

    const needTotals = options.forceTotals
      || !lastTotalsRefresh
      || (Date.now() - lastTotalsRefresh >= totalsIntervalMs);
    if (needTotals) {
      await refreshLifetimeTotals();
    }
  } catch (err) {
    logger.error('analytics aggregation failed', { err });
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  // 启动：回填 14 天 + 强制刷 lifetime
  void runAggregation(14, { forceTotals: true });
  timer = setInterval(() => {
    void runAggregation(2);
  }, aggregateIntervalMs);
  if (timer.unref) timer.unref();
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = {
  start,
  stop,
  runAggregation,
  aggregateDay,
  refreshLifetimeTotals,
  formatDate
};

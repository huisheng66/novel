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

/** 聚合单日 page_views 到 analytics_daily */
async function aggregateDay(day) {
  await pool.query(
    `INSERT INTO analytics_daily (stat_date, sessions, users, page_views, unique_ips, novel_views, chapter_views)
     SELECT
       DATE(created_at) AS stat_date,
       COUNT(DISTINCT session_id) AS sessions,
       COUNT(DISTINCT visitor_uid) AS users,
       COUNT(*) AS page_views,
       COUNT(DISTINCT visitor_ip) AS unique_ips,
       COUNT(DISTINCT CASE WHEN novel_id IS NOT NULL THEN novel_id END) AS novel_views,
       COUNT(DISTINCT CASE WHEN novel_id IS NOT NULL AND chapter_id IS NOT NULL THEN CONCAT(novel_id, ':', chapter_id) END) AS chapter_views
     FROM page_views
     WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY DATE(created_at)
     ON DUPLICATE KEY UPDATE
       sessions = VALUES(sessions),
       users = VALUES(users),
       page_views = VALUES(page_views),
       unique_ips = VALUES(unique_ips),
       novel_views = VALUES(novel_views),
       chapter_views = VALUES(chapter_views)`,
    [day, day]
  );
}

/**
 * 全站 lifetime 去重汇总写入 analytics_totals（全表扫一次，低频执行）。
 * page_views 用 COUNT 精确；sessions/users/ips 为真实 DISTINCT。
 */
async function refreshLifetimeTotals() {
  await pool.query(`
    INSERT INTO analytics_totals (id, page_views, sessions, users, unique_ips, novel_views, chapter_views)
    SELECT
      1,
      COUNT(*) AS page_views,
      COUNT(DISTINCT session_id) AS sessions,
      COUNT(DISTINCT visitor_uid) AS users,
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

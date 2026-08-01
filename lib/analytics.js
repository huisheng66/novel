const { pool } = require('../db');
const logger = require('./logger');

const DEFAULT_AGGREGATE_INTERVAL_MS = 60 * 1000;
const aggregateIntervalMs = (() => {
  const parsed = Number.parseInt(process.env.ANALYTICS_AGGREGATE_INTERVAL_MS, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_AGGREGATE_INTERVAL_MS;
})();

let timer = null;
let running = false;

// 将指定日期(默认昨天)的 page_views 增量聚合到 analytics_daily。
// 当天数据会在每次运行时刷新,保证仪表盘看到当日实时聚合值。
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
     WHERE DATE(created_at) = ?
     GROUP BY DATE(created_at)
     ON DUPLICATE KEY UPDATE
       sessions = VALUES(sessions),
       users = VALUES(users),
       page_views = VALUES(page_views),
       unique_ips = VALUES(unique_ips),
       novel_views = VALUES(novel_views),
       chapter_views = VALUES(chapter_views)`,
    [day]
  );
}

async function runAggregation() {
  if (running) return;
  running = true;
  try {
    // 聚合今天和昨天:今天实时刷新,昨天补全(跨午夜边界)
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    await aggregateDay(formatDate(today));
    await aggregateDay(formatDate(yesterday));
  } catch (err) {
    logger.error('analytics aggregation failed', { err });
  } finally {
    running = false;
  }
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function start() {
  if (timer) return;
  // 启动后立即聚合一次,再按间隔定时运行
  void runAggregation();
  timer = setInterval(() => {
    void runAggregation();
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
  aggregateDay
};

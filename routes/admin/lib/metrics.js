// 数据看板指标：lifetime 读 analytics_totals，趋势读 analytics_daily，明细扫近 7 天

const { pool } = require('../../../db');

function localDayKey(offsetDays = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function getDashboardMetrics() {
  // 全站去重汇总（定时全表聚合写入，看板 O(1) 读取）
  const [[totals]] = await pool.execute(`
    SELECT page_views, sessions, users, readers, unique_ips, novel_views, chapter_views, updated_at
    FROM analytics_totals
    WHERE id = 1
    LIMIT 1
  `);

  // 无无 totals 行时回退日表 SUM（page_views 仍精确）
  let summary;
  if (totals) {
    summary = {
      page_views: Number(totals.page_views || 0),
      sessions: Number(totals.sessions || 0),
      users: Number(totals.users || 0),
      readers: Number(totals.readers || 0),
      unique_ips: Number(totals.unique_ips || 0),
      novels_viewed: Number(totals.novel_views || 0),
      chapters_viewed: Number(totals.chapter_views || 0),
      totals_updated_at: totals.updated_at
    };
  } else {
    const [[sumRow]] = await pool.execute(`
      SELECT
        COALESCE(SUM(page_views), 0) AS page_views,
        COALESCE(SUM(sessions), 0) AS sessions,
        COALESCE(SUM(users), 0) AS users,
        COALESCE(SUM(readers), 0) AS readers,
        COALESCE(SUM(unique_ips), 0) AS unique_ips,
        COALESCE(SUM(novel_views), 0) AS novels_viewed,
        COALESCE(SUM(chapter_views), 0) AS chapters_viewed
      FROM analytics_daily
    `);
    summary = sumRow || {
      page_views: 0,
      sessions: 0,
      users: 0,
      readers: 0,
      unique_ips: 0,
      novels_viewed: 0,
      chapters_viewed: 0
    };
  }

  const [dailyRows] = await pool.execute(`
    SELECT
      DATE_FORMAT(stat_date, '%Y-%m-%d') AS day,
      page_views,
      sessions,
      users,
      readers,
      unique_ips
    FROM analytics_daily
    WHERE stat_date >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
    ORDER BY stat_date ASC
  `);

  const dailyMap = new Map(dailyRows.map(row => [String(row.day).slice(0, 10), row]));
  const dailySeries = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const dayKey = localDayKey(offset);
    const row = dailyMap.get(dayKey) || {};
    dailySeries.push({
      day: dayKey,
      page_views: Number(row.page_views || 0),
      sessions: Number(row.sessions || 0),
      users: Number(row.users || 0),
      readers: Number(row.readers || 0),
      unique_ips: Number(row.unique_ips || 0)
    });
  }

  const [topPaths] = await pool.execute(`
    SELECT path, COUNT(*) AS views
    FROM page_views
    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    GROUP BY path
    ORDER BY views DESC, path ASC
    LIMIT 8
  `);

  const [topNovels] = await pool.execute(`
    SELECT
      COALESCE(n.id, 0) AS id,
      COALESCE(n.title, '未知小说') AS title,
      COUNT(pv.id) AS views
    FROM page_views pv
    LEFT JOIN novels n ON n.id = pv.novel_id
    WHERE pv.novel_id IS NOT NULL
      AND pv.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    GROUP BY n.id, n.title
    ORDER BY views DESC, title ASC
    LIMIT 8
  `);

  const [topIps] = await pool.execute(`
    SELECT
      CASE
        WHEN visitor_ip LIKE '::ffff:%.%' THEN SUBSTRING(visitor_ip, 8)
        WHEN visitor_ip = '::1' THEN '127.0.0.1'
        ELSE visitor_ip
      END AS ip,
      COUNT(*) AS views
    FROM page_views
    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    GROUP BY ip
    ORDER BY views DESC, ip ASC
    LIMIT 8
  `);

  const [userIpStats] = await pool.execute(`
    SELECT
      pv.visitor_uid,
      CASE
        WHEN pv.visitor_ip LIKE '::ffff:%.%' THEN SUBSTRING(pv.visitor_ip, 8)
        WHEN pv.visitor_ip = '::1' THEN '127.0.0.1'
        ELSE pv.visitor_ip
      END AS visitor_ip,
      MAX(t.name) AS user_name,
      MAX(u.username) AS reader_name,
      COUNT(*) AS page_views,
      COUNT(DISTINCT pv.session_id) AS sessions,
      COUNT(DISTINCT pv.path) AS paths,
      COUNT(DISTINCT pv.novel_id) AS novels,
      COUNT(DISTINCT CASE
        WHEN pv.novel_id IS NOT NULL AND pv.chapter_id IS NOT NULL THEN CONCAT(pv.novel_id, ':', pv.chapter_id)
        ELSE NULL
      END) AS chapters,
      DATE_FORMAT(MIN(pv.created_at), '%Y-%m-%d %H:%i:%s') AS first_seen,
      DATE_FORMAT(MAX(pv.created_at), '%Y-%m-%d %H:%i:%s') AS last_seen
    FROM page_views pv
    LEFT JOIN access_tokens t ON t.id = pv.access_token_id
    LEFT JOIN users u ON u.id = pv.user_id
    WHERE pv.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    GROUP BY pv.visitor_uid, visitor_ip
    ORDER BY page_views DESC, last_seen DESC
    LIMIT 50
  `);

  const [latestViews] = await pool.execute(`
    SELECT
      DATE_FORMAT(pv.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
      pv.session_id,
      pv.visitor_uid,
      CASE
        WHEN pv.visitor_ip LIKE '::ffff:%.%' THEN SUBSTRING(pv.visitor_ip, 8)
        WHEN pv.visitor_ip = '::1' THEN '127.0.0.1'
        ELSE pv.visitor_ip
      END AS visitor_ip,
      pv.path,
      pv.novel_id,
      pv.chapter_id,
      u.username AS reader_name,
      n.title AS novel_title,
      c.title AS chapter_title,
      c.chapter_number
    FROM page_views pv
    LEFT JOIN users u ON u.id = pv.user_id
    LEFT JOIN novels n ON n.id = pv.novel_id
    LEFT JOIN chapters c ON c.novel_id = pv.novel_id AND c.chapter_number = pv.chapter_id
    ORDER BY pv.created_at DESC
    LIMIT 20
  `);

  return {
    summary,
    dailyRows,
    dailySeries,
    topPaths,
    topNovels,
    topIps,
    userIpStats,
    latestViews
  };
}

module.exports = { getDashboardMetrics };

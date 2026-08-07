// Token 用户统计：total_views 读 access_tokens 计数；明细只扫近窗 page_views

const { pool } = require('../../../db');

const RECENT_DAYS = 30;
const RECENT_VIEWS_DAYS = 7;

async function getTokenUsers() {
  const [tokens] = await pool.execute(`
    SELECT
      t.id,
      t.name,
      t.token,
      t.allowed_novel_id,
      n_allowed.title AS allowed_novel_title,
      t.is_active,
      DATE_FORMAT(t.risk_paused_until, '%Y-%m-%d %H:%i:%s') AS risk_paused_until,
      t.risk_paused_until > NOW() AS is_risk_paused,
      t.risk_reason,
      t.total_views,
      DATE_FORMAT(t.last_seen_at, '%Y-%m-%d %H:%i:%s') AS last_seen,
      t.created_at
    FROM access_tokens t
    LEFT JOIN novels n_allowed ON n_allowed.id = t.allowed_novel_id
    ORDER BY t.is_active DESC, is_risk_paused DESC, t.id DESC
  `);

  if (tokens.length === 0) return [];

  const ids = tokens.map(token => token.id);
  const placeholders = ids.map(() => '?').join(',');

  // 近 5 分钟（风控相关，数据量小）
  const [stat5m] = await pool.execute(
    `SELECT
       access_token_id,
       COUNT(*) AS views_5m,
       COUNT(CASE
         WHEN novel_id IS NOT NULL AND chapter_id IS NOT NULL THEN 1
       END) AS chapter_views_5m
     FROM page_views
     WHERE access_token_id IN (${placeholders})
       AND created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
     GROUP BY access_token_id`,
    ids
  );

  // 近 30 天 IP/会话去重（展示用，不全表扫）
  const [statPeriod] = await pool.execute(
    `SELECT
       access_token_id,
       COUNT(DISTINCT visitor_ip) AS ip_count,
       COUNT(DISTINCT session_id) AS session_count
     FROM page_views
     WHERE access_token_id IN (${placeholders})
       AND created_at >= DATE_SUB(NOW(), INTERVAL ${RECENT_DAYS} DAY)
     GROUP BY access_token_id`,
    ids
  );

  const map5m = new Map(stat5m.map(row => [row.access_token_id, row]));
  const mapPeriod = new Map(statPeriod.map(row => [row.access_token_id, row]));

  for (const token of tokens) {
    const s5 = map5m.get(token.id) || {};
    const sp = mapPeriod.get(token.id) || {};
    token.total_views = Number(token.total_views || 0);
    token.views_5m = Number(s5.views_5m || 0);
    token.chapter_views_5m = Number(s5.chapter_views_5m || 0);
    token.ip_count = Number(sp.ip_count || 0);
    token.session_count = Number(sp.session_count || 0);
  }

  tokens.sort((a, b) => {
    if (a.is_active !== b.is_active) return b.is_active - a.is_active;
    if (a.is_risk_paused !== b.is_risk_paused) return b.is_risk_paused - a.is_risk_paused;
    if (Number(b.views_5m) !== Number(a.views_5m)) return Number(b.views_5m) - Number(a.views_5m);
    if (Number(b.total_views) !== Number(a.total_views)) return Number(b.total_views) - Number(a.total_views);
    return b.id - a.id;
  });

  const [ipRows] = await pool.execute(
    `SELECT
       access_token_id,
       CASE
         WHEN visitor_ip LIKE '::ffff:%.%' THEN SUBSTRING(visitor_ip, 8)
         WHEN visitor_ip = '::1' THEN '127.0.0.1'
         ELSE visitor_ip
       END AS visitor_ip,
       COUNT(*) AS total_views,
       COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE) THEN 1 END) AS views_5m,
       DATE_FORMAT(MAX(created_at), '%Y-%m-%d %H:%i:%s') AS last_seen
     FROM page_views
     WHERE access_token_id IN (${placeholders})
       AND created_at >= DATE_SUB(NOW(), INTERVAL ${RECENT_DAYS} DAY)
     GROUP BY access_token_id, visitor_ip
     ORDER BY total_views DESC, visitor_ip ASC`,
    ids
  );

  const recentViewLimit = Math.min(ids.length * 10, 1000);
  const [viewRows] = await pool.execute(
    `SELECT
       pv.access_token_id,
       DATE_FORMAT(pv.created_at, '%Y-%m-%d %H:%i:%s') AS visited_at,
       CASE
         WHEN pv.visitor_ip LIKE '::ffff:%.%' THEN SUBSTRING(pv.visitor_ip, 8)
         WHEN pv.visitor_ip = '::1' THEN '127.0.0.1'
         ELSE pv.visitor_ip
       END AS visitor_ip,
       pv.path,
       pv.novel_id,
       pv.chapter_id,
       n.title AS novel_title,
       c.title AS chapter_title,
       c.chapter_number
     FROM page_views pv
     LEFT JOIN novels n ON n.id = pv.novel_id
     LEFT JOIN chapters c ON c.novel_id = pv.novel_id AND c.chapter_number = pv.chapter_id
     WHERE pv.access_token_id IN (${placeholders})
       AND pv.created_at >= DATE_SUB(NOW(), INTERVAL ${RECENT_VIEWS_DAYS} DAY)
     ORDER BY pv.created_at DESC
     LIMIT ${recentViewLimit}`,
    ids
  );

  const ipMap = new Map();
  for (const row of ipRows) {
    const list = ipMap.get(row.access_token_id) || [];
    if (list.length < 8) {
      list.push(row);
      ipMap.set(row.access_token_id, list);
    }
  }

  const viewMap = new Map();
  for (const row of viewRows) {
    const list = viewMap.get(row.access_token_id) || [];
    if (list.length < 10) {
      list.push(row);
      viewMap.set(row.access_token_id, list);
    }
  }

  return tokens.map(token => ({
    ...token,
    ips: ipMap.get(token.id) || [],
    recentViews: viewMap.get(token.id) || []
  }));
}

module.exports = { getTokenUsers };

// 后台仪表盘路由:首页、小说信息、数据看板

const express = require('express');
const { pool } = require('../../db');
const pageViewQueue = require('../../lib/pageViewQueue');
const { getNovels, getCurrentNovel, toPositiveInt } = require('./shared');

const router = express.Router();

async function renderDashboard(req, res, options = {}) {
  const novels = await getNovels();
  const selectedId = toPositiveInt(req.query.novel_id) || (novels[0] && novels[0].id);
  const selectedChapterId = toPositiveInt(req.query.chapter_id);
  const currentNovel = await getCurrentNovel(selectedId);

  let chapters = [];
  let selectedChapter = null;
  let nextNumber = 1;
  let novelTotalChapters = 0;
  if (currentNovel) {
    const currentNovelSummary = novels.find(novel => novel.id === currentNovel.id);
    novelTotalChapters = Number(currentNovelSummary && currentNovelSummary.chapter_count || 0);

    const [[nextRow]] = await pool.execute(
      'SELECT COALESCE(MAX(chapter_number), 0) + 1 AS next_number FROM chapters WHERE novel_id = ?',
      [currentNovel.id]
    );
    nextNumber = nextRow.next_number;

    if (selectedChapterId) {
      const [[chapter]] = await pool.execute(
        'SELECT id, novel_id, chapter_number, title, content FROM chapters WHERE id = ? AND novel_id = ?',
        [selectedChapterId, currentNovel.id]
      );
      selectedChapter = chapter || null;
    }

    [chapters] = await pool.execute(
      `SELECT id, chapter_number, title, CHAR_LENGTH(content) AS content_length, created_at
       FROM chapters
       WHERE novel_id = ?
       ORDER BY chapter_number ASC`,
      [currentNovel.id]
    );
  }

  res.render('admin/index', {
    novels,
    currentNovel,
    chapters,
    selectedChapter,
    nextNumber,
    novelTotalChapters,
    notice: options.notice || req.query.notice || '',
    error: options.error || req.query.error || ''
  });
}

async function renderNovelInfo(req, res, options = {}) {
  const novels = await getNovels();
  const selectedId = toPositiveInt(req.query.novel_id) || (novels[0] && novels[0].id);
  const currentNovel = await getCurrentNovel(selectedId);

  res.render('admin/novel-info', {
    novels,
    currentNovel,
    notice: options.notice || req.query.notice || '',
    error: options.error || req.query.error || ''
  });
}

async function getDashboardMetrics() {
  const [[summary]] = await pool.execute(`
    SELECT
      COUNT(*) AS page_views,
      COUNT(DISTINCT session_id) AS sessions,
      COUNT(DISTINCT visitor_uid) AS users,
      COUNT(DISTINCT visitor_ip) AS unique_ips,
      COUNT(DISTINCT novel_id) AS novels_viewed,
      COUNT(DISTINCT chapter_id) AS chapters_viewed
    FROM page_views
  `);

  const [dailyRows] = await pool.execute(`
    SELECT
      DATE_FORMAT(created_at, '%Y-%m-%d') AS day,
      COUNT(*) AS page_views,
      COUNT(DISTINCT session_id) AS sessions,
      COUNT(DISTINCT visitor_uid) AS users,
      COUNT(DISTINCT visitor_ip) AS unique_ips
    FROM page_views
    WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
    GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')
    ORDER BY day ASC
  `);

  const dailyMap = new Map(dailyRows.map(row => [String(row.day).slice(0, 10), row]));
  const dailySeries = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const dayDate = new Date();
    dayDate.setHours(0, 0, 0, 0);
    dayDate.setDate(dayDate.getDate() - offset);
    // 用本地日期格式而非 toISOString(UTC),与 MySQL DATE_FORMAT 保持一致
    const y = dayDate.getFullYear();
    const m = String(dayDate.getMonth() + 1).padStart(2, '0');
    const d = String(dayDate.getDate()).padStart(2, '0');
    const dayKey = `${y}-${m}-${d}`;
    const row = dailyMap.get(dayKey) || {};
    dailySeries.push({
      day: dayKey,
      page_views: Number(row.page_views || 0),
      sessions: Number(row.sessions || 0),
      users: Number(row.users || 0),
      unique_ips: Number(row.unique_ips || 0)
    });
  }

  const [topPaths] = await pool.execute(`
    SELECT path, COUNT(*) AS views
    FROM page_views
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
      n.title AS novel_title,
      c.title AS chapter_title,
      c.chapter_number
    FROM page_views pv
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

router.get('/', async (req, res, next) => {
  try {
    await renderDashboard(req, res);
  } catch (err) {
    next(err);
  }
});

router.get('/novels/info', async (req, res, next) => {
  try {
    await renderNovelInfo(req, res);
  } catch (err) {
    next(err);
  }
});

router.get('/dashboard', async (req, res, next) => {
  try {
    await pageViewQueue.flush();
    const metrics = await getDashboardMetrics();
    const novels = await getNovels();
    const currentNovel = novels[0] || null;
    res.render('admin/dashboard', {
      ...metrics,
      currentNovel,
      notice: req.query.notice || '',
      error: req.query.error || ''
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.renderDashboard = renderDashboard;
module.exports.renderNovelInfo = renderNovelInfo;

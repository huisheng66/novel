// 前台路由:首页、小说详情、章节阅读 + 中间件与书源子路由挂载

const express = require('express');
const { pool } = require('../db');
const cache = require('../lib/memoryCache');
const { getBaseUrl } = require('../lib/util');
const { authenticateToken, recordPageView, getRiskStats } = require('./middleware/auth');
const sourceRoutes = require('./source');

const router = express.Router();

router.use(authenticateToken);
router.use(recordPageView);
router.use(sourceRoutes);

function sendCachedHtml(res, cacheKey) {
  const html = cache.get(cacheKey);
  if (!html) return false;

  res.set('X-Cache', 'HIT');
  res.send(html);
  return true;
}

function renderAndCache(req, res, next, cacheKey, view, data) {
  res.render(view, data, (err, html) => {
    if (err) return next(err);

    cache.set(cacheKey, html);
    res.set('X-Cache', 'MISS');
    res.send(html);
  });
}

function splitParagraphs(chapter) {
  const cacheKey = `paragraphs:${chapter.id}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const paragraphs = chapter.content
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  cache.set(cacheKey, paragraphs);
  return paragraphs;
}

router.get('/', async (req, res, next) => {
  try {
    // 未登录:显示登录提示页(不暴露小说列表)
    if (!req.accessTokenId) {
      return res.render('home', { novels: [], baseUrl: getBaseUrl(req), requireLogin: true });
    }

    const allowedNovelId = req.accessToken && req.accessToken.allowedNovelId;
    const cacheKey = `html:home:${allowedNovelId || 'all'}`;
    if (sendCachedHtml(res, cacheKey)) return;

    const params = [];
    let whereClause = '';
    if (allowedNovelId) {
      whereClause = 'WHERE n.id = ?';
      params.push(allowedNovelId);
    }

    const [novels] = await pool.execute(
      `SELECT n.id, n.title, n.description, n.cover_image, COUNT(c.id) AS chapter_count
       FROM novels n
       LEFT JOIN chapters c ON c.novel_id = n.id
       ${whereClause}
       GROUP BY n.id, n.title, n.description, n.cover_image
       ORDER BY n.id ASC`,
      params
    );

    renderAndCache(req, res, next, cacheKey, 'home', { novels, baseUrl: getBaseUrl(req) });
  } catch (err) {
    next(err);
  }
});

router.get('/novel/:id', async (req, res, next) => {
  try {
    const cacheKey = `html:novel:${req.params.id}`;
    if (sendCachedHtml(res, cacheKey)) return;

    const [[novel]] = await pool.execute(
      'SELECT id, title, description, cover_image, created_at FROM novels WHERE id = ?',
      [req.params.id]
    );
    if (!novel) return res.status(404).render('404', { url: req.originalUrl });

    const [chapters] = await pool.execute(
      'SELECT id, chapter_number, title, created_at FROM chapters WHERE novel_id = ? ORDER BY chapter_number ASC',
      [req.params.id]
    );

    renderAndCache(req, res, next, cacheKey, 'novel', { novel, chapters, baseUrl: getBaseUrl(req) });
  } catch (err) {
    next(err);
  }
});

router.get('/novel/:id/comments', async (req, res, next) => {
  try {
    const cacheKey = `html:novel-comments:${req.params.id}`;
    if (sendCachedHtml(res, cacheKey)) return;

    const [[novel]] = await pool.execute(
      'SELECT id, title FROM novels WHERE id = ?',
      [req.params.id]
    );
    if (!novel) return res.status(404).render('404', { url: req.originalUrl });

    renderAndCache(req, res, next, cacheKey, 'novel-comments', { novel, baseUrl: getBaseUrl(req) });
  } catch (err) {
    next(err);
  }
});

router.get('/novel/:id/:chapterNum', async (req, res, next) => {
  try {
    const { id, chapterNum } = req.params;

    const [[novel]] = await pool.execute(
      'SELECT id, title, description, cover_image FROM novels WHERE id = ?',
      [id]
    );
    if (!novel) return res.status(404).render('404', { url: req.originalUrl });

    const [[chapter]] = await pool.execute(
      'SELECT id, chapter_number, title, content FROM chapters WHERE novel_id = ? AND chapter_number = ?',
      [id, chapterNum]
    );
    if (!chapter) return res.status(404).render('404', { url: req.originalUrl });

    // 章节缓存键以 chapter.id 为主键,避免 chapter_number 调整后旧缓存残留
    const cacheKey = `html:chapter:${chapter.id}`;
    if (sendCachedHtml(res, cacheKey)) return;

    chapter.paragraphs = splitParagraphs(chapter);

    const [[prevChapter]] = await pool.execute(
      'SELECT chapter_number, title FROM chapters WHERE novel_id = ? AND chapter_number < ? ORDER BY chapter_number DESC LIMIT 1',
      [id, chapterNum]
    );

    const [[nextChapter]] = await pool.execute(
      'SELECT chapter_number, title FROM chapters WHERE novel_id = ? AND chapter_number > ? ORDER BY chapter_number ASC LIMIT 1',
      [id, chapterNum]
    );

    renderAndCache(req, res, next, cacheKey, 'chapter', { novel, chapter, prevChapter, nextChapter, baseUrl: getBaseUrl(req) });
  } catch (err) {
    next(err);
  }
});

// 透传风控统计供 /metrics 端点消费
router.getRiskStats = getRiskStats;

module.exports = router;

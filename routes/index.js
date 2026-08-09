// 前台路由:首页、小说详情、章节阅读 + 中间件与书源子路由挂载

const express = require('express');
const { pool } = require('../db');
const cache = require('../lib/memoryCache');
const { getBaseUrl } = require('../lib/util');
const {
  buildReaderChapterTitle,
  mergeParagraphsForReader,
  splitContentParagraphs
} = require('../lib/chapterText');
const { authenticateToken, recordPageView, getRiskStats } = require('./middleware/auth');
const sourceRoutes = require('./source');
const webAuthRoutes = require('./web-auth');

const router = express.Router();

// Web 登录/注册（免 access_token；与 App 共用 users）
router.use(webAuthRoutes);

router.use(authenticateToken);
router.use(recordPageView);
router.use(sourceRoutes);

function sendHtml(res, html, cacheStatus) {
  // 登录态页面：允许浏览器短缓存，回退/前进更顺；CDN 仍因 Cookie 通常不缓存
  res.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
  res.set('X-Cache', cacheStatus);
  res.type('html');
  res.send(html);
}

function sendCachedHtml(res, cacheKey) {
  const html = cache.get(cacheKey);
  if (!html) return false;
  sendHtml(res, html, 'HIT');
  return true;
}

function renderAndCache(req, res, next, cacheKey, view, data) {
  res.render(view, data, (err, html) => {
    if (err) return next(err);

    cache.set(cacheKey, html);
    sendHtml(res, html, 'MISS');
  });
}

function splitParagraphs(chapter) {
  // v3: 合并短段 + 阅读模式友好标题后的段落缓存
  const cacheKey = `paragraphs:v3:${chapter.id}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const paragraphs = mergeParagraphsForReader(splitContentParagraphs(chapter.content), 100);
  cache.set(cacheKey, paragraphs);
  return paragraphs;
}

router.get('/', async (req, res, next) => {
  try {
    const allowedNovelId = req.accessToken && req.accessToken.allowedNovelId;
    const cacheKey = `html:home:${allowedNovelId || 'all'}`;
    if (sendCachedHtml(res, cacheKey)) return;

    const params = [];
    let whereClause = '';
    if (allowedNovelId) {
      whereClause = 'WHERE n.id = ?';
      params.push(allowedNovelId);
    }

    // 相关子查询走章节索引，避免 JOIN 全表再 GROUP BY（书多章时首页更稳）
    const [novels] = await pool.execute(
      `SELECT n.id, n.title, n.description, n.cover_image,
              (SELECT COUNT(*) FROM chapters c WHERE c.novel_id = n.id) AS chapter_count
       FROM novels n
       ${whereClause}
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

    // 目录页只要编号+标题，少传字段减轻序列化与 HTML 体积
    const [chapters] = await pool.execute(
      'SELECT chapter_number, title FROM chapters WHERE novel_id = ? ORDER BY chapter_number ASC',
      [req.params.id]
    );

    renderAndCache(req, res, next, cacheKey, 'novel', { novel, chapters, baseUrl: getBaseUrl(req) });
  } catch (err) {
    next(err);
  }
});

router.get('/novel/:id/:chapterNum', async (req, res, next) => {
  try {
    const { id, chapterNum } = req.params;

    // 缓存键用 novelId+章号：命中时不必先读 LONGTEXT
    const cacheKey = `html:chapter:v4:${id}:${chapterNum}`;
    if (sendCachedHtml(res, cacheKey)) return;

    // 未命中：小说元信息 / 正文 / 上下章并行查询
    const [[novelRows], [chapterRows], [prevRows], [nextRows]] = await Promise.all([
      pool.execute(
        'SELECT id, title, description, cover_image FROM novels WHERE id = ?',
        [id]
      ),
      pool.execute(
        'SELECT id, chapter_number, title, content FROM chapters WHERE novel_id = ? AND chapter_number = ?',
        [id, chapterNum]
      ),
      pool.execute(
        'SELECT chapter_number, title FROM chapters WHERE novel_id = ? AND chapter_number < ? ORDER BY chapter_number DESC LIMIT 1',
        [id, chapterNum]
      ),
      pool.execute(
        'SELECT chapter_number, title FROM chapters WHERE novel_id = ? AND chapter_number > ? ORDER BY chapter_number ASC LIMIT 1',
        [id, chapterNum]
      )
    ]);

    const novel = novelRows[0];
    if (!novel) return res.status(404).render('404', { url: req.originalUrl });

    const chapter = chapterRows[0];
    if (!chapter) return res.status(404).render('404', { url: req.originalUrl });

    chapter.paragraphs = splitParagraphs(chapter);
    chapter.readerTitle = buildReaderChapterTitle(chapter.chapter_number, chapter.title);

    renderAndCache(req, res, next, cacheKey, 'chapter', {
      novel,
      chapter,
      prevChapter: prevRows[0] || null,
      nextChapter: nextRows[0] || null,
      baseUrl: getBaseUrl(req)
    });
  } catch (err) {
    next(err);
  }
});

// 透传风控统计供 /metrics 端点消费
router.getRiskStats = getRiskStats;

module.exports = router;

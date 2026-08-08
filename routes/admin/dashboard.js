// 后台仪表盘：章节管理首页、小说信息、数据看板

const express = require('express');
const { pool } = require('../../db');
const pageViewQueue = require('../../lib/pageViewQueue');
const analytics = require('../../lib/analytics');
const { parsePositiveInt, toPositiveInt } = require('../../lib/util');
const {
  getNovels,
  getCurrentNovel,
  getChaptersPage
} = require('./shared');
const { getDashboardMetrics } = require('./lib/metrics');

const router = express.Router();

const DEFAULT_CHAPTER_PAGE_SIZE = 40;
const MAX_CHAPTER_PAGE_SIZE = 100;

async function renderDashboard(req, res, options = {}) {
  const novels = await getNovels();
  const selectedId = toPositiveInt(req.query.novel_id) || (novels[0] && novels[0].id);
  const selectedChapterId = toPositiveInt(req.query.chapter_id);
  const currentNovel = await getCurrentNovel(selectedId);

  let chapters = [];
  let selectedChapter = null;
  let nextNumber = 1;
  let novelTotalChapters = 0;
  let chapterPage = { page: 1, pageSize: DEFAULT_CHAPTER_PAGE_SIZE, total: 0, totalPages: 1 };

  if (currentNovel) {
    const summary = novels.find(n => n.id === currentNovel.id);
    novelTotalChapters = Number(summary && summary.chapter_count || 0);

    const [[nextRow]] = await pool.execute(
      'SELECT COALESCE(MAX(chapter_number), 0) + 1 AS next_number FROM chapters WHERE novel_id = ?',
      [currentNovel.id]
    );
    nextNumber = nextRow.next_number;

    // 首屏只带章节元数据，正文由前端 API 异步加载，避免把 LONGTEXT 塞进 HTML
    if (selectedChapterId) {
      const [[chapter]] = await pool.execute(
        'SELECT id, novel_id, chapter_number, title FROM chapters WHERE id = ? AND novel_id = ?',
        [selectedChapterId, currentNovel.id]
      );
      selectedChapter = chapter ? { ...chapter, content: '' } : null;
    }

    const pageSize = Math.min(
      parsePositiveInt(req.query.page_size, DEFAULT_CHAPTER_PAGE_SIZE),
      MAX_CHAPTER_PAGE_SIZE
    );
    const page = parsePositiveInt(req.query.chapter_page, 1);

    const paged = await getChaptersPage(currentNovel.id, {
      page,
      pageSize,
      chapterId: selectedChapterId
    });
    chapters = paged.chapters;
    chapterPage = {
      page: paged.page,
      pageSize: paged.pageSize,
      total: paged.total,
      totalPages: paged.totalPages
    };
  }

  res.render('admin/index', {
    novels,
    currentNovel,
    chapters,
    selectedChapter,
    nextNumber,
    novelTotalChapters,
    chapterPage,
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
    // 刷今日/昨日日表；lifetime 按间隔自动刷新（打开看板不强制全表扫）
    await analytics.runAggregation(2);

    const metrics = await getDashboardMetrics();
    const novels = await getNovels();
    res.render('admin/dashboard', {
      ...metrics,
      currentNovel: novels[0] || null,
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

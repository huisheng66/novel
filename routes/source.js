// 书源路由(Legado JSON/HTML)：薄路由层，数据/HTML/payload 在 lib/source/*

const express = require('express');
const { getBaseUrl, toAbsoluteUrl } = require('../lib/util');
const { getAccessTokenValue } = require('./middleware/auth');
const {
  resolveSourceNovel,
  searchSourceNovels,
  getSourceChapters,
  getSourceChapter
} = require('../lib/source/novels');
const sourceHtml = require('../lib/source/html');
const {
  getSourceChapterUrl,
  buildSourceBookPayload,
  buildSourceChapterListPayload,
  withDataPayload,
  buildLegadoSource,
  tokenQuery
} = require('../lib/source/payload');

const router = express.Router();

function sendJson(res, payload) {
  res.set('Cache-Control', 'no-store');
  res.json(payload);
}

function sendHtml(res, html) {
  res.set('Cache-Control', 'no-store');
  res.type('text/html; charset=utf-8').send(html);
}

function allowedId(req) {
  return req.accessToken && req.accessToken.allowedNovelId;
}

function token(req) {
  return getAccessTokenValue(req);
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/** 解析书源小说，404 时按 format 返回 */
async function loadSourceNovel(req, res, format = 'json') {
  const sourceNovel = await resolveSourceNovel(req.params.id, allowedId(req));
  if (sourceNovel) return sourceNovel;

  if (format === 'html') {
    res.status(404).type('text/plain; charset=utf-8').send('Book not found');
  } else {
    res.status(404).json({ error: 'Book not found' });
  }
  return null;
}

/**
 * 注册 JSON + HTML 成对路由。
 * handlers: { json(req,res), html(req,res) }
 * path 不含 /source 前缀，如 'search'、'book/:id'
 */
function registerSourcePair(path, handlers) {
  router.get(`/source/${path}`, asyncRoute(handlers.json));
  router.get(`/source/html/${path}`, asyncRoute(handlers.html));
}

// ---------- search ----------
registerSourcePair('search', {
  async json(req, res) {
    const keyword = String(req.query.key || '').trim();
    const rows = await searchSourceNovels(keyword, allowedId(req));
    const t = token(req);
    sendJson(res, withDataPayload({
      keyword,
      books: rows.map(row => buildSourceBookPayload(req, row, t))
    }));
  },
  async html(req, res) {
    const keyword = String(req.query.key || '').trim();
    const rows = await searchSourceNovels(keyword, allowedId(req));
    const t = token(req);
    const base = getBaseUrl(req);
    const cards = sourceHtml.renderSearchCards(
      rows,
      id => `${base}/source/html/book/${id}?${tokenQuery(t)}`,
      cover => toAbsoluteUrl(req, cover)
    );
    sendHtml(res, sourceHtml.renderPage(
      keyword ? `${keyword} - 搜索结果` : '搜索结果',
      cards
    ));
  }
});

// ---------- book ----------
registerSourcePair('book/:id', {
  async json(req, res) {
    const sourceNovel = await loadSourceNovel(req, res, 'json');
    if (!sourceNovel) return;
    const { display, readable } = sourceNovel;
    const chapters = await getSourceChapters(readable.id);
    sendJson(res, withDataPayload(
      buildSourceChapterListPayload(req, display, chapters, token(req))
    ));
  },
  async html(req, res) {
    const sourceNovel = await loadSourceNovel(req, res, 'html');
    if (!sourceNovel) return;
    const { display } = sourceNovel;
    const t = token(req);
    const coverUrl = toAbsoluteUrl(req, display.cover_image);
    const tocUrl = `${getBaseUrl(req)}/source/html/toc/${display.id}?${tokenQuery(t)}`;
    // 详情页不内嵌全量章节（2000+ 章会拖垮客户端）
    sendHtml(res, sourceHtml.renderPage(
      display.title,
      sourceHtml.renderBookDetail(
        { ...display, coverHtml: sourceHtml.coverHtml(coverUrl, display.title) },
        tocUrl
      )
    ));
  }
});

// ---------- toc ----------
registerSourcePair('toc/:id', {
  async json(req, res) {
    const sourceNovel = await loadSourceNovel(req, res, 'json');
    if (!sourceNovel) return;
    const { display, readable } = sourceNovel;
    const chapters = await getSourceChapters(readable.id);
    sendJson(res, withDataPayload(
      buildSourceChapterListPayload(req, display, chapters, token(req))
    ));
  },
  async html(req, res) {
    const sourceNovel = await loadSourceNovel(req, res, 'html');
    if (!sourceNovel) return;
    const { display, readable } = sourceNovel;
    const chapters = await getSourceChapters(readable.id);
    const t = token(req);
    const items = sourceHtml.renderChapterItems(
      chapters,
      num => getSourceChapterUrl(req, display.id, num, t, 'html')
    );
    sendHtml(res, sourceHtml.renderPage(
      `${display.title} - 目录`,
      sourceHtml.renderChapterList(display.title, items)
    ));
  }
});

// ---------- content ----------
registerSourcePair('content/:id/:chapterNum', {
  async json(req, res) {
    const sourceNovel = await loadSourceNovel(req, res, 'json');
    if (!sourceNovel) return;
    const { display, readable } = sourceNovel;
    const chapter = await getSourceChapter(readable.id, req.params.chapterNum);
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

    sendJson(res, withDataPayload({
      bookName: display.title,
      title: chapter.title,
      chapterNumber: chapter.chapter_number,
      content: chapter.content
    }));
  },
  async html(req, res) {
    const sourceNovel = await loadSourceNovel(req, res, 'html');
    if (!sourceNovel) return;
    const { display, readable } = sourceNovel;
    const chapter = await getSourceChapter(readable.id, req.params.chapterNum);
    if (!chapter) {
      return res.status(404).type('text/plain; charset=utf-8').send('Chapter not found');
    }

    const { pageTitle, body } = sourceHtml.renderContent(
      display.title,
      chapter.title,
      chapter.content
    );
    sendHtml(res, sourceHtml.renderPage(pageTitle, body));
  }
});

// ---------- legado import ----------
router.get('/source/legado', asyncRoute(async (req, res) => {
  const t = token(req);
  if (!t) return res.status(403).json({ error: 'Access token required' });

  const source = buildLegadoSource(req, t);
  sendJson(res, String(req.query.single || '') === '1' ? source : [source]);
}));

router.get('/source/import/:token.json', asyncRoute(async (req, res) => {
  const t = token(req);
  if (!t) {
    return res.status(403).type('text/plain; charset=utf-8').send('Access token required');
  }

  const source = buildLegadoSource(req, t);
  res.type('application/json; charset=utf-8');
  res.set('Content-Disposition', 'inline; filename="legado-source.json"');
  res.set('Cache-Control', 'no-store');
  res.send(JSON.stringify(
    String(req.query.single || '') === '1' ? source : [source],
    null,
    2
  ));
}));

module.exports = router;

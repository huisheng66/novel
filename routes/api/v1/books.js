const express = require('express');
const { listBooks, getBook, getToc, getChapter } = require('../../../lib/api/books');
const { requireReaderAuth, assertNovelAccess } = require('./middleware/auth');
const { sendError, ApiError, badRequest } = require('../../../lib/api/errors');
const { toPositiveInt } = require('../../../lib/util');

const router = express.Router();

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.use(requireReaderAuth);

router.get('/', asyncRoute(async (req, res) => {
  try {
    const data = await listBooks(req, {
      q: req.query.q || '',
      page: toPositiveInt(req.query.page) || 1,
      pageSize: toPositiveInt(req.query.pageSize) || 20,
      allowedNovelId: req.allowedNovelId || null
    });
    res.json(data);
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

router.get('/:id', asyncRoute(async (req, res) => {
  try {
    const id = toPositiveInt(req.params.id);
    if (!id) throw badRequest('Invalid id');
    assertNovelAccess(req, id);
    const book = await getBook(req, id, req.allowedNovelId || null);
    res.json(book);
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

router.get('/:id/toc', asyncRoute(async (req, res) => {
  try {
    const id = toPositiveInt(req.params.id);
    if (!id) throw badRequest('Invalid id');
    assertNovelAccess(req, id);
    const toc = await getToc(req, id, {
      page: toPositiveInt(req.query.page) || 1,
      pageSize: toPositiveInt(req.query.pageSize) || 100,
      allowedNovelId: req.allowedNovelId || null
    });
    res.json(toc);
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

router.get('/:id/chapters/:chapterNumber', asyncRoute(async (req, res) => {
  try {
    const id = toPositiveInt(req.params.id);
    const chapterNumber = toPositiveInt(req.params.chapterNumber);
    if (!id || !chapterNumber) throw badRequest('Invalid chapter request');
    assertNovelAccess(req, id);
    const result = await getChapter(req, id, chapterNumber, {
      allowedNovelId: req.allowedNovelId || null,
      ifNoneMatch: req.headers['if-none-match'] || ''
    });
    res.set('ETag', result.etag);
    res.set('Cache-Control', 'private, max-age=60');
    if (result.notModified) return res.status(304).end();
    res.json(result.body);
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

module.exports = router;

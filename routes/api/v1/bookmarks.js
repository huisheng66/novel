const express = require('express');
const {
  listBookmarks,
  getBookmark,
  createBookmark,
  updateBookmark,
  deleteBookmark
} = require('../../../lib/api/bookmarks');
const { requireUser } = require('./middleware/auth');
const { sendError, ApiError, badRequest } = require('../../../lib/api/errors');
const { toPositiveInt } = require('../../../lib/util');

const router = express.Router();

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.use(requireUser);

router.get('/', asyncRoute(async (req, res) => {
  try {
    const novelId = req.query.novelId != null ? toPositiveInt(req.query.novelId) : null;
    res.json(await listBookmarks(req.apiUser.id, { novelId }));
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

router.get('/:id', asyncRoute(async (req, res) => {
  try {
    const id = toPositiveInt(req.params.id);
    if (!id) throw badRequest('id required');
    res.json(await getBookmark(req.apiUser.id, id));
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

router.post('/', asyncRoute(async (req, res) => {
  try {
    const item = await createBookmark(req.apiUser.id, req.body || {});
    res.status(201).json(item);
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

router.put('/:id', asyncRoute(async (req, res) => {
  try {
    const id = toPositiveInt(req.params.id);
    if (!id) throw badRequest('id required');
    res.json(await updateBookmark(req.apiUser.id, id, req.body || {}));
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

router.delete('/:id', asyncRoute(async (req, res) => {
  try {
    const id = toPositiveInt(req.params.id);
    if (!id) throw badRequest('id required');
    res.json(await deleteBookmark(req.apiUser.id, id));
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

module.exports = router;

const express = require('express');
const { listShelf, listShelfUpdates, addToShelf, removeFromShelf } = require('../../../lib/api/shelf');
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
    res.json(await listShelf(req, req.apiUser.id));
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

// 必须在 /:novelId 之前
router.get('/updates', asyncRoute(async (req, res) => {
  try {
    const data = await listShelfUpdates(req, req.apiUser.id, { since: req.query.since });
    res.set('Cache-Control', 'private, no-store');
    res.json(data);
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

router.post('/', asyncRoute(async (req, res) => {
  try {
    const novelId = toPositiveInt(req.body && req.body.novelId);
    if (!novelId) throw badRequest('novelId required');
    const result = await addToShelf(req.apiUser.id, novelId);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

router.delete('/:novelId', asyncRoute(async (req, res) => {
  try {
    const novelId = toPositiveInt(req.params.novelId);
    if (!novelId) throw badRequest('novelId required');
    res.json(await removeFromShelf(req.apiUser.id, novelId));
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

module.exports = router;

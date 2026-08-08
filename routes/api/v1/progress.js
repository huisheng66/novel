const express = require('express');
const { listProgress, getProgress, putProgress, putProgressBatch } = require('../../../lib/api/progress');
const { requireUser } = require('./middleware/auth');
const { progressBatchRateLimit } = require('../../../lib/api/rateLimit');
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
    res.json(await listProgress(req.apiUser.id));
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

// 离线队列批量上报（须在 /:novelId 之前）
router.post('/batch', progressBatchRateLimit(), asyncRoute(async (req, res) => {
  try {
    const result = await putProgressBatch(req.apiUser.id, req.body || {});
    res.json(result);
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

router.get('/:novelId', asyncRoute(async (req, res) => {
  try {
    const novelId = toPositiveInt(req.params.novelId);
    if (!novelId) throw badRequest('novelId required');
    res.json(await getProgress(req.apiUser.id, novelId));
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

router.put('/', asyncRoute(async (req, res) => {
  try {
    const result = await putProgress(req.apiUser.id, req.body || {});
    res.json(result);
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

module.exports = router;

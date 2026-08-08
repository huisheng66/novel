const express = require('express');
const { listUpdateNotices } = require('../../../lib/api/notices');
const { requireUser } = require('./middleware/auth');
const { sendError, ApiError } = require('../../../lib/api/errors');

const router = express.Router();

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.use(requireUser);

/** GET /me/notices/updates?since= — 书架更新通知 */
router.get('/updates', asyncRoute(async (req, res) => {
  try {
    const data = await listUpdateNotices(req, req.apiUser.id, { since: req.query.since });
    res.set('Cache-Control', 'private, no-store');
    res.json(data);
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

module.exports = router;

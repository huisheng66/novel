const express = require('express');
const { getClientOps, setClientOpsFromBody } = require('../../../lib/api/ops');
const { sendError, ApiError, forbidden } = require('../../../lib/api/errors');

const router = express.Router();

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function adminApiKeyOk(req) {
  const expected = String(process.env.API_OPS_ADMIN_KEY || process.env.ADMIN_PASSWORD || '').trim();
  if (!expected) return false;
  const key = String(req.headers['x-ops-admin-key'] || req.headers['x-admin-key'] || '').trim();
  return key && key === expected;
}

/** 公开：公告 + 强更策略 */
router.get('/', asyncRoute(async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=30');
    res.json(await getClientOps());
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

/** 运维写入：Header X-Ops-Admin-Key 匹配 API_OPS_ADMIN_KEY 或 ADMIN_PASSWORD */
router.put('/', asyncRoute(async (req, res) => {
  try {
    if (!adminApiKeyOk(req)) throw forbidden('Invalid ops admin key');
    const data = await setClientOpsFromBody(req.body || {});
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

module.exports = router;

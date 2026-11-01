const express = require('express');
const { purchaseChapter, purchaseFullNovel, listPurchases } = require('../../../lib/api/purchases');
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
    res.set('Cache-Control', 'private, no-store');
    res.json({ items: await listPurchases(req.apiUser.id, novelId) });
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

/**
 * 购买单章。幂等：已购返回 200 + alreadyOwned=true；余额不足返回 402。
 */
router.post('/', asyncRoute(async (req, res) => {
  try {
    const novelId = toPositiveInt(req.body && req.body.novelId);
    const chapterNumber = toPositiveInt(req.body && req.body.chapterNumber);
    if (!novelId || !chapterNumber) throw badRequest('novelId and chapterNumber required');

    const result = await purchaseChapter(req.apiUser.id, novelId, chapterNumber);
    res.set('Cache-Control', 'private, no-store');
    res.status(result.alreadyOwned ? 200 : 201).json({
      novelId,
      chapterNumber,
      alreadyOwned: result.alreadyOwned,
      amount: result.amount,
      balance: result.balance
    });
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

/**
 * 按本解锁（一次性购买整本书）。
 * 幂等：已购返回 200 + alreadyOwned=true；余额不足返回 402。
 */
router.post('/full', asyncRoute(async (req, res) => {
  try {
    const novelId = toPositiveInt(req.body && req.body.novelId);
    if (!novelId) throw badRequest('novelId required');

    const result = await purchaseFullNovel(req.apiUser.id, novelId);
    res.set('Cache-Control', 'private, no-store');
    res.status(result.alreadyOwned ? 200 : 201).json({
      novelId,
      alreadyOwned: result.alreadyOwned,
      amount: result.amount,
      balance: result.balance
    });
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

module.exports = router;

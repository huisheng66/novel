const express = require('express');
const { getWallet, listTransactions, redeemCode } = require('../../../lib/api/wallet');
const { requireUser } = require('./middleware/auth');
const { rateLimit } = require('../../../lib/api/rateLimit');
const { sendError, ApiError } = require('../../../lib/api/errors');

const router = express.Router();

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.use(requireUser);

router.get('/', asyncRoute(async (req, res) => {
  try {
    const wallet = await getWallet(req.apiUser.id);
    const transactions = await listTransactions(req.apiUser.id, { limit: 20 });
    res.set('Cache-Control', 'private, no-store');
    res.json({ balance: wallet.balance, updatedAt: wallet.updatedAt, transactions });
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

// 兑换码是短字符串，必须限流，避免被枚举
router.post('/redeem', rateLimit({ name: 'redeem', max: 10, windowMs: 60 * 1000 }), asyncRoute(async (req, res) => {
  try {
    const result = await redeemCode(req.apiUser.id, req.body && req.body.code);
    res.set('Cache-Control', 'private, no-store');
    res.json({ amount: result.amount, balance: result.balance });
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

module.exports = router;

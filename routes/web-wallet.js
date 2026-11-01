// 网页端钱包：查看余额与流水、兑换码充值、单章购买。
//
// 注意：这些接口是 POST，而全局 authenticateToken 只处理 GET/HEAD，
// 因此这里必须自己解析 JWT 挂 req.webUser（见 use 中间件）。

const express = require('express');
const { getWallet, listTransactions, redeemCode } = require('../lib/api/wallet');
const { purchaseChapter, purchaseFullNovel, listPurchases } = require('../lib/api/purchases');
const { ApiError } = require('../lib/api/errors');
const { rejectCrossSite } = require('../lib/csrf');
const rateLimitStore = require('../lib/rateLimitStore');
const { tryAuthenticateWebUser } = require('./middleware/auth');
const { getBaseUrl, toPositiveInt } = require('../lib/util');

const router = express.Router();

const REDEEM_MAX_PER_MINUTE = 10;

function yuan(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

/** POST 也需要读者身份：全局鉴权中间件只处理 GET/HEAD */
router.use(async (req, res, next) => {
  try {
    if (!req.webUser) await tryAuthenticateWebUser(req, res);
    next();
  } catch (err) {
    next(err);
  }
});

function loginRedirect(req, res, target) {
  return res.redirect(`/login?next=${encodeURIComponent(target)}`);
}

router.get('/wallet', async (req, res, next) => {
  try {
    if (!req.webUser) return loginRedirect(req, res, '/wallet');

    const wallet = await getWallet(req.webUser.id);
    const transactions = await listTransactions(req.webUser.id, { limit: 30 });
    const purchases = await listPurchases(req.webUser.id, null);

    // 余额是个人数据，禁止任何缓存
    res.set('Cache-Control', 'private, no-store');
    res.render('wallet', {
      webUser: req.webUser,
      wallet,
      yuan,
      transactions,
      purchases: purchases.slice(0, 20),
      notice: req.query.notice || '',
      error: req.query.error || '',
      baseUrl: getBaseUrl(req)
    });
  } catch (err) {
    next(err);
  }
});

router.post('/wallet/redeem', rejectCrossSite, async (req, res, next) => {
  try {
    if (!req.webUser) return loginRedirect(req, res, '/wallet');

    // 兑换码是短字符串，必须限流，否则可被暴力枚举
    const ip = String(req.ip || '').replace(/^::ffff:/, '').slice(0, 64);
    const limit = await rateLimitStore.consume(`redeem:u${req.webUser.id}:${ip}`, {
      max: REDEEM_MAX_PER_MINUTE,
      windowMs: 60 * 1000
    });
    if (!limit.allowed) {
      return res.redirect(`/wallet?error=${encodeURIComponent('尝试过于频繁，请 1 分钟后再试')}`);
    }

    const result = await redeemCode(req.webUser.id, req.body.code);
    res.redirect(`/wallet?notice=${encodeURIComponent(
      `充值成功，到账 ¥${yuan(result.amount)}，当前余额 ¥${yuan(result.balance)}`
    )}`);
  } catch (err) {
    if (err instanceof ApiError) {
      return res.redirect(`/wallet?error=${encodeURIComponent(err.message)}`);
    }
    next(err);
  }
});

router.post('/novel/:id/:chapterNum/buy', rejectCrossSite, async (req, res, next) => {
  const novelId = toPositiveInt(req.params.id);
  const chapterNum = toPositiveInt(req.params.chapterNum);
  const back = `/novel/${req.params.id}/${req.params.chapterNum}`;

  try {
    if (!req.webUser) return loginRedirect(req, res, back);
    if (!novelId || !chapterNum) {
      return res.redirect(`${back}?error=${encodeURIComponent('无效的章节')}`);
    }

    const result = await purchaseChapter(req.webUser.id, novelId, chapterNum);
    const notice = result.alreadyOwned
      ? '该章已购买'
      : `购买成功，扣除 ¥${yuan(result.amount)}，余额 ¥${yuan(result.balance)}`;

    res.redirect(`${back}?notice=${encodeURIComponent(notice)}`);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === 'INSUFFICIENT_BALANCE') {
        const need = err.details && err.details.required ? `，本章需 ¥${yuan(err.details.required)}` : '';
        return res.redirect(`/wallet?error=${encodeURIComponent(`余额不足${need}，请先充值`)}`);
      }
      return res.redirect(`${back}?error=${encodeURIComponent(err.message)}`);
    }
    next(err);
  }
});

router.post('/novel/:id/buy-full', rejectCrossSite, async (req, res, next) => {
  const novelId = toPositiveInt(req.params.id);
  const back = `/novel/${req.params.id}`;

  try {
    if (!req.webUser) return loginRedirect(req, res, back);
    if (!novelId) {
      return res.redirect(`${back}?error=${encodeURIComponent('无效的小说 ID')}`);
    }

    const result = await purchaseFullNovel(req.webUser.id, novelId);
    const notice = result.alreadyOwned
      ? '你已解锁整本书'
      : `解锁成功，扣除 ¥${yuan(result.amount)}，余额 ¥${yuan(result.balance)}。所有付费章节已解锁`;

    res.redirect(`${back}?notice=${encodeURIComponent(notice)}`);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === 'INSUFFICIENT_BALANCE') {
        const need = err.details && err.details.required ? `，需 ¥${yuan(err.details.required)}` : '';
        return res.redirect(`/wallet?error=${encodeURIComponent(`余额不足${need}，请先充值`)}`);
      }
      return res.redirect(`${back}?error=${encodeURIComponent(err.message)}`);
    }
    next(err);
  }
});

module.exports = router;

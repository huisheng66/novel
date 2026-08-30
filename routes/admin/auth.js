// 后台认证路由:登录/登出

const express = require('express');
const {
  parseCookies,
  timingSafeEqualString,
  isValidSession,
  setAdminSessionCookie,
  clearAdminSessionCookie,
  sanitizeNextPath,
  ADMIN_PASSWORD
} = require('./shared');
const { createRateLimiter } = require('../../lib/rateLimit');
const { getClientIp } = require('../middleware/auth');

const router = express.Router();

// 15 分钟内最多 5 次失败,成功登录即清零
const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });

router.get('/login', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  try {
    if (await isValidSession(cookies['admin_session'])) {
      return res.redirect(sanitizeNextPath(req.query.next));
    }
  } catch (err) {
    // 会话验证失败时继续渲染登录页
  }

  res.render('admin/login', {
    nextPath: sanitizeNextPath(req.query.next),
    error: req.query.error || ''
  });
});

router.post('/login', async (req, res) => {
  const ip = getClientIp(req);
  const limit = loginLimiter.check(ip);
  if (limit.blocked) {
    const message = `失败次数过多,请约 ${Math.max(1, Math.ceil(limit.retryAfterSec / 60))} 分钟后再试`;
    return res.redirect(429, `/admin/login?next=${encodeURIComponent(sanitizeNextPath(req.body.next))}&error=${encodeURIComponent(message)}`);
  }

  const password = String(req.body.password || '');
  const nextPath = sanitizeNextPath(req.body.next);

  if (!timingSafeEqualString(password, ADMIN_PASSWORD)) {
    loginLimiter.record(ip);
    return res.redirect(`/admin/login?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent('密码错误')}`);
  }

  loginLimiter.reset(ip);

  try {
    await setAdminSessionCookie(req, res);
  } catch (err) {
    return res.redirect(`/admin/login?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent('会话创建失败,请重试')}`);
  }
  res.redirect(nextPath);
});

router.post('/logout', async (req, res) => {
  await clearAdminSessionCookie(req, res);
  res.redirect('/admin/login');
});

module.exports = router;

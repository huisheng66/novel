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

const router = express.Router();

// 后台登录防爆破：按真实对端地址滑动窗口限流（默认 5 次 / 10 分钟）
const ADMIN_LOGIN_MAX = 5;
const ADMIN_LOGIN_WINDOW_MS = 10 * 60 * 1000;
const adminLoginWindows = new Map();

function adminLoginIp(req) {
  const ip = (req.ip || (req.socket && req.socket.remoteAddress) || 'unknown')
    .replace(/^::ffff:/, '')
    .slice(0, 64);
  return ip || 'unknown';
}

function adminLoginLimited(req) {
  const now = Date.now();
  const key = `admin-login:${adminLoginIp(req)}`;
  const list = adminLoginWindows.get(key) || [];
  while (list.length && list[0] <= now - ADMIN_LOGIN_WINDOW_MS) list.shift();
  if (list.length >= ADMIN_LOGIN_MAX) return true;
  list.push(now);
  adminLoginWindows.set(key, list);
  return false;
}

const adminLoginCleanupTimer = setInterval(() => {
  const cutoff = Date.now() - ADMIN_LOGIN_WINDOW_MS;
  for (const [key, list] of adminLoginWindows) {
    if (!list.length || list[list.length - 1] <= cutoff) adminLoginWindows.delete(key);
  }
}, ADMIN_LOGIN_WINDOW_MS);
if (adminLoginCleanupTimer.unref) adminLoginCleanupTimer.unref();

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
  if (adminLoginLimited(req)) {
    return res.status(429).send('登录尝试过于频繁，请 10 分钟后再试');
  }
  const password = String(req.body.password || '');
  const nextPath = sanitizeNextPath(req.body.next);

  if (!timingSafeEqualString(password, ADMIN_PASSWORD)) {
    return res.redirect(`/admin/login?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent('密码错误')}`);
  }

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

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

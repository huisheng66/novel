// Web 前台登录/注册/登出 — 与 App 共用 users 表与 JWT

const express = require('express');
const {
  isRegisterEnabled,
  loginUser,
  registerUser,
  logoutSession
} = require('../lib/api/users');
const { ApiError } = require('../lib/api/errors');
const {
  WEB_JWT_COOKIE,
  WEB_JWT_COOKIE_OPTS,
  tryAuthenticateWebUser
} = require('./middleware/auth');

const router = express.Router();

function sanitizeNext(next) {
  const raw = String(next || '/').trim() || '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/admin')) return '/';
  return raw.slice(0, 500);
}

function renderBridge(res, { accessToken, refreshToken, nextPath, notice }) {
  res.type('html').send(`<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>登录中…</title></head>
<body>
<p style="font-family:sans-serif;padding:2rem;color:#666">${notice || '正在进入书库…'}</p>
<script>
(function(){
  try {
    localStorage.setItem('codexnovel_access_token', ${JSON.stringify(accessToken)});
    ${refreshToken ? `localStorage.setItem('codexnovel_refresh_token', ${JSON.stringify(refreshToken)});` : ''}
  } catch (e) {}
  location.replace(${JSON.stringify(nextPath)});
})();
</script>
</body></html>`);
}

router.get('/login', async (req, res) => {
  await tryAuthenticateWebUser(req, res);
  if (req.webUser) {
    return res.redirect(sanitizeNext(req.query.next));
  }
  res.render('login', {
    error: req.query.error || '',
    notice: req.query.notice || '',
    nextPath: sanitizeNext(req.query.next),
    registerEnabled: isRegisterEnabled()
  });
});

router.post('/login', async (req, res) => {
  const nextPath = sanitizeNext(req.body.next);
  try {
    const result = await loginUser({
      username: req.body.username,
      password: req.body.password,
      deviceName: 'web',
      userAgent: String(req.headers['user-agent'] || '').slice(0, 255)
    });
    res.cookie(WEB_JWT_COOKIE, result.accessToken, WEB_JWT_COOKIE_OPTS);
    return renderBridge(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      nextPath,
      notice: '登录成功，正在跳转…'
    });
  } catch (err) {
    const msg =
      err instanceof ApiError
        ? err.message
        : '登录失败';
    return res.redirect(
      `/login?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent(msg)}`
    );
  }
});

router.get('/register', async (req, res) => {
  if (!isRegisterEnabled()) {
    return res.redirect(
      `/login?error=${encodeURIComponent('当前未开放注册，请联系管理员开通账号')}`
    );
  }
  await tryAuthenticateWebUser(req, res);
  if (req.webUser) {
    return res.redirect('/');
  }
  res.render('register', {
    error: req.query.error || '',
    nextPath: sanitizeNext(req.query.next)
  });
});

router.post('/register', async (req, res) => {
  const nextPath = sanitizeNext(req.body.next);
  if (!isRegisterEnabled()) {
    return res.redirect(`/login?error=${encodeURIComponent('当前未开放注册')}`);
  }
  try {
    const result = await registerUser({
      username: req.body.username,
      password: req.body.password,
      displayName: req.body.displayName || req.body.username,
      deviceName: 'web',
      userAgent: String(req.headers['user-agent'] || '').slice(0, 255)
    });
    res.cookie(WEB_JWT_COOKIE, result.accessToken, WEB_JWT_COOKIE_OPTS);
    return renderBridge(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      nextPath,
      notice: '注册成功，正在跳转…'
    });
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : '注册失败';
    return res.redirect(
      `/register?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent(msg)}`
    );
  }
});

router.get('/logout', async (req, res) => {
  // 尽量清 refresh（来自 body 没有时用 localStorage 在页面清）
  const refresh =
    (req.body && req.body.refreshToken) ||
    req.query.refreshToken ||
    '';
  if (refresh) {
    try {
      await logoutSession(refresh);
    } catch (e) {
      /* ignore */
    }
  }
  res.clearCookie(WEB_JWT_COOKIE, { path: '/' });
  res.type('html').send(`<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>退出</title></head>
<body>
<script>
try {
  localStorage.removeItem('codexnovel_access_token');
  localStorage.removeItem('codexnovel_refresh_token');
} catch (e) {}
location.replace('/login?notice=${encodeURIComponent('已退出登录')}');
</script>
</body></html>`);
});

router.post('/logout', async (req, res) => {
  try {
    await logoutSession(req.body && req.body.refreshToken);
  } catch (e) {
    /* ignore */
  }
  res.clearCookie(WEB_JWT_COOKIE, { path: '/' });
  res.redirect('/logout');
});

module.exports = router;

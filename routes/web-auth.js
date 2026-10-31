// Web 前台登录/注册/登出 — 与 App 共用 users 表与 JWT

const express = require('express');
const {
  isRegisterEnabled,
  loginUser,
  registerUser,
  logoutSession
} = require('../lib/api/users');
const { ApiError } = require('../lib/api/errors');
const emailApi = require('../lib/api/email');
const {
  WEB_JWT_COOKIE,
  WEB_JWT_COOKIE_OPTS,
  tryAuthenticateWebUser
} = require('./middleware/auth');

const router = express.Router();

// ---- 登录/注册防爆破：滑动窗口，按真实对端地址计数 ----
// （不信任客户端可控的 X-Forwarded-For；见 lib/api/rateLimit.js 的说明）
// 计数后端由 lib/rateLimitStore.js 决定：默认进程内，配置 REDIS_URL 后多实例共享。
const rateLimitStore = require('../lib/rateLimitStore');

const WEB_LOGIN_MAX = 10; // 10 次 / 15 分钟
const WEB_LOGIN_WINDOW_MS = 15 * 60 * 1000;

function clientIp(req) {
  // req.ip 受 Express trust proxy 控制：未配置 TRUST_PROXY 时为 socket 对端地址，不可伪造
  const ip = (req.ip || (req.socket && req.socket.remoteAddress) || 'unknown').replace(/^::ffff:/, '');
  return String(ip).slice(0, 64) || 'unknown';
}

async function webLoginLimited(req) {
  const result = await rateLimitStore.consume(`web-login:${clientIp(req)}`, {
    max: WEB_LOGIN_MAX,
    windowMs: WEB_LOGIN_WINDOW_MS
  });
  return !result.allowed;
}

// ---- 登录 CSRF 防护：校验 Origin / Sec-Fetch-Site（实现见 lib/csrf.js）----
const { rejectCrossSite } = require('../lib/csrf');

function sanitizeNext(next) {
  const raw = String(next || '/').trim() || '/';
  // 反斜杠会被浏览器归一化为 /（/%5cevil.com → //evil.com），必须一并拒绝
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.startsWith('/admin')) return '/';
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

router.post('/login', rejectCrossSite, async (req, res) => {
  if (await webLoginLimited(req)) {
    return res.status(429).send('登录尝试过于频繁，请 15 分钟后再试');
  }
  const nextPath = sanitizeNext(req.body.next);
  try {
    const result = await loginUser({
      // 表单字段沿用 email，但允许填用户名（含 @ 视为邮箱）
      login: req.body.email || req.body.username,
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

router.post('/register', rejectCrossSite, async (req, res) => {
  if (await webLoginLimited(req)) {
    return res.status(429).send('操作过于频繁，请 15 分钟后再试');
  }
  const nextPath = sanitizeNext(req.body.next);
  if (!isRegisterEnabled()) {
    return res.redirect(`/login?error=${encodeURIComponent('当前未开放注册')}`);
  }
  try {
    const result = await registerUser({
      email: req.body.email,
      username: req.body.username,
      password: req.body.password,
      displayName: req.body.displayName,
      // 邀请码可选：留空即普通注册
      inviteCode: req.body.inviteCode || req.body.invite_code,
      deviceName: 'web',
      userAgent: String(req.headers['user-agent'] || '').slice(0, 255)
    });
    // 发验证邮件（未配置 SMTP 时降级为写日志，不影响注册）
    const sent = await emailApi.maybeSendVerification(result.user, emailApi.resolveBaseUrl(req));

    res.cookie(WEB_JWT_COOKIE, result.accessToken, WEB_JWT_COOKIE_OPTS);
    return renderBridge(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      nextPath,
      notice: sent && sent.delivered
        ? '注册成功，验证邮件已发送，请查收'
        : '注册成功，正在跳转…'
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

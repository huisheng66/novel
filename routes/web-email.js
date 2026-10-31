// 邮箱相关页面：验证邮箱、重发验证信、忘记密码、重置密码。
//
// 这些路由必须挂在 authenticateToken 之前 —— 忘记密码的人显然没有登录态。
// 其中 /verify-email/resend 需要登录，所以自己解析 JWT。

const express = require('express');
const rateLimitStore = require('../lib/rateLimitStore');
const { rejectCrossSite } = require('../lib/csrf');
const tokens = require('../lib/api/emailTokens');
const email = require('../lib/api/email');
const { findUserByLogin, resetUserPassword } = require('../lib/api/users');
const { tryAuthenticateWebUser } = require('./middleware/auth');
const { ApiError } = require('../lib/api/errors');

const router = express.Router();

function clientIp(req) {
  return String(req.ip || (req.socket && req.socket.remoteAddress) || 'unknown')
    .replace(/^::ffff:/, '')
    .slice(0, 64) || 'unknown';
}

function renderResult(res, { ok, title, message, linkHref, linkText }) {
  res.set('Cache-Control', 'private, no-store');
  res.status(ok ? 200 : 400).render('email-result', { ok, title, message, linkHref, linkText });
}

/* ---------------- 验证邮箱 ---------------- */

router.get('/verify-email', async (req, res, next) => {
  try {
    const token = req.query.token;
    if (!token) {
      return renderResult(res, {
        ok: false,
        title: '链接无效',
        message: '缺少验证令牌，请从邮件中重新打开链接。',
        linkHref: '/login',
        linkText: '去登录'
      });
    }

    const userId = await tokens.consumeToken('verify', token);
    await email.markVerified(userId);

    renderResult(res, {
      ok: true,
      title: '邮箱已验证',
      message: '验证成功，现在可以正常使用账号了。',
      linkHref: '/',
      linkText: '开始阅读'
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return renderResult(res, {
        ok: false,
        title: '验证失败',
        message: err.message,
        linkHref: '/login',
        linkText: '去登录后重发验证邮件'
      });
    }
    next(err);
  }
});

router.post('/verify-email/resend', rejectCrossSite, async (req, res, next) => {
  try {
    // 这个接口需要登录态：全局鉴权只处理 GET/HEAD，这里自己解析
    if (!req.webUser) await tryAuthenticateWebUser(req, res);
    if (!req.webUser) {
      return res.redirect(`/login?next=${encodeURIComponent('/wallet')}`);
    }

    const limit = await rateLimitStore.consume(`verify-resend:u${req.webUser.id}:${clientIp(req)}`, {
      max: 3,
      windowMs: 10 * 60 * 1000
    });
    if (!limit.allowed) {
      return res.redirect(`/wallet?error=${encodeURIComponent('发送过于频繁，请 10 分钟后再试')}`);
    }

    const state = await email.isEmailVerified(req.webUser.id);
    if (!state.hasEmail) {
      return res.redirect(`/wallet?error=${encodeURIComponent('该账号没有绑定邮箱')}`);
    }
    if (state.verified) {
      return res.redirect(`/wallet?notice=${encodeURIComponent('邮箱已经验证过了')}`);
    }

    const user = {
      id: req.webUser.id,
      email: req.webUser.email,
      username: req.webUser.username,
      display_name: req.webUser.displayName
    };
    const sent = await email.sendVerificationEmail(user, email.resolveBaseUrl(req));

    const notice = sent.delivered
      ? '验证邮件已发送，请查收'
      : '邮件服务未配置，验证链接已写入服务端日志（请联系站长）';
    res.redirect(`/wallet?notice=${encodeURIComponent(notice)}`);
  } catch (err) {
    next(err);
  }
});

/* ---------------- 忘记密码 ---------------- */

router.get('/forgot-password', (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.render('forgot-password', {
    error: req.query.error || '',
    notice: req.query.notice || ''
  });
});

router.post('/forgot-password', rejectCrossSite, async (req, res, next) => {
  try {
    const limit = await rateLimitStore.consume(`forgot:${clientIp(req)}`, {
      max: 5,
      windowMs: 15 * 60 * 1000
    });
    if (!limit.allowed) {
      return res.redirect(`/forgot-password?error=${encodeURIComponent('请求过于频繁，请 15 分钟后再试')}`);
    }

    const identifier = String(req.body.email || '').trim();
    const user = identifier ? await findUserByLogin(identifier) : null;

    // 无论邮箱是否存在都给同样的提示，避免被用来枚举账号
    if (user && user.email && user.is_active) {
      await email.sendPasswordResetEmail(
        { id: user.id, email: user.email, username: user.username, display_name: user.display_name },
        email.resolveBaseUrl(req)
      );
    }

    res.redirect(`/forgot-password?notice=${encodeURIComponent(
      '如果该邮箱已注册，我们已发送重置链接，请查收（1 小时内有效）'
    )}`);
  } catch (err) {
    next(err);
  }
});

/* ---------------- 重置密码 ---------------- */

router.get('/reset-password', async (req, res, next) => {
  try {
    const token = String(req.query.token || '');
    const valid = token ? await tokens.peekToken('reset', token) : false;

    res.set('Cache-Control', 'private, no-store');
    if (!valid) {
      return renderResult(res, {
        ok: false,
        title: '链接已失效',
        message: '重置链接无效或已过期，请重新申请。',
        linkHref: '/forgot-password',
        linkText: '重新申请'
      });
    }

    res.render('reset-password', { token, error: req.query.error || '' });
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', rejectCrossSite, async (req, res, next) => {
  const token = String(req.body.token || '');
  try {
    const limit = await rateLimitStore.consume(`reset:${clientIp(req)}`, {
      max: 10,
      windowMs: 15 * 60 * 1000
    });
    if (!limit.allowed) {
      return res.redirect(`/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent('操作过于频繁，请稍后再试')}`);
    }

    const password = String(req.body.password || '');
    if (password.length < 8) {
      return res.redirect(
        `/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent('密码至少 8 位')}`
      );
    }
    if (password !== String(req.body.password2 || '')) {
      return res.redirect(
        `/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent('两次输入的密码不一致')}`
      );
    }

    // 核销令牌 → 改密（内部会清掉所有会话）→ 顺带标记邮箱已验证
    const userId = await tokens.consumeToken('reset', token);
    await resetUserPassword(userId, password);
    await email.markVerified(userId);

    res.redirect(`/login?notice=${encodeURIComponent('密码已重置，请用新密码登录')}`);
  } catch (err) {
    if (err instanceof ApiError) {
      return renderResult(res, {
        ok: false,
        title: '重置失败',
        message: err.message,
        linkHref: '/forgot-password',
        linkText: '重新申请'
      });
    }
    next(err);
  }
});

module.exports = router;

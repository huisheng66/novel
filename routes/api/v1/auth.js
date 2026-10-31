const express = require('express');
const {
  registerUser,
  loginUser,
  refreshSession,
  logoutSession
} = require('../../../lib/api/users');
const { authRateLimit } = require('../../../lib/api/rateLimit');
const { sendError, ApiError } = require('../../../lib/api/errors');
const emailApi = require('../../../lib/api/email');

const router = express.Router();
const limitAuth = authRateLimit();

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function clientMeta(req) {
  return {
    deviceName: req.body && req.body.deviceName,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 255)
  };
}

router.post('/register', limitAuth, asyncRoute(async (req, res) => {
  try {
    const result = await registerUser({
      email: req.body.email,
      username: req.body.username,
      password: req.body.password,
      displayName: req.body.displayName,
      // 邀请码可选，填了才核销
      inviteCode: req.body.inviteCode || req.body.invite_code,
      ...clientMeta(req)
    });

    const sent = await emailApi.maybeSendVerification(result.user, emailApi.resolveBaseUrl(req));
    res.status(201).json({ ...result, emailVerificationSent: Boolean(sent && sent.delivered) });
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

router.post('/login', limitAuth, asyncRoute(async (req, res) => {
  try {
    const result = await loginUser({
      // 兼容三种字段：login / email / username
      login: req.body.login || req.body.email || req.body.username,
      password: req.body.password,
      ...clientMeta(req)
    });
    res.json(result);
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

router.post('/refresh', limitAuth, asyncRoute(async (req, res) => {
  try {
    const result = await refreshSession(req.body.refreshToken, clientMeta(req));
    res.json(result);
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

router.post('/logout', asyncRoute(async (req, res) => {
  await logoutSession(req.body && req.body.refreshToken);
  res.json({ ok: true });
}));

module.exports = router;

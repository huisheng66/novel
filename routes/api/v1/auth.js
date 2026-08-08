const express = require('express');
const {
  registerUser,
  loginUser,
  refreshSession,
  logoutSession
} = require('../../../lib/api/users');
const { authRateLimit } = require('../../../lib/api/rateLimit');
const { sendError, ApiError } = require('../../../lib/api/errors');

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
      username: req.body.username,
      password: req.body.password,
      displayName: req.body.displayName,
      ...clientMeta(req)
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

router.post('/login', limitAuth, asyncRoute(async (req, res) => {
  try {
    const result = await loginUser({
      username: req.body.username,
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

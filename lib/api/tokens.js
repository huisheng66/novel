// JWT access + opaque refresh helpers

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { parsePositiveInt } = require('../util');

function accessSecret() {
  return process.env.JWT_ACCESS_SECRET || process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || 'dev-api-secret';
}

function accessTtlSec() {
  return parsePositiveInt(process.env.JWT_ACCESS_TTL_SEC, 7200);
}

function refreshTtlDays() {
  return parsePositiveInt(process.env.JWT_REFRESH_TTL_DAYS, 30);
}

function signAccessToken(user) {
  const expiresIn = accessTtlSec();
  const token = jwt.sign(
    {
      sub: user.id,
      username: user.username,
      typ: 'access'
    },
    accessSecret(),
    { expiresIn }
  );
  return { token, expiresIn };
}

function verifyAccessToken(token) {
  const payload = jwt.verify(token, accessSecret());
  if (!payload || payload.typ !== 'access' || !payload.sub) {
    const err = new Error('Invalid access token');
    err.name = 'JsonWebTokenError';
    throw err;
  }
  return payload;
}

function createRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function contentHash(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function refreshExpiresAt() {
  const d = new Date();
  d.setDate(d.getDate() + refreshTtlDays());
  return d;
}

module.exports = {
  accessSecret,
  accessTtlSec,
  refreshTtlDays,
  signAccessToken,
  verifyAccessToken,
  createRefreshToken,
  hashToken,
  contentHash,
  refreshExpiresAt
};

// JWT access + opaque refresh helpers

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { parsePositiveInt } = require('../util');

// JWT 签名密钥必须显式配置（≥32 字节随机值）。
// 拒绝任何回退链：回退到 ADMIN_PASSWORD / 默认值会让攻击者直接伪造任意读者令牌。
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || '';
if (!ACCESS_SECRET || ACCESS_SECRET.length < 32) {
  throw new Error(
    'JWT_ACCESS_SECRET 未配置或过短（需 ≥32 字节随机值）。请设置强随机密钥后重启，拒绝使用弱默认值。'
  );
}

function accessSecret() {
  return ACCESS_SECRET;
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

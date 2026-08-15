// 后台会话：HMAC cookie + admin_sessions 表校验

const crypto = require('crypto');
const { pool } = require('../../../db');
const logger = require('../../../lib/logger');

const SESSION_COOKIE = 'admin_session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_ADMIN_PASSWORD = 'admin123';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || ADMIN_PASSWORD;
const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

// 生产环境拒绝默认/缺失的后台密码与会话密钥，避免 admin123 直登后台
if (process.env.NODE_ENV === 'production') {
  if (!process.env.ADMIN_PASSWORD || ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD) {
    throw new Error('生产环境必须设置强随机 ADMIN_PASSWORD，禁止使用默认密码 admin123');
  }
  if (!process.env.ADMIN_SESSION_SECRET) {
    throw new Error('生产环境必须设置 ADMIN_SESSION_SECRET（强随机值，与 ADMIN_PASSWORD 分离）');
  }
}

function parseCookies(cookieHeader) {
  return String(cookieHeader || '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) return cookies;

      const name = part.slice(0, separatorIndex);
      const value = part.slice(separatorIndex + 1);
      try {
        cookies[name] = decodeURIComponent(value);
      } catch (err) {
        cookies[name] = value;
      }
      return cookies;
    }, {});
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signSession(sid) {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`admin-session:${sid}`)
    .digest('base64url');
}

async function createSessionValue() {
  const sid = crypto.randomBytes(32).toString('hex');
  const signature = signSession(sid);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);
  await pool.execute(
    'INSERT INTO admin_sessions (sid, expires_at) VALUES (?, ?)',
    [sid, expiresAt]
  );
  return `${sid}.${signature}`;
}

async function isValidSession(value) {
  if (!value) return false;

  const [sid, signature] = String(value).split('.');
  if (!sid || !signature) return false;
  if (!timingSafeEqualString(signature, signSession(sid))) return false;

  const [rows] = await pool.execute(
    'SELECT 1 FROM admin_sessions WHERE sid = ? AND expires_at > NOW() LIMIT 1',
    [sid]
  );
  return rows.length > 0;
}

async function revokeSession(value) {
  if (!value) return;
  const [sid] = String(value).split('.');
  if (!sid) return;
  try {
    await pool.execute('DELETE FROM admin_sessions WHERE sid = ?', [sid]);
  } catch (err) {
    logger.warn('Failed to revoke session', { err });
  }
}

function isSecureRequest(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

async function setAdminSessionCookie(req, res) {
  const value = await createSessionValue();
  res.cookie(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    maxAge: SESSION_MAX_AGE_MS,
    path: '/admin'
  });
}

async function clearAdminSessionCookie(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  await revokeSession(cookies[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/admin'
  });
}

function sanitizeNextPath(nextPath) {
  const value = String(nextPath || '/admin');
  // 反斜杠会被浏览器归一化为 /，可绕过 // 前缀检查形成 scheme-relative 跳转
  if (!value.startsWith('/admin') || value.startsWith('/admin/login') || value.startsWith('/admin/logout') || value.includes('\\')) {
    return '/admin';
  }
  return value;
}

const sessionCleanupTimer = setInterval(async () => {
  try {
    await pool.execute('DELETE FROM admin_sessions WHERE expires_at < NOW()');
  } catch (err) {
    logger.warn('Session cleanup failed', { err });
  }
}, SESSION_CLEANUP_INTERVAL_MS);
sessionCleanupTimer.unref();

async function requireAdmin(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  try {
    if (await isValidSession(cookies[SESSION_COOKIE])) {
      return next();
    }
  } catch (err) {
    logger.error('Session validation error', { err });
  }
  res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl || '/admin')}`);
}

module.exports = {
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  ADMIN_PASSWORD,
  parseCookies,
  timingSafeEqualString,
  setAdminSessionCookie,
  clearAdminSessionCookie,
  sanitizeNextPath,
  isValidSession,
  requireAdmin
};

// /api/v1 鉴权：用户 JWT 与站点 Access Token

const { pool } = require('../../../../db');
const cache = require('../../../../lib/memoryCache');
const { parsePositiveInt } = require('../../../../lib/util');
const { verifyAccessToken } = require('../../../../lib/api/tokens');
const { findUserById } = require('../../../../lib/api/users');
const { unauthorized, forbidden, sendError, ApiError } = require('../../../../lib/api/errors');

const TOKEN_CACHE_TTL = parsePositiveInt(process.env.ACCESS_TOKEN_CACHE_TTL_MS, 120000);

function extractBearer(req) {
  const header = String(req.headers.authorization || '');
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function extractSiteToken(req) {
  const header = String(req.headers['x-access-token'] || '').trim();
  if (header) return header;
  const q = String(req.query.token || '').trim();
  return q || '';
}

async function loadSiteToken(tokenValue) {
  if (!tokenValue) return null;
  const cacheKey = `api-access-token:${tokenValue}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const [[row]] = await pool.execute(
    `SELECT id, name, token, allowed_novel_id, is_active, risk_paused_until
     FROM access_tokens
     WHERE token = ? AND is_active = 1
     LIMIT 1`,
    [tokenValue]
  );
  if (!row) {
    cache.set(cacheKey, null, Math.min(TOKEN_CACHE_TTL, 10000));
    return null;
  }
  cache.set(cacheKey, row, TOKEN_CACHE_TTL);
  return row;
}

async function attachUserFromJwt(req) {
  const bearer = extractBearer(req);
  if (!bearer) return false;
  try {
    const payload = verifyAccessToken(bearer);
    const user = await findUserById(payload.sub);
    if (!user || !user.is_active) return false;
    req.apiUser = {
      id: user.id,
      username: user.username,
      displayName: user.display_name || user.username,
      email: user.email || null
    };
    return true;
  } catch (err) {
    return false;
  }
}

async function attachSiteToken(req) {
  const tokenValue = extractSiteToken(req);
  if (!tokenValue) return false;
  const row = await loadSiteToken(tokenValue);
  if (!row) return false;
  req.siteAccessToken = row;
  req.allowedNovelId = row.allowed_novel_id || null;
  return true;
}

/** 书库只读：用户 JWT 或站点 Access Token 任一即可 */
async function requireReaderAuth(req, res, next) {
  try {
    const hasUser = await attachUserFromJwt(req);
    if (hasUser) return next();

    const hasSite = await attachSiteToken(req);
    if (hasSite) return next();

    throw unauthorized('Login or access token required');
  } catch (err) {
    return sendError(res, err instanceof ApiError ? err : unauthorized('Invalid credentials'));
  }
}

/** 书架/进度：必须用户 JWT */
async function requireUser(req, res, next) {
  try {
    const hasUser = await attachUserFromJwt(req);
    if (!hasUser) throw unauthorized('User login required');
    return next();
  } catch (err) {
    return sendError(res, err instanceof ApiError ? err : unauthorized('Invalid access token'));
  }
}

function assertNovelAccess(req, novelId) {
  if (req.allowedNovelId && Number(req.allowedNovelId) !== Number(novelId)) {
    throw forbidden('Token not allowed for this novel');
  }
}

module.exports = {
  requireReaderAuth,
  requireUser,
  assertNovelAccess,
  extractBearer,
  extractSiteToken
};

// 鉴权 + 风控 + 统计中间件,从 routes/index.js 抽取
// Web 可读：access_token（分享/Legado）或统一读者 JWT（App/Web 同一 users 账号）

const crypto = require('crypto');
const { pool } = require('../../db');
const cache = require('../../lib/memoryCache');
const pageViewQueue = require('../../lib/pageViewQueue');
const { parsePositiveInt } = require('../../lib/util');
const logger = require('../../lib/logger');
const { verifyAccessToken } = require('../../lib/api/tokens');
const { findUserById, publicUser } = require('../../lib/api/users');

/** Web JWT cookie：与 App 共用 users + access JWT */
const WEB_JWT_COOKIE = 'cn_jwt';
const WEB_JWT_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: 30 * 24 * 60 * 60 * 1000
};

// Token 鉴权内存缓存：过短会导致几乎每请求打 DB
const ACCESS_TOKEN_CACHE_TTL_MS = parsePositiveInt(process.env.ACCESS_TOKEN_CACHE_TTL_MS, 120000);
const RISK_WINDOW_MINUTES = parsePositiveInt(process.env.RISK_WINDOW_MINUTES, 5);
const RISK_CHAPTER_LIMIT = parsePositiveInt(process.env.RISK_CHAPTER_LIMIT, 75);
const RISK_PAUSE_HOURS = parsePositiveInt(process.env.RISK_PAUSE_HOURS, 1);
const RISK_WINDOW_MS = RISK_WINDOW_MINUTES * 60 * 1000;
const RISK_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const riskWindows = new Map();
const riskWindowLoads = new Map();

// 定期清理风控 Map 中的空/过期 entry,避免 token 删除后 key 残留导致内存泄漏
const riskCleanupTimer = setInterval(() => {
  const cutoff = Date.now() - RISK_WINDOW_MS;
  for (const [id, entry] of riskWindows) {
    if (!entry || entry.length === 0 || entry[entry.length - 1] < cutoff) {
      riskWindows.delete(id);
    }
  }
  // riskWindowLoads 的 entry 在 load 完成后即被删除,此处仅做兜底清理
  if (riskWindowLoads.size > 0 && riskWindows.size === 0) {
    riskWindowLoads.clear();
  }
}, RISK_CLEANUP_INTERVAL_MS);
if (riskCleanupTimer.unref) riskCleanupTimer.unref();

function normalizeIp(ip) {
  const value = String(ip || '').trim();
  if (!value) return 'unknown';
  // IPv4-mapped IPv6 (::ffff:1.2.3.4) → IPv4
  const mapped = value.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (mapped) return mapped[1];
  // IPv6 回环 ::1 → 127.0.0.1
  if (value === '::1') return '127.0.0.1';
  return value.slice(0, 64);
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (forwarded) return normalizeIp(forwarded);

  const remote = req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : '';
  return normalizeIp(remote);
}

function getSessionId(req) {
  const existing = readCookie(req, 'visitor_session').slice(0, 64);
  if (existing) return existing;
  return crypto.randomBytes(12).toString('hex');
}

const COOKIE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const ACCESS_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge: COOKIE_YEAR_MS,
  path: '/'
};

function readCookie(req, name) {
  const prefix = `${name}=`;
  const part = String(req.headers.cookie || '')
    .split(';')
    .map(item => item.trim())
    .find(item => item.startsWith(prefix));
  if (!part) return '';
  const raw = part.slice(prefix.length);
  try {
    return decodeURIComponent(raw).slice(0, 128);
  } catch (err) {
    return raw.slice(0, 128);
  }
}

function setCookieIfAbsentOrChanged(req, res, name, value, options) {
  const current = readCookie(req, name);
  if (current && current === value) return false;
  res.cookie(name, value, options);
  return true;
}

function getVisitorUid(req) {
  const existing = readCookie(req, 'visitor_uid').slice(0, 64);
  if (existing) return existing;
  return crypto.randomBytes(12).toString('hex');
}

function sendRiskPaused(res, pausedUntil) {
  const untilText = pausedUntil || '1 小时后';
  res.status(429).send(`访问过快，已触发风控暂停访问 1 小时。预计恢复时间：${untilText}`);
}

function parseNovelAndChapter(pathname) {
  const novelMatch = pathname.match(/^\/novel\/(\d+)(?:\/(\d+))?$/);
  if (novelMatch) {
    return {
      novelId: Number(novelMatch[1]),
      chapterId: novelMatch[2] ? Number(novelMatch[2]) : null
    };
  }

  const sourceBookMatch = pathname.match(/^\/source\/(?:html\/)?(?:book|toc)\/(\d+)$/);
  if (sourceBookMatch) {
    return {
      novelId: Number(sourceBookMatch[1]),
      chapterId: null
    };
  }

  const sourceContentMatch = pathname.match(/^\/source\/(?:html\/)?content\/(\d+)\/(\d+)$/);
  if (sourceContentMatch) {
    return {
      novelId: Number(sourceContentMatch[1]),
      chapterId: Number(sourceContentMatch[2])
    };
  }

  return {
    novelId: null,
    chapterId: null
  };
}

function isChapterPath(pathname) {
  const { novelId, chapterId } = parseNovelAndChapter(pathname);
  return Boolean(novelId && chapterId);
}

function isRiskControlledPath(pathname) {
  // Legado can fetch many chapters in parallel; source reads must not pause the token.
  return isChapterPath(pathname) && !String(pathname || '').startsWith('/source/');
}

function isSourcePath(pathname) {
  return String(pathname || '').startsWith('/source/');
}

function isAllowedNovelPath(pathname, allowedNovelId) {
  if (!allowedNovelId) return true;
  if (pathname === '/') return true;
  if (/^\/source\/(?:html\/)?search$/.test(pathname)) return true;
  if (pathname === '/source/legado') return true;
  if (/^\/source\/import\/[A-Za-z0-9_-]{8,128}\.json$/.test(pathname)) return true;

  const { novelId } = parseNovelAndChapter(pathname);
  return Number(novelId) === Number(allowedNovelId);
}

function sendNovelForbidden(res) {
  res.status(403).send('该 Token 无权访问这本小说');
}

function getAccessTokenValue(req) {
  const queryToken = String(req.query.token || '').trim();
  if (queryToken) return queryToken.slice(0, 128);

  const paramToken = String(req.params && req.params.token || '').trim();
  if (paramToken) return paramToken.slice(0, 128);

  const importPathTokenMatch = String(req.path || req.originalUrl || '').match(/^\/source\/import\/([A-Za-z0-9_-]{8,128})\.json$/);
  if (importPathTokenMatch) {
    return importPathTokenMatch[1];
  }

  const cookieToken = String(req.headers.cookie || '')
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith('access_token='));

  if (cookieToken) {
    const raw = cookieToken.slice('access_token='.length);
    try {
      return decodeURIComponent(raw).slice(0, 128);
    } catch (err) {
      return raw.slice(0, 128);
    }
  }
  return '';
}

async function getActiveAccessTokenId(req, res) {
  const token = getAccessTokenValue(req);
  if (!token) return null;

  const pathname = req.path || req.originalUrl || '/';
  const shouldApplyRiskControl = isRiskControlledPath(pathname);
  const cacheKey = `access-token:${token}`;
  const cachedAccessToken = cache.get(cacheKey);
  if (cachedAccessToken) {
    req.accessToken = cachedAccessToken;
    if (!isAllowedNovelPath(pathname, cachedAccessToken.allowedNovelId)) {
      sendNovelForbidden(res);
      return null;
    }
    if (cachedAccessToken.pausedUntil && shouldApplyRiskControl) {
      sendRiskPaused(res, cachedAccessToken.pausedUntil);
      return null;
    }
    const pausedUntil = shouldApplyRiskControl
      ? await pauseTokenIfOverLimit(cachedAccessToken.id, token, cachedAccessToken.allowedNovelId)
      : '';
    if (pausedUntil) {
      sendRiskPaused(res, pausedUntil);
      return null;
    }
    setCookieIfAbsentOrChanged(req, res, 'access_token', token, ACCESS_COOKIE_OPTS);
    return cachedAccessToken.id;
  }

  const [[row]] = await pool.execute(
    `SELECT
       id,
       allowed_novel_id,
       DATE_FORMAT(risk_paused_until, '%Y-%m-%d %H:%i:%s') AS paused_until,
       risk_paused_until > NOW() AS is_risk_paused
     FROM access_tokens
     WHERE token = ? AND is_active = 1
     LIMIT 1`,
    [token]
  );
  if (!row) return null;
  if (!isAllowedNovelPath(pathname, row.allowed_novel_id)) {
    sendNovelForbidden(res);
    return null;
  }
  if (row.is_risk_paused) {
    const pausedAccessToken = {
      id: row.id,
      allowedNovelId: row.allowed_novel_id || null,
      pausedUntil: row.paused_until
    };
    req.accessToken = pausedAccessToken;
    cache.set(cacheKey, pausedAccessToken, ACCESS_TOKEN_CACHE_TTL_MS);
    if (shouldApplyRiskControl) {
      sendRiskPaused(res, row.paused_until);
      return null;
    }
    setCookieIfAbsentOrChanged(req, res, 'access_token', token, ACCESS_COOKIE_OPTS);
    return row.id;
  }
  if (row.paused_until) {
    await pool.execute(
      'UPDATE access_tokens SET risk_paused_until = NULL, risk_reason = NULL WHERE id = ? AND risk_paused_until <= NOW()',
      [row.id]
    );
  }

  const accessToken = {
    id: row.id,
    allowedNovelId: row.allowed_novel_id || null,
    pausedUntil: ''
  };
  req.accessToken = accessToken;
  cache.set(cacheKey, accessToken, ACCESS_TOKEN_CACHE_TTL_MS);
  const pausedUntil = shouldApplyRiskControl
    ? await pauseTokenIfOverLimit(row.id, token, row.allowed_novel_id || null)
    : '';
  if (pausedUntil) {
    sendRiskPaused(res, pausedUntil);
    return null;
  }
  setCookieIfAbsentOrChanged(req, res, 'access_token', token, ACCESS_COOKIE_OPTS);
  return row.id;
}

async function pauseTokenIfOverLimit(accessTokenId, token, allowedNovelId) {
  const recentViews = await getRiskWindow(accessTokenId);
  if (recentViews.length < RISK_CHAPTER_LIMIT) {
    recentViews.push(Date.now());
    return '';
  }

  // 命中风控:内存立即置位,响应立刻返回 429;DB 更新异步执行,避免阻塞请求
  const reason = `${RISK_WINDOW_MINUTES}分钟内访问超过${RISK_CHAPTER_LIMIT}章节`;
  const pausedUntilDate = new Date(Date.now() + RISK_PAUSE_HOURS * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const pausedUntilText = `${pausedUntilDate.getFullYear()}-${pad(pausedUntilDate.getMonth() + 1)}-${pad(pausedUntilDate.getDate())} ${pad(pausedUntilDate.getHours())}:${pad(pausedUntilDate.getMinutes())}:${pad(pausedUntilDate.getSeconds())}`;

  cache.set(`access-token:${token}`, {
    id: accessTokenId,
    allowedNovelId: allowedNovelId || null,
    pausedUntil: pausedUntilText
  }, ACCESS_TOKEN_CACHE_TTL_MS);

  setImmediate(() => {
    pool.execute(
      `UPDATE access_tokens
       SET risk_paused_until = DATE_ADD(NOW(), INTERVAL ${RISK_PAUSE_HOURS} HOUR),
           risk_reason = ?
       WHERE id = ?`,
      [reason, accessTokenId]
    ).catch(err => logger.error('Failed to persist risk pause', { err }));
  });

  return pausedUntilText;
}

async function getRiskWindow(accessTokenId) {
  const now = Date.now();
  const cutoff = now - RISK_WINDOW_MS;
  let entry = riskWindows.get(accessTokenId);

  if (!entry) {
    entry = [];
    riskWindows.set(accessTokenId, entry);
  }

  let load = riskWindowLoads.get(accessTokenId);
  if (load) {
    await load;
  } else if (entry.length === 0) {
    load = loadRiskWindow(accessTokenId, entry, cutoff);
    riskWindowLoads.set(accessTokenId, load);
    try {
      await load;
    } finally {
      riskWindowLoads.delete(accessTokenId);
    }
  } else {
    while (entry.length > 0 && entry[0] < cutoff) {
      entry.shift();
    }
  }

  return entry;
}

async function loadRiskWindow(accessTokenId, entry, cutoff) {
  const [rows] = await pool.execute(
    `SELECT UNIX_TIMESTAMP(created_at) * 1000 AS viewed_at_ms
     FROM page_views
     WHERE access_token_id = ?
       AND novel_id IS NOT NULL
       AND chapter_id IS NOT NULL
       AND path NOT LIKE '/source/%'
       AND created_at >= DATE_SUB(NOW(), INTERVAL ${RISK_WINDOW_MINUTES} MINUTE)
     ORDER BY created_at ASC`,
    [accessTokenId]
  );

  for (const row of rows) {
    const viewedAt = Number(row.viewed_at_ms || 0);
    if (viewedAt >= cutoff) entry.push(viewedAt);
  }
}

function isTokenOnlySourcePath(pathname) {
  return isSourcePath(pathname);
}

function readCookieValue(req, name) {
  const prefix = `${name}=`;
  const part = String(req.headers.cookie || '')
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(prefix));
  if (!part) return '';
  const raw = part.slice(prefix.length);
  try {
    return decodeURIComponent(raw);
  } catch (err) {
    return raw;
  }
}

function getJwtFromRequest(req) {
  const auth = String(req.headers.authorization || '');
  if (/^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '').trim();
  }
  return readCookieValue(req, WEB_JWT_COOKIE).trim();
}

/**
 * 统一读者 JWT（App / Web 登录后同一账号）
 * @returns {Promise<object|null>} publicUser 或 null
 */
async function tryAuthenticateWebUser(req, res) {
  const token = getJwtFromRequest(req);
  if (!token) return null;
  try {
    const payload = verifyAccessToken(token);
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) return null;

    const cacheKey = `web-user:${userId}`;
    let user = cache.get(cacheKey);
    if (!user) {
      const row = await findUserById(userId);
      if (!row || !(row.is_active === 1 || row.is_active === true)) return null;
      user = publicUser(row);
      cache.set(cacheKey, user, 60 * 1000);
    }

    req.webUser = user;
    req.webJwt = token;
    // 刷新 cookie，保持 Web 会话
    if (res && !res.headersSent) {
      res.cookie(WEB_JWT_COOKIE, token, WEB_JWT_COOKIE_OPTS);
    }
    return user;
  } catch (err) {
    return null;
  }
}

async function requireAccessToken(req, res) {
  const accessTokenId = await getActiveAccessTokenId(req, res);
  if (accessTokenId) return accessTokenId;
  if (res.headersSent) return null;

  // 统一读者账号（Web 登录 / App 同一 JWT）
  const webUser = await tryAuthenticateWebUser(req, res);
  if (webUser) {
    req.accessTokenId = null;
    return 'jwt-user';
  }

  if (isTokenOnlySourcePath(req.path || req.originalUrl || '/')) {
    res.status(403).json({ error: 'Access token required' });
    return null;
  }

  // 跳转登录页（浏览器 HTML）
  const pathname = req.path || req.originalUrl || '/';
  const acceptsHtml = String(req.headers.accept || '').includes('text/html');
  if (acceptsHtml && !pathname.startsWith('/source')) {
    const next = encodeURIComponent(pathname + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''));
    res.redirect(`/login?next=${next}`);
    return null;
  }

  res.status(403).send('Access token required. 请登录或使用 ?token=');
  return null;
}

// 鉴权中间件:过滤静态/管理路径,校验 access token 或读者 JWT
async function authenticateToken(req, res, next) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }

    const pathname = req.path || req.originalUrl || '/';
    if (
      pathname.startsWith('/admin') ||
      pathname.startsWith('/api') ||
      pathname.startsWith('/css') ||
      pathname.startsWith('/js') ||
      pathname.startsWith('/uploads') ||
      pathname.startsWith('/favicon') ||
      pathname === '/healthz' ||
      pathname === '/login' ||
      pathname === '/logout' ||
      pathname === '/register'
    ) {
      // 登录页等也可解析 JWT 以显示状态
      if (pathname === '/login' || pathname === '/register' || pathname === '/logout') {
        await tryAuthenticateWebUser(req, res);
      }
      return next();
    }

    const accessTokenId = await requireAccessToken(req, res);
    if (!accessTokenId) return;
    if (accessTokenId !== 'jwt-user') {
      req.accessTokenId = accessTokenId;
    }
    // 若已有 access token，也尝试挂上 webUser（可选）
    if (!req.webUser) {
      await tryAuthenticateWebUser(req, res);
    }
    res.locals.webUser = req.webUser || null;
    next();
  } catch (err) {
    next(err);
  }
}

// 统计中间件:记录访客信息与页面访问(仅在鉴权通过后执行)
async function recordPageView(req, res, next) {
  try {
    if (!req.accessTokenId) {
      return next();
    }

    const pathname = req.path || req.originalUrl || '/';
    const hadUid = Boolean(readCookie(req, 'visitor_uid'));
    const hadSession = Boolean(readCookie(req, 'visitor_session'));
    const visitorUid = getVisitorUid(req);
    const sessionId = getSessionId(req);
    const visitorIp = getClientIp(req);
    const userAgent = String(req.headers['user-agent'] || 'unknown').slice(0, 255);
    const referrer = String(req.headers.referer || req.headers.referrer || '').slice(0, 255) || null;
    const { novelId, chapterId } = parseNovelAndChapter(pathname);

    // 已有 Cookie 不再重复 Set-Cookie，减小响应头与客户端处理
    if (!hadUid) {
      res.cookie('visitor_uid', visitorUid, ACCESS_COOKIE_OPTS);
    }
    if (!hadSession) {
      res.cookie('visitor_session', sessionId, ACCESS_COOKIE_OPTS);
    }

    pageViewQueue.enqueue({
      visitorUid,
      accessTokenId: req.accessTokenId,
      sessionId,
      visitorIp,
      userAgent,
      path: pathname,
      referrer,
      novelId,
      chapterId
    });

    next();
  } catch (err) {
    next(err);
  }
}

// 暴露风控内存统计供 /metrics 端点消费
function getRiskStats() {
  return {
    riskWindowsSize: riskWindows.size,
    riskWindowLoadsSize: riskWindowLoads.size
  };
}

module.exports = {
  authenticateToken,
  recordPageView,
  getRiskStats,
  getAccessTokenValue,
  parseNovelAndChapter,
  tryAuthenticateWebUser,
  getJwtFromRequest,
  WEB_JWT_COOKIE,
  WEB_JWT_COOKIE_OPTS
};

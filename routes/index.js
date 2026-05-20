const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { pool } = require('../db');
const cache = require('../lib/memoryCache');
const pageViewQueue = require('../lib/pageViewQueue');

const ACCESS_TOKEN_CACHE_TTL_MS = 5000;
const RISK_WINDOW_MINUTES = 5;
const RISK_CHAPTER_LIMIT = 75;
const RISK_PAUSE_HOURS = 1;
const RISK_WINDOW_MS = RISK_WINDOW_MINUTES * 60 * 1000;
const riskWindows = new Map();
const riskWindowLoads = new Map();

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (forwarded) return forwarded.slice(0, 64);

  const remote = req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : '';
  return remote.slice(0, 64) || 'unknown';
}

function getSessionId(req) {
  const value = String(req.headers.cookie || '')
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith('visitor_session='));

  if (value) return value.slice('visitor_session='.length).slice(0, 64);

  return crypto.randomBytes(12).toString('hex');
}

function getVisitorUid(req) {
  const value = String(req.headers.cookie || '')
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith('visitor_uid='));

  if (value) return value.slice('visitor_uid='.length).slice(0, 64);

  return crypto.randomBytes(12).toString('hex');
}

function sendRiskPaused(res, pausedUntil) {
  const untilText = pausedUntil || '1 小时后';
  res.status(429).send(`访问过快，已触发风控暂停访问 1 小时。预计恢复时间：${untilText}`);
}

function isChapterPath(pathname) {
  const { novelId, chapterId } = parseNovelAndChapter(pathname);
  return Boolean(novelId && chapterId);
}

function isAllowedNovelPath(pathname, allowedNovelId) {
  if (!allowedNovelId) return true;
  if (pathname === '/') return true;

  const { novelId } = parseNovelAndChapter(pathname);
  return Number(novelId) === Number(allowedNovelId);
}

function sendNovelForbidden(res) {
  res.status(403).send('该 Token 无权访问这本小说');
}

function getAccessTokenValue(req) {
  const queryToken = String(req.query.token || '').trim();
  if (queryToken) return queryToken.slice(0, 128);

  const cookieToken = String(req.headers.cookie || '')
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith('access_token='));

  if (cookieToken) return decodeURIComponent(cookieToken.slice('access_token='.length)).slice(0, 128);
  return '';
}

async function getActiveAccessTokenId(req, res) {
  const token = getAccessTokenValue(req);
  if (!token) return null;

  const pathname = req.path || req.originalUrl || '/';
  const cacheKey = `access-token:${token}`;
  const cachedAccessToken = cache.get(cacheKey);
  if (cachedAccessToken) {
    req.accessToken = cachedAccessToken;
    if (!isAllowedNovelPath(pathname, cachedAccessToken.allowedNovelId)) {
      sendNovelForbidden(res);
      return null;
    }
    if (cachedAccessToken.pausedUntil) {
      sendRiskPaused(res, cachedAccessToken.pausedUntil);
      return null;
    }
    const pausedUntil = isChapterPath(pathname)
      ? await pauseTokenIfOverLimit(cachedAccessToken.id, token, cachedAccessToken.allowedNovelId)
      : '';
    if (pausedUntil) {
      sendRiskPaused(res, pausedUntil);
      return null;
    }
    res.cookie('access_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60 * 1000,
      path: '/'
    });
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
    cache.set(cacheKey, {
      id: row.id,
      allowedNovelId: row.allowed_novel_id || null,
      pausedUntil: row.paused_until
    }, ACCESS_TOKEN_CACHE_TTL_MS);
    sendRiskPaused(res, row.paused_until);
    return null;
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
  const pausedUntil = isChapterPath(pathname)
    ? await pauseTokenIfOverLimit(row.id, token, row.allowed_novel_id || null)
    : '';
  if (pausedUntil) {
    sendRiskPaused(res, pausedUntil);
    return null;
  }
  res.cookie('access_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 365 * 24 * 60 * 60 * 1000,
    path: '/'
  });
  return row.id;
}

async function pauseTokenIfOverLimit(accessTokenId, token, allowedNovelId) {
  const recentViews = await getRiskWindow(accessTokenId);
  if (recentViews.length < RISK_CHAPTER_LIMIT) {
    recentViews.push(Date.now());
    return '';
  }

  const reason = `${RISK_WINDOW_MINUTES}分钟内访问超过${RISK_CHAPTER_LIMIT}章节`;
  await pool.execute(
    `UPDATE access_tokens
     SET risk_paused_until = DATE_ADD(NOW(), INTERVAL ${RISK_PAUSE_HOURS} HOUR),
         risk_reason = ?
     WHERE id = ?`,
    [reason, accessTokenId]
  );

  const [[updated]] = await pool.execute(
    `SELECT DATE_FORMAT(risk_paused_until, '%Y-%m-%d %H:%i:%s') AS paused_until
     FROM access_tokens
     WHERE id = ?`,
    [accessTokenId]
  );

  cache.set(`access-token:${token}`, {
    id: accessTokenId,
    allowedNovelId: allowedNovelId || null,
    pausedUntil: updated && updated.paused_until || ''
  }, ACCESS_TOKEN_CACHE_TTL_MS);
  return updated && updated.paused_until || '1 小时后';
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
       AND created_at >= DATE_SUB(NOW(), INTERVAL ${RISK_WINDOW_MINUTES} MINUTE)
     ORDER BY created_at ASC`,
    [accessTokenId]
  );

  for (const row of rows) {
    const viewedAt = Number(row.viewed_at_ms || 0);
    if (viewedAt >= cutoff) entry.push(viewedAt);
  }
}

async function requireAccessToken(req, res) {
  const accessTokenId = await getActiveAccessTokenId(req, res);
  if (accessTokenId) return accessTokenId;
  if (res.headersSent) return null;

  res.status(403).send('Access token required');
  return null;
}

function parseNovelAndChapter(pathname) {
  const novelMatch = pathname.match(/^\/novel\/(\d+)(?:\/(\d+))?$/);
  if (!novelMatch) return { novelId: null, chapterId: null };
  return {
    novelId: Number(novelMatch[1]),
    chapterId: novelMatch[2] ? Number(novelMatch[2]) : null
  };
}

async function recordPageView(req, res, next) {
  try {
    if (req.method !== 'GET') {
      return next();
    }

    const pathname = req.path || req.originalUrl || '/';
    if (
      pathname.startsWith('/admin') ||
      pathname.startsWith('/api') ||
      pathname.startsWith('/css') ||
      pathname.startsWith('/js') ||
      pathname.startsWith('/favicon') ||
      pathname === '/healthz'
    ) {
      return next();
    }

    const accessTokenId = await requireAccessToken(req, res);
    if (!accessTokenId) return;

    const visitorUid = getVisitorUid(req);
    const sessionId = getSessionId(req);
    const visitorIp = getClientIp(req);
    const userAgent = String(req.headers['user-agent'] || 'unknown').slice(0, 255);
    const referrer = String(req.headers.referer || req.headers.referrer || '').slice(0, 255) || null;
    const { novelId, chapterId } = parseNovelAndChapter(pathname);

    res.cookie('visitor_uid', visitorUid, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60 * 1000,
      path: '/'
    });
    res.cookie('visitor_session', sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365 * 1000,
      path: '/'
    });

    pageViewQueue.enqueue({
      visitorUid,
      accessTokenId,
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

router.use(recordPageView);

function sendCachedHtml(res, cacheKey) {
  const html = cache.get(cacheKey);
  if (!html) return false;

  res.set('X-Cache', 'HIT');
  res.send(html);
  return true;
}

function renderAndCache(req, res, next, cacheKey, view, data) {
  res.render(view, data, (err, html) => {
    if (err) return next(err);

    cache.set(cacheKey, html);
    res.set('X-Cache', 'MISS');
    res.send(html);
  });
}

function splitParagraphs(chapter) {
  const cacheKey = `paragraphs:${chapter.id}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const paragraphs = chapter.content
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  cache.set(cacheKey, paragraphs);
  return paragraphs;
}

router.get('/', async (req, res, next) => {
  try {
    const allowedNovelId = req.accessToken && req.accessToken.allowedNovelId;
    const cacheKey = `html:home:${allowedNovelId || 'all'}`;
    if (sendCachedHtml(res, cacheKey)) return;

    const params = [];
    let whereClause = '';
    if (allowedNovelId) {
      whereClause = 'WHERE n.id = ?';
      params.push(allowedNovelId);
    }

    const [novels] = await pool.execute(
      `SELECT n.id, n.title, n.description, n.cover_image, COUNT(c.id) AS chapter_count
       FROM novels n
       LEFT JOIN chapters c ON c.novel_id = n.id
       ${whereClause}
       GROUP BY n.id, n.title, n.description, n.cover_image
       ORDER BY n.id ASC`,
      params
    );

    renderAndCache(req, res, next, cacheKey, 'home', { novels });
  } catch (err) {
    next(err);
  }
});

router.get('/novel/:id', async (req, res, next) => {
  try {
    const cacheKey = `html:novel:${req.params.id}`;
    if (sendCachedHtml(res, cacheKey)) return;

    const [[novel]] = await pool.execute(
      'SELECT id, title, description, cover_image, created_at FROM novels WHERE id = ?',
      [req.params.id]
    );
    if (!novel) return res.status(404).render('404', { url: req.originalUrl });

    const [chapters] = await pool.execute(
      'SELECT id, chapter_number, title, created_at FROM chapters WHERE novel_id = ? ORDER BY chapter_number ASC',
      [req.params.id]
    );

    renderAndCache(req, res, next, cacheKey, 'novel', { novel, chapters });
  } catch (err) {
    next(err);
  }
});

router.get('/novel/:id/:chapterNum', async (req, res, next) => {
  try {
    const { id, chapterNum } = req.params;
    const cacheKey = `html:chapter:${id}:${chapterNum}`;
    if (sendCachedHtml(res, cacheKey)) return;

    const [[novel]] = await pool.execute(
      'SELECT id, title FROM novels WHERE id = ?',
      [id]
    );
    if (!novel) return res.status(404).render('404', { url: req.originalUrl });

    const [[chapter]] = await pool.execute(
      'SELECT id, chapter_number, title, content FROM chapters WHERE novel_id = ? AND chapter_number = ?',
      [id, chapterNum]
    );
    if (!chapter) return res.status(404).render('404', { url: req.originalUrl });

    chapter.paragraphs = splitParagraphs(chapter);

    const [[prevChapter]] = await pool.execute(
      'SELECT chapter_number, title FROM chapters WHERE novel_id = ? AND chapter_number < ? ORDER BY chapter_number DESC LIMIT 1',
      [id, chapterNum]
    );

    const [[nextChapter]] = await pool.execute(
      'SELECT chapter_number, title FROM chapters WHERE novel_id = ? AND chapter_number > ? ORDER BY chapter_number ASC LIMIT 1',
      [id, chapterNum]
    );

    renderAndCache(req, res, next, cacheKey, 'chapter', { novel, chapter, prevChapter, nextChapter });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

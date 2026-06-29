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

  if (cookieToken) return decodeURIComponent(cookieToken.slice('access_token='.length)).slice(0, 128);
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
    res.cookie('access_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60 * 1000,
      path: '/'
    });
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

async function requireAccessToken(req, res) {
  const accessTokenId = await getActiveAccessTokenId(req, res);
  if (accessTokenId) return accessTokenId;
  if (res.headersSent) return null;

  if (isTokenOnlySourcePath(req.path || req.originalUrl || '/')) {
    res.status(403).json({ error: 'Access token required' });
    return null;
  }

  res.status(403).send('Access token required');
  return null;
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

function isTokenOnlySourcePath(pathname) {
  return isSourcePath(pathname);
}

function getBaseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .split(',')[0]
    .trim() || 'http';
  return `${proto}://${req.get('host')}`;
}

function toAbsoluteUrl(req, value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `${getBaseUrl(req)}${url.startsWith('/') ? url : `/${url}`}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSourceHtmlPage(title, body) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 24px; color: #222; background: #f7f7f7; }
    main { max-width: 880px; margin: 0 auto; }
    .source-card, .source-book, .source-chapter-wrap, .source-content-wrap { background: #fff; border: 1px solid #e6e6e6; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
    .source-book-cover { width: 96px; height: 128px; object-fit: cover; border-radius: 8px; display: block; background: #eee; }
    .source-book-grid { display: grid; grid-template-columns: 96px 1fr; gap: 16px; align-items: start; }
    .source-book-title, .source-book-name, .source-chapter-title { font-size: 24px; font-weight: 700; margin: 0 0 12px; }
    .source-book-meta { margin: 6px 0; color: #555; }
    .source-book-intro { line-height: 1.8; white-space: pre-wrap; }
    .source-action { display: inline-block; margin-top: 16px; padding: 10px 14px; background: #111; color: #fff; text-decoration: none; border-radius: 8px; }
    .source-chapter-list { list-style: none; padding: 0; margin: 0; }
    .source-chapter-item { border-bottom: 1px solid #eee; }
    .source-chapter-item:last-child { border-bottom: 0; }
    .source-chapter-link { display: block; padding: 12px 0; color: #111; text-decoration: none; }
    .source-content p { line-height: 1.95; margin: 0 0 1.2em; }
  </style>
</head>
<body>
  <main>
    ${body}
  </main>
</body>
</html>`;
}

function buildSourceBookPayload(req, novel) {
  return {
    id: novel.id,
    name: novel.title,
    author: novel.author || '',
    intro: novel.description || '',
    kind: '自建书源',
    coverUrl: toAbsoluteUrl(req, novel.cover_image),
    lastChapter: novel.last_chapter || '',
    bookUrl: `${getBaseUrl(req)}/source/book/${novel.id}?token=${encodeURIComponent(getAccessTokenValue(req))}`,
    tocUrl: `${getBaseUrl(req)}/source/toc/${novel.id}?token=${encodeURIComponent(getAccessTokenValue(req))}`
  };
}

function buildSourceChapterListPayload(req, novel, chapters) {
  const book = buildSourceBookPayload(req, novel);
  return {
    ...book,
    chapters: chapters.map(chapter => ({
      title: chapter.title,
      url: getSourceChapterUrl(req, novel.id, chapter.chapter_number),
      chapterNumber: chapter.chapter_number
    }))
  };
}

function withDataPayload(payload) {
  return {
    ...payload,
    data: payload
  };
}

function sendSourceJson(res, payload) {
  res.set('Cache-Control', 'no-store');
  res.json(payload);
}

function sendSourceHtml(res, html) {
  res.set('Cache-Control', 'no-store');
  res.type('text/html; charset=utf-8').send(html);
}

function getSourceChapterUrl(req, novelId, chapterNumber, format = 'json') {
  const segment = format === 'html' ? '/source/html/content' : '/source/content';
  return `${getBaseUrl(req)}${segment}/${novelId}/${chapterNumber}?token=${encodeURIComponent(getAccessTokenValue(req))}`;
}

async function getSourceChapters(novelId) {
  const [chapters] = await pool.execute(
    `SELECT chapter_number, title
     FROM chapters
     WHERE novel_id = ?
     ORDER BY chapter_number ASC`,
    [novelId]
  );
  return chapters;
}

async function getSourceChapter(novelId, chapterNumber) {
  const [[chapter]] = await pool.execute(
    `SELECT chapter_number, title, content
     FROM chapters
     WHERE novel_id = ? AND chapter_number = ?`,
    [novelId, chapterNumber]
  );
  return chapter || null;
}

function renderSourceChapterItems(req, displayNovelId, chapters) {
  return chapters.map(chapter => {
    const url = getSourceChapterUrl(req, displayNovelId, chapter.chapter_number, 'html');
    return `<li class="source-chapter-item"><a class="source-chapter-link" href="${escapeHtml(url)}">${escapeHtml(chapter.title)}</a></li>`;
  }).join('\n');
}

function renderSourceContentParagraphs(content) {
  return String(content || '')
    .split(/\n{2,}/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => `<p>${escapeHtml(item)}</p>`)
    .join('\n');
}

async function getSourceNovelById(novelId, allowedNovelId) {
  const params = [novelId];
  const where = ['n.id = ?'];

  if (allowedNovelId) {
    where.push('n.id = ?');
    params.push(allowedNovelId);
  }

  const [rows] = await pool.execute(
    `SELECT
       n.id,
       n.title,
       n.author,
       n.description,
       n.cover_image,
       COUNT(c.id) AS chapter_count,
       SUBSTRING_INDEX(
         GROUP_CONCAT(c.title ORDER BY c.chapter_number DESC SEPARATOR '\\n'),
         '\\n',
         1
       ) AS last_chapter
     FROM novels n
     LEFT JOIN chapters c ON c.novel_id = n.id
     WHERE ${where.join(' AND ')}
     GROUP BY n.id, n.title, n.author, n.description, n.cover_image
     LIMIT 1`,
    params
  );

  return rows[0] || null;
}

async function resolveReadableNovel(requestedNovelId, allowedNovelId) {
  const params = [];
  const where = [];

  if (allowedNovelId) {
    where.push('n.id = ?');
    params.push(allowedNovelId);
  } else if (requestedNovelId) {
    where.push('(n.id = ? OR n.id <> ?)');
    params.push(requestedNovelId, requestedNovelId);
  }

  const [rows] = await pool.execute(
    `SELECT
       n.id,
       n.title,
       n.author,
       n.description,
       n.cover_image,
       COUNT(c.id) AS chapter_count,
       SUBSTRING_INDEX(
         GROUP_CONCAT(c.title ORDER BY c.chapter_number DESC SEPARATOR '\\n'),
         '\\n',
         1
       ) AS last_chapter
     FROM novels n
     LEFT JOIN chapters c ON c.novel_id = n.id
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     GROUP BY n.id, n.title, n.author, n.description, n.cover_image
     HAVING COUNT(c.id) > 0
     ORDER BY
       CASE WHEN n.id = ? THEN 0 ELSE 1 END,
       n.id ASC
     LIMIT 1`,
    [...params, Number(requestedNovelId) || 0]
  );

  return rows[0] || null;
}

async function resolveSourceNovel(requestedNovelId, allowedNovelId) {
  const requested = await getSourceNovelById(requestedNovelId, allowedNovelId);
  const requestedHasChapters = requested && Number(requested.chapter_count || 0) > 0;
  const readable = requestedHasChapters
    ? requested
    : await resolveReadableNovel(requestedNovelId, allowedNovelId);

  if (!readable) return null;

  if (requested && !requestedHasChapters) {
    return {
      display: {
        ...readable,
        id: requested.id,
        title: requested.title,
        author: requested.author || readable.author,
        description: requested.description || readable.description,
        cover_image: requested.cover_image || readable.cover_image,
        last_chapter: readable.last_chapter
      },
      readable
    };
  }

  return {
    display: readable,
    readable
  };
}

async function searchSourceNovels(keyword, allowedNovelId) {
  const params = [];
  const where = [];

  if (allowedNovelId) {
    where.push('n.id = ?');
    params.push(allowedNovelId);
  }

  if (keyword) {
    where.push('(n.title LIKE ? OR n.author LIKE ? OR n.description LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }

  const [rows] = await pool.execute(
    `SELECT
       n.id,
       n.title,
       n.author,
       n.description,
       n.cover_image,
       MAX(c.chapter_number) AS last_chapter_number,
       COUNT(c.id) AS chapter_count,
       SUBSTRING_INDEX(
         GROUP_CONCAT(c.title ORDER BY c.chapter_number DESC SEPARATOR '\\n'),
         '\\n',
         1
       ) AS last_chapter
     FROM novels n
     LEFT JOIN chapters c ON c.novel_id = n.id
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     GROUP BY n.id, n.title, n.author, n.description, n.cover_image
     ${keyword ? '' : 'HAVING COUNT(c.id) > 0'}
     ORDER BY
       CASE WHEN COUNT(c.id) > 0 THEN 0 ELSE 1 END,
       n.id ASC`,
    params
  );

  if (!keyword) return rows;

  const readable = await resolveReadableNovel(0, allowedNovelId);
  return rows.map(row => {
    if (Number(row.chapter_count || 0) > 0 || !readable) return row;
    return {
      ...row,
      cover_image: row.cover_image || readable.cover_image,
      last_chapter: readable.last_chapter,
      last_chapter_number: readable.last_chapter_number
    };
  });
}

function buildLegadoSource(req, token) {
  const baseUrl = getBaseUrl(req);
  const encodedToken = encodeURIComponent(token);

  return {
    bookSourceComment: '自建小说站书源，已自动绑定当前 token',
    bookSourceGroup: '自建',
    bookSourceName: `Novel 书源(${req.get('host')})`,
    bookSourceType: 0,
    bookSourceUrl: baseUrl,
    bookUrlPattern: '',
    customOrder: 0,
    enabled: true,
    enabledExplore: false,
    header: '{\n  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"\n}',
    lastUpdateTime: Date.now(),
    loginUrl: '',
    exploreUrl: '',
    ruleBookInfo: {
      name: '@css:.source-book-name@text',
      author: '@css:.source-book-author@text',
      intro: '@css:.source-book-intro@text',
      kind: '@css:.source-book-kind@text',
      coverUrl: '@css:.source-book-cover@src',
      lastChapter: '@css:.source-book-last@text',
      tocUrl: '@css:#source-toc-link@href'
    },
    ruleContent: {
      content: '@css:.source-content@html',
      nextContentUrl: ''
    },
    ruleExplore: {},
    ruleSearch: {
      bookList: '@css:.source-book',
      name: '@css:.source-book-title@text',
      author: '@css:.source-book-author@text',
      intro: '@css:.source-book-intro@text',
      kind: '@css:.source-book-kind@text',
      coverUrl: '@css:.source-book-cover@src',
      lastChapter: '@css:.source-book-last@text',
      bookUrl: '@css:.source-book-link@href'
    },
    ruleToc: {
      chapterList: '@css:.source-chapter-item',
      chapterName: '@css:.source-chapter-link@text',
      chapterUrl: '@css:.source-chapter-link@href',
      isVip: '',
      isPay: ''
    },
    searchUrl: `${baseUrl}/source/html/search?key={{key}}&page={{page}}&token=${encodedToken}`,
    weight: 0
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

router.get('/source/search', async (req, res, next) => {
  try {
    const keyword = String(req.query.key || '').trim();
    const allowedNovelId = req.accessToken && req.accessToken.allowedNovelId;
    const rows = await searchSourceNovels(keyword, allowedNovelId);

    sendSourceJson(res, withDataPayload({
      keyword,
      books: rows.map(row => buildSourceBookPayload(req, row))
    }));
  } catch (err) {
    next(err);
  }
});

router.get('/source/html/search', async (req, res, next) => {
  try {
    const keyword = String(req.query.key || '').trim();
    const allowedNovelId = req.accessToken && req.accessToken.allowedNovelId;
    const rows = await searchSourceNovels(keyword, allowedNovelId);

    const cards = rows.map(row => {
      const cover = toAbsoluteUrl(req, row.cover_image);
      const link = `${getBaseUrl(req)}/source/html/book/${row.id}?token=${encodeURIComponent(getAccessTokenValue(req))}`;
      return `<article class="source-book source-card">
  <div class="source-book-grid">
    ${cover ? `<img class="source-book-cover" src="${escapeHtml(cover)}" alt="${escapeHtml(row.title)}">` : '<div class="source-book-cover"></div>'}
    <div>
      <h2 class="source-book-title">${escapeHtml(row.title)}</h2>
      <div class="source-book-author">${escapeHtml(row.author || '')}</div>
      <div class="source-book-kind">自建书源</div>
      <div class="source-book-last">${escapeHtml(row.last_chapter || '')}</div>
      <div class="source-book-intro">${escapeHtml(row.description || '')}</div>
      <a class="source-book-link source-action" href="${escapeHtml(link)}">查看详情</a>
    </div>
  </div>
</article>`;
    }).join('\n');

    const html = renderSourceHtmlPage(
      keyword ? `${keyword} - 搜索结果` : '搜索结果',
      cards || '<section class="source-card"><p>未找到结果</p></section>'
    );

    sendSourceHtml(res, html);
  } catch (err) {
    next(err);
  }
});

router.get('/source/book/:id', async (req, res, next) => {
  try {
    const allowedNovelId = req.accessToken && req.accessToken.allowedNovelId;
    const sourceNovel = await resolveSourceNovel(req.params.id, allowedNovelId);
    if (!sourceNovel) {
      return res.status(404).json({ error: 'Book not found' });
    }
    const { display, readable } = sourceNovel;

    const chapters = await getSourceChapters(readable.id);

    sendSourceJson(res, withDataPayload(buildSourceChapterListPayload(req, display, chapters)));
  } catch (err) {
    next(err);
  }
});

router.get('/source/html/book/:id', async (req, res, next) => {
  try {
    const allowedNovelId = req.accessToken && req.accessToken.allowedNovelId;
    const sourceNovel = await resolveSourceNovel(req.params.id, allowedNovelId);
    if (!sourceNovel) {
      return res.status(404).type('text/plain; charset=utf-8').send('Book not found');
    }
    const { display, readable } = sourceNovel;

    const cover = toAbsoluteUrl(req, display.cover_image);
    const tocUrl = `${getBaseUrl(req)}/source/html/toc/${display.id}?token=${encodeURIComponent(getAccessTokenValue(req))}`;
    const chapters = await getSourceChapters(readable.id);
    const items = renderSourceChapterItems(req, display.id, chapters);
    const html = renderSourceHtmlPage(display.title, `<section class="source-card">
  <div class="source-book-grid">
    ${cover ? `<img class="source-book-cover" src="${escapeHtml(cover)}" alt="${escapeHtml(display.title)}">` : '<div class="source-book-cover"></div>'}
    <div>
      <h1 class="source-book-name">${escapeHtml(display.title)}</h1>
      <div class="source-book-author">${escapeHtml(display.author || '')}</div>
      <div class="source-book-kind">自建书源</div>
      <div class="source-book-last">${escapeHtml(display.last_chapter || '')}</div>
      <div class="source-book-intro">${escapeHtml(display.description || '')}</div>
      <a id="source-toc-link" class="source-action" href="${escapeHtml(tocUrl)}">目录</a>
    </div>
  </div>
</section>
<section class="source-chapter-wrap" id="source-inline-toc">
  <ul class="source-chapter-list">
    ${items}
  </ul>
</section>`);

    sendSourceHtml(res, html);
  } catch (err) {
    next(err);
  }
});

router.get('/source/toc/:id', async (req, res, next) => {
  try {
    const allowedNovelId = req.accessToken && req.accessToken.allowedNovelId;
    const sourceNovel = await resolveSourceNovel(req.params.id, allowedNovelId);
    if (!sourceNovel) {
      return res.status(404).json({ error: 'Book not found' });
    }
    const { display, readable } = sourceNovel;

    const chapters = await getSourceChapters(readable.id);

    sendSourceJson(res, withDataPayload(buildSourceChapterListPayload(req, display, chapters)));
  } catch (err) {
    next(err);
  }
});

router.get('/source/html/toc/:id', async (req, res, next) => {
  try {
    const allowedNovelId = req.accessToken && req.accessToken.allowedNovelId;
    const sourceNovel = await resolveSourceNovel(req.params.id, allowedNovelId);
    if (!sourceNovel) {
      return res.status(404).type('text/plain; charset=utf-8').send('Book not found');
    }
    const { display, readable } = sourceNovel;

    const chapters = await getSourceChapters(readable.id);
    const items = renderSourceChapterItems(req, display.id, chapters);

    const html = renderSourceHtmlPage(`${display.title} - 目录`, `<section class="source-chapter-wrap">
  <h1 class="source-chapter-title">${escapeHtml(display.title)}</h1>
  <ul class="source-chapter-list">
    ${items}
  </ul>
</section>`);

    sendSourceHtml(res, html);
  } catch (err) {
    next(err);
  }
});

router.get('/source/content/:id/:chapterNum', async (req, res, next) => {
  try {
    const allowedNovelId = req.accessToken && req.accessToken.allowedNovelId;
    const sourceNovel = await resolveSourceNovel(req.params.id, allowedNovelId);
    if (!sourceNovel) {
      return res.status(404).json({ error: 'Book not found' });
    }
    const { display, readable } = sourceNovel;

    const chapter = await getSourceChapter(readable.id, req.params.chapterNum);
    if (!chapter) {
      return res.status(404).json({ error: 'Chapter not found' });
    }

    sendSourceJson(res, withDataPayload({
      bookName: display.title,
      title: chapter.title,
      chapterNumber: chapter.chapter_number,
      content: chapter.content
    }));
  } catch (err) {
    next(err);
  }
});

router.get('/source/html/content/:id/:chapterNum', async (req, res, next) => {
  try {
    const allowedNovelId = req.accessToken && req.accessToken.allowedNovelId;
    const sourceNovel = await resolveSourceNovel(req.params.id, allowedNovelId);
    if (!sourceNovel) {
      return res.status(404).type('text/plain; charset=utf-8').send('Book not found');
    }
    const { display, readable } = sourceNovel;

    const chapter = await getSourceChapter(readable.id, req.params.chapterNum);
    if (!chapter) {
      return res.status(404).type('text/plain; charset=utf-8').send('Chapter not found');
    }

    const paragraphs = renderSourceContentParagraphs(chapter.content);

    const html = renderSourceHtmlPage(`${chapter.title} - ${display.title}`, `<section class="source-content-wrap">
  <h1 class="source-chapter-title">${escapeHtml(chapter.title)}</h1>
  <div class="source-content">
    ${paragraphs}
  </div>
</section>`);

    sendSourceHtml(res, html);
  } catch (err) {
    next(err);
  }
});

router.get('/source/legado', async (req, res, next) => {
  try {
    const token = getAccessTokenValue(req);
    if (!token) {
      return res.status(403).json({ error: 'Access token required' });
    }

    const source = buildLegadoSource(req, token);
    if (String(req.query.single || '') === '1') {
      return sendSourceJson(res, source);
    }
    sendSourceJson(res, [source]);
  } catch (err) {
    next(err);
  }
});

router.get('/source/import/:token.json', async (req, res, next) => {
  try {
    const token = getAccessTokenValue(req);
    if (!token) {
      return res.status(403).type('text/plain; charset=utf-8').send('Access token required');
    }

    const source = buildLegadoSource(req, token);

    res.type('application/json; charset=utf-8');
    res.set('Content-Disposition', 'inline; filename="legado-source.json"');
    res.set('Cache-Control', 'no-store');
    if (String(req.query.single || '') === '1') {
      return res.send(JSON.stringify(source, null, 2));
    }
    res.send(JSON.stringify([source], null, 2));
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

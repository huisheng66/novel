const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');
const iconv = require('iconv-lite');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { pool } = require('../db');
const cache = require('../lib/memoryCache');
const pageViewQueue = require('../lib/pageViewQueue');

const router = express.Router();
const COVER_UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'covers');
const COVER_PUBLIC_PREFIX = '/uploads/covers/';
const CHAPTER_UPLOAD_MAX_MB = 30;
const COVER_UPLOAD_MAX_MB = 30;
const CHAPTER_UPLOAD_MAX_BYTES = CHAPTER_UPLOAD_MAX_MB * 1024 * 1024;
const COVER_UPLOAD_MAX_BYTES = COVER_UPLOAD_MAX_MB * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: CHAPTER_UPLOAD_MAX_BYTES,
    files: 50
  }
});

const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: COVER_UPLOAD_MAX_BYTES,
    files: 1
  },
  fileFilter(req, file, cb) {
    if (/^image\/(?:jpeg|png|webp|gif)$/.test(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('封面仅支持 JPG、PNG、WebP 或 GIF 图片'));
  }
});

function handleCoverUpload(req, res, next) {
  coverUpload.single('cover_image')(req, res, err => {
    if (!err) {
      next();
      return;
    }

    const novelId = toPositiveInt(req.params.id);
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `封面图片不能超过 ${COVER_UPLOAD_MAX_MB}MB`
      : err.message || '封面上传失败';
    const target = novelId ? `/admin/novels/info?novel_id=${novelId}` : '/admin/novels/info';
    res.redirect(`${target}&error=${encodeURIComponent(message)}`);
  });
}

const SESSION_COOKIE = 'admin_session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || ADMIN_PASSWORD;

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
      cookies[name] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signSession(expiresAt) {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`admin:${expiresAt}`)
    .digest('base64url');
}

function createSessionValue() {
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  return `${expiresAt}.${signSession(expiresAt)}`;
}

function isValidSession(value) {
  if (!value) return false;

  const [expiresAt, signature] = String(value).split('.');
  if (!expiresAt || !signature || Number(expiresAt) <= Date.now()) return false;

  return timingSafeEqualString(signature, signSession(expiresAt));
}

function isSecureRequest(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

function setAdminSessionCookie(req, res) {
  res.cookie(SESSION_COOKIE, createSessionValue(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    maxAge: SESSION_MAX_AGE_MS,
    path: '/admin'
  });
}

function clearAdminSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/admin'
  });
}

function sanitizeNextPath(nextPath) {
  const value = String(nextPath || '/admin');
  if (!value.startsWith('/admin') || value.startsWith('/admin/login') || value.startsWith('/admin/logout')) {
    return '/admin';
  }
  return value;
}

function getBaseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .split(',')[0]
    .trim() || 'http';
  return `${proto}://${req.get('host')}`;
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  if (isValidSession(cookies[SESSION_COOKIE])) {
    return next();
  }

  res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl || '/admin')}`);
}

function toPositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function clearPublicCache() {
  cache.clear('html:');
  cache.clear('paragraphs:');
}

function clearAccessTokenCache() {
  cache.clear('access-token:');
}

function clearNovelCache(novelId) {
  clearPublicCache();
}

function generateAccessToken() {
  return crypto.randomBytes(16).toString('hex');
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
}

function formatChapterContent(text) {
  const normalized = normalizeText(text);
  if (!normalized) return '';

  return normalized
    .replace(/[\t\u3000]+/g, ' ')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/([\u3002\uff01\uff1f!?])([\u201d\u2019"'\)\]\}\uff09\u3011\u300b\u300d\u300f]*)[ \t\u3000]*(?=\S)/g, '$1$2\n\n')
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
    .join('\n\n');
}

function titleFromFilename(filename) {
  return path.basename(filename, path.extname(filename)).trim() || '未命名章节';
}

function decodeUploadedFilename(filename) {
  const rawName = String(filename || '');
  if (/[\u4e00-\u9fff]/.test(rawName)) return rawName;

  try {
    const decodedName = Buffer.from(rawName, 'latin1').toString('utf8');
    if (decodedName && !decodedName.includes('\uFFFD') && /[\u4e00-\u9fff]/.test(decodedName)) {
      return decodedName;
    }
  } catch (err) {
    return rawName;
  }

  return rawName;
}

function coverExtension(file) {
  const byMime = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif'
  };
  if (byMime[file.mimetype]) return byMime[file.mimetype];

  const ext = path.extname(file.originalname || '').toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '';
}

function isManagedCoverPath(coverPath) {
  const value = String(coverPath || '');
  return value.startsWith(COVER_PUBLIC_PREFIX) && !value.includes('..') && !value.includes('\\');
}

async function saveCoverImage(novelId, file) {
  const ext = coverExtension(file);
  if (!ext) {
    throw new Error('封面仅支持 JPG、PNG、WebP 或 GIF 图片');
  }

  await fs.mkdir(COVER_UPLOAD_DIR, { recursive: true });

  const fileName = `${novelId}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const absolutePath = path.join(COVER_UPLOAD_DIR, fileName);
  await fs.writeFile(absolutePath, file.buffer);
  return `${COVER_PUBLIC_PREFIX}${fileName}`;
}

async function deleteCoverImage(coverPath) {
  if (!isManagedCoverPath(coverPath)) return;

  const fileName = path.basename(coverPath);
  try {
    await fs.unlink(path.join(COVER_UPLOAD_DIR, fileName));
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.warn('Failed to delete cover image:', err.message);
    }
  }
}

function cleanChapterTitle(line) {
  return line
    .replace(/^[\s　]+|[\s　]+$/g, '')
    .replace(/^[#*\-=\s　]+|[#*\-=\s　]+$/g, '')
    .trim();
}

function isChapterTitleLine(line) {
  const title = cleanChapterTitle(line);
  if (!title || title.length > 80) return false;

  const chineseNumber = '零〇一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟';
  const chineseChapterPattern = new RegExp(`^第[\\d${chineseNumber}]+[章节回卷集部篇幕].{0,60}$`);
  const arabicChapterPattern = /^(?:正文\s*)?(?:chapter|Chapter|CHAPTER)\s*\d+[\s\S]{0,60}$/;
  const prefixedChapterPattern = /^\d{1,5}\s*[.、]\s*(?:第?\d+[章节回]|[\u4e00-\u9fa5A-Za-z].{0,50})$/;

  return chineseChapterPattern.test(title) ||
    arabicChapterPattern.test(title) ||
    prefixedChapterPattern.test(title);
}

function splitTextIntoChapters(text, fallbackTitle) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const headings = [];

  lines.forEach((line, index) => {
    if (isChapterTitleLine(line)) {
      headings.push({
        index,
        title: cleanChapterTitle(line)
      });
    }
  });

  if (headings.length === 0) {
    return [{
      title: fallbackTitle,
      content: formatChapterContent(normalized)
    }];
  }

  return headings
    .map((heading, position) => {
      const nextHeading = headings[position + 1];
      const content = formatChapterContent(lines
        .slice(heading.index + 1, nextHeading ? nextHeading.index : lines.length)
        .join('\n'));

      return {
        title: heading.title,
        content
      };
    })
    .filter(chapter => chapter.title && chapter.content);
}

function decodeTxt(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString('utf8', 3);
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return iconv.decode(buffer, 'utf16-le');
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return iconv.decode(buffer, 'utf16-be');
  }

  const utf8 = buffer.toString('utf8');
  const replacementCount = (utf8.match(/\uFFFD/g) || []).length;
  if (replacementCount === 0 || replacementCount / Math.max(utf8.length, 1) < 0.01) {
    return utf8;
  }

  return iconv.decode(buffer, 'gb18030');
}

async function extractUploadedFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.txt') {
    return normalizeText(decodeTxt(file.buffer));
  }
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return normalizeText(result.value);
  }
  throw new Error('仅支持 .txt 和 .docx 文件');
}

async function getNovels() {
  const [novels] = await pool.execute(
    `SELECT n.id, n.title, n.author, n.description, n.cover_image, COUNT(c.id) AS chapter_count
     FROM novels n
     LEFT JOIN chapters c ON c.novel_id = n.id
     GROUP BY n.id, n.title, n.author, n.description, n.cover_image
     ORDER BY n.id ASC`
  );
  return novels;
}

async function getCurrentNovel(novelId) {
  if (novelId) {
    const [[novel]] = await pool.execute(
      'SELECT id, title, author, description, cover_image FROM novels WHERE id = ?',
      [novelId]
    );
    if (novel) return novel;
  }

  const [[firstNovel]] = await pool.execute(
    'SELECT id, title, author, description, cover_image FROM novels ORDER BY id ASC LIMIT 1'
  );
  return firstNovel || null;
}

async function nextChapterNumber(conn, novelId) {
  const [[row]] = await conn.execute(
    'SELECT COALESCE(MAX(chapter_number), 0) + 1 AS next_number FROM chapters WHERE novel_id = ?',
    [novelId]
  );
  return row.next_number;
}

async function renderDashboard(req, res, options = {}) {
  const novels = await getNovels();
  const selectedId = toPositiveInt(req.query.novel_id) || (novels[0] && novels[0].id);
  const selectedChapterId = toPositiveInt(req.query.chapter_id);
  const currentNovel = await getCurrentNovel(selectedId);

  let chapters = [];
  let selectedChapter = null;
  let nextNumber = 1;
  let novelTotalChapters = 0;
  let chapterPage = {
    total: 0
  };
  if (currentNovel) {
    const currentNovelSummary = novels.find(novel => novel.id === currentNovel.id);
    novelTotalChapters = Number(currentNovelSummary && currentNovelSummary.chapter_count || 0);

    const [[nextRow]] = await pool.execute(
      'SELECT COALESCE(MAX(chapter_number), 0) + 1 AS next_number FROM chapters WHERE novel_id = ?',
      [currentNovel.id]
    );
    nextNumber = nextRow.next_number;

    if (selectedChapterId) {
      const [[chapter]] = await pool.execute(
        'SELECT id, novel_id, chapter_number, title, content FROM chapters WHERE id = ? AND novel_id = ?',
        [selectedChapterId, currentNovel.id]
      );
      selectedChapter = chapter || null;
    }

    [chapters] = await pool.execute(
      `SELECT id, chapter_number, title, CHAR_LENGTH(content) AS content_length, created_at
       FROM chapters
       WHERE novel_id = ?
       ORDER BY chapter_number ASC`,
      [currentNovel.id]
    );

    chapterPage = {
      total: chapters.length
    };
  }

  res.render('admin/index', {
    novels,
    currentNovel,
    chapters,
    chapterPage,
    selectedChapter,
    nextNumber,
    novelTotalChapters,
    notice: options.notice || req.query.notice || '',
    error: options.error || req.query.error || ''
  });
}

async function renderNovelInfo(req, res, options = {}) {
  const novels = await getNovels();
  const selectedId = toPositiveInt(req.query.novel_id) || (novels[0] && novels[0].id);
  const currentNovel = await getCurrentNovel(selectedId);

  res.render('admin/novel-info', {
    novels,
    currentNovel,
    notice: options.notice || req.query.notice || '',
    error: options.error || req.query.error || ''
  });
}

async function getDashboardMetrics() {
  const [[summary]] = await pool.execute(`
    SELECT
      COUNT(*) AS page_views,
      COUNT(DISTINCT session_id) AS sessions,
      COUNT(DISTINCT visitor_uid) AS users,
      COUNT(DISTINCT visitor_ip) AS unique_ips,
      COUNT(DISTINCT novel_id) AS novels_viewed,
      COUNT(DISTINCT chapter_id) AS chapters_viewed
    FROM page_views
  `);

  const [dailyRows] = await pool.execute(`
    SELECT
      DATE_FORMAT(created_at, '%Y-%m-%d') AS day,
      COUNT(*) AS page_views,
      COUNT(DISTINCT session_id) AS sessions,
      COUNT(DISTINCT visitor_uid) AS users,
      COUNT(DISTINCT visitor_ip) AS unique_ips
    FROM page_views
    WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
    GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')
    ORDER BY day ASC
  `);

  const dailyMap = new Map(dailyRows.map(row => [String(row.day).slice(0, 10), row]));
  const dailySeries = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const dayDate = new Date();
    dayDate.setHours(0, 0, 0, 0);
    dayDate.setDate(dayDate.getDate() - offset);
    const dayKey = dayDate.toISOString().slice(0, 10);
    const row = dailyMap.get(dayKey) || {};
    dailySeries.push({
      day: dayKey,
      page_views: Number(row.page_views || 0),
      sessions: Number(row.sessions || 0),
      users: Number(row.users || 0),
      unique_ips: Number(row.unique_ips || 0)
    });
  }

  const [topPaths] = await pool.execute(`
    SELECT path, COUNT(*) AS views
    FROM page_views
    GROUP BY path
    ORDER BY views DESC, path ASC
    LIMIT 8
  `);

  const [topNovels] = await pool.execute(`
    SELECT
      COALESCE(n.id, 0) AS id,
      COALESCE(n.title, '未知小说') AS title,
      COUNT(pv.id) AS views
    FROM page_views pv
    LEFT JOIN novels n ON n.id = pv.novel_id
    WHERE pv.novel_id IS NOT NULL
    GROUP BY n.id, n.title
    ORDER BY views DESC, title ASC
    LIMIT 8
  `);

  const [topIps] = await pool.execute(`
    SELECT visitor_ip AS ip, COUNT(*) AS views
    FROM page_views
    GROUP BY visitor_ip
    ORDER BY views DESC, ip ASC
    LIMIT 8
  `);

  const [userIpStats] = await pool.execute(`
    SELECT
      visitor_uid,
      visitor_ip,
      COUNT(*) AS page_views,
      COUNT(DISTINCT session_id) AS sessions,
      COUNT(DISTINCT path) AS paths,
      COUNT(DISTINCT novel_id) AS novels,
      COUNT(DISTINCT CASE
        WHEN novel_id IS NOT NULL AND chapter_id IS NOT NULL THEN CONCAT(novel_id, ':', chapter_id)
        ELSE NULL
      END) AS chapters,
      DATE_FORMAT(MIN(created_at), '%Y-%m-%d %H:%i:%s') AS first_seen,
      DATE_FORMAT(MAX(created_at), '%Y-%m-%d %H:%i:%s') AS last_seen
    FROM page_views
    GROUP BY visitor_uid, visitor_ip
    ORDER BY page_views DESC, last_seen DESC
    LIMIT 50
  `);

  const [latestViews] = await pool.execute(`
    SELECT
      pv.created_at,
      pv.session_id,
      pv.visitor_uid,
      pv.visitor_ip,
      pv.path,
      pv.novel_id,
      pv.chapter_id,
      n.title AS novel_title,
      c.title AS chapter_title,
      c.chapter_number
    FROM page_views pv
    LEFT JOIN novels n ON n.id = pv.novel_id
    LEFT JOIN chapters c ON c.novel_id = pv.novel_id AND c.chapter_number = pv.chapter_id
    ORDER BY pv.created_at DESC
    LIMIT 20
  `);

  return {
    summary,
    dailyRows,
    dailySeries,
    topPaths,
    topNovels,
    topIps,
    userIpStats,
    latestViews
  };
}

async function getTokenUsers() {
  const [tokens] = await pool.execute(`
    SELECT
      t.id,
      t.name,
      t.token,
      t.allowed_novel_id,
      n_allowed.title AS allowed_novel_title,
      t.is_active,
      DATE_FORMAT(t.risk_paused_until, '%Y-%m-%d %H:%i:%s') AS risk_paused_until,
      t.risk_paused_until > NOW() AS is_risk_paused,
      t.risk_reason,
      t.created_at,
      COUNT(pv.id) AS total_views,
      COUNT(CASE WHEN pv.created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE) THEN 1 END) AS views_5m,
      COUNT(CASE
        WHEN pv.created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
          AND pv.novel_id IS NOT NULL
          AND pv.chapter_id IS NOT NULL
        THEN 1
      END) AS chapter_views_5m,
      COUNT(DISTINCT pv.visitor_ip) AS ip_count,
      COUNT(DISTINCT pv.session_id) AS session_count,
      DATE_FORMAT(MAX(pv.created_at), '%Y-%m-%d %H:%i:%s') AS last_seen
    FROM access_tokens t
    LEFT JOIN novels n_allowed ON n_allowed.id = t.allowed_novel_id
    LEFT JOIN page_views pv ON pv.access_token_id = t.id
    GROUP BY t.id, t.name, t.token, t.allowed_novel_id, n_allowed.title, t.is_active, t.risk_paused_until, t.risk_reason, t.created_at
    ORDER BY t.is_active DESC, is_risk_paused DESC, views_5m DESC, total_views DESC, t.id DESC
  `);

  if (tokens.length === 0) return [];

  const ids = tokens.map(token => token.id);
  const placeholders = ids.map(() => '?').join(',');
  const recentViewLimit = Math.min(ids.length * 10, 1000);
  const [ipRows] = await pool.execute(
    `SELECT
       access_token_id,
       visitor_ip,
       COUNT(*) AS total_views,
       COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE) THEN 1 END) AS views_5m,
       DATE_FORMAT(MAX(created_at), '%Y-%m-%d %H:%i:%s') AS last_seen
     FROM page_views
     WHERE access_token_id IN (${placeholders})
     GROUP BY access_token_id, visitor_ip
     ORDER BY total_views DESC, visitor_ip ASC`,
    ids
  );

  const [viewRows] = await pool.execute(
    `SELECT
       pv.access_token_id,
       DATE_FORMAT(pv.created_at, '%Y-%m-%d %H:%i:%s') AS visited_at,
       pv.visitor_ip,
       pv.path,
       pv.novel_id,
       pv.chapter_id,
       n.title AS novel_title,
       c.title AS chapter_title,
       c.chapter_number
     FROM page_views pv
     LEFT JOIN novels n ON n.id = pv.novel_id
     LEFT JOIN chapters c ON c.novel_id = pv.novel_id AND c.chapter_number = pv.chapter_id
     WHERE pv.access_token_id IN (${placeholders})
     ORDER BY pv.created_at DESC
     LIMIT ${recentViewLimit}`,
    ids
  );

  const ipMap = new Map();
  for (const row of ipRows) {
    const list = ipMap.get(row.access_token_id) || [];
    if (list.length < 8) {
      list.push(row);
      ipMap.set(row.access_token_id, list);
    }
  }

  const viewMap = new Map();
  for (const row of viewRows) {
    const list = viewMap.get(row.access_token_id) || [];
    if (list.length < 10) {
      list.push(row);
      viewMap.set(row.access_token_id, list);
    }
  }

  return tokens.map(token => ({
    ...token,
    ips: ipMap.get(token.id) || [],
    recentViews: viewMap.get(token.id) || []
  }));
}

router.get('/login', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  if (isValidSession(cookies[SESSION_COOKIE])) {
    return res.redirect(sanitizeNextPath(req.query.next));
  }

  res.render('admin/login', {
    nextPath: sanitizeNextPath(req.query.next),
    error: req.query.error || ''
  });
});

router.post('/login', (req, res) => {
  const password = String(req.body.password || '');
  const nextPath = sanitizeNextPath(req.body.next);

  if (!timingSafeEqualString(password, ADMIN_PASSWORD)) {
    return res.redirect(`/admin/login?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent('密码错误')}`);
  }

  setAdminSessionCookie(req, res);
  res.redirect(nextPath);
});

router.post('/logout', (req, res) => {
  clearAdminSessionCookie(res);
  res.redirect('/admin/login');
});

router.use(requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    await renderDashboard(req, res);
  } catch (err) {
    next(err);
  }
});

router.get('/novels/info', async (req, res, next) => {
  try {
    await renderNovelInfo(req, res);
  } catch (err) {
    next(err);
  }
});

router.get('/dashboard', async (req, res, next) => {
  try {
    await pageViewQueue.flush();
    const metrics = await getDashboardMetrics();
    const novels = await getNovels();
    const currentNovel = novels[0] || null;
    res.render('admin/dashboard', {
      ...metrics,
      currentNovel,
      notice: req.query.notice || '',
      error: req.query.error || ''
    });
  } catch (err) {
    next(err);
  }
});

router.get('/tokens', async (req, res, next) => {
  try {
    await pageViewQueue.flush();
    const novels = await getNovels();
    const currentNovel = novels[0] || null;
    const tokenUsers = await getTokenUsers();

    res.render('admin/tokens', {
      baseUrl: getBaseUrl(req),
      currentNovel,
      novels,
      tokenUsers,
      notice: req.query.notice || '',
      error: req.query.error || ''
    });
  } catch (err) {
    next(err);
  }
});

router.post('/tokens', async (req, res, next) => {
  try {
    const name = normalizeText(req.body.name);
    const token = normalizeText(req.body.token) || generateAccessToken();

    if (!name) {
      return res.redirect(`/admin/tokens?error=${encodeURIComponent('请输入用户名称')}`);
    }
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(token)) {
      return res.redirect(`/admin/tokens?error=${encodeURIComponent('Token 只能包含字母、数字、下划线或短横线，长度 8-128')}`);
    }

    await pool.execute(
      'INSERT INTO access_tokens (name, token, is_active, risk_paused_until, risk_reason) VALUES (?, ?, 1, NULL, NULL)',
      [name, token]
    );
    clearAccessTokenCache();

    res.redirect(`/admin/tokens?notice=${encodeURIComponent('Token 已创建')}`);
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.redirect(`/admin/tokens?error=${encodeURIComponent('Token 已存在')}`);
    }
    next(err);
  }
});

router.post('/tokens/:id/toggle', async (req, res, next) => {
  try {
    const tokenId = toPositiveInt(req.params.id);
    const isActive = req.body.is_active === '1' ? 1 : 0;
    if (!tokenId) {
      return res.redirect(`/admin/tokens?error=${encodeURIComponent('无效的 Token ID')}`);
    }

    if (isActive) {
      await pool.execute(
        'UPDATE access_tokens SET is_active = 1, risk_paused_until = NULL, risk_reason = NULL WHERE id = ?',
        [tokenId]
      );
    } else {
      await pool.execute('UPDATE access_tokens SET is_active = 0 WHERE id = ?', [tokenId]);
    }
    clearAccessTokenCache();
    res.redirect(`/admin/tokens?notice=${encodeURIComponent(isActive ? 'Token 已启用' : 'Token 已停用')}`);
  } catch (err) {
    next(err);
  }
});

router.post('/tokens/:id/novel', async (req, res, next) => {
  try {
    const tokenId = toPositiveInt(req.params.id);
    const allowedNovelId = toPositiveInt(req.body.allowed_novel_id);
    if (!tokenId) {
      return res.redirect(`/admin/tokens?error=${encodeURIComponent('无效的 Token ID')}`);
    }

    if (allowedNovelId) {
      const [[novel]] = await pool.execute(
        'SELECT id FROM novels WHERE id = ?',
        [allowedNovelId]
      );
      if (!novel) {
        return res.redirect(`/admin/tokens?error=${encodeURIComponent('选择的小说不存在')}`);
      }
    }

    await pool.execute(
      'UPDATE access_tokens SET allowed_novel_id = ? WHERE id = ?',
      [allowedNovelId || null, tokenId]
    );
    clearAccessTokenCache();
    clearPublicCache();
    res.redirect(`/admin/tokens?notice=${encodeURIComponent(allowedNovelId ? 'Token 已限制到指定小说' : 'Token 已恢复访问全部小说')}`);
  } catch (err) {
    next(err);
  }
});

router.post('/tokens/:id/delete', async (req, res, next) => {
  try {
    const tokenId = toPositiveInt(req.params.id);
    if (!tokenId) {
      return res.redirect(`/admin/tokens?error=${encodeURIComponent('无效的 Token ID')}`);
    }

    await pool.execute('UPDATE page_views SET access_token_id = NULL WHERE access_token_id = ?', [tokenId]);
    await pool.execute('DELETE FROM access_tokens WHERE id = ?', [tokenId]);
    clearAccessTokenCache();
    res.redirect(`/admin/tokens?notice=${encodeURIComponent('Token 已删除，历史访问已保留为未绑定')}`);
  } catch (err) {
    next(err);
  }
});

router.post('/novels', async (req, res, next) => {
  try {
    const title = normalizeText(req.body.title);
    const author = normalizeText(req.body.author);
    const description = normalizeText(req.body.description);

    if (!title || !author) {
      return renderNovelInfo(req, res, { error: '小说标题和作者不能为空' });
    }

    const [result] = await pool.execute(
      'INSERT INTO novels (title, author, description) VALUES (?, ?, ?)',
      [title, author, description]
    );
    clearPublicCache();

    res.redirect(`/admin/novels/info?novel_id=${result.insertId}&notice=${encodeURIComponent('小说已创建')}`);
  } catch (err) {
    next(err);
  }
});

router.post('/novels/:id', async (req, res, next) => {
  try {
    const novelId = toPositiveInt(req.params.id);
    const title = normalizeText(req.body.title);
    const author = normalizeText(req.body.author);
    const description = normalizeText(req.body.description);

    if (!novelId || !title || !author) {
      return renderNovelInfo(req, res, { error: '小说标题和作者不能为空' });
    }

    await pool.execute(
      'UPDATE novels SET title = ?, author = ?, description = ? WHERE id = ?',
      [title, author, description, novelId]
    );
    clearNovelCache(novelId);

    res.redirect(`/admin/novels/info?novel_id=${novelId}&notice=${encodeURIComponent('小说已更新')}`);
  } catch (err) {
    next(err);
  }
});

router.post('/novels/:id/cover', handleCoverUpload, async (req, res, next) => {
  try {
    const novelId = toPositiveInt(req.params.id);
    if (!novelId) {
      return res.redirect(`/admin/novels/info?error=${encodeURIComponent('无效的小说 ID')}`);
    }
    if (!req.file) {
      return res.redirect(`/admin/novels/info?novel_id=${novelId}&error=${encodeURIComponent('请选择要上传的封面图片')}`);
    }

    const [[novel]] = await pool.execute(
      'SELECT id, cover_image FROM novels WHERE id = ?',
      [novelId]
    );
    if (!novel) {
      return res.redirect(`/admin/novels/info?error=${encodeURIComponent('小说不存在')}`);
    }

    const coverPath = await saveCoverImage(novelId, req.file);
    await pool.execute('UPDATE novels SET cover_image = ? WHERE id = ?', [coverPath, novelId]);
    await deleteCoverImage(novel.cover_image);
    clearNovelCache(novelId);

    res.redirect(`/admin/novels/info?novel_id=${novelId}&notice=${encodeURIComponent('封面已上传')}`);
  } catch (err) {
    next(err);
  }
});

router.post('/novels/:id/cover/delete', async (req, res, next) => {
  try {
    const novelId = toPositiveInt(req.params.id);
    if (!novelId) {
      return res.redirect(`/admin/novels/info?error=${encodeURIComponent('无效的小说 ID')}`);
    }

    const [[novel]] = await pool.execute(
      'SELECT id, cover_image FROM novels WHERE id = ?',
      [novelId]
    );
    if (!novel) {
      return res.redirect(`/admin/novels/info?error=${encodeURIComponent('小说不存在')}`);
    }

    await pool.execute('UPDATE novels SET cover_image = NULL WHERE id = ?', [novelId]);
    await deleteCoverImage(novel.cover_image);
    clearNovelCache(novelId);

    res.redirect(`/admin/novels/info?novel_id=${novelId}&notice=${encodeURIComponent('封面已删除')}`);
  } catch (err) {
    next(err);
  }
});

router.post('/novels/:id/delete', async (req, res, next) => {
  try {
    const novelId = toPositiveInt(req.params.id);
    if (!novelId) {
      return res.redirect(`/admin/novels/info?error=${encodeURIComponent('无效的小说 ID')}`);
    }

    const [[novel]] = await pool.execute(
      'SELECT cover_image FROM novels WHERE id = ?',
      [novelId]
    );
    await pool.execute('DELETE FROM novels WHERE id = ?', [novelId]);
    if (novel) await deleteCoverImage(novel.cover_image);
    clearNovelCache(novelId);
    res.redirect(`/admin/novels/info?notice=${encodeURIComponent('小说已删除')}`);
  } catch (err) {
    next(err);
  }
});

router.get('/chapters/new', async (req, res, next) => {
  try {
    const novels = await getNovels();
    const novelId = toPositiveInt(req.query.novel_id) || (novels[0] && novels[0].id);
    const currentNovel = await getCurrentNovel(novelId);
    let nextNumber = 1;
    if (currentNovel) {
      const [[nextRow]] = await pool.execute(
        'SELECT COALESCE(MAX(chapter_number), 0) + 1 AS next_number FROM chapters WHERE novel_id = ?',
        [currentNovel.id]
      );
      nextNumber = nextRow.next_number;
    }

    res.render('admin/chapter-form', {
      mode: 'create',
      novels,
      currentNovel,
      chapter: {
        id: null,
        novel_id: currentNovel ? currentNovel.id : '',
        chapter_number: nextNumber,
        title: '',
        content: ''
      },
      error: req.query.error || ''
    });
  } catch (err) {
    next(err);
  }
});

router.post('/chapters', async (req, res, next) => {
  try {
    const novelId = toPositiveInt(req.body.novel_id);
    const chapterNumber = toPositiveInt(req.body.chapter_number);
    const title = normalizeText(req.body.title);
    const content = formatChapterContent(req.body.content);

    if (!novelId || !chapterNumber || !title || !content) {
      return res.redirect(`/admin/chapters/new?novel_id=${novelId || ''}&error=${encodeURIComponent('章节编号、标题和内容不能为空')}`);
    }

    await pool.execute(
      'INSERT INTO chapters (novel_id, chapter_number, title, content) VALUES (?, ?, ?, ?)',
      [novelId, chapterNumber, title, content]
    );
    clearPublicCache();

    res.redirect(`/admin?novel_id=${novelId}&notice=${encodeURIComponent('章节已创建')}`);
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.redirect(`/admin/chapters/new?novel_id=${req.body.novel_id || ''}&error=${encodeURIComponent('该章节编号已存在')}`);
    }
    next(err);
  }
});

router.post('/chapters/upload', upload.array('chapter_files', 50), async (req, res, next) => {
  const novelId = toPositiveInt(req.body.novel_id);
  const startNumber = toPositiveInt(req.body.start_number);
  const uploadMode = req.body.upload_mode === 'replace' ? 'replace' : 'append';

  if (!novelId) {
    return res.redirect(`/admin?error=${encodeURIComponent('请先选择小说')}`);
  }
  if (!req.files || req.files.length === 0) {
    return res.redirect(`/admin?novel_id=${novelId}&error=${encodeURIComponent('请选择要上传的 txt 或 docx 文件')}`);
  }

  const conn = await pool.getConnection();
  try {
    let chapterNumber = startNumber || await nextChapterNumber(conn, novelId);
    const imported = [];
    const skipped = [];

    await conn.beginTransaction();

    if (uploadMode === 'replace') {
      await conn.execute('DELETE FROM chapters WHERE novel_id = ?', [novelId]);
    }

    for (const file of req.files) {
      const originalName = decodeUploadedFilename(file.originalname);
      try {
        const ext = path.extname(originalName).toLowerCase();
        if (!['.txt', '.docx'].includes(ext)) {
          skipped.push(`${originalName}: 文件类型不支持`);
          continue;
        }

        const text = await extractUploadedFile(file);
        if (!text) {
          skipped.push(`${originalName}: 没有读取到正文`);
          continue;
        }

        const chapters = splitTextIntoChapters(text, titleFromFilename(originalName));
        if (chapters.length === 0) {
          skipped.push(`${originalName}: 未识别到可导入章节`);
          continue;
        }

        for (const chapter of chapters) {
          await conn.execute(
            'INSERT INTO chapters (novel_id, chapter_number, title, content) VALUES (?, ?, ?, ?)',
            [novelId, chapterNumber, chapter.title, formatChapterContent(chapter.content)]
          );
          chapterNumber += 1;
        }

        imported.push(`${originalName}(${chapters.length}章)`);
      } catch (err) {
        skipped.push(`${originalName}: ${err.code === 'ER_DUP_ENTRY' ? '章节编号已存在' : err.message}`);
      }
    }

    await conn.commit();
    clearPublicCache();

    const parts = [];
    const importedChapterCount = imported.reduce((total, item) => {
      const match = item.match(/\((\d+)章\)$/);
      return total + (match ? Number(match[1]) : 0);
    }, 0);
    if (importedChapterCount > 0) parts.push(`${uploadMode === 'replace' ? '已覆盖导入' : '已追加导入'} ${importedChapterCount} 章：${imported.join('、')}`);
    if (skipped.length > 0) parts.push(`跳过 ${skipped.length} 个文件：${skipped.join('；')}`);
    const message = parts.join('，') || '没有导入任何文件';

    res.redirect(`/admin?novel_id=${novelId}&${importedChapterCount > 0 ? 'notice' : 'error'}=${encodeURIComponent(message)}`);
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

router.get('/api/chapters/:id', async (req, res, next) => {
  try {
    const chapterId = toPositiveInt(req.params.id);
    const novelId = toPositiveInt(req.query.novel_id);

    if (!chapterId || !novelId) {
      return res.status(400).json({ error: 'Invalid chapter request' });
    }

    const [[chapter]] = await pool.execute(
      'SELECT id, novel_id, chapter_number, title, content, CHAR_LENGTH(content) AS content_length FROM chapters WHERE id = ? AND novel_id = ?',
      [chapterId, novelId]
    );

    if (!chapter) {
      return res.status(404).json({ error: 'Chapter not found' });
    }

    res.json({ chapter });
  } catch (err) {
    next(err);
  }
});

router.get('/chapters/:id/edit', async (req, res, next) => {
  try {
    const chapterId = toPositiveInt(req.params.id);
    const [[chapter]] = await pool.execute(
      'SELECT id, novel_id, chapter_number, title, content FROM chapters WHERE id = ?',
      [chapterId]
    );
    if (!chapter) return res.status(404).render('404', { url: req.originalUrl });

    const novels = await getNovels();
    const currentNovel = await getCurrentNovel(chapter.novel_id);

    res.render('admin/chapter-form', {
      mode: 'edit',
      novels,
      currentNovel,
      chapter,
      error: req.query.error || ''
    });
  } catch (err) {
    next(err);
  }
});

router.post('/chapters/:id', async (req, res, next) => {
  try {
    const chapterId = toPositiveInt(req.params.id);
    const novelId = toPositiveInt(req.body.novel_id);
    const chapterNumber = toPositiveInt(req.body.chapter_number);
    const title = normalizeText(req.body.title);
    const content = formatChapterContent(req.body.content);

    if (!chapterId || !novelId || !chapterNumber || !title || !content) {
      return res.redirect(`/admin/chapters/${chapterId}/edit?error=${encodeURIComponent('章节编号、标题和内容不能为空')}`);
    }

    await pool.execute(
      'UPDATE chapters SET novel_id = ?, chapter_number = ?, title = ?, content = ? WHERE id = ?',
      [novelId, chapterNumber, title, content, chapterId]
    );
    clearPublicCache();

    res.redirect(`/admin?novel_id=${novelId}&chapter_id=${chapterId}&notice=${encodeURIComponent('章节已更新')}`);
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.redirect(`/admin/chapters/${req.params.id}/edit?error=${encodeURIComponent('该章节编号已存在')}`);
    }
    next(err);
  }
});

router.post('/chapters/:id/delete', async (req, res, next) => {
  try {
    const chapterId = toPositiveInt(req.params.id);
    const novelId = toPositiveInt(req.body.novel_id);

    if (!chapterId) {
      return res.redirect(`/admin?novel_id=${novelId || ''}&error=${encodeURIComponent('无效的章节 ID')}`);
    }

    await pool.execute('DELETE FROM chapters WHERE id = ?', [chapterId]);
    clearPublicCache();
    res.redirect(`/admin?novel_id=${novelId || ''}&notice=${encodeURIComponent('章节已删除')}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

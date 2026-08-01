// 后台共享配置与工具:multer、会话、缓存清理、封面处理、DB 助手

const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { pool } = require('../../db');
const cache = require('../../lib/memoryCache');
const logger = require('../../lib/logger');

// ===== 常量 =====
const COVER_UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'covers');
const COVER_PUBLIC_PREFIX = '/uploads/covers/';
const CHAPTER_UPLOAD_MAX_MB = 30;
const COVER_UPLOAD_MAX_MB = 30;
const CHAPTER_UPLOAD_MAX_BYTES = CHAPTER_UPLOAD_MAX_MB * 1024 * 1024;
const COVER_UPLOAD_MAX_BYTES = COVER_UPLOAD_MAX_MB * 1024 * 1024;

const SESSION_COOKIE = 'admin_session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || ADMIN_PASSWORD;
const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

// ===== 文件上传 =====
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

// ===== 会话管理 =====
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

function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

async function createSessionValue() {
  const sid = generateSessionId();
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
  if (!value.startsWith('/admin') || value.startsWith('/admin/login') || value.startsWith('/admin/logout')) {
    return '/admin';
  }
  return value;
}

// 定期清理过期会话,避免表膨胀
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

// ===== 缓存清理 =====
function clearHomeCache() {
  cache.clear('html:home:');
}

function clearAccessTokenCache() {
  cache.clear('access-token:');
}

function clearNovelCache(novelId) {
  if (!novelId) {
    cache.clear('html:');
    cache.clear('paragraphs:');
    return;
  }
  cache.clear(`html:novel:${novelId}`);
  // 章节缓存键以 chapter.id 为主键,无法按 novelId 精准失效,全清章节缓存
  cache.clear('html:chapter:');
  cache.clear('html:home:');
}

function clearChapterCache(novelId, chapterId) {
  if (novelId) {
    cache.clear(`html:novel:${novelId}`);
    cache.clear('html:home:');
  }
  if (chapterId) {
    cache.clear(`html:chapter:${chapterId}`);
    cache.clear(`paragraphs:${chapterId}`);
  } else {
    cache.clear('html:chapter:');
    cache.clear('paragraphs:');
  }
}

// ===== 封面处理 =====
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

// 校验图片真实 magic number,防止伪装扩展名上传脚本/HTML
function detectImageFormat(buffer) {
  if (!buffer || buffer.length < 12) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
    && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) return '.png';
  // GIF: 47 49 46 38 (GIF8)
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return '.gif';
  // WebP: RIFF....WEBP
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
    && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return '.webp';
  return null;
}

function isManagedCoverPath(coverPath) {
  const value = String(coverPath || '');
  return value.startsWith(COVER_PUBLIC_PREFIX) && !value.includes('..') && !value.includes('\\');
}

async function saveCoverImage(novelId, file) {
  // 优先用 magic number 判定真实格式,回退到 mimetype/扩展名
  const detectedExt = detectImageFormat(file.buffer);
  const ext = detectedExt || coverExtension(file);
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
      logger.warn('Failed to delete cover image', { err });
    }
  }
}

// ===== DB 助手 =====
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

// ===== 通用工具 =====
function toPositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function generateAccessToken() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = {
  // 常量
  COVER_UPLOAD_DIR,
  COVER_PUBLIC_PREFIX,
  CHAPTER_UPLOAD_MAX_MB,
  COVER_UPLOAD_MAX_MB,
  CHAPTER_UPLOAD_MAX_BYTES,
  COVER_UPLOAD_MAX_BYTES,
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  ADMIN_PASSWORD,
  // 文件上传
  upload,
  coverUpload,
  handleCoverUpload,
  // 会话
  parseCookies,
  timingSafeEqualString,
  setAdminSessionCookie,
  clearAdminSessionCookie,
  sanitizeNextPath,
  isValidSession,
  requireAdmin,
  // 缓存清理
  clearHomeCache,
  clearAccessTokenCache,
  clearNovelCache,
  clearChapterCache,
  // 封面
  saveCoverImage,
  deleteCoverImage,
  isManagedCoverPath,
  // DB 助手
  getNovels,
  getCurrentNovel,
  nextChapterNumber,
  // 工具
  toPositiveInt,
  generateAccessToken
};

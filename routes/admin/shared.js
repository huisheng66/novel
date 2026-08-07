// 后台共享门面：兼容旧 require('./shared')，实现拆到 lib/*

const { toPositiveInt } = require('../../lib/util');
const session = require('./lib/session');
const cover = require('./lib/cover');
const cache = require('./lib/cache');
const upload = require('./lib/upload');
const novels = require('./lib/novels');

module.exports = {
  // 常量
  COVER_UPLOAD_DIR: cover.COVER_UPLOAD_DIR,
  COVER_PUBLIC_PREFIX: cover.COVER_PUBLIC_PREFIX,
  CHAPTER_UPLOAD_MAX_MB: upload.CHAPTER_UPLOAD_MAX_MB,
  COVER_UPLOAD_MAX_MB: cover.COVER_UPLOAD_MAX_MB,
  CHAPTER_UPLOAD_MAX_BYTES: upload.CHAPTER_UPLOAD_MAX_BYTES,
  COVER_UPLOAD_MAX_BYTES: cover.COVER_UPLOAD_MAX_BYTES,
  SESSION_COOKIE: session.SESSION_COOKIE,
  SESSION_MAX_AGE_MS: session.SESSION_MAX_AGE_MS,
  ADMIN_PASSWORD: session.ADMIN_PASSWORD,

  // 上传
  upload: upload.upload,
  coverUpload: cover.coverUpload,
  handleCoverUpload: cover.handleCoverUpload,

  // 会话
  parseCookies: session.parseCookies,
  timingSafeEqualString: session.timingSafeEqualString,
  setAdminSessionCookie: session.setAdminSessionCookie,
  clearAdminSessionCookie: session.clearAdminSessionCookie,
  sanitizeNextPath: session.sanitizeNextPath,
  isValidSession: session.isValidSession,
  requireAdmin: session.requireAdmin,

  // 缓存
  clearHomeCache: cache.clearHomeCache,
  clearAccessTokenCache: cache.clearAccessTokenCache,
  clearNovelCache: cache.clearNovelCache,
  clearChapterCache: cache.clearChapterCache,

  // 封面
  saveCoverImage: cover.saveCoverImage,
  deleteCoverImage: cover.deleteCoverImage,
  isManagedCoverPath: cover.isManagedCoverPath,

  // DB
  getNovels: novels.getNovels,
  getCurrentNovel: novels.getCurrentNovel,
  nextChapterNumber: novels.nextChapterNumber,
  getChaptersPage: novels.getChaptersPage,

  // 工具
  toPositiveInt,
  generateAccessToken: novels.generateAccessToken
};

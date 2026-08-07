// 封面上传/校验/落盘

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const logger = require('../../../lib/logger');
const { toPositiveInt } = require('../../../lib/util');

const COVER_UPLOAD_DIR = path.join(__dirname, '..', '..', '..', 'public', 'uploads', 'covers');
const COVER_PUBLIC_PREFIX = '/uploads/covers/';
const COVER_UPLOAD_MAX_MB = 30;
const COVER_UPLOAD_MAX_BYTES = COVER_UPLOAD_MAX_MB * 1024 * 1024;

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

function detectImageFormat(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
    && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) return '.png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return '.gif';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
    && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return '.webp';
  return null;
}

function isManagedCoverPath(coverPath) {
  const value = String(coverPath || '');
  return value.startsWith(COVER_PUBLIC_PREFIX) && !value.includes('..') && !value.includes('\\');
}

async function saveCoverImage(novelId, file) {
  const ext = detectImageFormat(file.buffer) || coverExtension(file);
  if (!ext) throw new Error('封面仅支持 JPG、PNG、WebP 或 GIF 图片');

  await fs.mkdir(COVER_UPLOAD_DIR, { recursive: true });
  const fileName = `${novelId}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  await fs.writeFile(path.join(COVER_UPLOAD_DIR, fileName), file.buffer);
  return `${COVER_PUBLIC_PREFIX}${fileName}`;
}

async function deleteCoverImage(coverPath) {
  if (!isManagedCoverPath(coverPath)) return;
  try {
    await fs.unlink(path.join(COVER_UPLOAD_DIR, path.basename(coverPath)));
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      logger.warn('Failed to delete cover image', { err });
    }
  }
}

module.exports = {
  COVER_UPLOAD_DIR,
  COVER_PUBLIC_PREFIX,
  COVER_UPLOAD_MAX_MB,
  COVER_UPLOAD_MAX_BYTES,
  coverUpload,
  handleCoverUpload,
  saveCoverImage,
  deleteCoverImage,
  isManagedCoverPath
};

// 章节文件上传 multer 配置

const multer = require('multer');

const CHAPTER_UPLOAD_MAX_MB = 30;
const CHAPTER_UPLOAD_MAX_BYTES = CHAPTER_UPLOAD_MAX_MB * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: CHAPTER_UPLOAD_MAX_BYTES,
    files: 50
  }
});

module.exports = {
  CHAPTER_UPLOAD_MAX_MB,
  CHAPTER_UPLOAD_MAX_BYTES,
  upload
};

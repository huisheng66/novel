// 后台小说/章节 DB 助手

const crypto = require('crypto');
const { pool } = require('../../../db');

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

/**
 * 分页拉章节列表。
 * @returns {{ chapters, page, pageSize, total, totalPages }}
 */
async function getChaptersPage(novelId, { page = 1, pageSize = 80, chapterId = null } = {}) {
  const size = Math.min(Math.max(Number(pageSize) || 80, 1), 200);
  let currentPage = Math.max(Number(page) || 1, 1);

  const [[{ total }]] = await pool.execute(
    'SELECT COUNT(*) AS total FROM chapters WHERE novel_id = ?',
    [novelId]
  );
  const totalCount = Number(total) || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / size) || 1);

  // 带 chapter_id 时定位到该章所在页
  if (chapterId) {
    const [[row]] = await pool.execute(
      `SELECT COUNT(*) AS pos FROM chapters
       WHERE novel_id = ? AND chapter_number <= (
         SELECT chapter_number FROM chapters WHERE id = ? AND novel_id = ? LIMIT 1
       )`,
      [novelId, chapterId, novelId]
    );
    const pos = Number(row && row.pos) || 0;
    if (pos > 0) currentPage = Math.min(totalPages, Math.ceil(pos / size));
  }

  currentPage = Math.min(currentPage, totalPages);
  const offset = (currentPage - 1) * size;

  // LIMIT/OFFSET 内联整数，避免部分 mysql2 对占位符 LIMIT 的兼容问题
  const [chapters] = await pool.execute(
    `SELECT id, chapter_number, title, CHAR_LENGTH(content) AS content_length, created_at
     FROM chapters
     WHERE novel_id = ?
     ORDER BY chapter_number ASC
     LIMIT ${size} OFFSET ${offset}`,
    [novelId]
  );

  return {
    chapters,
    page: currentPage,
    pageSize: size,
    total: totalCount,
    totalPages
  };
}

function generateAccessToken() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = {
  getNovels,
  getCurrentNovel,
  nextChapterNumber,
  getChaptersPage,
  generateAccessToken
};

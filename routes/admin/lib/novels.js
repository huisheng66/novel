// 后台小说/章节 DB 助手

const crypto = require('crypto');
const { pool } = require('../../../db');
const cache = require('../../../lib/memoryCache');

const NOVELS_CACHE_KEY = 'admin:novels:list';
const NOVELS_CACHE_TTL_MS = 15 * 1000;

async function getNovels() {
  const cached = cache.get(NOVELS_CACHE_KEY);
  if (cached) return cached;

  // 相关子查询走 uk_novel_chapter 索引，避免 JOIN 大表再 GROUP BY
  const [novels] = await pool.execute(
    `SELECT n.id, n.title, n.author, n.description, n.cover_image,
            (SELECT COUNT(*) FROM chapters c WHERE c.novel_id = n.id) AS chapter_count
     FROM novels n
     ORDER BY n.id ASC`
  );
  cache.set(NOVELS_CACHE_KEY, novels, NOVELS_CACHE_TTL_MS);
  return novels;
}

function clearNovelsCache() {
  cache.clear(NOVELS_CACHE_KEY);
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

  // 列表不读 content / CHAR_LENGTH(content)：LONGTEXT 会拖垮后台翻页与首屏
  // LIMIT/OFFSET 内联整数，避免部分 mysql2 对占位符 LIMIT 的兼容问题
  const [chapters] = await pool.execute(
    `SELECT id, chapter_number, title, created_at
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
  clearNovelsCache,
  getCurrentNovel,
  nextChapterNumber,
  getChaptersPage,
  generateAccessToken
};

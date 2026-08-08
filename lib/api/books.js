// 读者书库查询（App API）

const { pool } = require('../../db');
const { toAbsoluteUrl } = require('../util');
const {
  splitContentParagraphs,
  mergeParagraphsForReader
} = require('../chapterText');
const { contentHash } = require('./tokens');
const { notFound } = require('./errors');

function toIso(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function mapBook(row, req) {
  return {
    id: row.id,
    title: row.title,
    author: row.author || '',
    description: row.description || '',
    coverUrl: toAbsoluteUrl(req, row.cover_image),
    status: row.status || 'serializing',
    chapterCount: Number(row.chapter_count || 0),
    lastChapterNumber: row.last_chapter_number != null ? Number(row.last_chapter_number) : null,
    lastChapterTitle: row.last_chapter_title || '',
    updatedAt: toIso(row.updated_at || row.created_at)
  };
}

async function listBooks(req, { q = '', page = 1, pageSize = 20, allowedNovelId = null } = {}) {
  const size = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
  const current = Math.max(Number(page) || 1, 1);
  const offset = (current - 1) * size;
  const params = [];
  const where = [];

  if (allowedNovelId) {
    where.push('n.id = ?');
    params.push(allowedNovelId);
  }
  const keyword = String(q || '').trim();
  if (keyword) {
    where.push('(n.title LIKE ? OR n.author LIKE ? OR n.description LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM novels n ${whereSql}`,
    params
  );

  const [rows] = await pool.execute(
    `SELECT n.id, n.title, n.author, n.description, n.cover_image, n.status,
            n.last_chapter_number, n.last_chapter_title, n.updated_at, n.created_at,
            (SELECT COUNT(*) FROM chapters c WHERE c.novel_id = n.id) AS chapter_count
     FROM novels n
     ${whereSql}
     ORDER BY COALESCE(n.updated_at, n.created_at) DESC, n.id DESC
     LIMIT ${size} OFFSET ${offset}`,
    params
  );

  return {
    page: current,
    pageSize: size,
    total: Number(total) || 0,
    items: rows.map(row => mapBook(row, req))
  };
}

async function getBook(req, novelId, allowedNovelId = null) {
  const params = [novelId];
  let sql = `
    SELECT n.id, n.title, n.author, n.description, n.cover_image, n.status,
           n.last_chapter_number, n.last_chapter_title, n.updated_at, n.created_at,
           (SELECT COUNT(*) FROM chapters c WHERE c.novel_id = n.id) AS chapter_count
    FROM novels n
    WHERE n.id = ?`;
  if (allowedNovelId) {
    sql += ' AND n.id = ?';
    params.push(allowedNovelId);
  }
  sql += ' LIMIT 1';

  const [[row]] = await pool.execute(sql, params);
  if (!row) throw notFound('Book not found');
  return mapBook(row, req);
}

async function getToc(req, novelId, { page = 1, pageSize = 100, allowedNovelId = null } = {}) {
  if (allowedNovelId && Number(allowedNovelId) !== Number(novelId)) {
    throw notFound('Book not found');
  }

  const [[novel]] = await pool.execute('SELECT id FROM novels WHERE id = ? LIMIT 1', [novelId]);
  if (!novel) throw notFound('Book not found');

  const size = Math.min(Math.max(Number(pageSize) || 100, 1), 200);
  let current = Math.max(Number(page) || 1, 1);

  const [[{ total }]] = await pool.execute(
    'SELECT COUNT(*) AS total FROM chapters WHERE novel_id = ?',
    [novelId]
  );
  const totalCount = Number(total) || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / size) || 1);
  current = Math.min(current, totalPages);
  const offset = (current - 1) * size;

  const [items] = await pool.execute(
    `SELECT id, chapter_number, title, updated_at, created_at
     FROM chapters
     WHERE novel_id = ?
     ORDER BY chapter_number ASC
     LIMIT ${size} OFFSET ${offset}`,
    [novelId]
  );

  return {
    novelId: Number(novelId),
    page: current,
    pageSize: size,
    total: totalCount,
    totalPages,
    items: items.map(ch => ({
      id: ch.id,
      chapterNumber: ch.chapter_number,
      title: ch.title,
      updatedAt: toIso(ch.updated_at || ch.created_at)
    }))
  };
}

async function getChapter(req, novelId, chapterNumber, { allowedNovelId = null, ifNoneMatch = '' } = {}) {
  if (allowedNovelId && Number(allowedNovelId) !== Number(novelId)) {
    throw notFound('Book not found');
  }

  const [[chapter]] = await pool.execute(
    `SELECT id, novel_id, chapter_number, title, content, content_hash, updated_at, created_at
     FROM chapters
     WHERE novel_id = ? AND chapter_number = ?
     LIMIT 1`,
    [novelId, chapterNumber]
  );
  if (!chapter) throw notFound('Chapter not found');

  const hash = chapter.content_hash || contentHash(chapter.content);
  const etag = `"${hash}"`;
  const clientTag = String(ifNoneMatch || '').trim();
  if (clientTag && (clientTag === etag || clientTag === hash)) {
    return { notModified: true, etag, contentHash: hash };
  }

  const [[prevRow]] = await pool.execute(
    `SELECT chapter_number FROM chapters
     WHERE novel_id = ? AND chapter_number < ?
     ORDER BY chapter_number DESC LIMIT 1`,
    [novelId, chapterNumber]
  );
  const [[nextRow]] = await pool.execute(
    `SELECT chapter_number FROM chapters
     WHERE novel_id = ? AND chapter_number > ?
     ORDER BY chapter_number ASC LIMIT 1`,
    [novelId, chapterNumber]
  );

  const rawParagraphs = splitContentParagraphs(chapter.content);
  const paragraphs = mergeParagraphsForReader(rawParagraphs);

  return {
    notModified: false,
    etag,
    body: {
      novelId: Number(novelId),
      chapterId: chapter.id,
      chapterNumber: chapter.chapter_number,
      title: chapter.title,
      content: chapter.content,
      paragraphs,
      contentHash: hash,
      updatedAt: toIso(chapter.updated_at || chapter.created_at),
      prev: prevRow ? prevRow.chapter_number : null,
      next: nextRow ? nextRow.chapter_number : null
    }
  };
}

/**
 * 刷新小说最新章冗余字段（admin 写章后调用）
 */
async function refreshNovelChapterStats(novelId, conn = pool) {
  const [[row]] = await conn.execute(
    `SELECT chapter_number, title, updated_at
     FROM chapters
     WHERE novel_id = ?
     ORDER BY chapter_number DESC
     LIMIT 1`,
    [novelId]
  );
  if (!row) {
    await conn.execute(
      `UPDATE novels
       SET last_chapter_number = NULL, last_chapter_title = NULL, updated_at = NOW()
       WHERE id = ?`,
      [novelId]
    );
    return;
  }
  await conn.execute(
    `UPDATE novels
     SET last_chapter_number = ?, last_chapter_title = ?, updated_at = ?
     WHERE id = ?`,
    [row.chapter_number, row.title, row.updated_at || new Date(), novelId]
  );
}

module.exports = {
  listBooks,
  getBook,
  getToc,
  getChapter,
  refreshNovelChapterStats,
  mapBook,
  toIso
};

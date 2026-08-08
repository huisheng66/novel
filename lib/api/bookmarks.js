// 阅读书签/笔记（绑定 novelId + chapterNumber + offset）

const { pool } = require('../../db');
const { toIso } = require('./books');
const { badRequest, notFound } = require('./errors');

function clampOffset(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function mapBookmark(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    novelId: Number(row.novel_id),
    chapterNumber: Number(row.chapter_number),
    chapterId: row.chapter_id != null ? Number(row.chapter_id) : null,
    offsetRatio: Number(row.offset_ratio) || 0,
    note: row.note || '',
    color: row.color || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

async function listBookmarks(userId, { novelId = null } = {}) {
  const params = [userId];
  let sql = `
    SELECT id, novel_id, chapter_number, chapter_id, offset_ratio, note, color, created_at, updated_at
    FROM reading_bookmarks
    WHERE user_id = ?`;
  if (novelId != null) {
    const nid = Number(novelId);
    if (!Number.isInteger(nid) || nid <= 0) throw badRequest('novelId invalid');
    sql += ' AND novel_id = ?';
    params.push(nid);
  }
  sql += ' ORDER BY updated_at DESC, id DESC';
  const [rows] = await pool.execute(sql, params);
  return { items: rows.map(mapBookmark) };
}

async function getBookmark(userId, bookmarkId) {
  const id = Number(bookmarkId);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('id invalid');
  const [[row]] = await pool.execute(
    `SELECT id, novel_id, chapter_number, chapter_id, offset_ratio, note, color, created_at, updated_at
     FROM reading_bookmarks WHERE id = ? AND user_id = ? LIMIT 1`,
    [id, userId]
  );
  if (!row) throw notFound('Bookmark not found');
  return mapBookmark(row);
}

async function createBookmark(userId, body) {
  const novelId = Number(body.novelId);
  const chapterNumber = Number(body.chapterNumber);
  const offsetRatio = clampOffset(body.offsetRatio);
  const note = body.note != null ? String(body.note).slice(0, 8000) : '';
  const color = body.color != null ? String(body.color).slice(0, 32) : null;

  if (!Number.isInteger(novelId) || novelId <= 0) throw badRequest('novelId required');
  if (!Number.isInteger(chapterNumber) || chapterNumber <= 0) throw badRequest('chapterNumber required');

  const [[novel]] = await pool.execute('SELECT id FROM novels WHERE id = ? LIMIT 1', [novelId]);
  if (!novel) throw notFound('Book not found');

  const [[chapter]] = await pool.execute(
    `SELECT id FROM chapters WHERE novel_id = ? AND chapter_number = ? LIMIT 1`,
    [novelId, chapterNumber]
  );
  if (!chapter) throw notFound('Chapter not found');

  const [result] = await pool.execute(
    `INSERT INTO reading_bookmarks
       (user_id, novel_id, chapter_number, chapter_id, offset_ratio, note, color)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, novelId, chapterNumber, chapter.id, offsetRatio, note, color]
  );
  return getBookmark(userId, result.insertId);
}

async function updateBookmark(userId, bookmarkId, body) {
  const existing = await getBookmark(userId, bookmarkId);
  let chapterNumber = existing.chapterNumber;
  let chapterId = existing.chapterId;
  let offsetRatio = existing.offsetRatio;
  let note = existing.note;
  let color = existing.color;

  if (body.chapterNumber != null) {
    chapterNumber = Number(body.chapterNumber);
    if (!Number.isInteger(chapterNumber) || chapterNumber <= 0) throw badRequest('chapterNumber invalid');
    const [[chapter]] = await pool.execute(
      `SELECT id FROM chapters WHERE novel_id = ? AND chapter_number = ? LIMIT 1`,
      [existing.novelId, chapterNumber]
    );
    if (!chapter) throw notFound('Chapter not found');
    chapterId = chapter.id;
  }
  if (body.offsetRatio != null) offsetRatio = clampOffset(body.offsetRatio);
  if (body.note != null) note = String(body.note).slice(0, 8000);
  if (body.color !== undefined) {
    color = body.color == null || body.color === '' ? null : String(body.color).slice(0, 32);
  }

  await pool.execute(
    `UPDATE reading_bookmarks
     SET chapter_number = ?, chapter_id = ?, offset_ratio = ?, note = ?, color = ?, updated_at = NOW()
     WHERE id = ? AND user_id = ?`,
    [chapterNumber, chapterId, offsetRatio, note, color, existing.id, userId]
  );
  return getBookmark(userId, existing.id);
}

async function deleteBookmark(userId, bookmarkId) {
  const id = Number(bookmarkId);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('id invalid');
  const [result] = await pool.execute(
    'DELETE FROM reading_bookmarks WHERE id = ? AND user_id = ?',
    [id, userId]
  );
  if (!result.affectedRows) throw notFound('Bookmark not found');
  return { id, deleted: true };
}

module.exports = {
  listBookmarks,
  getBookmark,
  createBookmark,
  updateBookmark,
  deleteBookmark,
  mapBookmark
};

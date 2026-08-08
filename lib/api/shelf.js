const { pool } = require('../../db');
const { toAbsoluteUrl } = require('../util');
const { toIso } = require('./books');
const { badRequest, notFound } = require('./errors');

async function listShelf(req, userId) {
  const [rows] = await pool.execute(
    `SELECT b.novel_id, b.added_at, b.last_opened_at, b.pinned, b.sort_order,
            n.title, n.author, n.cover_image, n.status,
            n.last_chapter_number, n.last_chapter_title, n.updated_at AS novel_updated_at,
            p.chapter_number AS progress_chapter, p.offset_ratio, p.updated_at AS progress_updated_at
     FROM bookshelf b
     INNER JOIN novels n ON n.id = b.novel_id
     LEFT JOIN reading_progress p ON p.user_id = b.user_id AND p.novel_id = b.novel_id
     WHERE b.user_id = ?
     ORDER BY b.pinned DESC, COALESCE(b.last_opened_at, b.added_at) DESC, b.novel_id DESC`,
    [userId]
  );

  return {
    items: rows.map(row => {
      const progress = row.progress_chapter != null
        ? {
            chapterNumber: Number(row.progress_chapter),
            offsetRatio: Number(row.offset_ratio) || 0,
            updatedAt: toIso(row.progress_updated_at)
          }
        : null;
      const lastNum = row.last_chapter_number != null ? Number(row.last_chapter_number) : null;
      const hasUpdate = !!(
        progress &&
        lastNum != null &&
        lastNum > progress.chapterNumber
      );

      return {
        novelId: row.novel_id,
        title: row.title,
        author: row.author || '',
        coverUrl: toAbsoluteUrl(req, row.cover_image),
        status: row.status || 'serializing',
        lastChapterNumber: lastNum,
        lastChapterTitle: row.last_chapter_title || '',
        novelUpdatedAt: toIso(row.novel_updated_at),
        addedAt: toIso(row.added_at),
        lastOpenedAt: toIso(row.last_opened_at),
        progress,
        hasUpdate
      };
    })
  };
}

async function addToShelf(userId, novelId) {
  const id = Number(novelId);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('novelId required');

  const [[novel]] = await pool.execute('SELECT id FROM novels WHERE id = ? LIMIT 1', [id]);
  if (!novel) throw notFound('Book not found');

  await pool.execute(
    `INSERT INTO bookshelf (user_id, novel_id, added_at)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE user_id = user_id`,
    [userId, id]
  );
  return { novelId: id };
}

async function removeFromShelf(userId, novelId) {
  const id = Number(novelId);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('novelId required');
  await pool.execute('DELETE FROM bookshelf WHERE user_id = ? AND novel_id = ?', [userId, id]);
  return { novelId: id };
}

async function touchShelfOpened(userId, novelId) {
  await pool.execute(
    `UPDATE bookshelf SET last_opened_at = NOW()
     WHERE user_id = ? AND novel_id = ?`,
    [userId, novelId]
  );
}

module.exports = {
  listShelf,
  addToShelf,
  removeFromShelf,
  touchShelfOpened
};

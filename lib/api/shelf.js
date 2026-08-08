const { pool } = require('../../db');
const { toAbsoluteUrl } = require('../util');
const { toIso, parseSince } = require('./books');
const { badRequest, notFound } = require('./errors');

function computeHasUpdate(progressChapter, lastChapterNumber, novelUpdatedAt, sinceDate) {
  const lastNum = lastChapterNumber != null ? Number(lastChapterNumber) : null;
  if (progressChapter != null && lastNum != null && lastNum > Number(progressChapter)) {
    return true;
  }
  // 无进度时：若提供 since 且小说在此之后有更新，也标为有更新
  if (sinceDate && novelUpdatedAt) {
    const t = new Date(novelUpdatedAt).getTime();
    if (!Number.isNaN(t) && t > sinceDate.getTime()) return true;
  }
  return false;
}

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
      const hasUpdate = computeHasUpdate(
        progress ? progress.chapterNumber : null,
        lastNum,
        row.novel_updated_at,
        null
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

/**
 * 书架更新摘要：小说 updated_at > since，或最新章号大于阅读进度。
 */
async function listShelfUpdates(req, userId, { since } = {}) {
  const sinceDate = parseSince(since);
  if (!sinceDate) throw badRequest('since query required (ISO-8601)');

  const [rows] = await pool.execute(
    `SELECT b.novel_id,
            n.title, n.author, n.cover_image, n.status,
            n.last_chapter_number, n.last_chapter_title, n.updated_at AS novel_updated_at,
            p.chapter_number AS progress_chapter, p.offset_ratio, p.updated_at AS progress_updated_at
     FROM bookshelf b
     INNER JOIN novels n ON n.id = b.novel_id
     LEFT JOIN reading_progress p ON p.user_id = b.user_id AND p.novel_id = b.novel_id
     WHERE b.user_id = ?
       AND (
         COALESCE(n.updated_at, n.created_at) > ?
         OR (p.chapter_number IS NOT NULL AND n.last_chapter_number IS NOT NULL
             AND n.last_chapter_number > p.chapter_number)
       )
     ORDER BY COALESCE(n.updated_at, n.created_at) DESC, b.novel_id DESC`,
    [userId, sinceDate]
  );

  const serverTime = new Date().toISOString();
  return {
    since: sinceDate.toISOString(),
    serverTime,
    items: rows.map(row => {
      const progress = row.progress_chapter != null
        ? {
            chapterNumber: Number(row.progress_chapter),
            offsetRatio: Number(row.offset_ratio) || 0,
            updatedAt: toIso(row.progress_updated_at)
          }
        : null;
      const lastNum = row.last_chapter_number != null ? Number(row.last_chapter_number) : null;
      const newChapterCount = progress && lastNum != null
        ? Math.max(0, lastNum - progress.chapterNumber)
        : null;

      return {
        novelId: row.novel_id,
        title: row.title,
        author: row.author || '',
        coverUrl: toAbsoluteUrl(req, row.cover_image),
        status: row.status || 'serializing',
        lastChapterNumber: lastNum,
        lastChapterTitle: row.last_chapter_title || '',
        novelUpdatedAt: toIso(row.novel_updated_at),
        progress,
        hasUpdate: true,
        newChapterCount
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
  listShelfUpdates,
  addToShelf,
  removeFromShelf,
  touchShelfOpened
};

const { pool } = require('../../db');
const { toIso } = require('./books');
const { badRequest, notFound } = require('./errors');
const { touchShelfOpened } = require('./shelf');

function clampOffset(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function mapProgress(row) {
  if (!row) return null;
  return {
    novelId: row.novel_id,
    chapterNumber: Number(row.chapter_number),
    chapterId: row.chapter_id != null ? Number(row.chapter_id) : null,
    offsetRatio: Number(row.offset_ratio) || 0,
    updatedAt: toIso(row.updated_at),
    deviceName: row.device_name || null
  };
}

async function listProgress(userId) {
  const [rows] = await pool.execute(
    `SELECT novel_id, chapter_number, chapter_id, offset_ratio, updated_at, device_name
     FROM reading_progress
     WHERE user_id = ?
     ORDER BY updated_at DESC`,
    [userId]
  );
  return { items: rows.map(mapProgress) };
}

async function getProgress(userId, novelId) {
  const [[row]] = await pool.execute(
    `SELECT novel_id, chapter_number, chapter_id, offset_ratio, updated_at, device_name
     FROM reading_progress
     WHERE user_id = ? AND novel_id = ?
     LIMIT 1`,
    [userId, novelId]
  );
  if (!row) throw notFound('Progress not found');
  return mapProgress(row);
}

async function putProgress(userId, body) {
  const novelId = Number(body.novelId);
  const chapterNumber = Number(body.chapterNumber);
  const offsetRatio = clampOffset(body.offsetRatio);
  const deviceName = body.deviceName ? String(body.deviceName).slice(0, 100) : null;
  const clientUpdatedAt = body.updatedAt ? new Date(body.updatedAt) : new Date();

  if (!Number.isInteger(novelId) || novelId <= 0) throw badRequest('novelId required');
  if (!Number.isInteger(chapterNumber) || chapterNumber <= 0) throw badRequest('chapterNumber required');
  if (Number.isNaN(clientUpdatedAt.getTime())) throw badRequest('updatedAt invalid');

  const [[novel]] = await pool.execute('SELECT id FROM novels WHERE id = ? LIMIT 1', [novelId]);
  if (!novel) throw notFound('Book not found');

  const [[chapter]] = await pool.execute(
    `SELECT id FROM chapters WHERE novel_id = ? AND chapter_number = ? LIMIT 1`,
    [novelId, chapterNumber]
  );
  if (!chapter) throw notFound('Chapter not found');

  const [[existing]] = await pool.execute(
    `SELECT novel_id, chapter_number, chapter_id, offset_ratio, updated_at, device_name
     FROM reading_progress
     WHERE user_id = ? AND novel_id = ?
     LIMIT 1`,
    [userId, novelId]
  );

  if (existing) {
    const serverTime = new Date(existing.updated_at).getTime();
    const clientTime = clientUpdatedAt.getTime();
    if (clientTime <= serverTime) {
      return { applied: false, progress: mapProgress(existing) };
    }
  }

  await pool.execute(
    `INSERT INTO reading_progress
       (user_id, novel_id, chapter_number, chapter_id, offset_ratio, updated_at, device_name)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       chapter_number = VALUES(chapter_number),
       chapter_id = VALUES(chapter_id),
       offset_ratio = VALUES(offset_ratio),
       updated_at = VALUES(updated_at),
       device_name = VALUES(device_name)`,
    [userId, novelId, chapterNumber, chapter.id, offsetRatio, clientUpdatedAt, deviceName]
  );

  // 若已在书架则刷新打开时间；不在则不自动加书架（由客户端显式加）
  await touchShelfOpened(userId, novelId);

  const progress = await getProgress(userId, novelId);
  return { applied: true, progress };
}

const BATCH_MAX = 50;

/**
 * 离线队列批量上报进度。逐条 LWW；单条失败不中断整批。
 * @returns {{ results: Array<object>, appliedCount: number, skippedCount: number, errorCount: number }}
 */
async function putProgressBatch(userId, body) {
  const items = body && Array.isArray(body.items) ? body.items : null;
  if (!items) throw badRequest('items array required');
  if (items.length === 0) throw badRequest('items must not be empty');
  if (items.length > BATCH_MAX) {
    throw badRequest(`items max ${BATCH_MAX}, got ${items.length}`);
  }

  const results = [];
  let appliedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const item of items) {
    const novelId = item && item.novelId != null ? Number(item.novelId) : null;
    try {
      const result = await putProgress(userId, item || {});
      if (result.applied) appliedCount += 1;
      else skippedCount += 1;
      results.push({
        novelId: result.progress ? result.progress.novelId : novelId,
        applied: result.applied,
        progress: result.progress
      });
    } catch (err) {
      errorCount += 1;
      results.push({
        novelId: Number.isInteger(novelId) ? novelId : null,
        applied: false,
        error: {
          code: err.code || (err.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST'),
          message: err.message || 'failed'
        }
      });
    }
  }

  return {
    results,
    appliedCount,
    skippedCount,
    errorCount,
    serverTime: new Date().toISOString()
  };
}

module.exports = {
  listProgress,
  getProgress,
  putProgress,
  putProgressBatch,
  mapProgress,
  BATCH_MAX
};

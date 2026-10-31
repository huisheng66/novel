// 更新通知：设备订阅 + 书架「有新章」通知列表

const { pool } = require('../../db');
const { toAbsoluteUrl } = require('../util');
const { toIso, parseSince } = require('./books');
const { badRequest } = require('./errors');

function mapDevice(row) {
  return {
    id: Number(row.id),
    deviceId: row.device_id,
    platform: row.platform || null,
    pushToken: row.push_token || null,
    enabled: !!row.enabled,
    lastSeenAt: toIso(row.last_seen_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

/**
 * 注册/更新设备（用于后续推送；本阶段只存 token，不向 FCM 发送）
 */
async function registerDevice(userId, body) {
  const deviceId = String(body.deviceId || '').trim().slice(0, 128);
  if (!deviceId) throw badRequest('deviceId required');
  const platform = body.platform != null ? String(body.platform).slice(0, 32) : null;
  const pushToken = body.pushToken != null ? String(body.pushToken).slice(0, 512) : null;
  const enabled = body.enabled === false || body.enabled === 0 ? 0 : 1;

  await pool.execute(
    `INSERT INTO device_subscriptions
       (user_id, device_id, platform, push_token, enabled, last_seen_at)
     VALUES (?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       platform = COALESCE(VALUES(platform), platform),
       push_token = COALESCE(VALUES(push_token), push_token),
       enabled = VALUES(enabled),
       last_seen_at = NOW(),
       updated_at = NOW()`,
    [userId, deviceId, platform, pushToken, enabled]
  );

  const [[row]] = await pool.execute(
    `SELECT id, device_id, platform, push_token, enabled, last_seen_at, created_at, updated_at
     FROM device_subscriptions
     WHERE user_id = ? AND device_id = ?
     LIMIT 1`,
    [userId, deviceId]
  );
  return mapDevice(row);
}

async function listDevices(userId) {
  const [rows] = await pool.execute(
    `SELECT id, device_id, platform, push_token, enabled, last_seen_at, created_at, updated_at
     FROM device_subscriptions
     WHERE user_id = ?
     ORDER BY updated_at DESC`,
    [userId]
  );
  return { items: rows.map(mapDevice) };
}

/**
 * 书架更新通知列表（与 shelf/updates 语义一致，面向「通知中心」）
 * since 可选：缺省则返回所有「进度落后最新章」的书架书
 */
async function listUpdateNotices(req, userId, { since } = {}) {
  const sinceDate = since != null && since !== '' ? parseSince(since) : null;

  const params = [userId];
  let sinceClause = '';
  if (sinceDate) {
    sinceClause = ' AND n.updated_at > ?';
    params.push(sinceDate);
  }

  const [rows] = await pool.execute(
    `SELECT b.novel_id,
            n.title, n.author, n.cover_image, n.status,
            n.last_chapter_number, n.last_chapter_title, n.updated_at AS novel_updated_at,
            p.chapter_number AS progress_chapter, p.offset_ratio, p.updated_at AS progress_updated_at
     FROM bookshelf b
     INNER JOIN novels n ON n.id = b.novel_id
     LEFT JOIN reading_progress p ON p.user_id = b.user_id AND p.novel_id = b.novel_id
     WHERE b.user_id = ?
       AND n.last_chapter_number IS NOT NULL
       AND (
         (p.chapter_number IS NOT NULL AND n.last_chapter_number > p.chapter_number)
         OR (p.chapter_number IS NULL AND 1=1)
       )
       ${sinceClause}
     ORDER BY n.updated_at DESC, b.novel_id DESC`,
    params
  );

  // 无进度时：若未传 since，仍可提示「未读完/有全书」——仅当 last_chapter 存在
  // 有进度落后才算强更新；无进度时标 type unread_shelf
  const items = rows
    .map(row => {
      const lastNum = Number(row.last_chapter_number);
      const progressChapter = row.progress_chapter != null ? Number(row.progress_chapter) : null;
      const hasNewChapters = progressChapter != null && lastNum > progressChapter;
      const noProgress = progressChapter == null;
      if (!hasNewChapters && !noProgress) return null;
      // 若传了 since，无进度的书仅当小说在 since 后更新才出现（SQL 已过滤）
      if (!hasNewChapters && !sinceDate) {
        // 无进度且无 since：不算「更新通知」，避免刷屏
        return null;
      }
      if (!hasNewChapters && sinceDate) {
        // 无进度 + since：小说有更新，通知可看
      }

      return {
        type: hasNewChapters ? 'new_chapters' : 'book_updated',
        novelId: row.novel_id,
        title: row.title,
        author: row.author || '',
        coverUrl: toAbsoluteUrl(req, row.cover_image),
        lastChapterNumber: lastNum,
        lastChapterTitle: row.last_chapter_title || '',
        novelUpdatedAt: toIso(row.novel_updated_at),
        progress: progressChapter != null
          ? {
              chapterNumber: progressChapter,
              offsetRatio: Number(row.offset_ratio) || 0,
              updatedAt: toIso(row.progress_updated_at)
            }
          : null,
        newChapterCount: hasNewChapters ? lastNum - progressChapter : null,
        message: hasNewChapters
          ? `《${row.title}》更新至第 ${lastNum} 章`
          : `《${row.title}》有内容更新`
      };
    })
    .filter(Boolean);

  return {
    since: sinceDate ? sinceDate.toISOString() : null,
    serverTime: new Date().toISOString(),
    items
  };
}

module.exports = {
  registerDevice,
  listDevices,
  listUpdateNotices,
  mapDevice
};

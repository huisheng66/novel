// 平台运营配置：公告、最低客户端版本、强制更新

const { pool } = require('../../db');
const { toIso } = require('./books');
const { badRequest } = require('./errors');

const KNOWN_KEYS = new Set([
  'announcement',
  'announcement_enabled',
  'min_client_version',
  'force_update',
  'force_update_message',
  'store_url'
]);

function parseBool(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

async function getAllSettings() {
  const [rows] = await pool.execute(
    'SELECT setting_key, setting_value, updated_at FROM platform_settings'
  );
  const map = {};
  let maxUpdated = null;
  for (const row of rows) {
    map[row.setting_key] = row.setting_value;
    const t = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    if (!maxUpdated || t > maxUpdated) maxUpdated = t;
  }
  return { map, updatedAt: maxUpdated ? new Date(maxUpdated).toISOString() : null };
}

/**
 * 公开可读的客户端运营面（无需登录）
 */
async function getClientOps() {
  const { map, updatedAt } = await getAllSettings();
  return {
    announcement: {
      enabled: parseBool(map.announcement_enabled),
      text: map.announcement || ''
    },
    updatePolicy: {
      minClientVersion: map.min_client_version || '0.0.0',
      forceUpdate: parseBool(map.force_update),
      message: map.force_update_message || '',
      storeUrl: map.store_url || ''
    },
    serverTime: new Date().toISOString(),
    updatedAt
  };
}

async function setSettings(partial) {
  if (!partial || typeof partial !== 'object') throw badRequest('body required');
  const entries = Object.entries(partial);
  if (entries.length === 0) throw badRequest('no settings provided');

  for (const [key, value] of entries) {
    if (!KNOWN_KEYS.has(key)) throw badRequest(`unknown setting key: ${key}`);
    await pool.execute(
      `INSERT INTO platform_settings (setting_key, setting_value)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()`,
      [key, String(value == null ? '' : value)]
    );
  }
  return getClientOps();
}

/**
 * 从结构化 body 写入（App 友好字段）
 */
async function setClientOpsFromBody(body) {
  const patch = {};
  if (body.announcement != null) {
    if (typeof body.announcement === 'object') {
      if (body.announcement.text != null) patch.announcement = body.announcement.text;
      if (body.announcement.enabled != null) {
        patch.announcement_enabled = body.announcement.enabled ? '1' : '0';
      }
    } else {
      patch.announcement = body.announcement;
    }
  }
  if (body.announcementEnabled != null) {
    patch.announcement_enabled = body.announcementEnabled ? '1' : '0';
  }
  if (body.announcementText != null) patch.announcement = body.announcementText;

  const up = body.updatePolicy || body;
  if (up.minClientVersion != null) patch.min_client_version = up.minClientVersion;
  if (up.forceUpdate != null) patch.force_update = up.forceUpdate ? '1' : '0';
  if (up.message != null) patch.force_update_message = up.message;
  if (up.storeUrl != null) patch.store_url = up.storeUrl;
  if (body.minClientVersion != null) patch.min_client_version = body.minClientVersion;
  if (body.forceUpdate != null) patch.force_update = body.forceUpdate ? '1' : '0';
  if (body.forceUpdateMessage != null) patch.force_update_message = body.forceUpdateMessage;
  if (body.storeUrl != null) patch.store_url = body.storeUrl;

  return setSettings(patch);
}

module.exports = {
  getClientOps,
  setSettings,
  setClientOpsFromBody,
  KNOWN_KEYS,
  parseBool,
  toIso
};

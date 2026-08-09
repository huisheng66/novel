// 一次一码邀请码：自助注册消耗

const crypto = require('crypto');
const { pool } = require('../../db');
const { badRequest, notFound } = require('./errors');

function normalizeInviteCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function generateInviteCodeValue() {
  // INV- + 8 hex → 约 40 亿种，碰撞极低
  return `INV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * 生成 n 个未使用邀请码（一次一码）
 * @param {{ count?: number, note?: string, expiresAt?: Date|string|null }} opts
 */
async function createInviteCodes({ count = 1, note = null, expiresAt = null } = {}) {
  const n = Math.min(Math.max(Number(count) || 1, 1), 50);
  const noteText = note ? String(note).trim().slice(0, 255) : null;
  let exp = null;
  if (expiresAt) {
    const d = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    if (Number.isNaN(d.getTime())) throw badRequest('expiresAt invalid');
    exp = d;
  }

  const created = [];
  for (let i = 0; i < n; i++) {
    let code = generateInviteCodeValue();
    let tries = 0;
    // 极少数碰撞时重试
    while (tries < 5) {
      try {
        const [result] = await pool.execute(
          `INSERT INTO invite_codes (code, note, expires_at) VALUES (?, ?, ?)`,
          [code, noteText, exp]
        );
        created.push({
          id: result.insertId,
          code,
          note: noteText,
          expiresAt: exp,
          usedAt: null
        });
        break;
      } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') {
          code = generateInviteCodeValue();
          tries += 1;
          continue;
        }
        throw err;
      }
    }
  }
  return created;
}

async function listInviteCodes({ status = 'all', page = 1, pageSize = 50 } = {}) {
  const size = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const current = Math.max(Number(page) || 1, 1);
  const offset = (current - 1) * size;

  const where = [];
  if (status === 'unused') {
    where.push('used_at IS NULL');
    where.push('(expires_at IS NULL OR expires_at > NOW())');
  } else if (status === 'used') {
    where.push('used_at IS NOT NULL');
  } else if (status === 'expired') {
    where.push('used_at IS NULL');
    where.push('expires_at IS NOT NULL AND expires_at <= NOW()');
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM invite_codes ${whereSql}`
  );
  const [rows] = await pool.execute(
    `SELECT id, code, note, created_at, expires_at, used_at, used_by_user_id
     FROM invite_codes
     ${whereSql}
     ORDER BY id DESC
     LIMIT ${size} OFFSET ${offset}`
  );

  return {
    page: current,
    pageSize: size,
    total: Number(total) || 0,
    items: rows.map((r) => ({
      id: r.id,
      code: r.code,
      note: r.note || null,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      usedAt: r.used_at,
      usedByUserId: r.used_by_user_id,
      status: r.used_at
        ? 'used'
        : r.expires_at && new Date(r.expires_at).getTime() <= Date.now()
          ? 'expired'
          : 'unused'
    }))
  };
}

/**
 * 在事务中核销邀请码（一次一码）。
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {string} inviteCode
 * @param {number} userId
 */
async function consumeInviteCode(conn, inviteCode, userId) {
  const code = normalizeInviteCode(inviteCode);
  if (!code) throw badRequest('inviteCode required');

  const [rows] = await conn.execute(
    `SELECT id, code, used_at, expires_at
     FROM invite_codes
     WHERE code = ?
     LIMIT 1
     FOR UPDATE`,
    [code]
  );
  const row = rows[0];
  if (!row) throw badRequest('邀请码无效');
  if (row.used_at) throw badRequest('邀请码已被使用');
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    throw badRequest('邀请码已过期');
  }

  await conn.execute(
    `UPDATE invite_codes
     SET used_at = NOW(), used_by_user_id = ?
     WHERE id = ? AND used_at IS NULL`,
    [userId, row.id]
  );
  return { id: row.id, code: row.code };
}

async function deleteInviteCode(id) {
  const codeId = Number(id);
  if (!Number.isInteger(codeId) || codeId <= 0) throw badRequest('invalid id');
  // 仅允许删未使用的
  const [result] = await pool.execute(
    'DELETE FROM invite_codes WHERE id = ? AND used_at IS NULL',
    [codeId]
  );
  if (!result.affectedRows) throw notFound('邀请码不存在或已使用');
  return { ok: true };
}

module.exports = {
  normalizeInviteCode,
  generateInviteCodeValue,
  createInviteCodes,
  listInviteCodes,
  consumeInviteCode,
  deleteInviteCode
};

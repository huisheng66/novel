// 充值码（兑换码）：后台批量生成、按状态查询、删除未使用。
//
// 与 invite_codes 是同构设计（一次一码），区别是带面额。
// 面额单位：分。

const crypto = require('crypto');
const { pool } = require('../../db');
const { badRequest, notFound } = require('./errors');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(buf) {
  // 160 位随机 → 32 字符 base32（A-Z, 2-7），无填充
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

function generateCodeValue() {
  // 160 位随机熵（2^160），分组展示便于人工核对；用户输入时大小写/连字符/空格均可容忍
  const body = base32(crypto.randomBytes(20));
  return `RC-${body.replace(/(.{4})(?=.)/g, '$1-')}`;
}

/**
 * 兑换码输入归一化：
 * - 新长码 RC-XXXX-…-XXXX（42 字符）→ 还原分组规范形
 * - 旧短码 RC-XXXXXXXX / 纯 8 hex → 补全旧规范形（存量码继续可用）
 * - 大小写、连字符、空格一概容忍
 */
function normalizeCode(raw) {
  const flat = String(raw == null ? '' : raw).toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (/^RC[A-Z2-7]{32}$/.test(flat)) {
    return `RC-${flat.slice(2).replace(/(.{4})(?=.)/g, '$1-')}`;
  }
  if (/^RC[A-F0-9]{8}$/.test(flat)) return `RC-${flat.slice(2)}`;
  if (/^[A-F0-9]{8}$/.test(flat)) return `RC-${flat}`;
  return String(raw == null ? '' : raw).trim().toUpperCase();
}

function normalizeAmount(value) {
  const n = Math.trunc(Number(value));
  if (!Number.isInteger(n) || n <= 0) throw badRequest('面额必须是正整数（分）');
  return n;
}

async function createCodes({ count = 1, amount, note = null, expiresAt = null } = {}) {
  const n = Math.min(Math.max(Number(count) || 1, 1), 100);
  const cents = normalizeAmount(amount);
  const noteText = note ? String(note).trim().slice(0, 255) : null;

  let exp = null;
  if (expiresAt) {
    const d = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    if (Number.isNaN(d.getTime())) throw badRequest('expiresAt invalid');
    exp = d;
  }

  const created = [];
  for (let i = 0; i < n; i += 1) {
    let code = generateCodeValue();
    for (let tries = 0; tries < 5; tries += 1) {
      try {
        const [result] = await pool.execute(
          'INSERT INTO recharge_codes (code, amount, note, expires_at) VALUES (?, ?, ?, ?)',
          [code, cents, noteText, exp]
        );
        created.push({ id: result.insertId, code, amount: cents, note: noteText, expiresAt: exp });
        break;
      } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') {
          code = generateCodeValue();
          continue;
        }
        throw err;
      }
    }
  }
  return created;
}

async function listCodes({ status = 'unused', page = 1, pageSize = 50 } = {}) {
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

  const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM recharge_codes ${whereSql}`);
  const [rows] = await pool.execute(
    `SELECT r.id, r.code, r.amount, r.note, r.created_at, r.expires_at, r.used_at, r.used_by_user_id,
            u.username AS used_by
     FROM recharge_codes r
     LEFT JOIN users u ON u.id = r.used_by_user_id
     ${whereSql}
     ORDER BY r.id DESC
     LIMIT ${size} OFFSET ${offset}`
  );

  return {
    page: current,
    pageSize: size,
    total: Number(total) || 0,
    items: rows.map(row => ({
      id: row.id,
      code: row.code,
      amount: Number(row.amount) || 0,
      note: row.note || null,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
      usedBy: row.used_by || null,
      status: row.used_at
        ? 'used'
        : (row.expires_at && new Date(row.expires_at).getTime() <= Date.now() ? 'expired' : 'unused')
    }))
  };
}

/** 导出用：不分页全量拉取（TXT 一行一码） */
async function exportCodes({ status = 'unused' } = {}) {
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
  const [rows] = await pool.execute(
    `SELECT code, amount, expires_at, used_at FROM recharge_codes ${whereSql} ORDER BY id ASC`
  );
  return rows.map(row => ({
    code: row.code,
    amount: Number(row.amount) || 0,
    expiresAt: row.expires_at,
    used: Boolean(row.used_at)
  }));
}

async function deleteCode(id) {
  const codeId = Number(id);
  if (!Number.isInteger(codeId) || codeId <= 0) throw badRequest('invalid id');
  const [result] = await pool.execute(
    'DELETE FROM recharge_codes WHERE id = ? AND used_at IS NULL',
    [codeId]
  );
  if (!result.affectedRows) throw notFound('充值码不存在或已被使用');
  return { ok: true };
}

module.exports = {
  createCodes,
  listCodes,
  deleteCode,
  exportCodes,
  generateCodeValue,
  normalizeCode
};

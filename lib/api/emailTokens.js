// 邮箱令牌：验证邮箱 / 重置密码。
//
// 与 refresh token 同策略：明文只在下发那一刻存在，库里只存 sha256；
// 一次性使用、带过期时间；同类旧令牌在签发新令牌时作废，避免多封邮件同时有效。

const crypto = require('crypto');
const { pool } = require('../../db');
const { badRequest } = require('./errors');

const TTL_MS = {
  verify: 24 * 60 * 60 * 1000,
  reset: 60 * 60 * 1000
};

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function ttlOf(kind) {
  const ttl = TTL_MS[kind];
  if (!ttl) throw badRequest('invalid token kind');
  return ttl;
}

/**
 * 签发令牌。
 * @returns {Promise<{token: string, expiresAt: Date}>} token 为明文，仅此一次可见
 */
async function issueToken(userId, kind) {
  const ttl = ttlOf(kind);
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttl);

  // 同用户同类型的未用令牌作废：只保留最新一封邮件里的链接
  await pool.execute(
    'DELETE FROM email_tokens WHERE user_id = ? AND kind = ? AND used_at IS NULL',
    [userId, kind]
  );
  await pool.execute(
    `INSERT INTO email_tokens (user_id, kind, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
    [userId, kind, hashToken(token), expiresAt]
  );

  return { token, expiresAt };
}

/**
 * 核销令牌，返回所属用户 id。失败抛 400（不区分「不存在」与「已使用」，避免探测）。
 */
async function consumeToken(kind, rawToken) {
  const token = String(rawToken == null ? '' : rawToken).trim();
  if (!token) throw badRequest('链接无效');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      `SELECT id, user_id, expires_at, used_at FROM email_tokens
       WHERE token_hash = ? AND kind = ? FOR UPDATE`,
      [hashToken(token), kind]
    );
    const row = rows[0];
    if (!row || row.used_at) throw badRequest('链接无效或已被使用');
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw badRequest('链接已过期，请重新获取');
    }

    await conn.execute('UPDATE email_tokens SET used_at = NOW() WHERE id = ?', [row.id]);
    await conn.commit();
    return Number(row.user_id);
  } catch (err) {
    try {
      await conn.rollback();
    } catch (e) {
      /* ignore */
    }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * 只检查令牌是否可用（不核销），用于打开页面时提前给出「链接已失效」而不是等提交才报错。
 * @returns {Promise<boolean>}
 */
async function peekToken(kind, rawToken) {
  const token = String(rawToken == null ? '' : rawToken).trim();
  if (!token) return false;
  const [[row]] = await pool.execute(
    `SELECT expires_at, used_at FROM email_tokens WHERE token_hash = ? AND kind = ? LIMIT 1`,
    [hashToken(token), kind]
  );
  if (!row || row.used_at) return false;
  return new Date(row.expires_at).getTime() > Date.now();
}

/** 作废某用户某类型的所有未用令牌（改密后调用） */
async function revokeTokens(userId, kind) {
  await pool.execute(
    'DELETE FROM email_tokens WHERE user_id = ? AND kind = ? AND used_at IS NULL',
    [userId, kind]
  );
}

/** 清理过期令牌（可挂定时任务，也可忽略——表很小） */
async function purgeExpired() {
  const [res] = await pool.execute(
    'DELETE FROM email_tokens WHERE expires_at < DATE_SUB(NOW(), INTERVAL 7 DAY)'
  );
  return res.affectedRows || 0;
}

module.exports = {
  TTL_MS,
  hashToken,
  issueToken,
  consumeToken,
  peekToken,
  revokeTokens,
  purgeExpired
};

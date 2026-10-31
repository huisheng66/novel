const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../../db');
const {
  createRefreshToken,
  hashToken,
  signAccessToken,
  refreshExpiresAt
} = require('./tokens');
const { ApiError, badRequest, unauthorized, conflict, notFound } = require('./errors');

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
// 邮箱只做基础形态校验（邮箱是否真实存在需要发信验证，当前未接入）
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/;
const MAX_EMAIL_LEN = 255;

/** 归一化邮箱：去空格、转小写；非法则抛 400 */
function normalizeEmail(value) {
  const email = String(value == null ? '' : value).trim().toLowerCase();
  if (!email) return '';
  if (email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
    throw badRequest('邮箱格式不正确');
  }
  return email;
}

/** 由邮箱本地部分推导一个合法用户名；不合规则回退为 reader */
function baseUsernameFromEmail(email) {
  const local = String(email || '').split('@')[0].toLowerCase();
  const cleaned = local
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  return cleaned.length >= 3 ? cleaned : 'reader';
}

function randomUsernameSuffix() {
  return crypto.randomBytes(3).toString('hex');
}

function isRegisterEnabled() {
  const raw = process.env.API_REGISTER_ENABLED;
  if (raw === undefined || raw === '') return true;
  return !['0', 'false', 'no', 'off'].includes(String(raw).toLowerCase());
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    email: row.email || null,
    emailVerified: Boolean(row.email_verified_at)
  };
}

async function findUserByUsername(username) {
  const [[row]] = await pool.execute(
    'SELECT id, username, email, email_verified_at, password_hash, display_name, is_active FROM users WHERE username = ? LIMIT 1',
    [username]
  );
  return row || null;
}

/** 登录查询：含 @ 按邮箱查，否则按用户名查 */
async function findUserByLogin(identifier) {
  const value = String(identifier || '').trim();
  if (!value) return null;

  if (value.includes('@')) {
    const [[row]] = await pool.execute(
      'SELECT id, username, email, email_verified_at, password_hash, display_name, is_active FROM users WHERE email = ? LIMIT 1',
      [value.toLowerCase()]
    );
    return row || null;
  }
  return findUserByUsername(value);
}

async function findUserById(id) {
  const [[row]] = await pool.execute(
    'SELECT id, username, email, email_verified_at, password_hash, display_name, is_active FROM users WHERE id = ? LIMIT 1',
    [id]
  );
  return row || null;
}

/** 是否启用（DB 列为 is_active） */
function isUserActive(row) {
  if (!row) return false;
  return row.is_active === 1 || row.is_active === true;
}

async function createSession(user, { deviceName, userAgent } = {}) {
  const refreshToken = createRefreshToken();
  const refreshHash = hashToken(refreshToken);
  const expiresAt = refreshExpiresAt();
  await pool.execute(
    `INSERT INTO user_sessions (user_id, refresh_token_hash, device_name, user_agent, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [user.id, refreshHash, deviceName || null, userAgent || null, expiresAt]
  );
  const { token: accessToken, expiresIn } = signAccessToken(user);
  return {
    user: publicUser(user),
    accessToken,
    refreshToken,
    expiresIn
  };
}

/**
 * 注册（邮箱为主，用户名可选自动生成，邀请码可选）。
 *
 * - email 必填之一（或显式 username，兼容老客户端）
 * - 不给 username 时由邮箱本地部分推导；重名自动加随机后缀
 * - inviteCode 可选：填了就必须有效，不填也允许注册
 */
async function registerUser({
  email,
  username,
  password,
  displayName,
  deviceName,
  userAgent,
  inviteCode
}) {
  if (!isRegisterEnabled()) {
    throw new ApiError(403, 'REGISTER_DISABLED', 'Registration is disabled');
  }

  const pass = String(password || '');
  if (pass.length < 8) {
    throw badRequest('password must be at least 8 characters');
  }

  const mail = normalizeEmail(email);
  const rawName = String(username || '').trim();

  if (!mail && !rawName) throw badRequest('请填写邮箱');
  if (rawName && !USERNAME_RE.test(rawName)) {
    throw badRequest('username must be 3-32 chars: letters, numbers, underscore');
  }

  // 邀请码不再强制；填了就必须能核销
  const invite = String(inviteCode || '').trim();

  const passwordHash = await bcrypt.hash(pass, 10);
  const display = (String(displayName || '').trim()
    || (mail ? mail.split('@')[0] : rawName)
    || 'reader').slice(0, 100);

  const { consumeInviteCode } = require('./invites');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 自动生成用户名时，遇到并发重名就换一个后缀重试
    const attempts = rawName ? 1 : 4;
    let name = rawName || baseUsernameFromEmail(mail);
    let userId = null;
    let lastErr = null;

    for (let i = 0; i < attempts; i += 1) {
      const candidate = rawName
        ? rawName
        : (i === 0 ? name : `${baseUsernameFromEmail(mail).slice(0, 24)}_${randomUsernameSuffix()}`);

      try {
        const [result] = await conn.execute(
          `INSERT INTO users (username, email, password_hash, display_name) VALUES (?, ?, ?, ?)`,
          [candidate, mail || null, passwordHash, display]
        );
        userId = result.insertId;
        name = candidate;
        break;
      } catch (err) {
        lastErr = err;
        if (!err || err.code !== 'ER_DUP_ENTRY') throw err;

        // 唯一键冲突要分清是邮箱还是用户名，否则用户会收到误导性提示
        const message = String(err.sqlMessage || '');
        if (message.includes('uk_users_email') || message.includes('email')) {
          throw conflict('该邮箱已注册，请直接登录');
        }
        if (rawName) throw conflict('用户名已被占用');

        // 自动生成的名字撞了：继续下一轮换后缀
      }
    }

    if (!userId) {
      if (lastErr && lastErr.code === 'ER_DUP_ENTRY') throw conflict('用户名已被占用');
      throw lastErr || new Error('register failed');
    }

    if (invite) await consumeInviteCode(conn, invite, userId);
    await conn.commit();

    const user = {
      id: userId,
      username: name,
      display_name: display,
      email: mail || null,
      is_active: 1
    };
    return createSession(user, { deviceName, userAgent });
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
 * 登录：identifier 可以是邮箱或用户名（含 @ 视为邮箱）。
 * 兼容老参数名 username / email。
 */
async function loginUser({ login, username, email, password, deviceName, userAgent }) {
  const identifier = String(login || email || username || '').trim();
  const pass = String(password || '');
  if (!identifier || !pass) throw badRequest('email/username and password required');

  const user = await findUserByLogin(identifier);
  if (!user || !user.is_active) throw unauthorized('邮箱/用户名或密码错误');

  const ok = await bcrypt.compare(pass, user.password_hash);
  if (!ok) throw unauthorized('邮箱/用户名或密码错误');

  // 密码正确后才检查验证状态，避免把「这个邮箱存在但没验证」暴露给猜密码的人
  const { checkVerifiedFor } = require('./email');
  const verified = await checkVerifiedFor('login', user);
  if (!verified.ok) {
    throw new ApiError(403, 'EMAIL_NOT_VERIFIED', '邮箱尚未验证，请查收验证邮件后再登录');
  }

  return createSession(user, { deviceName, userAgent });
}

async function refreshSession(refreshToken, { deviceName, userAgent } = {}) {
  const token = String(refreshToken || '').trim();
  if (!token) throw badRequest('refreshToken required');

  const refreshHash = hashToken(token);
  const [[session]] = await pool.execute(
    `SELECT s.id, s.user_id, s.expires_at, u.username, u.display_name, u.email, u.is_active
     FROM user_sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.refresh_token_hash = ?
     LIMIT 1`,
    [refreshHash]
  );
  if (!session || !session.is_active) throw unauthorized('Invalid refresh token');
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await pool.execute('DELETE FROM user_sessions WHERE id = ?', [session.id]);
    throw unauthorized('Refresh token expired');
  }

  // 轮换 refresh
  const newRefresh = createRefreshToken();
  const newHash = hashToken(newRefresh);
  const expiresAt = refreshExpiresAt();
  await pool.execute(
    `UPDATE user_sessions
     SET refresh_token_hash = ?, expires_at = ?, last_seen_at = NOW(),
         device_name = COALESCE(?, device_name),
         user_agent = COALESCE(?, user_agent)
     WHERE id = ?`,
    [newHash, expiresAt, deviceName || null, userAgent || null, session.id]
  );

  const user = {
    id: session.user_id,
    username: session.username,
    display_name: session.display_name,
    email: session.email
  };
  const { token: accessToken, expiresIn } = signAccessToken(user);
  return {
    user: publicUser(user),
    accessToken,
    refreshToken: newRefresh,
    expiresIn
  };
}

async function logoutSession(refreshToken) {
  const token = String(refreshToken || '').trim();
  if (!token) return;
  await pool.execute('DELETE FROM user_sessions WHERE refresh_token_hash = ?', [hashToken(token)]);
}

/** 后台建号：不受 API_REGISTER_ENABLED 限制 */
async function createUserAdmin({ username, email, password, displayName, isActive = true }) {
  const name = String(username || '').trim();
  const mail = normalizeEmail(email);
  const pass = String(password || '');
  if (!USERNAME_RE.test(name)) {
    throw badRequest('username must be 3-32 chars: letters, numbers, underscore');
  }
  if (pass.length < 8) {
    throw badRequest('password must be at least 8 characters');
  }

  const passwordHash = await bcrypt.hash(pass, 10);
  const display = String(displayName || name).trim().slice(0, 100) || name;
  const active = isActive ? 1 : 0;

  try {
    const [result] = await pool.execute(
      `INSERT INTO users (username, email, password_hash, display_name, is_active) VALUES (?, ?, ?, ?, ?)`,
      [name, mail || null, passwordHash, display, active]
    );
    return findUserById(result.insertId);
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      const message = String(err.sqlMessage || '');
      if (message.includes('uk_users_email') || message.includes('email')) {
        throw conflict('该邮箱已被其他账号使用');
      }
      throw conflict('username already exists');
    }
    throw err;
  }
}

async function listUsers({ q = '', page = 1, pageSize = 50 } = {}) {
  const size = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const current = Math.max(Number(page) || 1, 1);
  const offset = (current - 1) * size;
  const keyword = String(q || '').trim();
  const params = [];
  let where = '';
  if (keyword) {
    where = 'WHERE u.username LIKE ? OR u.display_name LIKE ?';
    const like = `%${keyword}%`;
    params.push(like, like);
  }

  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM users ${where}`,
    params
  );
  const [rows] = await pool.execute(
    `SELECT u.id, u.username, u.email, u.email_verified_at, u.display_name, u.is_active,
            u.created_at, u.updated_at, COALESCE(w.balance, 0) AS balance
     FROM users u
     LEFT JOIN user_wallets w ON w.user_id = u.id
     ${where}
     ORDER BY u.id DESC
     LIMIT ${size} OFFSET ${offset}`,
    params
  );

  return {
    page: current,
    pageSize: size,
    total: Number(total) || 0,
    items: rows.map((row) => ({
      id: row.id,
      username: row.username,
      email: row.email || null,
      emailVerified: Boolean(row.email_verified_at),
      displayName: row.display_name || row.username,
      isActive: Boolean(row.is_active),
      balance: Number(row.balance) || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  };
}

async function setUserActive(userId, isActive) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('invalid user id');
  const [result] = await pool.execute('UPDATE users SET is_active = ? WHERE id = ?', [
    isActive ? 1 : 0,
    id
  ]);
  if (!result.affectedRows) throw notFound('User not found');
  if (!isActive) {
    await pool.execute('DELETE FROM user_sessions WHERE user_id = ?', [id]);
  }
  return findUserById(id);
}

async function resetUserPassword(userId, password) {
  const id = Number(userId);
  const pass = String(password || '');
  if (!Number.isInteger(id) || id <= 0) throw badRequest('invalid user id');
  if (pass.length < 8) throw badRequest('password must be at least 8 characters');
  const passwordHash = await bcrypt.hash(pass, 10);
  const [result] = await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [
    passwordHash,
    id
  ]);
  if (!result.affectedRows) throw badRequest('User not found');
  await pool.execute('DELETE FROM user_sessions WHERE user_id = ?', [id]);
  return findUserById(id);
}

async function revokeUserSessions(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('invalid user id');
  const [result] = await pool.execute('DELETE FROM user_sessions WHERE user_id = ?', [id]);
  return { deleted: result.affectedRows || 0 };
}

/** 后台手动标记邮箱已验证（邮件发不出去时的兜底） */
async function setEmailVerifiedAdmin(userId, verified = true) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('invalid user id');
  const [result] = await pool.execute(
    'UPDATE users SET email_verified_at = ? WHERE id = ?',
    [verified ? new Date() : null, id]
  );
  if (!result.affectedRows) throw notFound('User not found');
  return findUserById(id);
}

async function deleteUser(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('invalid user id');
  const [result] = await pool.execute('DELETE FROM users WHERE id = ?', [id]);
  if (!result.affectedRows) throw badRequest('User not found');
  return { ok: true };
}

module.exports = {
  USERNAME_RE,
  isRegisterEnabled,
  publicUser,
  findUserById,
  findUserByUsername,
  findUserByLogin,
  normalizeEmail,
  baseUsernameFromEmail,
  registerUser,
  loginUser,
  refreshSession,
  logoutSession,
  createUserAdmin,
  listUsers,
  setUserActive,
  resetUserPassword,
  revokeUserSessions,
  setEmailVerifiedAdmin,
  deleteUser
};

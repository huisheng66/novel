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
    email: row.email || null
  };
}

async function findUserByUsername(username) {
  const [[row]] = await pool.execute(
    'SELECT id, username, email, password_hash, display_name, is_active FROM users WHERE username = ? LIMIT 1',
    [username]
  );
  return row || null;
}

async function findUserById(id) {
  const [[row]] = await pool.execute(
    'SELECT id, username, email, password_hash, display_name, is_active FROM users WHERE id = ? LIMIT 1',
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

async function registerUser({ username, password, displayName, deviceName, userAgent }) {
  if (!isRegisterEnabled()) {
    throw new ApiError(403, 'REGISTER_DISABLED', 'Registration is disabled');
  }
  const name = String(username || '').trim();
  const pass = String(password || '');
  if (!USERNAME_RE.test(name)) {
    throw badRequest('username must be 3-32 chars: letters, numbers, underscore');
  }
  if (pass.length < 8) {
    throw badRequest('password must be at least 8 characters');
  }

  const passwordHash = await bcrypt.hash(pass, 10);
  const display = String(displayName || name).trim().slice(0, 100) || name;

  try {
    const [result] = await pool.execute(
      `INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)`,
      [name, passwordHash, display]
    );
    const user = {
      id: result.insertId,
      username: name,
      display_name: display,
      email: null,
      is_active: 1
    };
    return createSession(user, { deviceName, userAgent });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      throw conflict('username already exists');
    }
    throw err;
  }
}

async function loginUser({ username, password, deviceName, userAgent }) {
  const name = String(username || '').trim();
  const pass = String(password || '');
  if (!name || !pass) throw badRequest('username and password required');

  const user = await findUserByUsername(name);
  if (!user || !user.is_active) throw unauthorized('Invalid username or password');

  const ok = await bcrypt.compare(pass, user.password_hash);
  if (!ok) throw unauthorized('Invalid username or password');

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
async function createUserAdmin({ username, password, displayName, isActive = true }) {
  const name = String(username || '').trim();
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
      `INSERT INTO users (username, password_hash, display_name, is_active) VALUES (?, ?, ?, ?)`,
      [name, passwordHash, display, active]
    );
    return findUserById(result.insertId);
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
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
    where = 'WHERE username LIKE ? OR display_name LIKE ?';
    const like = `%${keyword}%`;
    params.push(like, like);
  }

  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM users ${where}`,
    params
  );
  const [rows] = await pool.execute(
    `SELECT id, username, email, display_name, is_active, created_at, updated_at
     FROM users
     ${where}
     ORDER BY id DESC
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
      displayName: row.display_name || row.username,
      isActive: Boolean(row.is_active),
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
  registerUser,
  loginUser,
  refreshSession,
  logoutSession,
  createUserAdmin,
  listUsers,
  setUserActive,
  resetUserPassword,
  revokeUserSessions,
  deleteUser
};

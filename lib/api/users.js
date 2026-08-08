const bcrypt = require('bcryptjs');
const { pool } = require('../../db');
const {
  createRefreshToken,
  hashToken,
  signAccessToken,
  refreshExpiresAt
} = require('./tokens');
const { ApiError, badRequest, unauthorized, conflict } = require('./errors');

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

module.exports = {
  isRegisterEnabled,
  publicUser,
  findUserById,
  findUserByUsername,
  registerUser,
  loginUser,
  refreshSession,
  logoutSession
};

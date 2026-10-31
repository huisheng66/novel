// 邮箱令牌与验证开关：一次性、过期、作废、改密清会话。
// 需要数据库，连不上则跳过。

const test = require('node:test');
const assert = require('node:assert/strict');

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const { pool } = require('../db');
const tokens = require('../lib/api/emailTokens');
const emailApi = require('../lib/api/email');
const { registerUser, resetUserPassword, loginUser } = require('../lib/api/users');

let dbAvailable = false;
const createdUserIds = [];

const SKIP = '需要可连接的 MySQL（DB_HOST/DB_USER/DB_PASSWORD），当前连不上，跳过';

function stamp() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function canConnectDb() {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'novel',
      connectTimeout: 3000
    });
    await conn.query('SELECT 1');
    return true;
  } catch (err) {
    return false;
  } finally {
    if (conn) {
      try {
        await conn.end();
      } catch (err) {
        /* ignore */
      }
    }
  }
}

async function makeUser() {
  const reg = await registerUser({
    email: `mail_${stamp()}@example.com`,
    password: 'testpass123'
  });
  createdUserIds.push(reg.user.id);
  return reg;
}

test.before(async () => {
  dbAvailable = await canConnectDb();
});

test.after(async () => {
  if (!dbAvailable) return;
  for (const id of createdUserIds) {
    await pool.execute('DELETE FROM users WHERE id = ?', [id]);
  }
  // 恢复默认开关，避免影响后续用例
  await pool.execute(
    "UPDATE platform_settings SET setting_value = '0' WHERE setting_key IN ('email_verify_required_login','email_verify_required_purchase')"
  );
  emailApi.clearCache();
  await pool.end();
});

/* ===== 令牌 ===== */

test('令牌只存哈希，库里查不到明文', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  const reg = await makeUser();
  const { token } = await tokens.issueToken(reg.user.id, 'verify');

  const [[row]] = await pool.execute(
    'SELECT token_hash FROM email_tokens WHERE user_id = ? AND kind = ?',
    [reg.user.id, 'verify']
  );
  assert.equal(row.token_hash, tokens.hashToken(token));
  assert.notEqual(row.token_hash, token, '不能明文存令牌');
  assert.equal(row.token_hash.length, 64);
});

test('令牌一次性：核销后不能再用', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  const reg = await makeUser();
  const { token } = await tokens.issueToken(reg.user.id, 'reset');

  const userId = await tokens.consumeToken('reset', token);
  assert.equal(userId, reg.user.id);

  await assert.rejects(() => tokens.consumeToken('reset', token), /无效或已被使用/);
});

test('令牌过期后失效', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  const reg = await makeUser();
  const { token } = await tokens.issueToken(reg.user.id, 'verify');

  // 手动把过期时间推到过去
  await pool.execute(
    'UPDATE email_tokens SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE user_id = ? AND kind = ?',
    [reg.user.id, 'verify']
  );

  await assert.rejects(() => tokens.consumeToken('verify', token), /已过期/);
  assert.equal(await tokens.peekToken('verify', token), false);
});

test('签发新令牌会作废同类旧令牌', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  const reg = await makeUser();
  const first = await tokens.issueToken(reg.user.id, 'reset');
  const second = await tokens.issueToken(reg.user.id, 'reset');

  await assert.rejects(() => tokens.consumeToken('reset', first.token), /无效或已被使用/);
  const userId = await tokens.consumeToken('reset', second.token);
  assert.equal(userId, reg.user.id);
});

test('verify 与 reset 令牌互不通用', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  const reg = await makeUser();
  const { token } = await tokens.issueToken(reg.user.id, 'verify');

  await assert.rejects(() => tokens.consumeToken('reset', token), /无效或已被使用/);
  // verify 令牌仍可用
  assert.equal(await tokens.consumeToken('verify', token), reg.user.id);
});

/* ===== 验证状态与开关 ===== */

test('开关关闭时，未验证也放行', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  await pool.execute(
    "UPDATE platform_settings SET setting_value = '0' WHERE setting_key IN ('email_verify_required_login','email_verify_required_purchase')"
  );
  emailApi.clearCache();

  const reg = await makeUser();
  const login = await loginUser({ login: `mail_${stamp()}@example.com`, password: 'x' }).catch(() => null);
  assert.equal(login, null, '错误密码当然登不进去，这里只确认没被验证逻辑拦截');

  const ok = await emailApi.checkVerifiedFor('login', {
    email: reg.user.email,
    email_verified_at: null
  });
  assert.equal(ok.ok, true);
});

test('开关开启后，未验证邮箱被拦下；验证后放行', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  await pool.execute(
    "UPDATE platform_settings SET setting_value = '1' WHERE setting_key = 'email_verify_required_login'"
  );
  emailApi.clearCache();

  const reg = await makeUser();

  // 未验证：登录被拒（403 EMAIL_NOT_VERIFIED）
  await assert.rejects(
    () => loginUser({ login: reg.user.email, password: 'testpass123' }),
    (err) => {
      assert.equal(err.code, 'EMAIL_NOT_VERIFIED');
      assert.equal(err.status, 403);
      return true;
    }
  );

  await emailApi.markVerified(reg.user.id);

  const session = await loginUser({ login: reg.user.email, password: 'testpass123' });
  assert.equal(session.user.id, reg.user.id);

  await pool.execute(
    "UPDATE platform_settings SET setting_value = '0' WHERE setting_key = 'email_verify_required_login'"
  );
  emailApi.clearCache();
});

test('没有邮箱的账号不受验证开关影响', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  const result = await emailApi.checkVerifiedFor('purchase', { email: null, email_verified_at: null });
  assert.equal(result.ok, true);
});

/* ===== 改密 ===== */

test('重置密码会清掉所有会话，旧密码立即失效', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  const reg = await makeUser();
  const [[sessionCount]] = await pool.execute(
    'SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = ?',
    [reg.user.id]
  );
  assert.ok(Number(sessionCount.n) > 0, '注册后应有一个会话');

  await resetUserPassword(reg.user.id, 'brandnew123');

  const [[after]] = await pool.execute(
    'SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = ?',
    [reg.user.id]
  );
  assert.equal(Number(after.n), 0, '改密后会话必须全部失效');

  const [[pw]] = await pool.execute('SELECT password_hash FROM users WHERE id = ?', [reg.user.id]);
  assert.ok(await bcrypt.compare('brandnew123', pw.password_hash));
  assert.ok(!(await bcrypt.compare('testpass123', pw.password_hash)));
});

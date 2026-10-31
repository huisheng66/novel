// 邮箱注册 / 邀请码可选 / 登录标识
const test = require('node:test');
const assert = require('node:assert/strict');

const mysql = require('mysql2/promise');
const { pool } = require('../db');
const {
  normalizeEmail,
  baseUsernameFromEmail,
  registerUser,
  loginUser,
  USERNAME_RE
} = require('../lib/api/users');
const { ApiError } = require('../lib/api/errors');

let dbAvailable = false;
const createdUserIds = [];
const createdInviteIds = [];

const SKIP = '需要可连接的 MySQL（DB_HOST/DB_USER/DB_PASSWORD），当前连不上，跳过';

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

function stamp() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

test.before(async () => {
  dbAvailable = await canConnectDb();
});

test.after(async () => {
  if (!dbAvailable) return;
  for (const id of createdUserIds) {
    await pool.execute('DELETE FROM users WHERE id = ?', [id]);
  }
  for (const id of createdInviteIds) {
    await pool.execute('DELETE FROM invite_codes WHERE id = ?', [id]);
  }
  await pool.end();
});

/* ===== 邮箱校验与用户名推导（纯函数） ===== */

test('normalizeEmail：去空格、转小写', () => {
  assert.equal(normalizeEmail('  Alice@Example.COM '), 'alice@example.com');
});

test('normalizeEmail：空值返回空串（表示未提供）', () => {
  assert.equal(normalizeEmail(''), '');
  assert.equal(normalizeEmail(null), '');
  assert.equal(normalizeEmail(undefined), '');
});

test('normalizeEmail：明显不合法的邮箱抛 400', () => {
  for (const bad of ['abc', 'a@b', 'a b@c.com', '@example.com', 'a@.com', `${'x'.repeat(65)}@a.com`]) {
    assert.throws(() => normalizeEmail(bad), (err) => err instanceof ApiError && err.status === 400, `应拒绝 ${bad}`);
  }
});

test('baseUsernameFromEmail：生成合法用户名', () => {
  assert.equal(baseUsernameFromEmail('alice@example.com'), 'alice');
  assert.equal(baseUsernameFromEmail('li.lei+tag@example.com'), 'li_lei_tag');
  assert.equal(baseUsernameFromEmail('ab@example.com'), 'reader', '过短回退为 reader');
  assert.ok(USERNAME_RE.test(baseUsernameFromEmail('张三@example.com')), '中文邮箱前缀也要产出合法用户名');
});

/* ===== 注册 ===== */

test('邮箱注册不需要邀请码，用户名自动生成', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  const email = `reg_${stamp()}@example.com`;
  const result = await registerUser({ email, password: 'testpass123' });
  createdUserIds.push(result.user.id);

  assert.equal(result.user.email, email);
  assert.ok(USERNAME_RE.test(result.user.username), '自动用户名必须合法');
  assert.equal(result.user.displayName, email.split('@')[0], '显示名默认取邮箱前缀');
  assert.ok(result.accessToken && result.refreshToken);
});

test('同一邮箱重复注册被拒，且错误信息指向邮箱', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  const email = `dup_${stamp()}@example.com`;
  const first = await registerUser({ email, password: 'testpass123' });
  createdUserIds.push(first.user.id);

  await assert.rejects(
    () => registerUser({ email, password: 'testpass123' }),
    (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 409);
      assert.match(err.message, /邮箱已注册/);
      return true;
    }
  );

  // 大小写/空格不应绕过
  await assert.rejects(
    () => registerUser({ email: `  ${email.toUpperCase()}  `, password: 'testpass123' }),
    (err) => /邮箱已注册/.test(err.message)
  );
});

test('填了邀请码就必须有效，无效码拒绝注册', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  const email = `badinv_${stamp()}@example.com`;
  await assert.rejects(
    () => registerUser({ email, password: 'testpass123', inviteCode: 'INV-NOTEXIST' }),
    (err) => /邀请码/.test(err.message)
  );

  // 失败时不能残留账号
  const [[row]] = await pool.execute('SELECT COUNT(*) AS n FROM users WHERE email = ?', [email]);
  assert.equal(Number(row.n), 0, '注册失败不能留下半截账号');
});

test('有效邀请码注册后被核销并绑定到该用户', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  const code = `INV-${stamp().toUpperCase().slice(0, 8)}`;
  const [ins] = await pool.execute('INSERT INTO invite_codes (code, note) VALUES (?, ?)', [code, 'reg-test']);
  createdInviteIds.push(ins.insertId);

  const email = `inv_${stamp()}@example.com`;
  const result = await registerUser({ email, password: 'testpass123', inviteCode: code });
  createdUserIds.push(result.user.id);

  const [[used]] = await pool.execute(
    'SELECT used_at, used_by_user_id FROM invite_codes WHERE id = ?',
    [ins.insertId]
  );
  assert.ok(used.used_at, '邀请码应被标记已使用');
  assert.equal(Number(used.used_by_user_id), result.user.id);

  // 同一个码不能再用
  await assert.rejects(
    () => registerUser({ email: `inv2_${stamp()}@example.com`, password: 'testpass123', inviteCode: code }),
    (err) => /已被使用/.test(err.message)
  );
});

/* ===== 登录标识 ===== */

test('可以用邮箱登录', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  const email = `login_${stamp()}@example.com`;
  const reg = await registerUser({ email, password: 'testpass123' });
  createdUserIds.push(reg.user.id);

  const byEmail = await loginUser({ login: email, password: 'testpass123' });
  assert.equal(byEmail.user.id, reg.user.id);

  // 大小写不敏感
  const upper = await loginUser({ login: email.toUpperCase(), password: 'testpass123' });
  assert.equal(upper.user.id, reg.user.id);

  // 也可以用自动生成的用户名登录
  const byName = await loginUser({ username: reg.user.username, password: 'testpass123' });
  assert.equal(byName.user.id, reg.user.id);
});

test('密码错误时都返回同一条错误（不泄露账号是否存在）', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  const email = `wrong_${stamp()}@example.com`;
  const reg = await registerUser({ email, password: 'testpass123' });
  createdUserIds.push(reg.user.id);

  const existing = await loginUser({ login: email, password: 'bad-password' }).catch(e => e);
  const missing = await loginUser({ login: `nobody_${stamp()}@example.com`, password: 'bad-password' }).catch(e => e);

  assert.equal(existing.message, missing.message);
});

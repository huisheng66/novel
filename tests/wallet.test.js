// 钱包与购买：纯逻辑 + 真实数据库（不可用时跳过）。
// 重点验证「钱与章的原子性」：余额不足不产生订单、重复购买不重复扣费、并发不超额扣款。

const test = require('node:test');
const assert = require('node:assert/strict');

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const { pool } = require('../db');
const wallet = require('../lib/api/wallet');
const purchases = require('../lib/api/purchases');
const { createCodes } = require('../lib/api/recharge');
const paywall = require('../lib/paywall');
const { ApiError } = require('../lib/api/errors');

let dbAvailable = false;
let userId = null;
let novelId = null;

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

test.before(async () => {
  dbAvailable = await canConnectDb();
  if (!dbAvailable) return;

  const hash = await bcrypt.hash('testpass123', 10);
  const [ins] = await pool.execute(
    'INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)',
    [`t_${Date.now().toString(36)}`, hash, '钱包测试']
  );
  userId = ins.insertId;

  const [novelIns] = await pool.execute(
    'INSERT INTO novels (title, author, description) VALUES (?, ?, ?)',
    [`付费测试书 ${Date.now()}`, '测试', '临时数据，测试结束即删']
  );
  novelId = novelIns.insertId;

  for (let i = 1; i <= 3; i += 1) {
    await pool.execute(
      'INSERT INTO chapters (novel_id, chapter_number, title, content, content_hash) VALUES (?, ?, ?, ?, ?)',
      [novelId, i, `第${i}章`, `这是第 ${i} 章的正文内容。`, `h${i}-${novelId}`]
    );
  }

  // 前 1 章免费，其余每章 10 分
  await pool.execute(
    'INSERT INTO novel_paywall (novel_id, enabled, free_until_chapter, price_per_chapter) VALUES (?, 1, 1, 10)',
    [novelId]
  );
  paywall.clearCache(novelId);
});

test.after(async () => {
  if (!dbAvailable) return;
  if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
  if (novelId) await pool.execute('DELETE FROM novels WHERE id = ?', [novelId]);
  await pool.end();
});

/* ===== 金额参数校验（不需要数据库） ===== */

test('金额必须是非零整数（分）', () => {
  assert.equal(wallet.toAmount(100), 100);
  assert.throws(() => wallet.toAmount(0), /非零整数/);
  assert.throws(() => wallet.toAmount('abc'), /非零整数/);
  assert.throws(() => wallet.toAmount(null), /非零整数/);
});

/* ===== 钱包 ===== */

test('充值后余额与流水一致', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  const result = await wallet.applyDelta(userId, 500, { type: 'recharge', note: '测试充值' });
  assert.equal(result.balance, 500);

  const w = await wallet.getWallet(userId);
  assert.equal(w.balance, 500);

  const txs = await wallet.listTransactions(userId);
  assert.equal(txs[0].delta, 500);
  assert.equal(txs[0].balanceAfter, 500);
});

test('余额不足时扣款被拒，且不产生流水', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  const before = (await wallet.getWallet(userId)).balance;
  const txBefore = (await wallet.listTransactions(userId, { limit: 100 })).length;

  await assert.rejects(
    () => wallet.applyDelta(userId, -(before + 1), { type: 'purchase' }),
    (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 402);
      assert.equal(err.code, 'INSUFFICIENT_BALANCE');
      return true;
    }
  );

  assert.equal((await wallet.getWallet(userId)).balance, before, '余额不能变');
  assert.equal((await wallet.listTransactions(userId, { limit: 100 })).length, txBefore, '不能留下流水');
});

test('兑换码只能使用一次，且金额到账', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  const [created] = await createCodes({ count: 1, amount: 200, note: 'wallet-test' });
  const before = (await wallet.getWallet(userId)).balance;

  const result = await wallet.redeemCode(userId, created.code);
  assert.equal(result.amount, 200);
  assert.equal(result.balance, before + 200);

  await assert.rejects(() => wallet.redeemCode(userId, created.code), /已被使用/);
  assert.equal((await wallet.getWallet(userId)).balance, before + 200, '重复兑换不能再次加钱');

  await assert.rejects(() => wallet.redeemCode(userId, 'RC-NOTEXIST'), /无效/);

  await pool.execute('DELETE FROM recharge_codes WHERE id = ?', [created.id]);
});

test('新充值码为 42 位长随机格式（160 位熵），且容错输入可兑换', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  const [created] = await createCodes({ count: 1, amount: 500, note: 'long-code-test' });

  assert.equal(created.code.length, 42, `长度应为 42，实际 ${created.code.length}`);
  assert.ok(/^RC-[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/.test(created.code), '应为 RC- 分组 base32 格式');
  assert.ok(!/[0-1]/.test(created.code.slice(3)), 'base32 不含 0/1，避免人工抄写歧义');

  const before = (await wallet.getWallet(userId)).balance;

  // 容错：小写 + 连字符去掉 + 前后空格，都应能兑换
  const sloppy = '  ' + created.code.toLowerCase().replace(/-/g, ' ') + '  ';
  const result = await wallet.redeemCode(userId, sloppy);
  assert.equal(result.amount, 500);
  assert.equal(result.balance, before + 500);

  await pool.execute('DELETE FROM recharge_codes WHERE id = ?', [created.id]);
});

test('旧短码与无前缀 8 hex 输入都能归一化（存量码兼容）', async (t) => {
  const { normalizeCode } = require('../lib/api/recharge');
  assert.equal(normalizeCode('rc-ab12cd34'), 'RC-AB12CD34');
  assert.equal(normalizeCode(' AB12CD34 '), 'RC-AB12CD34');
  assert.equal(normalizeCode('RC-AB12-CD34'), 'RC-AB12CD34', '连字符应被剥离');
});

/* ===== 购买 ===== */

test('免费章节不能购买', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);
  await assert.rejects(() => purchases.purchaseChapter(userId, novelId, 1), /无需购买/);
});

test('余额不足时不产生订单', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  // 把钱花光
  const balance = (await wallet.getWallet(userId)).balance;
  if (balance > 0) await wallet.applyDelta(userId, -balance, { type: 'adjust', note: '清空' });

  await assert.rejects(
    () => purchases.purchaseChapter(userId, novelId, 2),
    (err) => err.code === 'INSUFFICIENT_BALANCE'
  );

  const [[row]] = await pool.execute(
    'SELECT COUNT(*) AS n FROM chapter_orders WHERE user_id = ? AND novel_id = ?',
    [userId, novelId]
  );
  assert.equal(Number(row.n), 0, '失败不能留下订单');
});

test('购买成功扣款并记录订单，重复购买幂等', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  await wallet.applyDelta(userId, 100, { type: 'recharge', note: '测试充值' });
  const before = (await wallet.getWallet(userId)).balance;

  const first = await purchases.purchaseChapter(userId, novelId, 2);
  assert.equal(first.alreadyOwned, false);
  assert.equal(first.amount, 10, '单价取书籍规则');
  assert.equal(first.balance, before - 10);

  const second = await purchases.purchaseChapter(userId, novelId, 2);
  assert.equal(second.alreadyOwned, true);
  assert.equal(second.amount, 0);
  assert.equal((await wallet.getWallet(userId)).balance, before - 10, '重复购买不能再次扣费');

  const list = await purchases.listPurchases(userId, novelId);
  assert.equal(list.length, 1);
  assert.equal(list[0].chapterNumber, 2);
});

test('并发购买同一章只扣一次钱', async (t) => {
  if (!dbAvailable) return t.skip(SKIP);

  const before = (await wallet.getWallet(userId)).balance;
  if (before < 50) await wallet.applyDelta(userId, 100, { type: 'recharge', note: '补足' });
  const start = (await wallet.getWallet(userId)).balance;

  const results = await Promise.allSettled([
    purchases.purchaseChapter(userId, novelId, 3),
    purchases.purchaseChapter(userId, novelId, 3),
    purchases.purchaseChapter(userId, novelId, 3)
  ]);

  const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  assert.equal(ok.length, 3, '并发请求都应成功返回（幂等）');
  assert.equal(ok.filter(r => !r.alreadyOwned).length, 1, '只有一次真正扣款');

  const after = (await wallet.getWallet(userId)).balance;
  assert.equal(after, start - 10, '三次并发只扣一章的钱');

  const [[row]] = await pool.execute(
    'SELECT COUNT(*) AS n FROM chapter_orders WHERE user_id = ? AND novel_id = ? AND chapter_number = 3',
    [userId, novelId]
  );
  assert.equal(Number(row.n), 1);
});

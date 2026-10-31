// 钱包：余额、流水、兑换码充值。
//
// 金额统一以「分」存储，与 chapters.price / novel_paywall.price_per_chapter 一致。
// 所有余额变动都在事务里 `SELECT ... FOR UPDATE` 后写入，并留一条 wallet_transactions，
// 便于对账与排查「扣了钱没给章」。

const { pool } = require('../../db');
const { ApiError, badRequest } = require('./errors');

const MAX_TRANSACTIONS = 100;

function toAmount(value) {
  const n = Math.trunc(Number(value));
  if (!Number.isInteger(n) || n === 0) throw badRequest('金额必须是非零整数（分）');
  return n;
}

async function getWallet(userId) {
  if (!userId) throw badRequest('userId required');
  await pool.execute('INSERT IGNORE INTO user_wallets (user_id, balance) VALUES (?, 0)', [userId]);
  const [[row]] = await pool.execute(
    'SELECT balance, updated_at FROM user_wallets WHERE user_id = ? LIMIT 1',
    [userId]
  );
  return {
    balance: Number(row && row.balance) || 0,
    updatedAt: row ? row.updated_at : null
  };
}

async function listTransactions(userId, { limit = 20 } = {}) {
  const size = Math.min(Math.max(Number(limit) || 20, 1), MAX_TRANSACTIONS);
  const [rows] = await pool.execute(
    `SELECT id, delta, balance_after, type, ref, note, created_at
     FROM wallet_transactions WHERE user_id = ?
     ORDER BY id DESC LIMIT ${size}`,
    [userId]
  );
  return rows.map(row => ({
    id: row.id,
    delta: Number(row.delta),
    balanceAfter: Number(row.balance_after),
    type: row.type,
    ref: row.ref || null,
    note: row.note || null,
    createdAt: row.created_at
  }));
}

/**
 * 余额变动（正数入账、负数出账）。余额不足时抛 402。
 * @returns {Promise<{balance:number, delta:number}>}
 */
async function applyDelta(userId, delta, { type, ref = null, note = null } = {}) {
  if (!userId) throw badRequest('userId required');
  const amount = toAmount(delta);

  // 钱包行必须在事务**外**确保存在：
  // 事务内 INSERT IGNORE 已存在的行会取共享锁，并发时多个事务各自持 S 锁再升级为 X 锁，直接死锁。
  await pool.execute('INSERT IGNORE INTO user_wallets (user_id, balance) VALUES (?, 0)', [userId]);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[wallet]] = await conn.execute(
      'SELECT balance FROM user_wallets WHERE user_id = ? FOR UPDATE',
      [userId]
    );
    const before = Number(wallet && wallet.balance) || 0;
    const after = before + amount;

    if (after < 0) {
      throw new ApiError(402, 'INSUFFICIENT_BALANCE', '余额不足', {
        balance: before,
        required: -amount
      });
    }

    await conn.execute('UPDATE user_wallets SET balance = ? WHERE user_id = ?', [after, userId]);
    await conn.execute(
      `INSERT INTO wallet_transactions (user_id, delta, balance_after, type, ref, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, amount, after, type || 'adjust', ref, note]
    );

    await conn.commit();
    return { balance: after, delta: amount };
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
 * 兑换码充值。整段在一个事务里完成：核销码 → 加余额 → 记流水，
 * 避免「码被标记已用但钱没到账」。
 */
async function redeemCode(userId, rawCode) {
  if (!userId) throw badRequest('userId required');
  const { normalizeCode } = require('./recharge');
  const code = normalizeCode(rawCode);
  if (!code) throw badRequest('请输入兑换码');

  // 同 applyDelta：钱包行在事务外建好，避免事务内 INSERT IGNORE 造成锁升级死锁
  await pool.execute('INSERT IGNORE INTO user_wallets (user_id, balance) VALUES (?, 0)', [userId]);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      `SELECT id, amount, used_at, expires_at FROM recharge_codes
       WHERE code = ? FOR UPDATE`,
      [code]
    );
    const row = rows[0];
    if (!row) throw badRequest('兑换码无效');
    if (row.used_at) throw badRequest('兑换码已被使用');
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
      throw badRequest('兑换码已过期');
    }

    const [mark] = await conn.execute(
      'UPDATE recharge_codes SET used_at = NOW(), used_by_user_id = ? WHERE id = ? AND used_at IS NULL',
      [userId, row.id]
    );
    if (mark.affectedRows !== 1) throw badRequest('兑换码已被使用');

    const [[wallet]] = await conn.execute(
      'SELECT balance FROM user_wallets WHERE user_id = ? FOR UPDATE',
      [userId]
    );
    const amount = Number(row.amount) || 0;
    const after = (Number(wallet && wallet.balance) || 0) + amount;

    await conn.execute('UPDATE user_wallets SET balance = ? WHERE user_id = ?', [after, userId]);
    await conn.execute(
      `INSERT INTO wallet_transactions (user_id, delta, balance_after, type, ref, note)
       VALUES (?, ?, ?, 'recharge', ?, ?)`,
      [userId, amount, after, `code:${row.id}`, '兑换码充值']
    );

    await conn.commit();
    return { amount, balance: after };
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

/** 后台直接加/减余额（客服补偿、内部测试） */
async function adminAdjust(userId, amount, note) {
  const cents = Math.trunc(Number(amount)) || 0;
  if (!Number.isInteger(cents) || cents === 0) throw badRequest('金额必须是非零整数（分）');
  return applyDelta(userId, cents, { type: 'admin', note: note || '后台调整' });
}

module.exports = {
  getWallet,
  listTransactions,
  applyDelta,
  redeemCode,
  adminAdjust,
  toAmount
};

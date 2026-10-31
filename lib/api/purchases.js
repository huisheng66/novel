// 章节购买：扣款与发章的原子性都在这里。
//
// 关键点：
// - 已购幂等：重复请求不重复扣费（先查订单，再用唯一键兜底并发）
// - 余额不足直接 402，不产生订单残留
// - 价格取自 paywall 规则（按章覆盖优先），与试读页展示的价格同源

const { pool } = require('../../db');
const { ApiError, badRequest, notFound } = require('./errors');
const { getChapterRule } = require('../paywall');
const { listPurchasedChapters } = require('./entitlements');

const DEADLOCK_CODES = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);
const MAX_ATTEMPTS = 3;

/**
 * 购买单章（带死锁重试）。
 * 金额相关的写路径必须能扛住 InnoDB 死锁/锁等待：重试是幂等的（已购会被识别），
 * 比把 500 抛给用户好得多。
 */
async function purchaseChapter(userId, novelId, chapterNumber) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await purchaseChapterOnce(userId, novelId, chapterNumber);
    } catch (err) {
      lastErr = err;
      if (!err || !DEADLOCK_CODES.has(err.code) || attempt === MAX_ATTEMPTS) throw err;
    }
  }
  throw lastErr;
}

async function purchaseChapterOnce(userId, novelId, chapterNumber) {
  if (!userId) throw badRequest('需要登录后才能购买');
  const id = Number(novelId);
  const num = Number(chapterNumber);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('novelId required');
  if (!Number.isInteger(num) || num <= 0) throw badRequest('chapterNumber required');

  const { checkVerifiedFor } = require('./email');
  const [[buyer]] = await pool.execute(
    'SELECT email, email_verified_at FROM users WHERE id = ? LIMIT 1',
    [userId]
  );
  const verified = await checkVerifiedFor('purchase', buyer);
  if (!verified.ok) {
    throw new ApiError(403, 'EMAIL_NOT_VERIFIED', '请先验证邮箱后再购买');
  }

  const [[chapter]] = await pool.execute(
    'SELECT id FROM chapters WHERE novel_id = ? AND chapter_number = ? LIMIT 1',
    [id, num]
  );
  if (!chapter) throw notFound('Chapter not found');

  const info = await getChapterRule(id, num);
  if (!info.paid) throw badRequest('该章无需购买');

  const price = Number(info.price) || 0;

  // 钱包行在事务外确保存在：事务内 INSERT IGNORE 会取共享锁，并发下容易与
  // 「SELECT ... FOR UPDATE」的 X 锁互相升级成死锁（实测三并发必现一次）。
  await pool.execute('INSERT IGNORE INTO user_wallets (user_id, balance) VALUES (?, 0)', [userId]);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[wallet]] = await conn.execute(
      'SELECT balance FROM user_wallets WHERE user_id = ? FOR UPDATE',
      [userId]
    );
    const balance = Number(wallet && wallet.balance) || 0;

    const [[owned]] = await conn.execute(
      `SELECT 1 FROM chapter_orders
       WHERE user_id = ? AND novel_id = ? AND chapter_number = ? LIMIT 1`,
      [userId, id, num]
    );
    if (owned) {
      await conn.commit();
      return { alreadyOwned: true, amount: 0, balance, chapterNumber: num };
    }

    if (balance < price) {
      throw new ApiError(402, 'INSUFFICIENT_BALANCE', '余额不足，请先充值', {
        balance,
        required: price,
        shortfall: price - balance
      });
    }

    try {
      await conn.execute(
        `INSERT INTO chapter_orders (user_id, novel_id, chapter_number, amount, channel)
         VALUES (?, ?, ?, ?, 'wallet')`,
        [userId, id, num, price]
      );
    } catch (err) {
      // 并发下另一个请求已下单：回滚（此时还没扣款），按已购处理
      if (err && err.code === 'ER_DUP_ENTRY') {
        await conn.rollback();
        return { alreadyOwned: true, amount: 0, balance, chapterNumber: num };
      }
      throw err;
    }

    const after = balance - price;
    if (price > 0) {
      await conn.execute('UPDATE user_wallets SET balance = ? WHERE user_id = ?', [after, userId]);
      await conn.execute(
        `INSERT INTO wallet_transactions (user_id, delta, balance_after, type, ref, note)
         VALUES (?, ?, ?, 'purchase', ?, ?)`,
        [userId, -price, after, `chapter:${id}:${num}`, `购买第 ${num} 章`]
      );
    }

    await conn.commit();
    return { alreadyOwned: false, amount: price, balance: after, chapterNumber: num };
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

async function listPurchases(userId, novelId) {
  if (!userId) throw badRequest('userId required');
  if (novelId) return listPurchasedChapters(userId, Number(novelId));

  const [rows] = await pool.execute(
    `SELECT novel_id, chapter_number, amount, created_at FROM chapter_orders
     WHERE user_id = ? ORDER BY id DESC LIMIT 200`,
    [userId]
  );
  return rows.map(row => ({
    novelId: Number(row.novel_id),
    chapterNumber: Number(row.chapter_number),
    amount: Number(row.amount) || 0,
    purchasedAt: row.created_at
  }));
}

module.exports = {
  purchaseChapter,
  listPurchases
};

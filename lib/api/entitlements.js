// 章节阅读权益：判断某个读者是否有权读某一章。
//
// 目前权益来源只有「已购买」（chapter_orders）。钱包/支付在下一阶段接入，
// 但判定链路先打通，届时只需往 chapter_orders 写行即可。
// 会员订阅以后同理：在这里加一条 or 条件。

const { pool } = require('../../db');
const { getChapterRule, teaserOf } = require('../paywall');

async function hasOrder(userId, novelId, chapterNumber) {
  if (!userId) return false;
  const [[row]] = await pool.execute(
    `SELECT 1 FROM chapter_orders
     WHERE user_id = ? AND novel_id = ? AND chapter_number = ? LIMIT 1`,
    [userId, novelId, chapterNumber]
  );
  return Boolean(row);
}

/**
 * 判定读某一章的权益。
 *
 * @param {object} input
 * @param {number|null} input.userId 已登录读者；匿名或仅持站点令牌时为 null
 * @param {number} input.novelId
 * @param {number} input.chapterNumber
 * @returns {Promise<{paid:boolean, allowed:boolean, price:number, reason:string, rule:object}>}
 */
async function getChapterAccess({ userId, novelId, chapterNumber }) {
  const info = await getChapterRule(novelId, chapterNumber);

  if (!info.paid) {
    return { paid: false, allowed: true, price: 0, reason: 'free', rule: info.rule };
  }

  if (await hasOrder(userId, novelId, chapterNumber)) {
    return { paid: true, allowed: true, price: info.price, reason: 'purchased', rule: info.rule };
  }

  return {
    paid: true,
    allowed: false,
    price: info.price,
    reason: 'payment_required',
    rule: info.rule
  };
}

/** 已购章节列表（客户端用于显示「已解锁」） */
async function listPurchasedChapters(userId, novelId) {
  if (!userId) return [];
  const [rows] = await pool.execute(
    `SELECT chapter_number, amount, created_at FROM chapter_orders
     WHERE user_id = ? AND novel_id = ? ORDER BY chapter_number ASC`,
    [userId, novelId]
  );
  return rows.map(row => ({
    chapterNumber: Number(row.chapter_number),
    amount: Number(row.amount) || 0,
    purchasedAt: row.created_at
  }));
}

module.exports = {
  getChapterAccess,
  hasOrder,
  listPurchasedChapters,
  teaserOf
};

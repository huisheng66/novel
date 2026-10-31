// 付费分层：规则矩阵 + 缓存失效契约。
// 重点是「可能收费的章节不得进缓存」这条 —— 它是付费内容不泄露的前提。

const test = require('node:test');
const assert = require('node:assert/strict');

const mysql = require('mysql2/promise');
const paywall = require('../lib/paywall');
const cache = require('../lib/memoryCache');
const { pool } = require('../db');

const RULE_ON = { enabled: true, freeUntil: 20, price: 10 };
const RULE_OFF = { enabled: false, freeUntil: 0, price: 0 };

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

/* ===== 纯函数：是否收费 ===== */

test('未启用付费时任何章节都免费', () => {
  assert.equal(paywall.isChapterPaid({ chapterNumber: 999, chapterIsFree: null, rule: RULE_OFF }), false);
  assert.equal(paywall.isChapterPaid({ chapterNumber: 999, chapterIsFree: 0, rule: RULE_OFF }), false);
});

test('章号边界：等于免费章数算免费，超出才算付费', () => {
  const at = n => paywall.isChapterPaid({ chapterNumber: n, chapterIsFree: null, rule: RULE_ON });
  assert.equal(at(1), false);
  assert.equal(at(20), false, '第 20 章仍在免费区间');
  assert.equal(at(21), true);
  assert.equal(at(2284), true);
});

test('按章覆盖优先于区间规则', () => {
  // 区间内但显式标付费
  assert.equal(paywall.isChapterPaid({ chapterNumber: 5, chapterIsFree: 0, rule: RULE_ON }), true);
  // 区间外但显式标免费
  assert.equal(paywall.isChapterPaid({ chapterNumber: 99, chapterIsFree: 1, rule: RULE_ON }), false);
  // MySQL TINYINT 可能是 0/1 也可能是布尔
  assert.equal(paywall.isChapterPaid({ chapterNumber: 5, chapterIsFree: false, rule: RULE_ON }), true);
  assert.equal(paywall.isChapterPaid({ chapterNumber: 99, chapterIsFree: true, rule: RULE_ON }), false);
});

test('价格为 0 表示「需解锁但不计价」而不是免费', () => {
  const rule = { enabled: true, freeUntil: 0, price: 0 };
  assert.equal(paywall.isChapterPaid({ chapterNumber: 1, chapterIsFree: null, rule }), true);
  assert.equal(paywall.priceOf({ chapterPrice: null, rule }), 0);
});

test('单章价格覆盖书籍单价', () => {
  assert.equal(paywall.priceOf({ chapterPrice: 25, rule: RULE_ON }), 25);
  assert.equal(paywall.priceOf({ chapterPrice: null, rule: RULE_ON }), 10);
  assert.equal(paywall.priceOf({ chapterPrice: 0, rule: RULE_ON }), 0, '显式 0 元也应按 0 处理');
});

test('负价与非法价一律归零', () => {
  assert.equal(paywall.priceOf({ chapterPrice: -5, rule: RULE_ON }), 0);
  assert.equal(paywall.priceOf({ chapterPrice: 'abc', rule: RULE_ON }), 0);
});

/* ===== 纯函数：缓存快路径的放行判定（防泄露的关键开关） ===== */

test('mayBePaid：区间外返回 true（必须走付费分支、不得读写缓存）', () => {
  assert.equal(paywall.mayBePaid(RULE_ON, 21, new Map()), true);
  assert.equal(paywall.mayBePaid(RULE_ON, 20, new Map()), false);
});

test('mayBePaid：区间内被单独标付费的章节同样要拦下来', () => {
  const overrides = new Map([[5, { isFree: 0, price: null }]]);
  assert.equal(paywall.mayBePaid(RULE_ON, 5, overrides), true, '否则这一章会被缓存后泄露');
});

test('mayBePaid：区间外被单独标免费的章节可以走缓存', () => {
  const overrides = new Map([[30, { isFree: 1, price: null }]]);
  assert.equal(paywall.mayBePaid(RULE_ON, 30, overrides), false);
});

test('mayBePaid：未启用付费时永远走缓存', () => {
  assert.equal(paywall.mayBePaid(RULE_OFF, 9999, new Map()), false);
});

/* ===== 试读与展示 ===== */

test('teaserOf 截断并保留可读性', () => {
  const long = '字'.repeat(1000);
  const teaser = paywall.teaserOf(long, 400);
  assert.equal(teaser.length, 400 + '……'.length, '400 字 + 省略号');
  assert.ok(teaser.endsWith('……'));
  assert.equal(paywall.teaserOf('短内容', 400), '短内容');
  assert.equal(paywall.teaserOf('', 400), '');
});

test('formatPrice 分转元', () => {
  assert.equal(paywall.formatPrice(10), '0.10');
  assert.equal(paywall.formatPrice(1999), '19.99');
  assert.equal(paywall.formatPrice(0), '0.00');
});

/* ===== 缓存失效契约 ===== */

test('clearCache 必须同时清掉章节 HTML 缓存（否则已缓存的免费章改付费后会漏出）', () => {
  cache.set('html:chapter:1:3:example.com', '<html>付费正文');
  cache.set('html:novel:1:example.com', '<html>目录');
  cache.set('paywall:novel:1', { row: null });

  paywall.clearCache(1);

  assert.equal(cache.get('html:chapter:1:3:example.com'), null, '章节 HTML 缓存必须失效');
  assert.equal(cache.get('html:novel:1:example.com'), null, '目录页的付费标记也要失效');
  assert.equal(cache.get('paywall:novel:1'), null, '规则缓存要失效');
});

/* ===== 需要数据库：规则解析 ===== */

test('resolveRule：没有书籍配置时继承全局默认', async (t) => {
  if (!await canConnectDb()) return t.skip('需要 MySQL');

  const [[novel]] = await pool.execute('SELECT id FROM novels ORDER BY id LIMIT 1');
  if (!novel) return t.skip('库里没有小说');

  // 保证这本书没有单独配置
  const [[existing]] = await pool.execute('SELECT novel_id FROM novel_paywall WHERE novel_id = ?', [novel.id]);
  if (existing) return t.skip('该小说已有付费配置，跳过以免影响线上设置');

  paywall.clearCache(novel.id);
  const rule = await paywall.resolveRule(novel.id);

  const settings = await paywall.getSettings();
  assert.equal(rule.source, 'default');
  assert.equal(rule.enabled, settings.enabled);
  assert.equal(rule.freeUntil, settings.defaultFreeUntil);
});

test.after(() => pool.end());

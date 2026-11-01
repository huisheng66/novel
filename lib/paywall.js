// 付费分层规则：免费到第几章、单章多少钱，全部可后台调整。
//
// 关键设计：规则**按书实时解析**，不把 is_free 写回每一行章节。
// 后台把「前 20 章免费」改成「前 30 章免费」应当立即生效，
// 而不是去改几千行 chapters（那既慢又容易与实际脱节）。
//
// chapters.is_free / price 是「按章覆盖」：NULL = 跟随书籍规则。

const { pool } = require('../db');
const cache = require('./memoryCache');

const SETTINGS_CACHE_KEY = 'paywall:settings';
const SETTINGS_TTL_MS = 30 * 1000;
const NOVEL_TTL_MS = 30 * 1000;

const SETTING_KEYS = [
  'paywall_enabled',
  'paywall_default_free_until',
  'paywall_default_price',
  'paywall_hide_from_source'
];

function novelCacheKey(novelId) {
  return `paywall:novel:${novelId}`;
}

function overridesCacheKey(novelId) {
  return `paywall:overrides:${novelId}`;
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** 全局默认（platform_settings） */
async function getSettings() {
  const cached = cache.get(SETTINGS_CACHE_KEY);
  if (cached) return cached;

  const [rows] = await pool.execute(
    `SELECT setting_key, setting_value FROM platform_settings
     WHERE setting_key IN (${SETTING_KEYS.map(() => '?').join(',')})`,
    SETTING_KEYS
  );
  const map = {};
  for (const row of rows) map[row.setting_key] = row.setting_value;

  const settings = {
    enabled: map.paywall_enabled === '1',
    defaultFreeUntil: toCount(map.paywall_default_free_until),
    defaultPrice: toCount(map.paywall_default_price),
    // 默认隐藏：付费书留在书源里反而会把读者赶走（目录有章节、正文抓不到）
    hideFromSource: map.paywall_hide_from_source !== '0'
  };

  cache.set(SETTINGS_CACHE_KEY, settings, SETTINGS_TTL_MS);
  return settings;
}

async function getNovelRow(novelId) {
  const key = novelCacheKey(novelId);
  const hit = cache.get(key);
  if (hit) return hit.row;

  const [[row]] = await pool.execute(
    `SELECT novel_id, enabled, free_until_chapter, price_per_chapter, unlock_full_price
     FROM novel_paywall WHERE novel_id = ? LIMIT 1`,
    [novelId]
  );
  cache.set(key, { row: row || null }, NOVEL_TTL_MS);
  return row || null;
}

/**
 * 解析某本书的有效规则：书籍级配置优先，没有则用全局默认。
 * @returns {Promise<{novelId:number, enabled:boolean, freeUntil:number, price:number, unlockFullPrice:number|null, source:'novel'|'default'}>}
 */
async function resolveRule(novelId) {
  const settings = await getSettings();
  const row = await getNovelRow(novelId);

  if (!row) {
    return {
      novelId: Number(novelId),
      enabled: settings.enabled,
      freeUntil: settings.defaultFreeUntil,
      price: settings.defaultPrice,
      unlockFullPrice: null,
      source: 'default'
    };
  }

  return {
    novelId: Number(novelId),
    enabled: row.enabled === 1 || row.enabled === true,
    freeUntil: toCount(row.free_until_chapter),
    price: toCount(row.price_per_chapter),
    unlockFullPrice: row.unlock_full_price !== null ? toCount(row.unlock_full_price) : null,
    source: 'novel'
  };
}

/**
 * 某本书里被单独覆盖过的章节（通常很少），一次性取进内存。
 * 有了它，「免费区间内的某一章单独收费」也能在缓存快路径上被识别出来。
 */
async function getOverrides(novelId) {
  const key = overridesCacheKey(novelId);
  const hit = cache.get(key);
  if (hit) return hit.map;

  const [rows] = await pool.execute(
    `SELECT chapter_number, is_free, price FROM chapters
     WHERE novel_id = ? AND (is_free IS NOT NULL OR price IS NOT NULL)`,
    [novelId]
  );
  const map = new Map();
  for (const row of rows) {
    map.set(Number(row.chapter_number), { isFree: row.is_free, price: row.price });
  }

  cache.set(key, { map }, NOVEL_TTL_MS);
  return map;
}

/**
 * 某章是否收费。
 * 判定顺序：书籍未启用 → 免费；按章覆盖优先；否则看章号是否越过免费区间。
 */
function isChapterPaid({ chapterNumber, chapterIsFree, rule }) {
  if (!rule || !rule.enabled) return false;

  if (chapterIsFree === 1 || chapterIsFree === true) return false;
  if (chapterIsFree === 0 || chapterIsFree === false) return true;

  return Number(chapterNumber) > Number(rule.freeUntil || 0);
}

/** 某章价格（分）：按章覆盖优先于书籍单价 */
function priceOf({ chapterPrice, rule }) {
  if (chapterPrice !== null && chapterPrice !== undefined) {
    return toCount(chapterPrice);
  }
  return toCount(rule && rule.price);
}

/**
 * 「这一章有没有可能需要付费」的快速预判，用于决定能否走 HTML 缓存快路径。
 * 只要可能收费，就必须进付费分支（不读也不写缓存）。
 */
function mayBePaid(rule, chapterNumber, overrides) {
  if (!rule || !rule.enabled) return false;

  const ov = overrides && overrides.get(Number(chapterNumber));
  if (ov) {
    if (ov.isFree === 1 || ov.isFree === true) return false;
    if (ov.isFree === 0 || ov.isFree === false) return true;
  }

  return Number(chapterNumber) > Number(rule.freeUntil || 0);
}

/** 一次拿到某章的完整判定结果（规则 + 是否收费 + 价格 + 覆盖） */
async function getChapterRule(novelId, chapterNumber) {
  const rule = await resolveRule(novelId);
  const overrides = await getOverrides(novelId);
  const override = overrides.get(Number(chapterNumber)) || null;

  const paid = isChapterPaid({
    chapterNumber,
    chapterIsFree: override ? override.isFree : null,
    rule
  });

  return {
    rule,
    overrides,
    override,
    paid,
    price: priceOf({ chapterPrice: override ? override.price : null, rule })
  };
}

/** 试读片段：付费章节给未购用户看开头，用于转化 */
function teaserOf(content, maxChars = 500) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}……`;
}

/** 分 → 元（展示用） */
function formatPrice(cents) {
  const n = Number(cents) || 0;
  return (n / 100).toFixed(2);
}

/**
 * 规则变更后必须清缓存。
 * 尤其要清 html: 缓存 —— 否则「原本免费、已被缓存」的章节改成收费后仍会漏出正文。
 */
function clearCache(novelId, cacheStore = cache) {
  cacheStore.clear(SETTINGS_CACHE_KEY);
  if (novelId) {
    cacheStore.clear(novelCacheKey(novelId));
    cacheStore.clear(overridesCacheKey(novelId));
  } else {
    cacheStore.clear('paywall:');
  }
  // 目录页带付费标记，规则变化后也要失效
  if (novelId) cacheStore.clear(`html:novel:${novelId}:`);
  cacheStore.clear('html:chapter:');
}

/**
 * 检查用户是否已购买整本书。
 * @param {number} userId
 * @param {number} novelId
 * @returns {Promise<boolean>}
 */
async function hasUnlockedFull(userId, novelId) {
  if (!userId || !novelId) return false;

  const [[row]] = await pool.execute(
    `SELECT 1 FROM novel_orders
     WHERE user_id = ? AND novel_id = ? LIMIT 1`,
    [userId, novelId]
  );
  return !!row;
}

/**
 * 解锁整本书（按本付费）。
 * 幂等操作：如果已购买过，直接返回成功。
 *
 * @param {number} userId
 * @param {number} novelId
 * @param {number} amount - 支付金额（分）
 * @param {string} channel - 支付渠道（'wallet' / 'alipay' / 等）
 * @returns {Promise<{success: boolean, alreadyOwned?: boolean, orderId?: number, error?: string}>}
 */
async function unlockFullNovel(userId, novelId, amount, channel = 'wallet') {
  if (!userId || !novelId) {
    return { success: false, error: 'Invalid user or novel' };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 检查是否已经购买过（幂等）
    const [[existing]] = await conn.execute(
      `SELECT id FROM novel_orders WHERE user_id = ? AND novel_id = ? LIMIT 1`,
      [userId, novelId]
    );

    if (existing) {
      await conn.commit();
      return { success: true, alreadyOwned: true, orderId: existing.id };
    }

    // 插入整本购买记录
    const [result] = await conn.execute(
      `INSERT INTO novel_orders (user_id, novel_id, amount, channel)
       VALUES (?, ?, ?, ?)`,
      [userId, novelId, amount, channel]
    );

    await conn.commit();
    return { success: true, orderId: result.insertId };
  } catch (err) {
    await conn.rollback();
    // 唯一键冲突 = 已购买（并发情况）
    if (err.code === 'ER_DUP_ENTRY') {
      return { success: true, alreadyOwned: true };
    }
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  getSettings,
  resolveRule,
  getOverrides,
  getChapterRule,
  isChapterPaid,
  priceOf,
  mayBePaid,
  teaserOf,
  formatPrice,
  clearCache,
  hasUnlockedFull,
  unlockFullNovel,
  SETTINGS_CACHE_KEY
};

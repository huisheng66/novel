// 后台：付费设置（全局默认 + 每本书覆盖）
//
// 规则全部可调，不需要改代码：
//   - 全局：是否启用付费、默认前 N 章免费、默认单章价格、付费书是否从书源隐藏
//   - 每本书：可单独覆盖以上三项，留空/恢复默认即继承全局

const express = require('express');
const { pool } = require('../../db');
const paywall = require('../../lib/paywall');
const { toPositiveInt } = require('./shared');

const router = express.Router();

function flash(notice, error) {
  const p = new URLSearchParams();
  if (notice) p.set('notice', notice);
  if (error) p.set('error', error);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** 元 → 分（后台以元为单位输入，存储用分） */
function yuanToCents(value) {
  const n = Number(String(value == null ? '' : value).trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function intOrZero(value) {
  const n = Number(String(value == null ? '' : value).trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

async function loadPageData() {
  const settings = await paywall.getSettings();

  const [novels] = await pool.execute(`
    SELECT n.id, n.title, n.last_chapter_number, n.cover_image,
           (SELECT COUNT(*) FROM chapters c WHERE c.novel_id = n.id) AS chapter_count,
           p.enabled, p.free_until_chapter, p.price_per_chapter
    FROM novels n
    LEFT JOIN novel_paywall p ON p.novel_id = n.id
    ORDER BY n.id ASC
  `);

  return {
    settings,
    novels: novels.map(row => ({
      ...row,
      chapterCount: Number(row.chapter_count) || 0,
      // 有 novel_paywall 行即为「本书单独设置」
      hasRule: row.enabled !== null && row.enabled !== undefined,
      enabled: row.enabled === null || row.enabled === undefined ? settings.enabled : row.enabled === 1,
      freeUntil: row.free_until_chapter === null || row.free_until_chapter === undefined
        ? settings.defaultFreeUntil
        : Number(row.free_until_chapter),
      price: row.price_per_chapter === null || row.price_per_chapter === undefined
        ? settings.defaultPrice
        : Number(row.price_per_chapter)
    }))
  };
}

router.get('/paywall', async (req, res, next) => {
  try {
    const data = await loadPageData();
    res.render('admin/paywall', {
      ...data,
      notice: req.query.notice || '',
      error: req.query.error || ''
    });
  } catch (err) {
    next(err);
  }
});

/** 全局默认 */
router.post('/paywall/settings', async (req, res, next) => {
  try {
    const entries = {
      paywall_enabled: req.body.enabled === '1' ? '1' : '0',
      paywall_default_free_until: String(intOrZero(req.body.default_free_until)),
      paywall_default_price: String(yuanToCents(req.body.default_price)),
      paywall_hide_from_source: req.body.hide_from_source === '0' ? '0' : '1'
    };

    for (const [key, value] of Object.entries(entries)) {
      await pool.execute(
        `INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()`,
        [key, value]
      );
    }

    paywall.clearCache();
    res.redirect(`/admin/paywall${flash('全局付费设置已保存，缓存已刷新')}`);
  } catch (err) {
    next(err);
  }
});

/** 单本覆盖 */
router.post('/paywall/novels/:id', async (req, res, next) => {
  try {
    const novelId = toPositiveInt(req.params.id);
    if (!novelId) return res.redirect(`/admin/paywall${flash('', '无效的小说 ID')}`);

    const enabled = req.body.enabled === '1' ? 1 : 0;
    const freeUntil = intOrZero(req.body.free_until_chapter);
    const price = yuanToCents(req.body.price_per_chapter);

    await pool.execute(
      `INSERT INTO novel_paywall (novel_id, enabled, free_until_chapter, price_per_chapter)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         enabled = VALUES(enabled),
         free_until_chapter = VALUES(free_until_chapter),
         price_per_chapter = VALUES(price_per_chapter)`,
      [novelId, enabled, freeUntil, price]
    );

    paywall.clearCache(novelId);
    res.redirect(`/admin/paywall${flash('本书付费规则已保存')}`);
  } catch (err) {
    next(err);
  }
});

/** 恢复继承全局默认 */
router.post('/paywall/novels/:id/reset', async (req, res, next) => {
  try {
    const novelId = toPositiveInt(req.params.id);
    if (!novelId) return res.redirect(`/admin/paywall${flash('', '无效的小说 ID')}`);

    await pool.execute('DELETE FROM novel_paywall WHERE novel_id = ?', [novelId]);
    paywall.clearCache(novelId);
    res.redirect(`/admin/paywall${flash('已恢复为全局默认规则')}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// 缓存预热：启动时预加载热门数据
const { pool } = require('../db');
const cache = require('./memoryCache');
const logger = require('./logger');

/**
 * 预热热门小说数据
 */
async function warmupNovels() {
  const conn = await pool.getConnection();
  try {
    // 获取最近更新的前50本小说
    const [novels] = await conn.execute(`
      SELECT * FROM novels
      ORDER BY updated_at DESC
      LIMIT 50
    `);

    for (const novel of novels) {
      const key = `novel:${novel.id}`;
      cache.set(key, novel, 10 * 60 * 1000); // 10分钟
    }

    logger.info('Novels cache warmed up', { count: novels.length });
    return novels.length;
  } catch (err) {
    logger.error('Novels warmup failed', { error: err.message });
    return 0;
  } finally {
    conn.release();
  }
}

/**
 * 预热付费墙配置
 */
async function warmupPaywallConfig() {
  const conn = await pool.getConnection();
  try {
    // 预加载全局付费配置
    const [settings] = await conn.execute(`
      SELECT setting_key, setting_value
      FROM platform_settings
      WHERE setting_key LIKE 'paywall%'
    `);

    const config = {};
    for (const row of settings) {
      config[row.setting_key] = row.setting_value;
    }

    cache.set('paywall:global', config, 30 * 1000); // 30秒

    // 预加载单书付费规则
    const [bookRules] = await conn.execute(`
      SELECT * FROM novel_paywall
      LIMIT 100
    `);

    for (const rule of bookRules) {
      const key = `paywall:novel:${rule.novel_id}`;
      cache.set(key, rule, 30 * 1000);
    }

    logger.info('Paywall config warmed up', {
      global: Object.keys(config).length,
      books: bookRules.length
    });

    return { global: settings.length, books: bookRules.length };
  } catch (err) {
    logger.error('Paywall warmup failed', { error: err.message });
    return { global: 0, books: 0 };
  } finally {
    conn.release();
  }
}

/**
 * 预热目录数据（热门书籍）
 */
async function warmupTOC() {
  const conn = await pool.getConnection();
  try {
    // 获取最近访问最多的小说ID（从 page_views 表）
    const [topNovels] = await conn.execute(`
      SELECT novel_id, COUNT(*) as views
      FROM page_views
      WHERE timestamp > DATE_SUB(NOW(), INTERVAL 1 DAY)
        AND novel_id IS NOT NULL
      GROUP BY novel_id
      ORDER BY views DESC
      LIMIT 20
    `);

    let cachedCount = 0;
    for (const { novel_id } of topNovels) {
      // 预加载目录
      const [chapters] = await conn.execute(
        `SELECT chapter_number, title, word_count, is_free, price, updated_at
         FROM chapters
         WHERE novel_id = ?
         ORDER BY chapter_number ASC`,
        [novel_id]
      );

      if (chapters.length > 0) {
        const key = `toc:${novel_id}`;
        cache.set(key, chapters, 5 * 60 * 1000); // 5分钟
        cachedCount++;
      }
    }

    logger.info('TOC cache warmed up', { novels: cachedCount });
    return cachedCount;
  } catch (err) {
    logger.error('TOC warmup failed', { error: err.message });
    return 0;
  } finally {
    conn.release();
  }
}

/**
 * 执行完整的缓存预热
 */
async function warmupAll() {
  logger.info('Starting cache warmup...');
  const start = Date.now();

  const results = await Promise.allSettled([
    warmupNovels(),
    warmupPaywallConfig(),
    warmupTOC()
  ]);

  const stats = {
    novels: results[0].status === 'fulfilled' ? results[0].value : 0,
    paywall: results[1].status === 'fulfilled' ? results[1].value : { global: 0, books: 0 },
    toc: results[2].status === 'fulfilled' ? results[2].value : 0,
    duration: Date.now() - start
  };

  logger.info('Cache warmup complete', stats);
  return stats;
}

module.exports = {
  warmupAll,
  warmupNovels,
  warmupPaywallConfig,
  warmupTOC
};

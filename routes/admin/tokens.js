// 后台 Token 管理路由

const express = require('express');
const { pool } = require('../../db');
const pageViewQueue = require('../../lib/pageViewQueue');
const { getBaseUrl } = require('../../lib/util');
const {
  getNovels,
  toPositiveInt,
  generateAccessToken,
  clearAccessTokenCache,
  clearHomeCache
} = require('./shared');
const { normalizeText } = require('../../lib/chapterText');

const router = express.Router();

async function getTokenUsers() {
  // 先取 token 基础信息(不 JOIN page_views)
  const [tokens] = await pool.execute(`
    SELECT
      t.id,
      t.name,
      t.token,
      t.allowed_novel_id,
      n_allowed.title AS allowed_novel_title,
      t.is_active,
      DATE_FORMAT(t.risk_paused_until, '%Y-%m-%d %H:%i:%s') AS risk_paused_until,
      t.risk_paused_until > NOW() AS is_risk_paused,
      t.risk_reason,
      t.created_at
    FROM access_tokens t
    LEFT JOIN novels n_allowed ON n_allowed.id = t.allowed_novel_id
    ORDER BY t.is_active DESC, is_risk_paused DESC, t.id DESC
  `);

  if (tokens.length === 0) return [];

  const ids = tokens.map(token => token.id);
  const placeholders = ids.map(() => '?').join(',');

  // token 维度统计:GROUP BY access_token_id(命中 idx_access_token_id),时间窗收窄到 5 分钟 + 全量计数
  const [statRows] = await pool.execute(
    `SELECT
       access_token_id,
       COUNT(*) AS total_views,
       COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE) THEN 1 END) AS views_5m,
       COUNT(CASE
         WHEN created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
           AND novel_id IS NOT NULL
           AND chapter_id IS NOT NULL
         THEN 1
       END) AS chapter_views_5m,
       COUNT(DISTINCT visitor_ip) AS ip_count,
       COUNT(DISTINCT session_id) AS session_count,
       DATE_FORMAT(MAX(created_at), '%Y-%m-%d %H:%i:%s') AS last_seen
     FROM page_views
     WHERE access_token_id IN (${placeholders})
     GROUP BY access_token_id`,
    ids
  );

  const statMap = new Map(statRows.map(row => [row.access_token_id, row]));
  for (const token of tokens) {
    const stat = statMap.get(token.id) || {};
    token.total_views = stat.total_views || 0;
    token.views_5m = stat.views_5m || 0;
    token.chapter_views_5m = stat.chapter_views_5m || 0;
    token.ip_count = stat.ip_count || 0;
    token.session_count = stat.session_count || 0;
    token.last_seen = stat.last_seen || null;
  }

  // 按 token 排序:活跃优先、风控优先、5 分钟访问优先
  tokens.sort((a, b) => {
    if (a.is_active !== b.is_active) return b.is_active - a.is_active;
    if (a.is_risk_paused !== b.is_risk_paused) return b.is_risk_paused - a.is_risk_paused;
    if (Number(b.views_5m) !== Number(a.views_5m)) return Number(b.views_5m) - Number(a.views_5m);
    if (Number(b.total_views) !== Number(a.total_views)) return Number(b.total_views) - Number(a.total_views);
    return b.id - a.id;
  });

  const recentViewLimit = Math.min(ids.length * 10, 1000);
  const [ipRows] = await pool.execute(
    `SELECT
       access_token_id,
       CASE
         WHEN visitor_ip LIKE '::ffff:%.%' THEN SUBSTRING(visitor_ip, 8)
         WHEN visitor_ip = '::1' THEN '127.0.0.1'
         ELSE visitor_ip
       END AS visitor_ip,
       COUNT(*) AS total_views,
       COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE) THEN 1 END) AS views_5m,
       DATE_FORMAT(MAX(created_at), '%Y-%m-%d %H:%i:%s') AS last_seen
     FROM page_views
     WHERE access_token_id IN (${placeholders})
     GROUP BY access_token_id, visitor_ip
     ORDER BY total_views DESC, visitor_ip ASC`,
    ids
  );

  const [viewRows] = await pool.execute(
    `SELECT
       pv.access_token_id,
       DATE_FORMAT(pv.created_at, '%Y-%m-%d %H:%i:%s') AS visited_at,
       CASE
         WHEN pv.visitor_ip LIKE '::ffff:%.%' THEN SUBSTRING(pv.visitor_ip, 8)
         WHEN pv.visitor_ip = '::1' THEN '127.0.0.1'
         ELSE pv.visitor_ip
       END AS visitor_ip,
       pv.path,
       pv.novel_id,
       pv.chapter_id,
       n.title AS novel_title,
       c.title AS chapter_title,
       c.chapter_number
     FROM page_views pv
     LEFT JOIN novels n ON n.id = pv.novel_id
     LEFT JOIN chapters c ON c.novel_id = pv.novel_id AND c.chapter_number = pv.chapter_id
     WHERE pv.access_token_id IN (${placeholders})
     ORDER BY pv.created_at DESC
     LIMIT ${recentViewLimit}`,
    ids
  );

  const ipMap = new Map();
  for (const row of ipRows) {
    const list = ipMap.get(row.access_token_id) || [];
    if (list.length < 8) {
      list.push(row);
      ipMap.set(row.access_token_id, list);
    }
  }

  const viewMap = new Map();
  for (const row of viewRows) {
    const list = viewMap.get(row.access_token_id) || [];
    if (list.length < 10) {
      list.push(row);
      viewMap.set(row.access_token_id, list);
    }
  }

  return tokens.map(token => ({
    ...token,
    ips: ipMap.get(token.id) || [],
    recentViews: viewMap.get(token.id) || []
  }));
}

router.get('/tokens', async (req, res, next) => {
  try {
    await pageViewQueue.flush();
    const novels = await getNovels();
    const currentNovel = novels[0] || null;
    const tokenUsers = await getTokenUsers();

    res.render('admin/tokens', {
      baseUrl: getBaseUrl(req),
      currentNovel,
      novels,
      tokenUsers,
      notice: req.query.notice || '',
      error: req.query.error || ''
    });
  } catch (err) {
    next(err);
  }
});

router.post('/tokens', async (req, res, next) => {
  try {
    const name = normalizeText(req.body.name);
    const token = normalizeText(req.body.token) || generateAccessToken();

    if (!name) {
      return res.redirect(`/admin/tokens?error=${encodeURIComponent('请输入用户名称')}`);
    }
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(token)) {
      return res.redirect(`/admin/tokens?error=${encodeURIComponent('Token 只能包含字母、数字、下划线或短横线，长度 8-128')}`);
    }

    await pool.execute(
      'INSERT INTO access_tokens (name, token, is_active, risk_paused_until, risk_reason) VALUES (?, ?, 1, NULL, NULL)',
      [name, token]
    );
    clearAccessTokenCache();

    res.redirect(`/admin/tokens?notice=${encodeURIComponent('Token 已创建')}`);
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.redirect(`/admin/tokens?error=${encodeURIComponent('Token 已存在')}`);
    }
    next(err);
  }
});

router.post('/tokens/:id/toggle', async (req, res, next) => {
  try {
    const tokenId = toPositiveInt(req.params.id);
    const isActive = req.body.is_active === '1' ? 1 : 0;
    if (!tokenId) {
      return res.redirect(`/admin/tokens?error=${encodeURIComponent('无效的 Token ID')}`);
    }

    if (isActive) {
      await pool.execute(
        'UPDATE access_tokens SET is_active = 1, risk_paused_until = NULL, risk_reason = NULL WHERE id = ?',
        [tokenId]
      );
    } else {
      await pool.execute('UPDATE access_tokens SET is_active = 0 WHERE id = ?', [tokenId]);
    }
    clearAccessTokenCache();
    res.redirect(`/admin/tokens?notice=${encodeURIComponent(isActive ? 'Token 已启用' : 'Token 已停用')}`);
  } catch (err) {
    next(err);
  }
});

router.post('/tokens/:id/novel', async (req, res, next) => {
  try {
    const tokenId = toPositiveInt(req.params.id);
    const allowedNovelId = toPositiveInt(req.body.allowed_novel_id);
    if (!tokenId) {
      return res.redirect(`/admin/tokens?error=${encodeURIComponent('无效的 Token ID')}`);
    }

    if (allowedNovelId) {
      const [[novel]] = await pool.execute(
        'SELECT id FROM novels WHERE id = ?',
        [allowedNovelId]
      );
      if (!novel) {
        return res.redirect(`/admin/tokens?error=${encodeURIComponent('选择的小说不存在')}`);
      }
    }

    await pool.execute(
      'UPDATE access_tokens SET allowed_novel_id = ? WHERE id = ?',
      [allowedNovelId || null, tokenId]
    );
    clearAccessTokenCache();
    clearHomeCache();
    res.redirect(`/admin/tokens?notice=${encodeURIComponent(allowedNovelId ? 'Token 已限制到指定小说' : 'Token 已恢复访问全部小说')}`);
  } catch (err) {
    next(err);
  }
});

router.post('/tokens/:id/delete', async (req, res, next) => {
  try {
    const tokenId = toPositiveInt(req.params.id);
    if (!tokenId) {
      return res.redirect(`/admin/tokens?error=${encodeURIComponent('无效的 Token ID')}`);
    }

    await pool.execute('UPDATE page_views SET access_token_id = NULL WHERE access_token_id = ?', [tokenId]);
    await pool.execute('DELETE FROM access_tokens WHERE id = ?', [tokenId]);
    clearAccessTokenCache();
    res.redirect(`/admin/tokens?notice=${encodeURIComponent('Token 已删除，历史访问已保留为未绑定')}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

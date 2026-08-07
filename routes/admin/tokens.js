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
const { getTokenUsers } = require('./lib/tokens');

const router = express.Router();

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

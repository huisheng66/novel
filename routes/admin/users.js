// 后台：统一读者账号（Web + App 同一 users 表）

const express = require('express');
const {
  listUsers,
  createUserAdmin,
  setUserActive,
  resetUserPassword,
  revokeUserSessions,
  deleteUser
} = require('../../lib/api/users');
const { ApiError } = require('../../lib/api/errors');
const { toPositiveInt } = require('./shared');

const router = express.Router();

function q(notice, error) {
  const p = new URLSearchParams();
  if (notice) p.set('notice', notice);
  if (error) p.set('error', error);
  const s = p.toString();
  return s ? `?${s}` : '';
}

router.get('/users', async (req, res, next) => {
  try {
    const page = toPositiveInt(req.query.page) || 1;
    const search = String(req.query.q || '').trim();
    const data = await listUsers({ q: search, page, pageSize: 50 });
    res.render('admin/users', {
      users: data.items,
      total: data.total,
      page: data.page,
      pageSize: data.pageSize,
      q: search,
      notice: req.query.notice || '',
      error: req.query.error || ''
    });
  } catch (err) {
    next(err);
  }
});

router.post('/users', async (req, res, next) => {
  try {
    await createUserAdmin({
      username: req.body.username,
      password: req.body.password,
      displayName: req.body.displayName,
      isActive: req.body.is_active !== '0'
    });
    res.redirect(`/admin/users${q('用户已创建')}`);
  } catch (err) {
    if (err instanceof ApiError) {
      return res.redirect(`/admin/users${q('', err.message)}`);
    }
    next(err);
  }
});

router.post('/users/:id/toggle', async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    const active = req.body.is_active === '1';
    if (!id) return res.redirect(`/admin/users${q('', '无效用户')}`);
    await setUserActive(id, active);
    res.redirect(`/admin/users${q(active ? '已启用' : '已禁用并踢下线')}`);
  } catch (err) {
    if (err instanceof ApiError) return res.redirect(`/admin/users${q('', err.message)}`);
    next(err);
  }
});

router.post('/users/:id/password', async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    if (!id) return res.redirect(`/admin/users${q('', '无效用户')}`);
    await resetUserPassword(id, req.body.password);
    res.redirect(`/admin/users${q('密码已重置，会话已清除')}`);
  } catch (err) {
    if (err instanceof ApiError) return res.redirect(`/admin/users${q('', err.message)}`);
    next(err);
  }
});

router.post('/users/:id/revoke-sessions', async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    if (!id) return res.redirect(`/admin/users${q('', '无效用户')}`);
    const result = await revokeUserSessions(id);
    res.redirect(`/admin/users${q(`已踢下线（${result.deleted} 个会话）`)}`);
  } catch (err) {
    if (err instanceof ApiError) return res.redirect(`/admin/users${q('', err.message)}`);
    next(err);
  }
});

router.post('/users/:id/delete', async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    if (!id) return res.redirect(`/admin/users${q('', '无效用户')}`);
    await deleteUser(id);
    res.redirect(`/admin/users${q('用户已删除')}`);
  } catch (err) {
    if (err instanceof ApiError) return res.redirect(`/admin/users${q('', err.message)}`);
    next(err);
  }
});

module.exports = router;

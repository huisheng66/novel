// 后台：一次一码邀请码

const express = require('express');
const {
  createInviteCodes,
  listInviteCodes,
  deleteInviteCode
} = require('../../lib/api/invites');
const { ApiError } = require('../../lib/api/errors');
const { toPositiveInt } = require('./shared');

const router = express.Router();

function q(notice, error, extra = {}) {
  const p = new URLSearchParams();
  if (notice) p.set('notice', notice);
  if (error) p.set('error', error);
  if (extra.status) p.set('status', extra.status);
  const s = p.toString();
  return s ? `?${s}` : '';
}

router.get('/invites', async (req, res, next) => {
  try {
    const status = ['unused', 'used', 'expired', 'all'].includes(req.query.status)
      ? req.query.status
      : 'unused';
    const page = toPositiveInt(req.query.page) || 1;
    const data = await listInviteCodes({ status, page, pageSize: 50 });
    res.render('admin/invites', {
      invites: data.items,
      total: data.total,
      page: data.page,
      pageSize: data.pageSize,
      status,
      notice: req.query.notice || '',
      error: req.query.error || '',
      lastCodes: req.query.codes ? String(req.query.codes).split(',').filter(Boolean) : []
    });
  } catch (err) {
    next(err);
  }
});

/** 一键生成（默认 1 个，最多 50） */
router.post('/invites/generate', async (req, res, next) => {
  try {
    const count = Math.min(Math.max(toPositiveInt(req.body.count) || 1, 1), 50);
    const note = String(req.body.note || '').trim() || null;
    const created = await createInviteCodes({ count, note });
    const codes = created.map((c) => c.code).join(',');
    res.redirect(
      `/admin/invites${q(`已生成 ${created.length} 个邀请码（一次一码）`, '', {
        status: 'unused'
      })}&codes=${encodeURIComponent(codes)}`
    );
  } catch (err) {
    if (err instanceof ApiError) {
      return res.redirect(`/admin/invites${q('', err.message)}`);
    }
    next(err);
  }
});

router.post('/invites/:id/delete', async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    if (!id) return res.redirect(`/admin/invites${q('', '无效 ID')}`);
    await deleteInviteCode(id);
    res.redirect(`/admin/invites${q('已删除未使用邀请码')}`);
  } catch (err) {
    if (err instanceof ApiError) {
      return res.redirect(`/admin/invites${q('', err.message)}`);
    }
    next(err);
  }
});

module.exports = router;

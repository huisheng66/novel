// 后台：充值码管理（生成 / 查询 / 删除未使用）

const express = require('express');
const { createCodes, listCodes, deleteCode,
  exportCodes
} = require('../../lib/api/recharge');
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

/** 元 → 分 */
function yuanToCents(value) {
  const n = Number(String(value == null ? '' : value).trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

router.get('/recharge', async (req, res, next) => {
  try {
    const status = ['unused', 'used', 'expired', 'all'].includes(req.query.status)
      ? req.query.status
      : 'unused';
    const page = toPositiveInt(req.query.page) || 1;
    const data = await listCodes({ status, page, pageSize: 50 });

    res.render('admin/recharge', {
      ...data,
      status,
      notice: req.query.notice || '',
      error: req.query.error || '',
      lastCodes: req.query.codes ? String(req.query.codes).split(',').filter(Boolean) : []
    });
  } catch (err) {
    next(err);
  }
});

router.post('/recharge/generate', async (req, res, next) => {
  try {
    const count = Math.min(Math.max(toPositiveInt(req.body.count) || 1, 1), 100);
    const amount = yuanToCents(req.body.amount);
    if (!amount) {
      return res.redirect(`/admin/recharge${q('', '请输入大于 0 的面额')}`);
    }

    const created = await createCodes({
      count,
      amount,
      note: req.body.note,
      expiresAt: req.body.expires_at || null
    });

    // 批量大时只在 URL 里放前几个码，其余走列表页 / TXT 导出——
    // 100 个长码全塞进 Location 头会超过 nginx 代理缓冲，直接 502
    const shown = created.slice(0, 8).map(c => c.code).join(',');
    const suffix = created.length > 8 ? `（其余 ${created.length - 8} 个见下方列表或「导出 TXT」）` : '';

    res.redirect(
      `/admin/recharge${q(`已生成 ${created.length} 个充值码（每个 ¥${(amount / 100).toFixed(2)}）${suffix}`, '', {
        status: 'unused'
      })}&codes=${encodeURIComponent(shown)}`
    );
  } catch (err) {
    if (err instanceof ApiError) return res.redirect(`/admin/recharge${q('', err.message)}`);
    next(err);
  }
});

/** TXT 导出：一行一码。默认未使用；?status=used|expired 为档案导出 */
router.get('/recharge/export.txt', async (req, res, next) => {
  try {
    const status = ['used', 'expired'].includes(req.query.status) ? req.query.status : 'unused';
    const rows = await exportCodes({ status });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition',
      `attachment; filename="recharge-${status}-${stamp}.txt"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(rows.map(r => r.code).join('\n') + (rows.length ? '\n' : ''));
  } catch (err) {
    next(err);
  }
});

router.post('/recharge/:id/delete', async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    if (!id) return res.redirect(`/admin/recharge${q('', '无效 ID')}`);
    await deleteCode(id);
    res.redirect(`/admin/recharge${q('已删除未使用的充值码')}`);
  } catch (err) {
    if (err instanceof ApiError) return res.redirect(`/admin/recharge${q('', err.message)}`);
    next(err);
  }
});

module.exports = router;

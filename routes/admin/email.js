// 后台：邮件与邮箱验证设置（SMTP 配置走环境变量，这里只读展示）

const express = require('express');
const { pool } = require('../../db');
const emailApi = require('../../lib/api/email');
const mailer = require('../../lib/mailer');
const { toPositiveInt } = require('./shared');

const router = express.Router();

function flash(notice, error) {
  const p = new URLSearchParams();
  if (notice) p.set('notice', notice);
  if (error) p.set('error', error);
  const s = p.toString();
  return s ? `?${s}` : '';
}

router.get('/email', async (req, res, next) => {
  try {
    const settings = await emailApi.getSettings();

    // 验证状态概览：有多少账号填了邮箱 / 已验证
    const [[stats]] = await pool.execute(`
      SELECT
        COUNT(*) AS total,
        SUM(email IS NOT NULL AND email <> '') AS with_email,
        SUM(email_verified_at IS NOT NULL) AS verified
      FROM users
    `);

    res.render('admin/email', {
      settings,
      smtp: mailer.describeConfig(),
      stats: {
        total: Number(stats.total) || 0,
        withEmail: Number(stats.with_email) || 0,
        verified: Number(stats.verified) || 0
      },
      notice: req.query.notice || '',
      error: req.query.error || ''
    });
  } catch (err) {
    next(err);
  }
});

router.post('/email/settings', async (req, res, next) => {
  try {
    const entries = {
      email_verify_on_register: req.body.on_register === '0' ? '0' : '1',
      email_verify_required_login: req.body.required_login === '1' ? '1' : '0',
      email_verify_required_purchase: req.body.required_purchase === '1' ? '1' : '0'
    };

    for (const [key, value] of Object.entries(entries)) {
      await pool.execute(
        `INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()`,
        [key, value]
      );
    }

    emailApi.clearCache();
    res.redirect(`/admin/email${flash('设置已保存')}`);
  } catch (err) {
    next(err);
  }
});

router.post('/email/test', async (req, res, next) => {
  try {
    const to = String(req.body.to || '').trim();
    if (!to) return res.redirect(`/admin/email${flash('', '请填写收件邮箱')}`);
    if (!mailer.isConfigured()) {
      return res.redirect(`/admin/email${flash('', 'SMTP 未配置，无法发信：请设置 SMTP_HOST 等环境变量后重启')}`);
    }

    const result = await mailer.sendTestMail(to);
    if (result.delivered) {
      return res.redirect(`/admin/email${flash(`测试邮件已发送到 ${to}`)}`);
    }
    return res.redirect(`/admin/email${flash('', `发送失败：${result.reason}`)}`);
  } catch (err) {
    next(err);
  }
});

/** 手动给某个用户标记已验证（邮件发不出去时的兜底） */
router.post('/users/:id/verify-email', async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    if (!id) return res.redirect(`/admin/users${flash('', '无效用户')}`);

    const { setEmailVerifiedAdmin } = require('../../lib/api/users');
    await setEmailVerifiedAdmin(id, true);
    res.redirect(`/admin/users${flash('已标记邮箱验证通过')}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

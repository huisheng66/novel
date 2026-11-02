const express = require('express');
const router = express.Router();
const mailer = require('../../lib/mailer');
const logger = require('../../lib/logger');
const rateLimitStore = require('../../lib/rateLimitStore');

// 反馈接口限流：每 IP 每 15 分钟最多 5 次
const FEEDBACK_RATE_LIMIT_MAX = 5;
const FEEDBACK_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

function getClientIp(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown')
    .replace(/^::ffff:/, '')
    .slice(0, 64) || 'unknown';
  return ip;
}

async function feedbackRateLimit(req, res, next) {
  const ip = getClientIp(req);
  const key = `feedback:${ip}`;

  const result = await rateLimitStore.consume(key, {
    max: FEEDBACK_RATE_LIMIT_MAX,
    windowMs: FEEDBACK_RATE_LIMIT_WINDOW_MS
  });

  if (!result.allowed) {
    return res.status(429).json({
      error: '提交过于频繁，请稍后再试',
      retryAfter: result.retryAfterSec
    });
  }

  next();
}

/**
 * POST /api/feedback
 * 用户反馈接口（带限流）
 * Body: { email?: string, content: string }
 */
router.post('/', feedbackRateLimit, async (req, res) => {
  const { email, content } = req.body;

  // 验证必填字段
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: '反馈内容不能为空' });
  }

  // 验证邮箱格式（如果提供）
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: '邮箱格式不正确' });
  }

  // 长度限制
  if (content.length > 5000) {
    return res.status(400).json({ error: '反馈内容过长（最多5000字）' });
  }

  try {
    const feedbackEmail = process.env.FEEDBACK_EMAIL || process.env.SMTP_USER;

    if (!feedbackEmail) {
      console.warn('[Feedback] 未配置 FEEDBACK_EMAIL 或 SMTP_USER，反馈将仅记录在日志');
      logger.info('用户反馈', { email: email || '未提供', content });
      return res.json({ success: true, message: '反馈已记录' });
    }

    const emailSubject = `[用户反馈] ${email || '匿名用户'}`;
    const emailBody = `
<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #96502f;">用户反馈</h2>

  <div style="background: #f7f6f2; padding: 15px; border-radius: 8px; margin: 15px 0;">
    <p style="margin: 0 0 8px 0;"><strong>用户邮箱：</strong>${email || '未提供'}</p>
    <p style="margin: 0;"><strong>提交时间：</strong>${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>
  </div>

  <div style="background: #ffffff; border: 1px solid #ddd9d1; border-radius: 8px; padding: 15px; margin: 15px 0;">
    <h3 style="margin-top: 0; color: #25231f;">反馈内容：</h3>
    <p style="white-space: pre-wrap; line-height: 1.6; color: #25231f;">${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
  </div>

  <hr style="border: none; border-top: 1px solid #ddd9d1; margin: 20px 0;">

  <p style="color: #68635c; font-size: 0.9em; margin: 0;">
    此邮件由 codexnovel 反馈系统自动发送${email ? `，可直接回复至用户邮箱：${email}` : ''}
  </p>
</div>
    `.trim();

    const result = await mailer.sendMail({
      to: feedbackEmail,
      subject: emailSubject,
      html: emailBody,
      text: `用户反馈\n\n用户邮箱：${email || '未提供'}\n提交时间：${new Date().toLocaleString('zh-CN')}\n\n反馈内容：\n${content}`
    });

    if (result.delivered) {
      logger.info('反馈邮件已发送', { to: feedbackEmail, messageId: result.messageId });
      res.json({ success: true, message: '反馈已提交' });
    } else {
      // 邮件发送失败，但记录到日志
      logger.info('用户反馈（邮件发送失败，记录到日志）', {
        email: email || '未提供',
        content,
        reason: result.reason
      });
      res.json({ success: true, message: '反馈已记录' });
    }

  } catch (error) {
    logger.error('反馈处理失败', { error });

    // 即使出错也记录反馈内容
    logger.info('用户反馈（异常，记录到日志）', {
      email: email || '未提供',
      content
    });

    res.status(500).json({
      error: '提交失败，请稍后重试',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;

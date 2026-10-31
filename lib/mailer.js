// 邮件发送：配置了 SMTP 就走真实发信，否则退化为「写日志」。
//
// 退化不是摆设：本地/内测阶段没有 SMTP 时，验证链接会打在日志里，
// 站长可以直接复制给用户，整条链路仍然可测。

const nodemailer = require('nodemailer');
const logger = require('./logger');

let transport = null;
let transportKey = '';

function smtpConfig() {
  const host = String(process.env.SMTP_HOST || '').trim();
  if (!host) return null;

  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = String(process.env.SMTP_SECURE || '') === '1' || port === 465;
  const user = String(process.env.SMTP_USER || '').trim();

  return {
    host,
    port,
    secure,
    auth: user ? { user, pass: String(process.env.SMTP_PASS || '') } : undefined
  };
}

function isConfigured() {
  return Boolean(smtpConfig());
}

function fromAddress() {
  return String(process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@localhost');
}

function describeConfig() {
  const cfg = smtpConfig();
  if (!cfg) return { configured: false };
  return { configured: true, host: cfg.host, port: cfg.port, secure: cfg.secure, from: fromAddress() };
}

function getTransport() {
  const cfg = smtpConfig();
  if (!cfg) return null;

  const key = JSON.stringify(cfg);
  if (transport && transportKey === key) return transport;

  transport = nodemailer.createTransport(cfg);
  transportKey = key;
  return transport;
}

/**
 * 发一封邮件。永不抛错——邮件失败不应该让注册/重置流程挂掉。
 * @returns {Promise<{delivered:boolean, reason?:string, messageId?:string}>}
 */
async function sendMail({ to, subject, text, html }) {
  const target = String(to || '').trim();
  if (!target) return { delivered: false, reason: 'no_recipient' };

  const tx = getTransport();
  if (!tx) {
    // 未配置 SMTP：把内容写进日志，方便本地自测（生产请务必配置 SMTP）
    logger.warn('邮件未配置（SMTP_HOST 为空），内容已写入日志', { to: target, subject });
    logger.info('邮件正文', { to: target, subject, text });
    return { delivered: false, reason: 'not_configured' };
  }

  try {
    const info = await tx.sendMail({ from: fromAddress(), to: target, subject, text, html });
    logger.info('邮件已发送', { to: target, subject, messageId: info.messageId });
    return { delivered: true, messageId: info.messageId };
  } catch (err) {
    logger.error('邮件发送失败', { to: target, subject, err });
    return { delivered: false, reason: 'send_failed' };
  }
}

/** 后台「发送测试邮件」用：这次失败要能报出来 */
async function sendTestMail(to) {
  const tx = getTransport();
  if (!tx) return { delivered: false, reason: 'not_configured' };

  try {
    const info = await tx.sendMail({
      from: fromAddress(),
      to,
      subject: '【测试】邮件配置可用',
      text: `这是一封测试邮件，收到说明 SMTP 配置正确。\n\n发送时间：${new Date().toISOString()}`
    });
    return { delivered: true, messageId: info.messageId };
  } catch (err) {
    return { delivered: false, reason: err.message || 'send_failed' };
  }
}

module.exports = {
  isConfigured,
  describeConfig,
  fromAddress,
  sendMail,
  sendTestMail
};

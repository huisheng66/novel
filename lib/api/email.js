// 邮箱业务：验证邮件、找回密码邮件、验证状态与开关。
//
// 三个开关都在 platform_settings 里，后台 /admin/email 可调：
//   email_verify_on_register     注册后是否发验证邮件（默认 1）
//   email_verify_required_login  未验证是否禁止登录（默认 0，不阻塞）
//   email_verify_required_purchase 未验证是否禁止购买（默认 0）

const { pool } = require('../../db');
const cache = require('../memoryCache');
const logger = require('../logger');
const mailer = require('../mailer');
const tokens = require('./emailTokens');

const SETTINGS_CACHE_KEY = 'email:settings';
const SETTINGS_TTL_MS = 30 * 1000;

const SETTING_KEYS = [
  'email_verify_on_register',
  'email_verify_required_login',
  'email_verify_required_purchase'
];

async function getSettings() {
  const cached = cache.get(SETTINGS_CACHE_KEY);
  if (cached) return cached;

  const [rows] = await pool.execute(
    `SELECT setting_key, setting_value FROM platform_settings
     WHERE setting_key IN (${SETTING_KEYS.map(() => '?').join(',')})`,
    SETTING_KEYS
  );
  const map = {};
  for (const row of rows) map[row.setting_key] = row.setting_value;

  const settings = {
    verifyOnRegister: map.email_verify_on_register !== '0',
    requiredForLogin: map.email_verify_required_login === '1',
    requiredForPurchase: map.email_verify_required_purchase === '1'
  };

  cache.set(SETTINGS_CACHE_KEY, settings, SETTINGS_TTL_MS);
  return settings;
}

function clearCache() {
  cache.clear(SETTINGS_CACHE_KEY);
}

/** 邮件里的链接不能用请求 Host（可能被伪造），优先取显式配置 */
function resolveBaseUrl(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (req) {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    const host = String(req.get('host') || '').trim();
    if (host) return `${proto}://${host}`;
  }
  return 'http://localhost:3008';
}

function siteName() {
  return String(process.env.SITE_NAME || '书库');
}

async function sendVerificationEmail(user, baseUrl) {
  if (!user || !user.id || !user.email) return { delivered: false, reason: 'no_email' };

  const { token } = await tokens.issueToken(user.id, 'verify');
  const url = `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`;
  const name = user.display_name || user.username || '读者';

  const result = await mailer.sendMail({
    to: user.email,
    subject: `【${siteName()}】验证你的邮箱`,
    text: [
      `${name}，你好：`,
      '',
      '请打开下面的链接完成邮箱验证（24 小时内有效）：',
      url,
      '',
      '如果不是你本人操作，忽略这封邮件即可。'
    ].join('\n'),
    html: `<p>${name}，你好：</p><p>请点击下面的链接完成邮箱验证（24 小时内有效）：</p><p><a href="${url}">${url}</a></p><p>如果不是你本人操作，忽略这封邮件即可。</p>`
  });

  return { ...result, url };
}

async function sendPasswordResetEmail(user, baseUrl) {
  if (!user || !user.id || !user.email) return { delivered: false, reason: 'no_email' };

  const { token } = await tokens.issueToken(user.id, 'reset');
  const url = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

  const result = await mailer.sendMail({
    to: user.email,
    subject: `【${siteName()}】重置密码`,
    text: [
      '我们收到了重置密码的请求，请打开下面的链接（1 小时内有效）：',
      url,
      '',
      '如果不是你本人操作，请忽略这封邮件，你的密码不会变化。'
    ].join('\n'),
    html: `<p>我们收到了重置密码的请求，请点击下面的链接（1 小时内有效）：</p><p><a href="${url}">${url}</a></p><p>如果不是你本人操作，请忽略这封邮件，你的密码不会变化。</p>`
  });

  return { ...result, url };
}

async function markVerified(userId) {
  await pool.execute(
    'UPDATE users SET email_verified_at = NOW() WHERE id = ? AND email_verified_at IS NULL',
    [userId]
  );
}

async function isEmailVerified(userId) {
  const [[row]] = await pool.execute(
    'SELECT email, email_verified_at FROM users WHERE id = ? LIMIT 1',
    [userId]
  );
  if (!row) return { hasEmail: false, verified: false };
  return { hasEmail: Boolean(row.email), verified: Boolean(row.email_verified_at) };
}

/** 登录/购买前是否需要先验证邮箱（只对「填了邮箱但没验证」的人生效） */
async function checkVerifiedFor(action, userRow) {
  if (!userRow) return { ok: true };

  const settings = await getSettings();
  const required = action === 'login' ? settings.requiredForLogin : settings.requiredForPurchase;
  if (!required) return { ok: true };
  if (!userRow.email) return { ok: true }; // 没有邮箱的账号不受限
  if (userRow.email_verified_at) return { ok: true };

  return { ok: false, reason: 'EMAIL_NOT_VERIFIED' };
}

/** 注册成功后按开关发信（失败不影响注册结果） */
async function maybeSendVerification(user, baseUrl) {
  try {
    const settings = await getSettings();
    if (!settings.verifyOnRegister || !user || !user.email) return null;
    return await sendVerificationEmail(user, baseUrl);
  } catch (err) {
    logger.warn('发送验证邮件失败（不影响注册）', { err });
    return null;
  }
}

module.exports = {
  getSettings,
  clearCache,
  resolveBaseUrl,
  sendVerificationEmail,
  sendPasswordResetEmail,
  markVerified,
  isEmailVerified,
  checkVerifiedFor,
  maybeSendVerification,
  SETTING_KEYS
};

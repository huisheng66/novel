// 统一工具函数,消除各模块重复定义

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** 正整数或 null（后台表单/路由参数常用） */
function toPositiveInt(value) {
  return parsePositiveInt(value, null);
}

// 可信 Host 白名单（逗号分隔，如 example.com,www.example.com:3008）。
// 配置后 getBaseUrl 只返回白名单内的 host，Host 头投毒（CWE-644）不再可能。
const ALLOWED_HOSTS = String(process.env.ALLOWED_HOSTS || '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

function getBaseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .split(',')[0]
    .trim() || 'http';
  const rawHost = String(req.get('host') || '').toLowerCase().trim();

  let host = rawHost;
  if (ALLOWED_HOSTS.length > 0) {
    host = ALLOWED_HOSTS.includes(rawHost) ? rawHost : ALLOWED_HOSTS[0];
  } else if (!/^[a-z0-9.-]+(?:\d+)?$/.test(rawHost.replace(/^([^:]+):/, '$1'))) {
    // 未配白名单时，至少拒绝含非法字符的 Host（防止拼出畸形 URL）
    host = '';
  }
  if (!host) return '/'; // 无法确定可信 host 时，不生成绝对地址
  return `${proto}://${host}`;
}

function toAbsoluteUrl(req, value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `${getBaseUrl(req)}${url.startsWith('/') ? url : `/${url}`}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  parsePositiveInt,
  toPositiveInt,
  getBaseUrl,
  toAbsoluteUrl,
  escapeHtml
};

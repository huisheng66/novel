// 统一工具函数,消除各模块重复定义

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** 正整数或 null（后台表单/路由参数常用） */
function toPositiveInt(value) {
  return parsePositiveInt(value, null);
}

function getBaseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .split(',')[0]
    .trim() || 'http';
  return `${proto}://${req.get('host')}`;
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

// 安全响应头中间件
// 防护: XSS, Clickjacking, MIME Sniffing, 信息泄露

/**
 * 设置安全响应头
 */
function securityHeaders(req, res, next) {
  // 1. Content-Security-Policy (CSP) - 防护 XSS
  // 注意：'unsafe-inline' 是为了兼容现有的内联样式和脚本
  // 生产环境建议移除 unsafe-inline，使用 nonce 或外部文件
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // unsafe-eval for EJS
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ')
  );

  // 2. X-Content-Type-Options - 防止 MIME 类型嗅探
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // 3. X-Frame-Options - 防止点击劫持
  res.setHeader('X-Frame-Options', 'DENY');

  // 4. X-XSS-Protection - 启用浏览器 XSS 过滤器（向后兼容）
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // 5. Referrer-Policy - 控制 Referer 头发送
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // 6. Permissions-Policy - 限制浏览器功能
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=()'
  );

  // 7. HSTS - 强制 HTTPS（仅在 HTTPS 连接下）
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    // max-age=31536000 (1年), includeSubDomains, preload
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }

  next();
}

/**
 * 禁用 X-Powered-By 头（隐藏服务器技术栈）
 */
function hidePoweredBy(app) {
  app.disable('x-powered-by');
}

module.exports = {
  securityHeaders,
  hidePoweredBy
};

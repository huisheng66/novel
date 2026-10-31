// 跨站表单提交（CSRF）防护。
//
// SameSite=Lax 挡不住跨站表单 POST —— 浏览器对表单提交不施加同站限制，
// 所以凡是改变状态的表单接口都要挂这个中间件。

function rejectCrossSite(req, res, next) {
  const origin = String(req.headers.origin || '').trim();
  const secFetchSite = String(req.headers['sec-fetch-site'] || '').trim().toLowerCase();

  if (origin) {
    try {
      const originHost = new URL(origin).host;
      const host = String(req.headers.host || '').toLowerCase();
      if (originHost.toLowerCase() !== host) {
        return res.status(403).send('拒绝跨站请求（CSRF 防护）');
      }
    } catch (err) {
      return res.status(403).send('拒绝非法来源请求');
    }
  }

  if (secFetchSite && ['same-origin', 'same-site', 'none'].indexOf(secFetchSite) === -1) {
    return res.status(403).send('拒绝跨站请求（CSRF 防护）');
  }

  next();
}

module.exports = { rejectCrossSite };

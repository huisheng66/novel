# Cookie 留存策略

## Cookie 类型与留存时间

### 1. 用户登录 Cookie
- **名称**: `cn_jwt`
- **用途**: Web/App 统一登录凭证（JWT）
- **留存时间**: **180天**（6个月）
- **作用域**: 全站（`path: /`）
- **安全设置**: `httpOnly`, `sameSite: lax`

用户登录后，该 Cookie 会保持登录状态 6 个月，无需频繁重新登录。

### 2. Access Token Cookie
- **名称**: `access_token`
- **用途**: 访问令牌（分享链接、Legado 阅读器）
- **留存时间**: **180天**（6个月）
- **作用域**: 全站（`path: /`）
- **安全设置**: `httpOnly`, `sameSite: lax`

持有访问令牌的用户（通过分享链接或阅读器）可在 6 个月内访问被授权的内容。

### 3. 访客追踪 Cookie
- **名称**: `visitor_uid`, `visitor_session`
- **用途**: 匿名访客统计和会话追踪
- **留存时间**: **180天**（6个月）
- **作用域**: 全站（`path: /`）
- **安全设置**: `httpOnly`, `sameSite: lax`

用于统计分析，不包含任何个人身份信息。

### 4. 后台管理会话
- **名称**: `admin_session`
- **用途**: 后台管理员登录会话
- **留存时间**: **30天**（1个月）
- **作用域**: `/admin` 路径
- **安全设置**: `httpOnly`, `sameSite: lax`, `secure`（HTTPS）

管理员登录后台，会话保持 30 天。出于安全考虑，留存时间相对较短。

## 技术实现

### 前端用户 Cookie（180天）
```javascript
// routes/middleware/auth.js
const WEB_JWT_COOKIE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000; // 180天
const COOKIE_HALF_YEAR_MS = 180 * 24 * 60 * 60 * 1000;       // 180天

const WEB_JWT_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: WEB_JWT_COOKIE_MAX_AGE_MS
};

const ACCESS_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge: COOKIE_HALF_YEAR_MS,
  path: '/'
};
```

### 后台管理 Cookie（30天）
```javascript
// routes/admin/lib/session.js
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30天
```

## 安全特性

### 1. HttpOnly
所有 Cookie 均设置 `httpOnly: true`，防止 XSS 攻击窃取 Cookie。

### 2. SameSite
所有 Cookie 设置 `sameSite: lax`，防止 CSRF 攻击。

### 3. Secure（HTTPS）
后台管理 Cookie 在 HTTPS 连接下自动启用 `secure` 标志。

### 4. 路径隔离
后台管理 Cookie 限制在 `/admin` 路径，与前台隔离。

## 自动清理机制

### 数据库过期清理
系统每小时自动清理过期的：
- 用户会话（`user_sessions`）
- Access Token（`access_tokens`）
- 邮箱验证令牌（`email_tokens`）
- 充值码（`recharge_codes`）

### 内存缓存过期
缓存数据设置 TTL，自动过期清理。

## 用户控制

用户可以随时：
1. **退出登录**: 访问 `/logout` 清除登录 Cookie
2. **浏览器清除**: 手动清除浏览器 Cookie
3. **隐私模式**: 使用浏览器隐私/无痕模式（Cookie 不持久化）

## 合规性

### GDPR / CCPA
- 所有 Cookie 用途明确
- 用户可随时清除
- 访客追踪 Cookie 不包含 PII（个人身份信息）
- 管理员会话有明确的安全需求

### Cookie 横幅（可选）
如需合规展示 Cookie 提示，可在前端添加：
```html
<div class="cookie-banner">
  本站使用 Cookie 以改善用户体验和统计分析。
  继续使用即表示同意我们的 <a href="/privacy">隐私政策</a>。
</div>
```

## 变更历史

### 2026-11-02
- Web JWT Cookie: 30天 → **180天**
- 访客 Cookie: 365天 → **180天**
- 后台会话: 7天 → **30天**

**理由**: 平衡用户体验（减少重复登录）与安全性（定期刷新凭证）。

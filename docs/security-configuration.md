# 安全配置指南

## 生产环境必需配置

### 1. 密钥配置

```bash
# JWT 密钥（必需，>=32字节）
JWT_ACCESS_SECRET=<随机生成的强密钥>
JWT_REFRESH_SECRET=<随机生成的强密钥>

# 后台管理密码（必需，禁止默认值）
ADMIN_PASSWORD=<强密码>
ADMIN_SESSION_SECRET=<随机生成的强密钥>

# 生成方法
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 2. 反向代理配置

```bash
# 信任代理（Nginx/CDN 后必需）
TRUST_PROXY=true

# 允许的 Host 白名单（防 Host 头投毒）
ALLOWED_HOSTS=example.com,www.example.com
```

### 3. HTTPS 配置

**Nginx 配置示例**:
```nginx
server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # 安全响应头（应用层已设置，这里可选）
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 4. 限流配置

```bash
# App API 限流
API_RATE_LIMIT_AUTH_MAX=30              # 认证接口：30次/15分钟
API_RATE_LIMIT_AUTH_WINDOW_MS=900000
API_RATE_LIMIT_CHAPTER_MAX=180          # 章节阅读：180次/分钟
API_RATE_LIMIT_CHAPTER_WINDOW_MS=60000

# Web 风控
RISK_WINDOW_MINUTES=5                   # 风控窗口：5分钟
RISK_CHAPTER_LIMIT=75                   # 风控阈值：75章
RISK_PAUSE_HOURS=1                      # 暂停时长：1小时
```

### 5. 数据库安全

```bash
# 使用专用数据库用户，最小权限原则
DB_USER=codexnovel_app
DB_PASSWORD=<强密码>

# 不要使用 root 用户
```

**MySQL 权限设置**:
```sql
-- 创建专用用户
CREATE USER 'codexnovel_app'@'localhost' IDENTIFIED BY '<强密码>';

-- 只授予必要权限
GRANT SELECT, INSERT, UPDATE, DELETE ON codexnovel.* TO 'codexnovel_app'@'localhost';

-- 不要授予 DROP, ALTER, GRANT 等高危权限
FLUSH PRIVILEGES;
```

### 6. Redis 安全

```bash
# Redis 密码认证
REDIS_URL=redis://:password@localhost:6379
```

**Redis 配置 (redis.conf)**:
```conf
# 绑定到本地（不对外暴露）
bind 127.0.0.1

# 设置密码
requirepass <强密码>

# 禁用危险命令
rename-command FLUSHDB ""
rename-command FLUSHALL ""
rename-command CONFIG ""
```

## 安全响应头

系统已自动设置以下安全响应头（lib/securityHeaders.js）：

| 头名称 | 值 | 作用 |
|--------|---|------|
| Content-Security-Policy | default-src 'self'; ... | 防护 XSS |
| X-Content-Type-Options | nosniff | 防止 MIME 嗅探 |
| X-Frame-Options | DENY | 防止点击劫持 |
| X-XSS-Protection | 1; mode=block | 启用 XSS 过滤器 |
| Referrer-Policy | strict-origin-when-cross-origin | 控制 Referer |
| Strict-Transport-Security | max-age=31536000 | 强制 HTTPS（HTTPS 下） |
| Permissions-Policy | geolocation=(), ... | 限制浏览器功能 |

**注意**: 已隐藏 `X-Powered-By` 头。

## 密码策略

### 用户密码要求
- 最小长度：8 字符
- 最大长度：128 字符
- 加密算法：bcrypt (cost=10)

### 管理员密码要求
- 生产环境禁止使用默认密码 `admin123`
- 建议 16+ 字符，包含大小写字母、数字、特殊符号

## 限流策略

### Web 登录限流
- **限制**: 10 次 / 15 分钟（每 IP）
- **超限响应**: HTTP 429, Retry-After 头

### App API 限流
- **认证接口**: 30 次 / 15 分钟
- **章节阅读**: 180 次 / 分钟
- **进度同步**: 60 次 / 分钟

### 反馈接口限流
- **限制**: 5 次 / 15 分钟（每 IP）
- **防护**: 防止垃圾邮件

### 风控机制
- **触发条件**: 5 分钟内访问超过 75 章
- **处罚**: 暂停访问 1 小时
- **豁免**: 书源路径（/source/*）不触发风控

## CSRF 防护

### 防护机制
- Origin 头验证
- Sec-Fetch-Site 头验证
- SameSite Cookie 策略

### 已防护的端点
- POST /login
- POST /register
- POST /forgot-password
- POST /reset-password
- POST /wallet/recharge

## 输入验证

### 用户名
- 正则: `/^[a-zA-Z0-9_]{3,32}$/`
- 长度: 3-32 字符
- 字符: 字母、数字、下划线

### 邮箱
- 基础格式验证
- 最大长度: 255 字符
- 自动转小写

### 整数参数
- 使用 `parsePositiveInt()` 严格验证
- 拒绝非正整数

### 路径参数
- `sanitizeNext()` 防止开放重定向
- 拒绝 `//`, `\\`, 跨域路径

## Cookie 安全

所有 Cookie 都设置：
- `httpOnly: true` - 防止 JS 访问
- `sameSite: 'lax'` - 防止 CSRF
- `secure: true` - HTTPS only（生产环境）

## 日志安全

### 禁止记录的敏感信息
- ❌ 密码（明文或哈希）
- ❌ JWT 令牌
- ❌ Access Token
- ❌ 信用卡号
- ❌ 身份证号

### 建议日志格式
```javascript
// ✅ 安全：只记录用户 ID
logger.info('用户登录', { userId: user.id });

// ❌ 危险：记录密码
logger.info('用户登录', { username, password }); // 禁止！
```

## 依赖安全

### 定期审计
```bash
# 检查漏洞
npm audit

# 自动修复
npm audit fix

# 更新依赖
npm update

# 查看过期依赖
npm outdated
```

### CI/CD 集成
```yaml
# GitHub Actions 示例
- name: Security audit
  run: npm audit --audit-level=high
```

## 错误处理

### 生产环境错误响应
```javascript
// ✅ 安全：通用错误消息
if (process.env.NODE_ENV === 'production') {
  res.status(500).json({ error: '服务器错误' });
} else {
  res.status(500).json({ error: err.message, stack: err.stack });
}
```

### 禁止泄露的信息
- ❌ 数据库错误详情
- ❌ 文件系统路径
- ❌ 服务器版本
- ❌ Stack Trace（生产环境）

## 访问控制

### 权限层级
1. **管理员** - `/admin/*`
2. **登录用户** - JWT 认证
3. **访问令牌** - 只读，可限书
4. **匿名** - 重定向登录

### 最小权限原则
- 数据库用户只授予必要权限
- API Token 可限定单本书
- 管理员会话独立于用户会话

## 备份与恢复

### 数据库备份
```bash
# 每日备份
mysqldump -u backup_user -p codexnovel > backup_$(date +%Y%m%d).sql

# 加密备份
mysqldump -u backup_user -p codexnovel | gpg -c > backup_$(date +%Y%m%d).sql.gpg
```

### 备份策略
- 每日全量备份
- 保留 30 天
- 异地存储
- 定期测试恢复

## 监控与告警

### 关键指标
- 登录失败率
- 限流触发次数
- 慢查询数量
- 错误率

### 告警阈值
- 登录失败率 > 10%
- 5xx 错误率 > 1%
- 慢查询 > 1秒
- 限流触发 > 100次/分钟

## 应急响应

### 安全事件处理流程
1. **发现** - 监控告警
2. **评估** - 确定影响范围
3. **遏制** - 封禁 IP / 停用账号
4. **根除** - 修复漏洞
5. **恢复** - 恢复服务
6. **总结** - 事后分析

### 紧急操作
```bash
# 封禁 IP（Nginx）
deny 1.2.3.4;

# 停用用户
UPDATE users SET is_active = 0 WHERE id = <user_id>;

# 撤销 Token
UPDATE access_tokens SET is_active = 0 WHERE id = <token_id>;

# 清除会话
DELETE FROM user_sessions WHERE user_id = <user_id>;
```

## 合规性

### GDPR / CCPA
- ✅ 用户可删除账号
- ✅ 用户可导出数据
- ✅ Cookie 策略透明
- ✅ 数据最小化

### 隐私保护
- 密码加密存储
- 敏感数据不记录日志
- 访客追踪 Cookie 匿名
- 用户邮箱可选填

## 安全检查清单

### 部署前检查
- [ ] 修改所有默认密码
- [ ] 配置强密钥（JWT, Session）
- [ ] 启用 HTTPS
- [ ] 配置 TRUST_PROXY
- [ ] 设置 ALLOWED_HOSTS
- [ ] 配置 Redis 密码
- [ ] 限制数据库用户权限
- [ ] 启用防火墙
- [ ] 配置日志轮转
- [ ] 设置监控告警

### 定期检查（每月）
- [ ] 运行 npm audit
- [ ] 更新依赖
- [ ] 审查访问日志
- [ ] 测试备份恢复
- [ ] 检查证书过期时间
- [ ] 审查用户权限
- [ ] 分析慢查询

### 年度检查
- [ ] 全面安全审计
- [ ] 渗透测试
- [ ] 灾难恢复演练
- [ ] 更新安全策略

## 联系方式

如发现安全漏洞，请联系：
- 邮箱: security@example.com
- 不要公开披露漏洞
- 负责任的漏洞披露政策

---

**最后更新**: 2026-11-02  
**版本**: 1.0

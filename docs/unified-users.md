# 统一读者账号（Web + App）

## 模型

| 身份 | 表 / 机制 | 用途 |
|------|-----------|------|
| **读者账号** | `users` + JWT + `user_sessions` | 网页登录、ReadAny App、云进度/书架 |
| **Access Token** | `access_tokens` | 分享链接、Legado 只读（**不是**登录账号） |
| **管理员** | `ADMIN_PASSWORD` | 仅 `/admin` |

注册用**邮箱 + 密码**（用户名自动生成），登录可用邮箱或用户名。同一套凭据可：

1. 打开 `https://站点/login` 读网页  
2. 在 ReadAny「在线书库」登录用 App  

进度键：`/api/v1/me/progress`，Web 章节页写 `localStorage.codexnovel_access_token`（JWT）。

## 邮箱验证与找回密码

| 能力 | 说明 |
|------|------|
| 注册发信 | 注册后自动发验证邮件（后台可关） |
| 验证邮箱 | `/verify-email?token=` 一次性，24 小时有效 |
| 重发 | 钱包页按钮，限 3 次 / 10 分钟 |
| 忘记密码 | `/forgot-password` → 邮件链接（1 小时）→ `/reset-password` |
| 强制验证 | 后台 `/admin/email` 两个开关：未验证禁止登录 / 禁止购买，默认都关 |
| 兜底 | 邮件发不出去时，`/admin/users` 可手动标记已验证 |

令牌只存 sha256 哈希，一次性；签发新令牌会作废同类旧令牌。重置密码会清空该账号所有会话。

## 后台管理

### 读者账号 `/admin/users`

- 新建 / 搜索  
- 启用、禁用（禁用会清会话）  
- 重置密码、踢下线、删除  

### 邀请码 `/admin/invites`（一次一码）

- 一键生成 `INV-XXXXXXXX`  
- 未使用 / 已使用列表  
- Web、App **自助注册必填**；用后即废  
- 邀请码**选填**：Web / App 自助注册填了就核销，不填也能注册
- **后台直接建号不需要邀请码**

`/admin/tokens` 仍只管理分享 / Legado 只读 Token。

## 环境变量

```env
API_REGISTER_ENABLED=true   # 是否允许 Web/App 自助注册（邮箱即可，邀请码选填）
JWT_ACCESS_SECRET=...       # 与 App 共用
```

生产可：`API_REGISTER_ENABLED=false` 只走后台建号；或开启注册（邮箱直注册，邀请码按需发放做灰度）。

## Web 鉴权顺序

1. `?token=` / Cookie `access_token` → 旧 Token 通道  
2. Cookie `cn_jwt` 或 `Authorization: Bearer` → 读者 JWT  
3. 否则浏览器跳转 `/login?next=...`

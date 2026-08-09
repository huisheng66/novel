# 统一读者账号（Web + App）

## 模型

| 身份 | 表 / 机制 | 用途 |
|------|-----------|------|
| **读者账号** | `users` + JWT + `user_sessions` | 网页登录、ReadAny App、云进度/书架 |
| **Access Token** | `access_tokens` | 分享链接、Legado 只读（**不是**登录账号） |
| **管理员** | `ADMIN_PASSWORD` | 仅 `/admin` |

同一 `username` / `password` 可：

1. 打开 `https://站点/login` 读网页  
2. 在 ReadAny「在线书库」登录用 App  

进度键：`/api/v1/me/progress`，Web 章节页写 `localStorage.codexnovel_access_token`（JWT）。

## 后台管理

### 读者账号 `/admin/users`

- 新建 / 搜索  
- 启用、禁用（禁用会清会话）  
- 重置密码、踢下线、删除  

### 邀请码 `/admin/invites`（一次一码）

- 一键生成 `INV-XXXXXXXX`  
- 未使用 / 已使用列表  
- Web、App **自助注册必填**；用后即废  
- **后台直接建号不需要邀请码**

`/admin/tokens` 仍只管理分享 / Legado 只读 Token。

## 环境变量

```env
API_REGISTER_ENABLED=true   # 是否允许 Web/App 自助注册（仍须邀请码）
JWT_ACCESS_SECRET=...       # 与 App 共用
```

生产可：`API_REGISTER_ENABLED=false` 只走后台建号；或开启注册 + 发邀请码。

## Web 鉴权顺序

1. `?token=` / Cookie `access_token` → 旧 Token 通道  
2. Cookie `cn_jwt` 或 `Authorization: Bearer` → 读者 JWT  
3. 否则浏览器跳转 `/login?next=...`

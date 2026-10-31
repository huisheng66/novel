# codexnovel

基于 **Express 5 + EJS + MySQL** 的在线小说阅读站，单体应用。同一份数据库同时对外提供三种访问形态：**网页阅读**、**官方 App 的 JSON API**、**Legado 书源协议**，另带一个后台管理面板。

## 三种访问形态

| 形态 | 路径 | 使用者 | 鉴权方式 |
|------|------|--------|----------|
| 网页阅读（SSR） | `/`、`/novel/*`、`/login` | 浏览器 | 站点 Access Token 或读者账号登录 |
| 官方 App API | `/api/v1/*` | ReadAny 等客户端 | 用户 JWT（书架/进度）+ Access Token（只读书库） |
| Legado 书源 | `/source/*` | 阅读 App（Legado） | 站点 Access Token，只读 |
| 管理后台 | `/admin/*` | 站长 | 管理员密码 + 服务端会话 |

三条内容通道**共用** `novels` / `chapters` 表，互不替换：上线 App API 不会影响网页，也不会影响书源。

## 功能概览

**阅读端**

- 首页书架、小说目录、章节正文阅读
- 阅读器支持深浅色、字号调节、滚动位置记忆、键盘左右键翻页
- 阅读进度本地记忆；登录后同步到云端（跨设备续读）

**账号体系**

- 读者账号（Web 与 App 同一套 `users`），JWT access + 轮换式 refresh
- **邮箱注册**：邮箱 + 密码即可，用户名自动生成；邀请码**选填**（有则核销、无则跳过）
- 登录可用**邮箱或用户名**；也可由后台直接建号
- 站点 Access Token：用于分享链接与 Legado，只读、可限制到单本小说、超量自动风控暂停

**后台管理**

- 章节管理（分页目录 + 异步加载正文，避免把 LONGTEXT 塞进首屏 HTML）
- 小说信息与封面（含格式魔数校验）
- 批量导入 `.txt` / `.docx`，自动识别章节标题，支持追加与覆盖
- 读者账号管理（建号、禁用、重置密码、踢下线、删除）
- 邀请码生成与查询
- Access Token 管理（启停、限书、查看近 5 分钟访问与风险状态）
- 数据看板（访问量、访客、登录读者、趋势、热门页面/小说/IP、访问明细）

**运营与运维**

- Legado 书源一键导入（`/source/import/<token>.json`）
- 公告与强制更新策略下发（`/api/v1/ops`）
- 书架更新通知、书签笔记、阅读进度批量上报（离线队列）
- `/healthz` 健康检查、`/metrics` Prometheus 指标、结构化 JSON 日志
- 数据库迁移自动执行，优雅关闭时刷新统计队列

## 技术栈

Node.js（20.6+）· Express 5 · EJS · MySQL（5.7+ / 8+）· mysql2 · multer · mammoth · iconv-lite · bcryptjs · jsonwebtoken

## 目录结构

```
server.js              应用装配、健康检查、优雅关闭
db.js                  连接池 + 全部建表与迁移（SCHEMA_VERSION）
routes/
  index.js             前台三个页面 + 中间件编排 + HTML 缓存
  middleware/auth.js   鉴权 / 风控 / 访问统计
  web-auth.js          Web 登录·注册·登出（CSRF、限流）
  source.js            Legado 书源路由（JSON + HTML 双形态）
  admin/               后台按域拆分：auth dashboard novels chapters tokens users invites
  api/v1/              官方 App API 按域拆分
lib/
  api/                 App API 领域逻辑（books shelf progress bookmarks ops invites tokens users rateLimit errors）
  source/              书源查询、HTML 伪装模板、Legado payload
  chapterText.js       编码识别、章节标题识别、分段（纯函数，测试覆盖最全）
  htmlCacheKey.js      前台 HTML 缓存键的唯一构造点
  memoryCache.js       进程内 TTL 缓存（可广播失效）
  redis.js             可选 Redis 后端：连接、失效广播、降级
  rateLimitStore.js    限流计数：内存 / Redis 滑动窗口
  pageViewQueue.js     访问日志批量入库队列
  analytics.js         page_views → 日聚合 / 累计聚合
views/                 EJS 模板（前台 5 个 + 后台 8 个）
public/                CSS / 前台脚本 / 封面上传目录
android/               Android 客户端（Kotlin + Jetpack Compose）
public/app/            网页版阅读器（PWA，同源调用 /api/v1）
scripts/               部署、导入、冒烟、去重、schema 检查
tests/                 node:test 单元与集成测试
docs/                  API 文档、运维手册、架构解读
```

## 安装与启动

```bash
npm install
# 准备 .env（可复制 .env.example 后修改）
npm start                 # 等价于 node --env-file=.env server.js
```

启动成功后：

| 入口 | 地址 |
|------|------|
| 前台首页 | `http://localhost:3008/` |
| 读者登录 | `http://localhost:3008/login` |
| 后台登录 | `http://localhost:3008/admin/login` |
| 章节管理 | `http://localhost:3008/admin` |
| 数据看板 | `http://localhost:3008/admin/dashboard` |
| 健康检查 | `http://localhost:3008/healthz` |

> 未设置 `PORT` 时默认监听 `3000`；`.env.example` 与部署脚本使用 `3008`。

## 环境变量

完整清单见 [`.env.example`](.env.example)，关键项：

| 变量 | 说明 |
|------|------|
| `PORT` | 服务端口，未设置时 3000 |
| `NODE_ENV` | 生产设为 `production`（启用静态资源长缓存与安全校验） |
| `DB_HOST` `DB_USER` `DB_PASSWORD` `DB_NAME` | MySQL 连接；数据库不存在时启动会自动创建 |
| `DB_CONNECTION_LIMIT` | 连接池上限，默认 20 |
| `ADMIN_PASSWORD` | 后台登录密码 |
| `ADMIN_SESSION_SECRET` | 后台会话签名密钥，须与密码不同 |
| `JWT_ACCESS_SECRET` | 读者 JWT 签名密钥，**≥32 字节随机值** |
| `JWT_ACCESS_TTL_SEC` / `JWT_REFRESH_TTL_DAYS` | access 2 小时 / refresh 30 天（默认） |
| `API_REGISTER_ENABLED` | 是否开放自助注册（开启后邮箱即可注册，邀请码选填） |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` | 邮件发信配置；不配置则验证/重置链接写入日志 |
| `MAIL_FROM` / `SITE_NAME` | 发件人地址、邮件里的站点名 |
| `PUBLIC_BASE_URL` | 邮件里链接的站点地址，例如 `https://novel.example.com`（建议设置） |
| `API_OPS_ADMIN_KEY` | 写 `/api/v1/ops` 的密钥 |
| `PUBLIC_CACHE_TTL_MS` | 前台 HTML 缓存时长，默认 5 分钟 |
| `ACCESS_TOKEN_CACHE_TTL_MS` | 令牌鉴权缓存，默认 2 分钟 |
| `PAGE_VIEW_BATCH_SIZE` / `PAGE_VIEW_FLUSH_INTERVAL_MS` | 访问日志批量入库参数 |
| `API_RATE_LIMIT_*` | App API 各接口限流阈值 |
| `TRUST_PROXY` | 部署在 nginx/CDN 后设 `true`，才采信 `X-Forwarded-For` |
| `ALLOWED_HOSTS` | 可信 Host 白名单（逗号分隔），防 Host 头投毒 |
| `LOG_LEVEL` | `debug` / `info`（默认）/ `warn` / `error` |
| `REDIS_URL` | 可选。配置后限流计数与缓存失效跨实例共享；不配置则全部走进程内存 |

**生产环境的硬性要求**（不满足则拒绝启动，这是刻意的）：

- `ADMIN_PASSWORD` 必须设置且不能是默认值 `admin123`
- `ADMIN_SESSION_SECRET` 必须设置
- `JWT_ACCESS_SECRET` 必须设置且长度 ≥ 32 字节

开发环境若未设置 `ADMIN_PASSWORD`，会回退到 `admin123` 并在启动日志中提示。

## 数据库

启动时自动建库、建表、执行尚未应用的迁移。当前 `SCHEMA_VERSION = 10`。

| 分组 | 表 |
|------|----|
| 内容 | `novels`、`chapters` |
| 身份 | `users`、`user_sessions`、`access_tokens`、`email_tokens` |
| 读者数据 | `bookshelf`、`reading_progress`、`reading_bookmarks`、`device_subscriptions` |
| 运营 | `platform_settings`、`invite_codes`、`novel_paywall` |
| 交易 | `chapter_orders`、`user_wallets`、`wallet_transactions`、`recharge_codes` |
| 统计 | `page_views`、`analytics_daily`、`analytics_totals` |
| 系统 | `admin_sessions`、`schema_version` |

- 迁移按版本增量执行：`db.js` 的 `MIGRATIONS` 数组逐档列出，只跑 `schema_version` 尚未记录的项。**新增迁移请往数组末尾追加，不要改动已有项。**
- 迁移幂等（`columnExists` / `CREATE TABLE IF NOT EXISTS`）。
- `novels` 表为空时会插入一份示例小说（3 章），便于立刻看到效果。

## 身份与权限

四层身份，边界清晰：

| 身份 | 凭据 | 能做什么 |
|------|------|----------|
| 管理员 | `ADMIN_PASSWORD` + 服务端会话 | 仅 `/admin/*` |
| 读者 | `users` + JWT（Web cookie `cn_jwt` / App Bearer） | 阅读、书架、进度、书签 |
| 站点令牌 | `access_tokens` | 只读阅读与书源，可限单书，可被风控暂停 |
| 匿名 | 无 | 只能到 `/login` |

**注意：Access Token 不是账号**，不能登录、不能写书架与进度，只用于分享链接和 Legado。

### 网页阅读的鉴权顺序

1. URL 上的 `?token=`，或 Cookie `access_token` → 走站点令牌
2. Cookie `cn_jwt`，或 `Authorization: Bearer <jwt>` → 走读者账号
3. 都没有 → 浏览器跳转 `/login?next=...`

## 后台使用

1. 打开 `/admin/login`，输入 `ADMIN_PASSWORD`（登录失败 5 次 / 10 分钟限流）
2. 各页面：

| 页面 | 用途 |
|------|------|
| `/admin` | 章节管理：左侧分页目录，右侧编辑区（正文异步加载） |
| `/admin/novels/info` | 小说信息、封面上传/删除 |
| `/admin/tokens` | 分享与 Legado 令牌：新建、启停、限制单书、删除 |
| `/admin/users` | 读者账号：建号、禁用、重置密码、踢下线、删除 |
| `/admin/invites` | 邀请码：一键生成（一次一码）、按状态查询、删除未使用 |
| `/admin/paywall` | 付费设置：全局开关、前 N 章免费、单章单价、是否从书源隐藏；每本书可单独覆盖 |
| `/admin/recharge` | 充值码：批量生成（面额/数量/有效期）、按状态查询、删除未使用 |
| `/admin/email` | 邮件与验证：SMTP 状态、验证策略三个开关、发送测试邮件 |
| `/admin/dashboard` | 数据看板 |

## 批量导入章节

在 `/admin` 中上传：

- 支持 `.txt` 与 `.docx`
- 单文件上限 30 MB，单次最多 50 个文件
- 导入方式：**追加**（接在现有章节后）或**覆盖**（先删除该小说已有章节）
- 可指定起始章节号，默认接在最大章号之后

章节标题识别支持：

- `第一章 标题`、`第001章 标题`、`第十回 标题`、`第X节/集/部/篇`
- `Chapter 1`、`1. 标题`
- 序章、楔子、引子、番外、后记等
- 分卷（`第N卷`）：卷名只挂在该卷第一章，后续章节自动去掉重复前缀

识别不到任何标题时，整个文件按**单章**导入，标题取文件名——不会丢内容。

`.txt` 编码自动识别（UTF-8 / UTF-16 LE·BE / GB18030）；仍建议提前转成 UTF-8。

## 书源（Legado）

导入地址（把 `<token>` 换成后台创建的 Access Token）：

```
https://你的域名/source/import/<token>.json
```

可用的数据接口（`.../html/` 前缀为同内容的网页形态）：

| 接口 | 说明 |
|------|------|
| `/source/search?key=` | 搜索 |
| `/source/book/:id` | 书籍详情 |
| `/source/toc/:id` | 目录 |
| `/source/content/:id/:chapterNum` | 正文 |
| `/source/legado` | 书源 JSON（`?single=1` 返回单条） |

书源请求**不参与**章节风控计时——Legado 会并行拉取大量章节，否则会被误暂停。

## App API

完整协议见 [`docs/api-v1.md`](docs/api-v1.md)。速览：

```
GET  /api/v1/health
POST /api/v1/auth/{register,login,refresh,logout}
GET  /api/v1/me
GET  /api/v1/books?q=&page=&pageSize=
GET  /api/v1/books/:id
GET  /api/v1/books/:id/toc
GET  /api/v1/books/:id/toc/delta?since=
GET  /api/v1/books/:id/chapters/:chapterNumber   # 支持 ETag / 304
GET  /api/v1/me/shelf  |  POST /api/v1/me/shelf  |  DELETE /api/v1/me/shelf/:novelId
GET  /api/v1/me/shelf/updates?since=
GET  /api/v1/me/progress  |  PUT /api/v1/me/progress
POST /api/v1/me/progress/batch
GET/POST/PUT/DELETE /api/v1/me/bookmarks
GET/POST /api/v1/me/devices
GET  /api/v1/me/notices/updates?since=
GET  /api/v1/ops  |  PUT /api/v1/ops
```

进度冲突策略为 **LWW**（客户端 `updatedAt` 不晚于服务端则不覆盖，返回 `applied: false` 与服务端权威副本）。

## 邮箱验证与找回密码

注册后自动发送验证邮件（可在后台关闭）；登录页有「忘记密码」入口，通过邮件里的链接重置密码。

| 流程 | 路径 | 有效期 |
|---|---|---|
| 验证邮箱 | `/verify-email?token=…` | 24 小时，一次性 |
| 重发验证邮件 | 钱包页按钮 → `/verify-email/resend`（限 3 次/10 分钟） | — |
| 忘记密码 | `/forgot-password` → 邮件链接 | 1 小时，一次性 |
| 重置密码 | `/reset-password?token=…` | 用后即焚，并清空该账号所有登录会话 |

三个开关在 `/admin/email`，保存即生效：

| 开关 | 默认 | 作用 |
|---|---|---|
| 注册后发送验证邮件 | 开 | 关掉则注册不发信 |
| 未验证禁止登录 | 关 | 开启后，填了邮箱但没验证的账号无法登录 |
| 未验证禁止购买 | 关 | 开启后，未验证账号不能购买付费章节 |

两个「禁止」只对**填了邮箱但没验证**的账号生效，后台建的无邮箱账号不受影响。邮件发不出去时，可在 `/admin/users` 手动标记已验证。

**未配置 SMTP 时**不会发信，验证/重置链接会写入服务端日志（`邮件正文` 那条），可手动复制给用户——整条链路依然可用，适合内测。

实现细节：令牌只存 sha256 哈希（与 refresh token 同策略）、一次性、签发新令牌会作废同类旧令牌；忘记密码无论邮箱是否存在都返回同一提示，避免被用来枚举账号。

## 客户端

除了服务端自带的网页版，仓库里还有两个可直接用的客户端，都只依赖 `/api/v1`：

| 客户端 | 位置 | 说明 |
|--------|------|------|
| Android（原生） | `android/` | Kotlin + Jetpack Compose，Material3；书库/搜索/目录/阅读器/进度同步/书架/钱包/付费解锁 |
| 网页版阅读器 | `public/app/` → 访问 `/app` | 纯前端（ES Module，无构建步骤），可加到手机桌面；适合快速验证或在电脑上读 |

Android 客户端构建：

```bash
# 需要 JDK 17 与 Android SDK 35
gradle -p android assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

默认服务端地址是模拟器用的 `http://10.0.2.2:3008/api/v1/`，真机改成局域网 IP：

```bash
gradle -p android assembleDebug -PapiBaseUrl=http://192.168.1.10:3008/api/v1/
```

详见 [`android/README.md`](android/README.md)。

## 付费章节

「前 N 章免费」这类规则**全部在后台 `/admin/paywall` 调整**，保存即生效，不需要改代码或重启。

| 可配置项 | 说明 |
|---|---|
| 启用付费 | 总开关。关闭时全站按免费处理，连按章覆盖也不生效 |
| 默认前 N 章免费 | 填 0 表示整本收费；填大于总章数的值表示整本免费 |
| 默认单章价格 | 以元输入，按分存储 |
| 付费书籍是否从书源隐藏 | 开启（默认）时付费书不出现在 Legado 书源；关闭则只输出免费章 |
| 按书覆盖 | 每本书可单独设置上面三项，或一键恢复继承全局 |

两条硬规则（写在代码里，不可配置，因为它们是安全前提）：

1. **付费章节永不进入 HTML / 段落缓存**。缓存键只含 host、书号、章号，不含用户身份——一旦把付费正文写进去，就等于对所有持链接的人生效。因此判定顺序是「先看是否可能收费，再决定能不能读缓存」。
2. **书源只输出免费章节**。付费章节在 `/source/*` 一律 404，不返回「需付费」提示（避免被用来探测）。

未购买时：网页显示试读片段（前 400 字）+ 解锁卡片；API 返回 `402 PAYMENT_REQUIRED`，带 `price` 与 `teaser`。

### 钱包与充值

读者访问 `/wallet` 查看余额、消费流水与已购章节。当前充值走**充值码**（`/admin/recharge` 批量生成，面额以元输入、按分存储），不依赖任何支付通道即可跑通「充值 → 购买 → 阅读」全链路。

也可以在 `/admin/users` 直接给某个读者加减余额（客服补偿、内测发币）。

余额变动全部落 `wallet_transactions`，便于对账。购买记录在 `chapter_orders`（`user_id + novel_id + chapter_number` 唯一），因此**重复购买不会重复扣费**；并发请求由唯一键 + 行锁兜底，并带死锁重试。

微信/支付宝与 iOS IAP 尚未接入：国内卖虚拟内容需要企业商户资质，iOS 内购必须走 Apple IAP（抽成 15~30%）。

## 访问统计

写入条件：**持站点令牌**或**已登录读者**的 GET 请求；后台路径、静态资源、不存在的章节（404）不计入。

看板上的两个指标口径不同，别混用：

| 指标 | 口径 | 含义 |
|------|------|------|
| 访客数 | `COUNT(DISTINCT visitor_uid)` | 按访客 Cookie 去重，匿名与登录读者都算 |
| 登录读者 | `COUNT(DISTINCT user_id)` | 按账号去重，仅登录过的读者 |

实现上，访问日志先进内存队列（满 100 条或每 1 秒批量入库），再由定时任务聚合到 `analytics_daily`（每分钟）与 `analytics_totals`（每小时）。看板读聚合表，不扫明细。

## 运维

```bash
curl -s localhost:3008/healthz    # 队列长度、缓存条目数
curl -s localhost:3008/metrics    # Prometheus 文本格式
```

- `/healthz` 同时返回 `redis.status`（`disabled` / `ready` / `error`）与 `rateLimit.backend`
- 日志为单行 JSON（含 `req_id` 与 `X-Request-Id` 响应头），便于与 nginx 日志关联
- 收到 SIGTERM/SIGINT 会先关服、刷新统计队列再退出（5 秒强制兜底）
- 备份、迁移与回滚流程见 [`docs/api-ops.md`](docs/api-ops.md)
- Ubuntu 一键部署：

```bash
sudo bash scripts/deploy-ubuntu.sh
```

域名、HTTPS 与自定义密码见 [`docs/ubuntu-deploy.md`](docs/ubuntu-deploy.md)。

## 测试

```bash
npm test                  # 单元测试 + 上传限制集成测试
npm run smoke:source      # 书源冒烟（需运行中的服务与有效 token）
npm run smoke:api         # App API 冒烟（API_BASE=... npm run smoke:api）
```

`tests/upload-limit.test.js` 会拉起真实服务，需要本地 MySQL 可用；**数据库连不上时这组用例自动跳过**（不会让整体测试判失败），其余用例照常执行。

`tests/redis-backend.test.js` 用 `ioredis-mock` 驱动，验证限流与失效广播的逻辑，不依赖真实 Redis。

## 常见问题

**端口被占用** — 修改 `.env` 的 `PORT` 后重启。

**数据库连接失败** — 确认 MySQL 已启动、账号密码正确。启动日志会输出 `Database initialization failed`。

**服务启动后立即退出** — 生产环境通常是缺少 `ADMIN_SESSION_SECRET` 或 `JWT_ACCESS_SECRET`（需 ≥32 字节），日志会写明具体原因。

**上传后中文乱码** — `.txt` 建议使用 UTF-8。系统会尝试识别 UTF-16 与 GB18030，但来源复杂的文件仍建议先转码。

**后台登录失败** — 确认输入的是 `.env` 中的 `ADMIN_PASSWORD`；改完 `.env` 需重启。连续失败 5 次会锁 10 分钟。

**打开前台被跳到登录页** — 网页阅读需要 `?token=` 或读者账号登录，这是默认行为；不希望公开访问时不要创建长期令牌。

**改了章节前台要等一会儿才更新** — 前台 HTML 有 5 分钟缓存（`PUBLIC_CACHE_TTL_MS`）。后台保存会主动失效对应缓存；若仍看到旧内容，通常是①有多个服务实例（进程内缓存不共享）②前面挂了 CDN/反向代理缓存。

## 分支说明

| 分支 | 内容 |
|------|------|
| `main` | 稳定的网页 + 后台 |
| `app` | 网页 + 后台 + `/api/v1` 读者 API + 统一账号 + 付费分层（当前开发分支） |

**多实例部署**：单实例不需要 Redis；跑多实例前请先读 [`docs/multi-instance.md`](docs/multi-instance.md)——不配 Redis 的话，最先出问题的不是性能，而是内容更新在部分实例上不生效。

客户端：Android 见 [`android/README.md`](android/README.md)，网页版阅读器直接访问 `/app`。

更多文档：架构解读 [`docs/architecture-deep-dive.md`](docs/architecture-deep-dive.md) · API [`docs/api-v1.md`](docs/api-v1.md) · 账号模型 [`docs/unified-users.md`](docs/unified-users.md) · 运维 [`docs/api-ops.md`](docs/api-ops.md)

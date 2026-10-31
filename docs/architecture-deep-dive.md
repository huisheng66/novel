# codexnovel 深度架构解读

> 基于对 `server.js`、`db.js`、`routes/**`、`lib/**`、`views/**`、`docs/**`、`strix_runs/**` 的全量通读整理。
> 目的：一次性建立"这个项目是什么、请求怎么流动、数据怎么存、哪里会踩坑"的完整心智模型。

---

## 0. 一句话定位

一个**单体 Node.js / Express 5 + EJS + MySQL** 的自建小说站。同一份 MySQL 同时对外提供三种互不干扰的访问形态：

| 形态 | 路径 | 使用者 | 渲染方式 |
|------|------|--------|----------|
| Web 阅读站 | `/`、`/novel/*`、`/login` | 浏览器 | 服务端 EJS 渲染 + 进程内 HTML 缓存 |
| 官方 App API | `/api/v1/*` | ReadAny fork（App） | 纯 JSON，JWT 鉴权 |
| Legado 书源 | `/source/*`（JSON + HTML 双形态） | 阅读 App「阅读」（Legado） | JSON 结构化源码 / 伪 HTML 页面 |
| 管理后台 | `/admin/*` | 站长 | EJS + 少量异步 AJAX |

三者共用 `novels` / `chapters` 表，**互不替换**——这是整个项目最重要的设计约束（见 `docs/api-v1.md` 开头的"保留/增量/不下线"）。

---

## 1. 启动链（`server.js`，108 行，几乎无业务）

```
express()
 ├─ trust proxy  ← TRUST_PROXY=true 才信任 X-Forwarded-For（默认 false，防伪造限流）
 ├─ express.static(public)  ← 生产 7d 强缓存
 ├─ urlencoded(50mb) / json(1mb)   ← 50mb 是给批量上传章节留的
 ├─ logger.requestLogger  ← 生成 req.id / X-Request-Id
 ├─ GET /healthz   ← 队列 + 缓存大小
 ├─ GET /metrics   ← Prometheus 文本格式（队列/丢弃数/缓存条目/风控窗口）
 ├─ mount /admin      → routes/admin/index.js
 ├─ mount /api/v1     → routes/api/v1/index.js
 ├─ mount /           → routes/index.js
 ├─ 404 渲染 views/404.ejs
 └─ 错误处理（统一 500 + 结构化日志）

initDB() ──成功──> listen(0.0.0.0:PORT) + analytics.start()
                  + SIGINT/SIGTERM → 关服 → flushAll 队列 → exit（5s 强制超时兜底）
         └─失败──> logger.error + exit(1)
```

`initDB()` 是最"重"的启动逻辑：建库 → 建基础表 → 读 `schema_version` → **只跑尚未应用的迁移**（`MIGRATIONS` 清单，当前到 v6）→ `novels` 为空时插种子数据（《星辰变》3 章）。

迁移清单是数组形式（`{ version, name, run }`），新增迁移往末尾追加即可。历史链（≤5）虽然幂等但含 `ALTER TABLE MODIFY` 与全表 `UPDATE`，因此**不能**每次升版本都整链重跑——这一点曾被写成「appliedVersion < SCHEMA_VERSION 就跑 runSchemaMigrations」，导致每次升版都重复全量迁移。

---

## 2. 目录职责矩阵

| 路径 | 职责 | 备注 |
|------|------|------|
| `server.js` | 装配、健康检查、优雅关闭 | 不放业务 |
| `db.js` | 连接池 + **全部 DDL/迁移** | `SCHEMA_VERSION = 6`，迁移按版本增量执行 |
| `routes/index.js` | 前台三页 + 中间件编排 + 缓存读写 | 前端页面的"总调度" |
| `routes/middleware/auth.js` | 鉴权 / 风控 / 访问统计 | 590 行，全站最核心的横切逻辑 |
| `routes/web-auth.js` | Web 登录/注册/登出 + CSRF + 限流 | 与 App 共用 `users` + JWT |
| `routes/source.js` | Legado 书源薄路由 | 只做参数解析与响应，数据在 `lib/source/` |
| `routes/admin/` | 后台按域拆分（auth/dashboard/tokens/users/invites/novels/chapters） | `shared.js` 是门面 re-export |
| `routes/admin/lib/` | session / cover / cache / metrics / tokens / novels / upload | 后台的"服务层" |
| `routes/api/v1/` | App API 按域拆分 + 专属 middleware | 每条路由都是 `asyncRoute` 包裹 |
| `lib/api/` | App API 的领域逻辑（books/shelf/progress/bookmarks/notices/ops/invites/tokens/users/rateLimit/errors） | 可单测，不依赖 req/res（少数例外） |
| `lib/source/` | 书源数据查询、HTML 伪装模板、Legado payload 构造 | |
| `lib/chapterText.js` | 纯函数：编码识别、章节标题识别、分段合并、DOCX 抽取 | **测试覆盖率最高的一块** |
| `lib/memoryCache.js` | Map + TTL 的进程内缓存 | 无 LRU、无容量上限 |
| `lib/htmlCacheKey.js` | 前台 HTML 缓存键的唯一构造点 + 失效前缀 | 键序 = 失效维度在前、Host 在后 |
| `lib/redis.js` | 可选 Redis：连接生命周期、失效广播、故障降级 | 未配置即不加载 |
| `lib/rateLimitStore.js` | 限流计数：内存 / Redis 滑动窗口双实现 | 三处登录限流由此收敛 |
| `lib/pageViewQueue.js` | 访问日志批量入库队列 | 满 1000 条/1s 刷盘，可 flushAll |
| `lib/analytics.js` | `page_views` → `analytics_daily`/`analytics_totals` 定时聚合 | 60s / 1h 双周期 |
| `views/` | EJS 模板（前台 5 个 + 后台 8 个） | 章节页自带阅读器 JS（主题/字号/进度/键盘翻页） |
| `scripts/` | 部署、导入、冒烟、去重、schema 检查 | `deploy-ubuntu.sh` 是生产入口 |
| `tests/` | node:test 纯函数 + 上传限制 + API helper | `npm test` |

---

## 3. 三条请求链

### 3.1 Web 阅读链（最复杂）

```
GET /novel/:id/:chapterNum
  │
  ├─ router.use(webAuthRoutes)        ← /login /register /logout 在此短路
  ├─ router.use(authenticateToken)
  │    ├─ 非 GET/HEAD → 直接放行（POST 由各路由器自己保护）
  │    ├─ /admin /api /css /js /uploads /healthz /login /register → 放行
  │    └─ 其它 → requireAccessToken()
  │         ① ?token= / cookie access_token / /source/import/:token.json
  │            → 查 access_tokens（缓存 2min）→ 校验 allowedNovelId → 风控暂停判定
  │         ② Authorization: Bearer 或 cookie cn_jwt → 验 JWT → 查 users
  │         ③ 都没有 → 浏览器跳 /login?next=...；/source/* 返回 403 JSON
  ├─ router.use(recordPageView)
  │    └─ 仅当 req.accessTokenId 存在才入队（JWT 用户不计入统计，见 §10）
  ├─ router.use(sourceRoutes)          ← /source/* 在这里被接管
  └─ 命中 handler → 先查 HTML 缓存（键含 Host）→ MISS 则并行查 4 条 SQL → EJS 渲染 → 回写缓存
```

### 3.2 App API 链

```
/api/v1/*
 ├─ 统一加 X-API-Version: 1
 ├─ /health  公开
 ├─ /ops     公开读（GET），写需 X-Ops-Admin-Key
 ├─ /auth/*  authRateLimit（30/15min/IP+用户）
 ├─ /books/* requireReaderAuth（JWT 或站点 token 任一）
 │            └─ 章节正文额外 chapterRateLimit（180/min）+ ETag/304
 └─ /me/*    requireUser（必须 JWT）
              ├─ /me/shelf、/me/progress、/me/bookmarks、/me/devices、/me/notices
              └─ /me/progress/batch 额外 progressBatchRateLimit（60/min）
```

同步协议的两个关键约定：

- **进度 LWW**：客户端 `updatedAt` 不晚于服务端 → 不覆盖，返回 `applied:false` + 服务端权威副本。
- **增量追更**：`/toc/delta?since=` 用 `COALESCE(updated_at, created_at) > since`，`serverTime` 作为下次游标；书架 `hasUpdate = lastChapterNumber > progress.chapterNumber`。

### 3.3 Legado 书源链

`registerSourcePair(path, {json, html})` 一次注册成对路由：`/source/x` 与 `/source/html/x`。

- 只读，凭 Access Token（`?token=` 或 cookie），**不参与风控计时**（Legado 会并行拉多章，否则会被暂停）。
- `/source/legado` 与 `/source/import/:token.json` 直接产出可导入的 Legado 书源 JSON。
- 详情页刻意不内嵌全量目录（2000+ 章会拖垮客户端），目录走 `/source/(html/)toc/:id`。
- `resolveSourceNovel()` 有个"内容回退"策略：请求的书存在但没章节时，正文回退到任意有章节的书，但标题/封面仍展示请求的那本——为了让空书不至于整站 404。

---

## 4. 数据模型（22 张表）

| 分组 | 表 | 关键点 |
|------|----|--------|
| 内容 | `novels` | `status`、`last_chapter_number/title`（**冗余**，写入时由 `refreshNovelChapterStats()` 刷新）、`updated_at` 驱动增量追更 |
| 内容 | `chapters` | `UNIQUE(novel_id, chapter_number)` 是全局强约束；`content_hash`(sha256) 支撑 ETag；`content` LONGTEXT |
| 身份 | `access_tokens` | 分享/Legado 令牌。`allowed_novel_id` 限书，`risk_paused_until/reason` 风控，`total_views/last_seen_at` 累计计数 |
| 身份 | `users` / `user_sessions` | 读者账号；refresh token 只存 hash，轮换制；`email_verified_at` 记录验证时间 |
| 身份 | `email_tokens` | 验证/重置令牌，只存 sha256、一次性、带过期 |
| 读者数据 | `bookshelf` / `reading_progress` / `reading_bookmarks` | 主键 `(user_id, novel_id)`，全部外键级联删除 |
| 读者数据 | `device_subscriptions` | 只存 pushToken，**不真发推送**（明确 non-goal） |
| 运营 | `platform_settings` | KV 表：公告、强更策略、**付费全局默认**（`paywall_*`） |
| 运营 | `novel_paywall` | 每本书的付费规则（启用 / 免费到第 N 章 / 单价），无行则继承全局 |
| 运营 | `invite_codes` | 一次一码，`FOR UPDATE` 行锁 + 事务内核销 |
| 统计 | `page_views` | 两类身份列：`access_token_id`（分享/Legado 令牌）与 `user_id`（登录读者），二者可同时为 NULL（不记录）；含 `(access_token_id, created_at, novel_id, chapter_id)` 复合索引给风控用 |
| 统计 | `analytics_daily` / `analytics_totals` | 聚合层，看板 O(1) 读。`users`=访客数（DISTINCT visitor_uid），`readers`=登录读者数（DISTINCT user_id） |
| 交易 | `chapter_orders` | 单章购买记录，`(user_id, novel_id, chapter_number)` 唯一，防重复扣费 |
| 交易 | `user_wallets` | 余额（分）。**事务外**建行、事务内 `FOR UPDATE` 更新 |
| 交易 | `wallet_transactions` | 每次余额变动留痕（`delta` / `balance_after` / `type` / `ref`），用于对账 |
| 交易 | `recharge_codes` | 充值码，一次一码，带面额与有效期 |
| 系统 | `admin_sessions` / `schema_version` | 后台会话可吊销；迁移版本号 |

**索引设计主线**：所有"列表 + 计数"场景都用相关子查询吃 `uk_novel_chapter`，避免 `JOIN + GROUP BY` 大表（唯一例外是 `lib/source/novels.js` 的书源查询，它确实需要 `GROUP_CONCAT` 取末章）。

---

## 5. 缓存体系

| 键 | 值 | TTL | 写入点 |
|----|----|-----|--------|
| `html:home:{host}:{allowedId\|all}` | 首页 HTML | 5min | 前台 |
| `html:novel:{novelId}:{host}` | 目录 HTML | 5min | 前台 |
| `html:chapter:{novelId}:{chapterNum}:{host}` | 章节 HTML | 5min | 前台 |
| `paragraphs:v3:{chapterId}` | 分段数组 | 5min | 前台 |
| `web-access-token:{token}` | 令牌鉴权快照 | 2min | 中间件 |
| `api-access-token:{token}` | 同上（API 侧独立命名空间） | 2min | API 中间件 |
| `web-user:{userId}` | 读者公开信息 | 1min | 中间件 |
| `admin:novels:list` | 后台小说下拉 | 15s | admin |

键的段序是刻意设计：**失效维度（页面类型 / 小说 / 章节）在前，Host 在后**。这样后台用 `cache.clear(前缀)` 就能精准失效（可按小说收敛），同时 Host 仍参与键值——恶意 Host 渲染出的页面不会污染正常 Host（CWE-644）。所有键必须经 `lib/htmlCacheKey.js` 构造，**业务代码里不要手写 `html:xxx:` 字符串**。

`web-` / `api-` 两个令牌命名空间分离是为修"缓存形状冲突导致限书被绕过"。

---

## 6. 统计与风控管线

```
请求 ──> recordPageView ──> pageViewQueue.enqueue(事件)
          │ 有 accessTokenId 或 webUser 才记录
          │（两者可同时存在：分享令牌 + 已登录读者）
          │  内存数组
          ├─ 满 100 条 或 1s 到期 → flush()
          │      ├─ 批量 INSERT page_views（列顺序来自单一 COLUMNS 常量）
          │      └─ 按 token 汇总 UPDATE access_tokens.total_views（仅 token 行）
          └─ 超 10000 条 → shift 丢弃并计入 dropped

analytics.start()
 ├─ 启动：回填 14 天 + 强制刷 lifetime
 ├─ 每 60s：聚合今天+昨天 → analytics_daily
 └─ 每 60min：全表 DISTINCT → analytics_totals

风控（仅 Access Token，仅 /novel/:id/:num 这类真实章节路径）
 ├─ 内存滑动窗口 riskWindows: Map<tokenId, timestamp[]>
 ├─ 阈值：5 分钟内 75 章 → 暂停 1 小时
 ├─ 伪造 404 路径不计入（chapterExists 60s 缓存校验）
 └─ 命中后：内存置位 → 立刻 429；DB 落库 setImmediate 异步
```

后台看板：`/admin/dashboard` 先 `flush()` 队列 + `runAggregation(2)`，再读 `analytics_totals`/`analytics_daily`（明细部分扫近 7 天）。

两个指标的语义必须分清：

| 指标 | 口径 | 含义 |
|------|------|------|
| `users`（访客数） | `COUNT(DISTINCT visitor_uid)` | 按访客 Cookie 去重，匿名与登录读者都算 |
| `readers`（登录读者） | `COUNT(DISTINCT user_id)` | 按账号去重，只有登录过（Web JWT / App）的才计入 |

风控只认 `access_token_id`（`loadRiskWindow` 的 WHERE 条件），因此新增的读者行**不会**影响令牌风控窗口。

**日聚合的坑**：`aggregateDay` 不能写成 `INSERT ... SELECT ... GROUP BY DATE(created_at)`——某天没有数据时 SELECT 不返回任何行，`ON DUPLICATE KEY` 不触发，日表里会残留上一次的旧值（访问日志被清理后尤其明显，看板会永远显示历史数字）。现在是「先 SELECT 求和 → 再 upsert」，没有流量也会被写成 0。

---

## 6.5 付费分层（v8）

```
规则来源                          判定                            出口
platform_settings (全局默认)  ┐
novel_paywall (按书覆盖)      ├─> resolveRule(novelId) ─> isChapterPaid()
chapters.is_free/price (按章) ┘         │
                                        ├─ 免费  → 可走 HTML/段落缓存 → SSR / 书源 / API
                                        └─ 付费  → 绕开缓存 → 校验 chapter_orders
                                                     ├─ 已购 → 按人渲染，Cache-Control: no-store
                                                     └─ 未购 → 试读页 / 402 + teaser
```

设计要点：

- **规则不落库到章节行**。改「前 20 章」为「前 30 章」只是一次 upsert，不会去改几千行 chapters。
- **判定前置于缓存**。`mayBePaid()` 在读写缓存之前执行——这是整个付费体系的安全前提，不是性能优化。
- **按章覆盖走内存**。`getOverrides()` 只取 `is_free/price` 非空的少量行，所以「免费区间内单独收费某一章」也能在快路径上被拦下。
- **书源整本隐藏**。付费书留在书源里只会把读者赶走（目录有章节、正文抓不到），因此默认整本不出现；可通过后台开关改为「只出免费章」。

## 7. 内容导入流水线（本项目最"领域"的部分）

`lib/chapterText.js` 全是纯函数，可单测：

```
上传 .txt/.docx（multer，单文件 30MB、单次 50 个）
  → extractUploadedFile：BOM 嗅探 → UTF-16LE/BE → UTF-8（替换符 <1% 判定）→ 否则 GB18030
  → mammoth 抽 DOCX 纯文本
  → splitTextIntoChapters：
       逐行判定 isVolumeTitleLine（第N卷）与 isChapterTitleLine（第N章/回/节/集/部/篇、Chapter N、1. 标题、序章/楔子/番外…）
       无任何标题 → 整篇按文件名导入为单章（兜底，不丢内容）
       有标题 → 按标题切片，卷名只挂在该卷第一章，后续章去重前缀
  → formatChapterContent：全角空白归一 → 按句末标点重新分段（每段 2 空行）
  → INSERT + sha256(content) → content_hash
  → 事务提交 → refreshNovelChapterStats → 清缓存
```

阅读侧还有两个"反爬/阅读模式友好"的细节：

- `buildReaderChapterTitle()`：强制标题带「第N章」，否则夸克等浏览器不触发阅读模式。
- `mergeParagraphsForReader(…, 100)`：合并短段，避免对话体小说被判为非正文。

---

## 8. 后台管理面

| 路由 | 功能 |
|------|------|
| `/admin/login` `POST /admin/login` `POST /admin/logout` | 单密码登录（`timingSafeEqual`）+ 5 次/10 分钟限流 |
| `/admin` | 章节管理：左侧分页目录（默认 40/页，上限 100）+ 右侧编辑器（正文 AJAX 加载，避免 LONGTEXT 进 HTML） |
| `/admin/chapters/new` `POST /admin/chapters` `POST /admin/chapters/upload` `POST /admin/chapters/:id` `POST /admin/chapters/:id/delete` | 章节 CRUD + 批量导入（追加/覆盖） |
| `/admin/novels/info` + `POST /admin/novels*` | 小说信息、封面上传（magic number 校验）/删除 |
| `/admin/tokens` | 分享/Legado 令牌：建、启停、限书、删（删前把 page_views 的 token 归 NULL 保留历史） |
| `/admin/users` | 读者账号：建、禁用（清会话）、重置密码、踢下线、删 |
| `/admin/invites` | 一次一码生成（`INV-XXXXXXXX`）/查看/删未用 |
| `/admin/dashboard` | 数据看板 |

后台会话是 **HMAC 签名 cookie + `admin_sessions` 表双校验**：签名防篡改，DB 行使"主动吊销"成为可能（修了无状态 cookie 无法踢人的问题）。

---

## 9. 安全模型

四层身份，边界清晰：

1. **管理员** = `ADMIN_PASSWORD` + `admin_sessions`，只管 `/admin`。
2. **读者** = `users` + JWT access(2h) + opaque refresh(30d，存 hash，轮换)，Web(`cn_jwt` cookie) 与 App 同一账号。
3. **站点令牌** = `access_tokens`，只读，可限书，可被风控暂停。**不是账号**。
4. **匿名** = 仅能到 `/login`。

已落地的加固（都能在代码里找到注释说明"为什么"）：

- JWT 密钥缺失/短于 32 字节 → **拒绝启动**，禁止任何回退链（修 Critical 级 JWT 伪造）。
- 生产环境 `ADMIN_PASSWORD` 为默认值或缺 `ADMIN_SESSION_SECRET` → 拒绝启动。
- `trust proxy` 默认 false，限流/风控只认 socket 对端地址，`X-Forwarded-For` 伪造失效。
- HTML 缓存键带 Host；`getBaseUrl` 支持 `ALLOWED_HOSTS` 白名单。
- `/login` 与 `/admin/login` 都有滑动窗口限流；登录/注册额外校验 `Origin` / `Sec-Fetch-Site`（防登录 CSRF）。
- `sanitizeNext()` 同时拒绝 `//`、`\`（反斜杠归一化绕过）与 `/admin` 前缀（防开放重定向）。
- 封面 magic number 校验；DOCX 用 mammoth（不解析外部实体）。
- 邀请码 `FOR UPDATE` 行锁，防并发复用。
- 全部 SQL 使用 prepared statement；EJS 默认转义。

`strix_runs/codexnovel_af01/penetration_test_report.md`（2026-08-15）的结论：13 项发现（1 Critical / 1 High / 10 Medium / 1 Low），**SQL 注入、XSS、SSTI、SSRF、XXE、路径穿越、IDOR 全部验证为已加固**；Critical 项（JWT 弱密钥回退链）已在 `aa59fbf` 修复。

---

## 10. 技术债与真实缺陷

### 10.1 缓存失效曾整段落空（**已修复**，2026-10-30）

**曾有 bug**：缓存键为防 Host 头投毒改成了 `html:{host}:...`，但 `routes/admin/lib/cache.js` 的清理前缀没跟着改：

```js
cache.clear('html:home:');              // 键是 html:example.com:home:all  → 不匹配
cache.clear(`html:novel:${novelId}`);   // 键是 html:example.com:novel:5   → 不匹配
cache.clear('html:chapter:');           // 键是 html:example.com:chapter:… → 不匹配
```

后果是后台改完章节/小说，前台最长 **5 分钟**（`PUBLIC_CACHE_TTL_MS`）才更新；只有 `paragraphs:v3:{id}` 与令牌缓存正常。

**修法**（不是改前缀，而是消除"两处各写一份键格式"的结构性问题）：

1. 新增 `lib/htmlCacheKey.js` 作为**唯一构造点**，并把段序改为「失效维度在前、Host 在后」：
   `html:home:{host}:…` / `html:novel:{id}:{host}` / `html:chapter:{id}:{num}:{host}`。
2. `routes/admin/lib/cache.js` 只引用该模块导出的前缀，不再手写字符串。
3. 失效粒度反而更细了：改章节只清该小说的章节页与首页，不再全清所有小说。
4. `tests/html-cache-key.test.js` 用真实键构造器 + 真实清理函数交叉验证，锁死这条不变式。
5. 顺手修正 `scripts/dedupe-volume-titles.js`：它 clear 的是**另一个进程**的内存缓存，本来就无效。

### 10.2 JWT 读者的访问不被统计（**已修复**，2026-10-30）

**曾有 bug**：`recordPageView` 第一行 `if (!req.accessTokenId) return next();`——只有 Access Token 流量进 `page_views`，Web 登录用户与 App 用户的行为完全不进看板。

**修法**（v6 迁移，一次补齐整条链路，否则只改一半会出现「写进去但统计不出来」）：

| 层 | 改动 |
|----|------|
| `db.js` | `page_views.user_id` + `idx_user_id`；`analytics_daily.readers`、`analytics_totals.readers`；`SCHEMA_VERSION → 6` |
| `routes/middleware/auth.js` | 判定改为「有 `accessTokenId` **或** `webUser` 就记录」，两者并存时都写入 |
| `lib/pageViewQueue.js` | 列顺序抽成单一 `COLUMNS` 常量，INSERT 与取值同源；`bumpTokenCounters` 不再依赖魔数下标 `row[1]` |
| `lib/analytics.js` | 聚合新增 `COUNT(DISTINCT user_id) AS readers` |
| `routes/admin/lib/metrics.js` | 汇总/趋势带 `readers`；`userIpStats`/`latestViews` 关联 `users` 显示账号名 |
| `views/admin/dashboard.ejs` + `admin.css` | 新增「登录读者」卡片、趋势第 5 根柱、访问明细的「读者」列 |

**注意**：`users`（访客数）仍按 `visitor_uid` 去重，语义未改，历史数据不会跳变；新增的 `readers` 是独立维度。老数据该列为 0，启动时 14 天回填会自动补上近两周。

### 10.3 文档与实际不一致（doc drift，**已全部对齐** 2026-10-30）

| 文档 | 曾经的偏差 | 现状 |
|------|------------|------|
| `README.md` | 只有 Web + 后台，缺 `/api/v1`、`/login`、`/admin/users`、`/admin/invites`、`/admin/tokens` | 已重写：三形态总览、四层身份、完整路由与页面表 |
| `README.md` | 路由表列 `routes/admin.js` | 已改为真实目录结构 `routes/admin/*` |
| `README.md` | 统计口径写"前台 GET 请求" | 已改为「持令牌或已登录读者」，并区分访客数 / 登录读者 |
| `docs/api-v1.md`、`docs/api-ops.md` | SCHEMA 目标版本 4 | 已同步为 6，并补 v3~v6 各档内容表 |
| `docs/api-v1.md` | 复核结论：注册段落**本就**写明 `inviteCode` 必填，此前的判断有误 | 无需改动，已撤销该条 |

维护约定：**改 schema、改指标口径、改鉴权入口时，同一提交内同步 README 与对应 docs**。这三类信息最容易腐坏，且腐坏后不会被测试发现。

### 10.4 单进程状态的扩展性天花板（**部分已解决**，2026-10-30）

原状：`memoryCache`、`pageViewQueue`、`riskWindows`、三套限流窗口**全部在进程内存**，多实例下缓存各自为政、限流阈值 × 实例数。

现状（详见 `docs/multi-instance.md`）：

| 状态 | 多实例下的性质 | 处置 |
|------|----------------|------|
| HTML 缓存 | **正确性问题**（其他实例返回旧页面） | 已改为本地缓存 + Redis pub/sub 广播失效，命中路径仍是内存 |
| 限流窗口 | 防护削弱（阈值 × N） | 已改为 Redis 滑动窗口（ZSET + MULTI），超限请求不占配额 |
| 访问队列 | 无问题（各实例批量写同一 MySQL） | 刻意不动 |
| 风控窗口 | 仅判定变慢；暂停状态落库、任一实例读到时都生效 | 刻意不动 |
| 定时聚合 | 重复计算但幂等 | 可接受 |

全部为**可选**：未配 `REDIS_URL` 时零外部依赖，行为与改造前一致；Redis 故障自动降级为进程内，不会拖垮站点。

仍存在的限制：限流与失效只在配置 Redis 后跨实例生效；滚动发布时旧实例（无 Redis）不响应失效广播，发布窗口内仍可能返回旧页。

### 10.5 其它已知缺口

- `authenticateToken` 只处理 GET/HEAD，POST/PUT 完全依赖各子路由器自带守卫——新增写接口时必须自己加 `requireAdmin`/`requireUser`，没有兜底。
- `getTocDelta` 用 `COALESCE(updated_at, created_at)` 比较，无法走 `idx_chapters_novel_updated` 索引（函数包裹列）。
- `getChaptersPage`/`listUsers`/`listInviteCodes` 用字符串拼接 `LIMIT ${size} OFFSET ${offset}`（值已 `Math.min/max` 夹紧，安全但风格不统一）。
- 后台 `admin.js` 异步加载失败时会整页跳转，没有 inline 错误条。
- `public/audio-cache/` 是历史遗留空目录，代码中无任何 TTS/音频引用。
- 根目录混入 `release-*.tgz`、`strix_runs/`、`ppt_edit_tmp/`、`tmp-legado.json`、`书源规则：从入门到入土.html` 等未纳入版本控制的临时产物。

---

## 11. 改动时的坑清单（Cheat Sheet）

1. **改章节内容** → 必须同时更新 `content_hash` 与 `updated_at`，否则 ETag 与增量追更全部失效。请走 `routes/admin/chapters.js` 里的写法，别直接裸 SQL。
2. **新增/删除章节** → 必须调用 `refreshNovelChapterStats(novelId)`，否则 `novels.last_chapter_*` 冗余字段与书架"有新章"红点全错。
3. **`chapter_number` 是书内顺序号，不可复用**（唯一索引 + 进度绑定）。新章只追加。
4. **新增缓存键** → 一律走 `lib/htmlCacheKey.js` 构造，不要手写字符串；同时确认 `routes/admin/lib/cache.js` 的前缀能命中（`tests/html-cache-key.test.js` 会替你验）。
5. **新增公开写接口** → 记得自己挂鉴权，`authenticateToken` 不会帮你挡 POST。
6. **生产启动前置条件**：`ADMIN_PASSWORD`、`ADMIN_SESSION_SECRET`、`JWT_ACCESS_SECRET`(≥32B) 三者缺一即拒绝启动。
7. **`/source/*` 与风控解耦是刻意设计**，不要"顺手"把它纳入章节计数，否则 Legado 批量拉取会被集体暂停。
8. **迁移**：往 `db.js` 加表/列时，新增 `runSchemaMigrationsV{n}`，往 `MIGRATIONS` 数组末尾追加一项并提升 `SCHEMA_VERSION`，用 `columnExists`/`indexExists` 保证幂等。
9. **付费章节不得进缓存**：`html:chapter:` 与 `paragraphs:` 都是全站共享键，不含用户身份。新增任何缓存层之前，先用 `paywall.mayBePaid()` 判断——可能收费就必须绕开缓存，否则等于把付费正文公开。
10. **书源只读免费章**：`/source/*` 是明文出口，付费章节在那里必须表现为 404（不是「需付费」），否则会被用来确认章节存在。

---

## 12. 上手与验证

```bash
# 依赖与启动（需要 .env）
npm install
npm start                     # node --env-file=.env server.js

# 自检
curl -s localhost:3008/healthz            # 队列 + 缓存
curl -s localhost:3008/metrics            # Prometheus 指标
curl -s localhost:3008/api/v1/health      # {"status":"ok","apiVersion":1}

# 测试 / 冒烟
npm test                      # 纯函数 + 上传限制 + API helper
npm run smoke:source          # 需要运行中的服务 + 有效 token
API_BASE=http://localhost:3008 npm run smoke:api

# 关键入口
/                             首页（需登录或 ?token=）
/novel/:id/:chapterNum        章节阅读
/api/v1/books                 书库（JWT 或 X-Access-Token）
/source/import/<token>.json   Legado 一键导入
/admin/login                  后台
```

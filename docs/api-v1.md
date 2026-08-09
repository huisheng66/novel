# App Reader API v1

> 分支：**codexnovel `app`**（本仓库在此分支开发；`main` 保持稳定 Web）  
> 客户端：**ReadAny fork 用 `main`**  
> 目标：为官方 App 与后续 Web 升级提供统一读者接口。  
> **现有 Web SSR（`/`、`/novel/*`）与 Legado（`/source/*`）完整保留**，在此基础上增量升级，不替换、不下线。

Base path: `/api/v1`  
格式: JSON  
时间: ISO-8601 UTC  
API 版本响应头: `X-API-Version: 1`

## 错误格式

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Access token required"
  }
}
```

| code | HTTP | 含义 |
|------|------|------|
| `BAD_REQUEST` | 400 | 参数错误 |
| `UNAUTHORIZED` | 401 | 未登录 / token 无效 |
| `FORBIDDEN` | 403 | 无权限 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `CONFLICT` | 409 | 冲突（如用户名占用） |
| `REGISTER_DISABLED` | 403 | 关闭注册 |
| `RATE_LIMITED` | 429 | 触发限流（见 `Retry-After`） |
| `INTERNAL` | 500 | 服务器错误 |

## 鉴权

| 方式 | Header / Query | 用途 |
|------|----------------|------|
| 用户 JWT | `Authorization: Bearer <accessJwt>` | 书架、进度、书库（推荐） |
| 站点 Access Token | `X-Access-Token` 或 `?token=` | **只读**书库/正文（兼容分享与过渡） |

- 书架与进度：**必须**用户 JWT  
- 书列表/详情/目录/正文：用户 JWT **或** Access Token  
- Access Token 若绑定 `allowed_novel_id`，仅能访问该小说  

## 认证

### `POST /auth/register`

Body:

```json
{
  "username": "alice",
  "password": "secret12",
  "displayName": "Alice",
  "inviteCode": "INV-A1B2C3D4"
}
```

- `username`: 3–32，字母数字下划线  
- `password`: 至少 8 位  
- `inviteCode`：**必填**，后台「邀请码」生成的一次一码；用后即废  
- 受 `API_REGISTER_ENABLED` 控制（默认开发开启）；关闭后仅能后台建号  

响应 `201`：同 login。

### `POST /auth/login`

```json
{ "username": "alice", "password": "secret12", "deviceName": "Pixel" }
```

响应 `200`:

```json
{
  "user": { "id": 1, "username": "alice", "displayName": "Alice" },
  "accessToken": "<jwt>",
  "refreshToken": "<opaque>",
  "expiresIn": 7200
}
```

### `POST /auth/refresh`

```json
{ "refreshToken": "<opaque>" }
```

### `POST /auth/logout`

```json
{ "refreshToken": "<opaque>" }
```

### `GET /me`

需用户 JWT。返回当前用户。

### `GET /health`

无需鉴权。

```json
{ "status": "ok", "apiVersion": 1 }
```

## 书库

### `GET /books?q=&page=1&pageSize=20`

```json
{
  "page": 1,
  "pageSize": 20,
  "total": 2,
  "items": [
    {
      "id": 10,
      "title": "蛊真人",
      "author": "…",
      "description": "…",
      "coverUrl": "https://…/uploads/covers/….jpg",
      "status": "serializing",
      "chapterCount": 2284,
      "lastChapterNumber": 2284,
      "lastChapterTitle": "…",
      "updatedAt": "2026-08-08T12:00:00.000Z"
    }
  ]
}
```

### `GET /books/:id`

元数据，**不含**全量目录。

### `GET /books/:id/toc?page=1&pageSize=100`

```json
{
  "novelId": 10,
  "page": 1,
  "pageSize": 100,
  "total": 2284,
  "totalPages": 23,
  "items": [
    {
      "id": 9001,
      "chapterNumber": 1,
      "title": "第一章 …",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

### `GET /books/:id/toc/delta?since=&limit=500`（第 2 期）

增量目录：返回 `updated_at > since` 的章节元数据（新建 + 修文）。

- `since`：**必填**，ISO-8601  
- `limit`：默认 500，最大 2000；超出时 `truncated: true`

```json
{
  "novelId": 10,
  "since": "2026-08-01T00:00:00.000Z",
  "serverTime": "2026-08-08T12:00:00.000Z",
  "lastChapterNumber": 2284,
  "lastChapterTitle": "…",
  "novelUpdatedAt": "…",
  "truncated": false,
  "totalChanged": 5,
  "items": [
    {
      "id": 9010,
      "chapterNumber": 2280,
      "title": "…",
      "contentHash": "…",
      "updatedAt": "…"
    }
  ]
}
```

客户端应用：本地 TOC 合并 `items`；下次 `since` 用本次 `serverTime`（或本批最大 `updatedAt`）。

### `GET /books/:id/chapters/:chapterNumber`

```json
{
  "novelId": 10,
  "chapterId": 9001,
  "chapterNumber": 1,
  "title": "第一章 …",
  "content": "纯文本\\n\\n段落",
  "paragraphs": ["…"],
  "contentHash": "sha256hex",
  "updatedAt": "…",
  "prev": null,
  "next": 2
}
```

响应头：`ETag: "<contentHash>"`，`Cache-Control: private, max-age=60`。  
`If-None-Match` 支持：`"hash"`、`W/"hash"`、裸 hash、多值逗号分隔；匹配则 **304**。

## 书架

### `GET /me/shelf`

```json
{
  "items": [
    {
      "novelId": 10,
      "title": "…",
      "author": "…",
      "coverUrl": "…",
      "status": "serializing",
      "lastChapterNumber": 2284,
      "lastChapterTitle": "…",
      "novelUpdatedAt": "…",
      "addedAt": "…",
      "lastOpenedAt": null,
      "progress": {
        "chapterNumber": 120,
        "offsetRatio": 0.37,
        "updatedAt": "…"
      },
      "hasUpdate": true
    }
  ]
}
```

`hasUpdate`：有进度时，若 `lastChapterNumber > progress.chapterNumber` 则为 true。

### `GET /me/shelf/updates?since=`（第 2 期）

书架更新摘要。`since` 必填。

命中条件（或）：

1. 小说 `updated_at > since`  
2. 有进度且 `lastChapterNumber > progress.chapterNumber`

```json
{
  "since": "…",
  "serverTime": "…",
  "items": [
    {
      "novelId": 10,
      "title": "…",
      "lastChapterNumber": 2284,
      "lastChapterTitle": "…",
      "novelUpdatedAt": "…",
      "progress": { "chapterNumber": 120, "offsetRatio": 0.37, "updatedAt": "…" },
      "hasUpdate": true,
      "newChapterCount": 5
    }
  ]
}
```

### `POST /me/shelf`

```json
{ "novelId": 10 }
```

### `DELETE /me/shelf/:novelId`

## 进度

主键：`(userId, novelId)`。冲突：**LWW**，比较客户端 `updatedAt` 与库中 `updated_at`。

### `GET /me/progress`

### `GET /me/progress/:novelId`

### `PUT /me/progress`

```json
{
  "novelId": 10,
  "chapterNumber": 120,
  "offsetRatio": 0.37,
  "updatedAt": "2026-08-08T12:00:00.000Z",
  "deviceName": "Pixel"
}
```

- 若客户端时间 **不晚于** 服务端：不覆盖，返回服务端权威副本 + `"applied": false`  
- 否则写入并 `"applied": true`

### `POST /me/progress/batch`（第 3 期）

离线队列批量上报。单条失败不中断整批。

- 最多 **50** 条 / 请求  
- 每条规则同 `PUT /me/progress`（LWW）  
- 限流：默认 60 次/分钟/IP+用户（可配）

```json
{
  "items": [
    {
      "novelId": 10,
      "chapterNumber": 120,
      "offsetRatio": 0.37,
      "updatedAt": "2026-08-08T12:00:00.000Z",
      "deviceName": "Pixel"
    },
    {
      "novelId": 11,
      "chapterNumber": 3,
      "offsetRatio": 0.1,
      "updatedAt": "2026-08-08T11:00:00.000Z",
      "deviceName": "Pixel"
    }
  ]
}
```

响应：

```json
{
  "appliedCount": 1,
  "skippedCount": 0,
  "errorCount": 1,
  "serverTime": "…",
  "results": [
    { "novelId": 10, "applied": true, "progress": { "…": "…" } },
    { "novelId": 11, "applied": false, "error": { "code": "NOT_FOUND", "message": "Chapter not found" } }
  ]
}
```

### 客户端离线队列约定（第 3 期）

1. 本地先写进度（SQLite / localStorage）  
2. 联网后按 `updatedAt` 排序，`POST /me/progress/batch` 分批 flush（≤50）  
3. `applied: true` 或 `applied: false`（LWW 被拒）均可从队列移除该条  
4. 仅 `error` 且可恢复（网络/5xx）时保留重试；`NOT_FOUND` 可丢弃或标脏  
5. 正文缓存策略（App）：按 `contentHash` / ETag 存盘；清缓存不删进度  

## 限流（第 3 期）

| 范围 | 默认 | 环境变量 |
|------|------|----------|
| register / login / refresh | 30 次 / 15 分钟 / IP | `API_RATE_LIMIT_AUTH_MAX` / `…_WINDOW_MS` |
| 章节正文 GET | 180 次 / 分钟 / 用户+IP | `API_RATE_LIMIT_CHAPTER_MAX` / `…_WINDOW_MS` |
| progress batch | 60 次 / 分钟 / 用户+IP | `API_RATE_LIMIT_PROGRESS_BATCH_MAX` / `…_WINDOW_MS` |

触发时 HTTP **429**，`Retry-After` 秒，`error.code = RATE_LIMITED`。  
说明：单机内存窗口；多实例各自计数（后续可换 Redis）。

## 书签 / 笔记（第 4 期）

绑定：`userId + novelId + chapterNumber + offsetRatio`（并冗余 `chapterId`）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/me/bookmarks?novelId=` | 列表（可选按书过滤） |
| GET | `/me/bookmarks/:id` | 单条 |
| POST | `/me/bookmarks` | 创建 |
| PUT | `/me/bookmarks/:id` | 更新 note/offset/章 |
| DELETE | `/me/bookmarks/:id` | 删除 |

```json
// POST body
{
  "novelId": 10,
  "chapterNumber": 120,
  "offsetRatio": 0.25,
  "note": "这段伏笔",
  "color": "yellow"
}
```

## 运营面（第 4 期）

### `GET /ops`（无需登录）

```json
{
  "announcement": { "enabled": true, "text": "今晚 2 点维护" },
  "updatePolicy": {
    "minClientVersion": "1.2.0",
    "forceUpdate": false,
    "message": "请更新到最新版本后继续使用",
    "storeUrl": "https://…"
  },
  "serverTime": "…",
  "updatedAt": "…"
}
```

### `PUT /ops`（运维写）

Header：`X-Ops-Admin-Key: <API_OPS_ADMIN_KEY 或 ADMIN_PASSWORD>`

Body 示例：

```json
{
  "announcement": { "enabled": true, "text": "公告内容" },
  "updatePolicy": {
    "minClientVersion": "1.0.0",
    "forceUpdate": false,
    "message": "…",
    "storeUrl": ""
  }
}
```

## 设备订阅与更新通知（第 4 期）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/me/devices` | 注册/更新设备（`deviceId` 必填；`pushToken` 可选，**不**向 FCM 发送） |
| GET | `/me/devices` | 设备列表 |
| GET | `/me/notices/updates?since=` | 书架「有新章」通知（语义对齐 shelf/updates） |

`POST /me/devices` body：

```json
{ "deviceId": "pixel-abc", "platform": "android", "pushToken": "…", "enabled": true }
```

通知项含 `type: new_chapters`、`newChapterCount`、`message` 等。真实手机推送为非目标（见 Non-goals）。

## 章节 ID 约定

- `chapterNumber`：书内顺序号，与 Web `/novel/:id/:chapterNum` 一致；进度默认绑此字段  
- `chapterId`：数据库行 ID，稳定引用（笔记/书签使用）  
- **禁止**复用 `chapterNumber` 表达不同剧情章；新章只追加  

## 分期

| 能力 | 期 |
|------|----|
| auth / books / toc 分页 / chapter / shelf / progress | 1（已完成） |
| toc delta / shelf updates / ETag 强化 / Web 进度可选同步 | 2（已完成） |
| progress batch / 限流 / 运维文档 | 3（已完成） |
| 书签笔记 / 运营强更 / 设备订阅与更新通知 | 4（已完成；TTS/AI/真推送在客户端或后续） |

## 与 Web / Legado

| 路径 | 状态 |
|------|------|
| `/` `/novel/*` | **保留**；章节页若 `localStorage.codexnovel_access_token` 有 JWT，则读写 `/api/v1/me/progress`（与本地进度 LWW） |
| `/source/*` | **保留** Legado 兼容；Access Token 只读内容，不可写进度 |
| `/api/v1/*` | 官方 App + Web 增强 |

### Web 进度约定（第 2 期）

- 键：`localStorage.codexnovel_access_token` = 用户 JWT（App/调试可写入；正式 Web 登录页后期补）  
- 本地仍写 `reading-progress:{novelId}:{chapterNumber}`  
- 云端：`PUT /api/v1/me/progress`，`deviceName: "web"`  
- 打开章节：先 `GET /api/v1/me/progress/:novelId`，若服务端章号/时间更新则覆盖滚动位置

## 环境变量

```text
JWT_ACCESS_SECRET=
JWT_ACCESS_TTL_SEC=7200
JWT_REFRESH_TTL_DAYS=30
API_REGISTER_ENABLED=true
API_RATE_LIMIT_AUTH_MAX=30
API_RATE_LIMIT_AUTH_WINDOW_MS=900000
API_RATE_LIMIT_CHAPTER_MAX=180
API_RATE_LIMIT_CHAPTER_WINDOW_MS=60000
API_RATE_LIMIT_PROGRESS_BATCH_MAX=60
API_RATE_LIMIT_PROGRESS_BATCH_WINDOW_MS=60000
API_OPS_ADMIN_KEY=
```

生产备份与 SCHEMA 迁移见 [api-ops.md](./api-ops.md)。SCHEMA 当前目标版本 **4**。

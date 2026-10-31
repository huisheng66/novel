# 多实例部署：哪些状态必须外提，哪些不必

> 结论先行：**单实例不需要 Redis**，默认配置就是纯内存、零外部依赖。
> 一旦要跑多实例（多机、pm2 cluster、滚动发布保留旧实例），必须处理两件事：
> **缓存失效**与**限流计数**。其余进程内状态可以接受，或在数据库里已经是对的。

## 一、逐项盘点

| 状态 | 当前位置 | 多实例下的后果 | 处置 |
|------|----------|----------------|------|
| 前台 HTML / 段落 / 令牌缓存 | `lib/memoryCache.js`，进程内 Map | **正确性问题**：后台改完章节只清掉本实例的缓存，其他实例继续返回旧页面，直到 TTL（默认 5 分钟）过期 | ✅ 已用 Redis pub/sub 广播失效（各实例仍保留本地缓存，命中路径不变快） |
| 限流窗口（App API / Web 登录 / 后台登录） | `lib/rateLimitStore.js` | **防护被削弱**：N 个实例 → 实际阈值 ≈ 配置值 × N，暴力破解成本降到 1/N | ✅ 已改为 Redis 滑动窗口（ZSET），原子计数 |
| 访问日志队列 | `lib/pageViewQueue.js` | 各实例各自批量写 MySQL，**数据正确** | ⚪ 无需外提——队列本来就是「攒批写共享库」，多实例天然分摊写入 |
| 风控窗口（`riskWindows`） | `routes/middleware/auth.js` | 检测变慢：同一 token 的请求分散到 N 个实例，各自统计，达到暂停阈值的时间推迟 | ⚪ 刻意保留。暂停状态本身落在 `access_tokens.risk_paused_until`，任何实例读到都会立即 429；内存窗口只是「加速判定」 |
| 看板定时聚合 | `lib/analytics.js` | 多实例会重复跑同一段聚合 | ⚪ 可接受：`aggregateDay` / `refreshLifetimeTotals` 都是幂等 upsert，重复执行结果一致；只是多耗一点 CPU |
| 后台会话 | `admin_sessions` 表（MySQL） | 无影响 | ✅ 本来就是共享的，可主动吊销 |
| 邀请码 / 进度 / 书架 / 书签 | MySQL | 无影响 | ✅ |
| 内存占用的章节段落缓存 | 进程内 | —— | ⚪ 每实例各存一份，内存 ≈ 实例数 × 单实例用量 |

## 二、怎么开启

```env
REDIS_URL=redis://127.0.0.1:6379
# 带密码：redis://:password@host:6379/0
```

启动后确认：

```bash
curl -s localhost:3008/healthz | jq '.redis, .rateLimit'
# { "status": "ready", "configured": true, ... }
# { "keys": 0, "backend": "redis" }
```

`status` 的取值含义：

| status | 含义 |
|--------|------|
| `disabled` | 未配置 `REDIS_URL`，纯内存（默认） |
| `ready` | 已连接，限流与失效广播跨实例生效 |
| `error` | 连接失败或中途断开，**已自动降级为进程内**，`lastError` 给出原因 |

## 三、降级策略（刻意设计）

Redis 出问题**不允许把站点带崩**：

| 场景 | 行为 |
|------|------|
| 未配置 `REDIS_URL` | 完全不加载 ioredis，行为与改造前一致 |
| 启动时连不上 | 记一条 error 日志，`status=error`，服务照常启动，限流走内存 |
| 运行中断连 | 翻转为内存模式并记 warn，恢复后需重启才重新接入（尚未做自动重连后的状态回迁） |
| 单条命令失败 | 降级为内存计数，请求不被拒绝 |

代价要认清：**降级期间限流是单机口径、缓存失效只作用于本机**。所以 Redis 的可用性要求不应低于应用本身。

## 四、上线前必须在真实 Redis 上验证的点

本仓库的自动化测试用的是 `ioredis-mock`（`tests/redis-backend.test.js`），它验证的是**代码逻辑**（命令组合、原子性假设、降级、回环过滤），
**不能替代真实 Redis 的行为验证**。切到生产前请至少确认：

1. **时钟与 TTL**：限流 key 用 `PEXPIRE` 兜底，若 Redis 与应用的时钟偏差大，窗口会偏移。
2. **pub/sub 断线重连**：ioredis 会自动重连并重新订阅，但需要在网络抖动后实际观察一次失效广播是否仍然生效。
3. **key 前缀冲突**：所有键带 `codexnovel:` 前缀（限流 `codexnovel:rl:*`、失效频道 `codexnovel:cache:invalidate`）；共用 Redis 实例时不要与其它系统撞键。
4. **内存占用**：限流 ZSET 每个活跃 key 只保留窗口内的成员，但**风控窗口仍在应用内存**；若 token 数量极大，请观察应用侧内存。
5. **多实例灰度的场景**：滚动发布时新旧实例并存，旧版本（无 Redis）不会响应失效广播——发布期间仍可能出现旧页面，属预期。

## 五、不想上 Redis 的话

那就**只跑单实例**，并注意这几件事：

- 不要用 `pm2 start -i max` / `node cluster` 起多个 worker：它们是独立进程，同样享受不到共享状态。
- 滚动发布时不要让新旧实例同时对外服务（旧实例的缓存不会收到失效通知，会继续返回旧页面）。
- 扩容到多机前，先把 `REDIS_URL` 配上，否则最先出问题的不是性能，而是**内容更新不生效**。

## 六、相关实现位置

| 文件 | 职责 |
|------|------|
| `lib/redis.js` | 连接生命周期、失效频道、降级与状态上报 |
| `lib/rateLimitStore.js` | 滑动窗口计数：内存 / Redis 双实现，超限请求不占配额 |
| `lib/memoryCache.js` | 缓存工厂 `createCacheStore({ publish })` + 默认单例；`clearLocal` 供订阅端使用 |
| `server.js` | 启动时 `init` + 订阅，关闭时 `close`；`/healthz` 暴露 `redis` 与 `rateLimit` 状态 |

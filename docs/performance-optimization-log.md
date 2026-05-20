# 性能优化测试日志

## 2026-05-15 前台与后台高并发优化

目标：

- 前台目录页、章节页增加短 TTL 缓存。
- `page_views` 改为内存队列批量落库。
- 章节正文页缓存 paragraphs 拆分结果。
- 后台章节列表改为分页渲染，避免一次输出全部章节。
- 数据库连接池改为可配置。
- 一键部署脚本加入 Nginx gzip、可用时启用 Brotli、静态资源缓存头。

## 本次代码优化

1. 新增 `lib/memoryCache.js`
   - 默认 `PUBLIC_CACHE_TTL_MS=10000`。
   - 缓存前台渲染后的 HTML。
   - 缓存章节 paragraphs 拆分结果。
   - 后台小说/章节写操作后清空前台缓存。

2. 新增 `lib/pageViewQueue.js`
   - 默认 `PAGE_VIEW_BATCH_SIZE=100`。
   - 默认 `PAGE_VIEW_FLUSH_INTERVAL_MS=1000`。
   - 前台 GET 请求先进入内存队列，再批量 `INSERT INTO page_views ... VALUES ?`。
   - 服务退出前调用 `flushAll()`，尽量落库剩余访问记录。

3. 优化后台章节列表
   - 默认每页 80 章。
   - `page_size` 最大 200。
   - URL 支持 `chapter_page`。
   - 如果 URL 带 `chapter_id`，服务端自动定位到该章节所在页。

4. 数据库连接池
   - `DB_CONNECTION_LIMIT` 默认 20。
   - `DB_QUEUE_LIMIT` 默认 0。

5. 一键部署脚本
   - `.env` 自动写入性能参数。
   - Nginx 开启 gzip。
   - Nginx 支持 Brotli 时自动启用。
   - `/css`、`/js`、`/favicon.ico` 添加 7 天静态缓存头。

## 本地验证

环境：

- Windows 本机
- Node.js / Express / MySQL
- 目标：`http://localhost:3008`
- 压测工具：`tools/load-test.js`

语法检查：

```powershell
node --check db.js
node --check server.js
node --check routes\index.js
node --check routes\admin.js
node --check lib\memoryCache.js
node --check lib\pageViewQueue.js
```

结果：全部通过。

功能验证：

- 首页首次请求：`X-Cache: MISS`
- 首页第二次请求：`X-Cache: HIT`
- 章节页首次请求：`X-Cache: MISS`
- 章节页第二次请求：`X-Cache: HIT`
- 后台 `/admin?novel_id=1`：`200 OK`
- 后台 `/admin?novel_id=1&chapter_page=2`：`200 OK`，显示上一页/下一页

## 压测结果

优化后短压测：

| 场景 | 并发 | 时长 | RPS | P50 | P95 | P99 | 错误 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | 100 | 8s | 2376.87 | 39.71ms | 46.87ms | 63.62ms | 0 |
| `/novel/1/4` | 100 | 8s | 2473.01 | 39.32ms | 46.63ms | 58.37ms | 0 |

优化前同类结果：

| 场景 | 并发 | 时长 | RPS | P95 | 错误 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/` | 100 | 10s | 454.87 | 240ms | 0 |
| `/novel/1/4` | 100 | 8s | 109.13 | 998ms | 0 |

结论：

- 首页 100 并发吞吐从约 455 RPS 提升到约 2377 RPS。
- 章节页 100 并发吞吐从约 109 RPS 提升到约 2473 RPS。
- 章节页 P95 从约 998ms 降到约 47ms。
- 当前主要瓶颈已从 EJS 渲染、正文拆分和单条统计写库，转为网络/Node 事件循环/本机环境开销。

## 遇到的问题与修复

### MySQL LIMIT 参数兼容问题

现象：

```text
Error: Incorrect arguments to mysqld_stmt_execute
```

原因：

- 当前 MySQL 驱动/服务端组合对预处理语句里的 `LIMIT ? OFFSET ?` 参数兼容不稳定。

修复：

- `page`、`pageSize`、`offset` 在服务端先转为受限整数。
- SQL 中仅内联已校验的 `LIMIT ${pageSize} OFFSET ${offset}`。
- 其它用户输入仍使用参数绑定。

### 退出时统计队列 flush 边界

问题：

- 如果退出时已有批量写入正在执行，`flushAll()` 可能没有等待当前批次结束。

修复：

- `pageViewQueue.flush()` 增加 `activeFlush` 等待逻辑。
- 如果已有 flush 进行中，后续调用会等待它完成。

## 后续建议

- 在 Ubuntu 测试机上用真实 Nginx 入口复测 gzip、静态资源缓存头和 systemd 退出 flush。
- 结合 `SHOW VARIABLES LIKE 'max_connections';` 调整 `DB_CONNECTION_LIMIT`，建议连接池不要超过 MySQL 最大连接数的 50%。
- 如果章节规模继续增长到数万章，后台列表可继续升级为搜索 + 虚拟滚动。

## 2026-05-15 Ubuntu 测试机 Nginx 入口复测

目标：

- 将当前优化版本部署到 Ubuntu 测试机。
- 通过 Nginx 入口 `http://192.168.159.130/` 复测前台高并发。
- 验证 gzip 和静态资源缓存头。

测试机：

- IP：`192.168.159.130`
- SSH 用户：`huisheng`
- 部署目录：`/home/huisheng/codexnovel-deploy-test`
- 应用端口：`3008`
- Nginx 入口：`http://192.168.159.130/`

部署命令：

```bash
sudo ADMIN_PASSWORD='admin123' DB_PASSWORD='000000' PORT=3008 DB_CONNECTION_LIMIT=20 PUBLIC_CACHE_TTL_MS=10000 PAGE_VIEW_BATCH_SIZE=100 PAGE_VIEW_FLUSH_INTERVAL_MS=1000 bash scripts/deploy-ubuntu.sh
```

部署结果：

- 一键部署脚本退出码：`0`
- `codexnovel` systemd 服务：`active`
- Nginx 配置检查：`successful`
- 访问 `http://192.168.159.130/`：`200 OK`
- 访问 `http://192.168.159.130/admin/login`：`200 OK`

功能验证：

- 首页首次请求：`X-Cache: MISS`
- 首页第二次请求：`X-Cache: HIT`
- 章节页首次请求：`X-Cache: MISS`
- 章节页第二次请求：`X-Cache: HIT`
- 静态资源 `main.css`：`Cache-Control: max-age=604800`
- 静态资源 gzip：`Content-Encoding: gzip`

Nginx 入口压测：

| 场景 | 并发 | 时长 | RPS | P50 | P95 | P99 | 错误 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | 100 | 10s | 1229.18 | 77.80ms | 109.87ms | 127.83ms | 0 |
| `/novel/1/4` | 100 | 10s | 1229.43 | 77.79ms | 108.90ms | 127.98ms | 0 |
| `/` | 200 | 10s | 1383.43 | 144.30ms | 203.12ms | 357.41ms | 0 |
| `/novel/1/4` | 200 | 10s | 1689.40 | 141.60ms | 182.48ms | 222.79ms | 0 |
| `/novel/1/4` | 100 | 5s | 2837.51 | 31.08ms | 50.56ms | 62.10ms | 0 |

远端状态采样：

- Node 服务内存：约 `74.9M`
- MySQL `Threads_connected`：`10`
- MySQL `max_connections`：`151`
- `DB_CONNECTION_LIMIT`：`20`

遇到的问题与优化：

### 静态资源 Cache-Control 重复

现象：

```text
Cache-Control: max-age=604800,public, max-age=604800, immutable
```

原因：

- Express 生产静态资源头和 Nginx `add_header Cache-Control` 同时存在。
- Nginx `expires 7d` 也会生成 `Cache-Control`。

修复：

- Nginx 静态资源 location 增加：
  - `proxy_hide_header Cache-Control;`
  - `proxy_hide_header Expires;`
- 移除手动 `add_header Cache-Control ...`。
- 保留 `expires 7d` 生成标准缓存头。

修复后：

```text
Cache-Control: max-age=604800
Content-Encoding: gzip
Vary: Accept-Encoding
```

剩余提示：

- Nginx 仍提示 `conflicting server name "192.168.159.130"`，原因是测试机已有其它站点使用同一 IP 作为 `server_name`。当前健康检查和入口压测均正常，生产环境建议绑定正式域名部署。

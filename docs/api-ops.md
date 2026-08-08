# App API 运维：备份、迁移与回滚

> 适用分支：`app`（含 `/api/v1` 与 SCHEMA ≥ 3）  
> Web SSR / Legado 与 API 共用同一 MySQL。

## 1. 升级前备份

在应用目录或运维机执行（按实际账号改）：

```bash
# 逻辑备份（推荐，可跨机恢复）
mysqldump -u root -p \
  --single-transaction --routines --triggers \
  --databases novel \
  > "backup-novel-$(date +%Y%m%d%H%M%S).sql"

# 若无 PROCESS 权限可用 root + --no-tablespaces
mysqldump -u root -p --no-tablespaces --single-transaction novel \
  > "backup-novel-$(date +%Y%m%d%H%M%S).sql"
```

建议保留至少：

- 升级前 1 份  
- 每日滚动 7 天  

备份对象重点表：`novels`、`chapters`、`users`、`user_sessions`、`bookshelf`、`reading_progress`、`access_tokens`。

## 2. SCHEMA 迁移

应用启动时 `db.js` `initDB()`：

- 读 `schema_version`  
- 若 `< SCHEMA_VERSION` 则跑增量迁移并写入版本号  

当前目标版本：**4**（v3 + 书签/笔记、platform_settings、device_subscriptions）。

```bash
# 部署后确认
mysql -u novel_app -p novel -e "SELECT * FROM schema_version ORDER BY version DESC;"
mysql -u novel_app -p novel -e "SHOW TABLES LIKE 'users'; SHOW TABLES LIKE 'reading_progress';"
```

或：

```bash
node --env-file=.env scripts/check-schema-v3.js
```

迁移特点：

- 幂等（`columnExists` / `CREATE TABLE IF NOT EXISTS`）  
- 会回填 `content_hash`、`last_chapter_*`（大库首次可能稍慢）  

## 3. 应用发布（app 分支）

```bash
git fetch && git checkout app && git pull
npm ci --omit=dev   # 或 npm install --production
# 确认 .env：JWT_ACCESS_SECRET、API_REGISTER_ENABLED、限流参数
sudo systemctl restart codexnovel   # 服务名以实际为准
curl -sS http://127.0.0.1:3008/api/v1/health
# 期望 {"status":"ok","apiVersion":1}
```

冒烟（有网络与测试库时）：

```bash
API_BASE=https://your.domain npm run smoke:api
```

## 4. 回滚

| 情况 | 做法 |
|------|------|
| 仅代码问题 | 切回上一 git tag/commit，重启；**表可保留** |
| API 需下线 | 去掉 `server.js` 中 `/api/v1` 挂载或反向代理不转发；Web/Legado 不受影响 |
| 错误迁移（少见） | 停服 → 用升级前 sql 恢复 → 再发修复版 |

**不要**在未备份时 `DROP TABLE users` / `reading_progress`。

## 5. 密钥与注册

生产建议：

```text
JWT_ACCESS_SECRET=<长随机串，勿与 ADMIN_PASSWORD 相同>
API_REGISTER_ENABLED=false
ADMIN_SESSION_SECRET=<独立随机串>
```

关闭自助注册后，可用 SQL 建用户或后续加 admin 建号接口：

```sql
-- 仅示例：密码需用应用 bcrypt 生成，勿手写明文 hash
-- 推荐：临时打开注册建号后立刻关闭，或写运维脚本调用 /api/v1/auth/register
```

## 6. 限流与多实例

当前限流为**进程内存**。多机部署时每机独立计数，有效阈值 ≈ 单机阈值 × 实例数。  
若需全局限流，后续可换 Redis；在此之前可适当收紧 `API_RATE_LIMIT_*`。

## 7. 与 main 分支关系

| 分支 | 内容 |
|------|------|
| `main` | 稳定 Web + 后台（可不含 `/api/v1`） |
| `app` | Web + `/api/v1` 读者 API |

生产若只提供网页可读 `main`；上 App 则部署 `app` 并完成 SCHEMA 3。

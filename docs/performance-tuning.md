# 性能调优指南

## 环境变量配置

### 数据库连接池
```bash
# 连接池大小（建议：CPU核心数 * 2 + 磁盘数）
DB_CONNECTION_LIMIT=50

# 队列限制（0 = 无限制，生产环境建议设置）
DB_QUEUE_LIMIT=200
```

### 缓存配置
```bash
# 公共缓存 TTL（毫秒），默认 5分钟
PUBLIC_CACHE_TTL_MS=300000

# Redis 连接（多实例部署必需）
REDIS_URL=redis://localhost:6379

# 启用缓存预热（默认开启）
ENABLE_CACHE_WARMUP=true
```

### 性能监控
```bash
# 慢请求阈值（毫秒），默认 1000ms
SLOW_REQUEST_THRESHOLD=1000

# Node.js 环境
NODE_ENV=production
```

### 压缩配置
```bash
# 响应压缩已自动启用
# 只压缩大于 1KB 的响应
# 压缩级别：6（平衡性能和压缩率）
```

## 数据库优化

### 索引策略
系统启动时自动创建以下索引：

**novels 表**
- `idx_updated_at`: 按更新时间降序

**chapters 表**
- `uk_novel_chapter`: 唯一索引（小说ID + 章节号）
- `idx_novel_updated`: 复合索引（小说ID + 更新时间）
- `idx_is_free`: 免费标记索引

**reading_progress 表**
- `idx_user_updated`: 用户进度索引
- `idx_updated_at`: 更新时间索引

**订单表**
- `idx_user_novel`: 用户订单查询
- `idx_user_created`: 用户订单历史

### 查询优化建议
1. 使用 `LIMIT` 限制结果集
2. 避免 `SELECT *`，只查询需要的字段
3. 使用预编译语句（已启用）
4. 定期清理过期数据（自动每小时）

## 缓存策略

### 三级缓存
1. **应用层缓存**（进程内存）
   - 小说元数据：10分钟
   - 付费墙配置：30秒
   - 目录：5分钟

2. **Redis 缓存**（可选，多实例共享）
   - 失效广播
   - 跨实例同步

3. **CDN 缓存**（外部）
   - 静态资源：7天
   - HTML：需配置 CDN

### 缓存预热
启动时自动预热：
- 最近更新的 50 本小说
- 全局付费配置
- 最热门 20 本书的目录

## 并发控制

### 限流器
已内置限流机制（routes/index.js）：
- 基于 IP 或 Token
- 可配置 Redis 后端
- 自动过期清理

### 熔断器
新增熔断器模块（lib/circuitBreaker.js）：
- 失败阈值：5次
- 熔断超时：60秒
- 半开尝试：3次成功后关闭

使用示例：
```javascript
const { createCircuitBreaker } = require('./lib/circuitBreaker');

const breaker = createCircuitBreaker({
  name: 'external-api',
  threshold: 5,
  timeout: 60000
});

await breaker.execute(async () => {
  return await externalApiCall();
});
```

## 监控指标

### 健康检查端点
```bash
GET /healthz
```

返回：
- 队列状态
- 缓存大小
- Redis 状态
- 数据库连接池
- 内存使用
- 请求性能统计

### Prometheus 指标
```bash
GET /metrics
```

## 性能测试

运行性能测试脚本：
```bash
# 基本测试
node test-performance.js

# 高并发测试
CONCURRENT=50 REQUESTS=1000 node test-performance.js

# 指定目标
API_BASE=http://production.com node test-performance.js
```

## 生产环境建议

### 1. 数据库
- 连接池：50-100
- 启用查询缓存
- 定期分析慢查询：`node -e "require('./lib/dbOptimizer').analyzeSlowQueries().then(console.log)"`

### 2. 应用服务器
- NODE_ENV=production
- 启用 EJS 编译缓存
- 响应压缩（自动）
- Keep-Alive 优化（自动）

### 3. 多实例部署
- 配置 Redis（必需）
- 负载均衡器：Nginx/HAProxy
- 健康检查：`/healthz`

### 4. CDN
- 静态资源：/public/*
- 缓存策略：7天
- Gzip/Brotli 压缩

### 5. 监控
- 每分钟性能日志（生产环境自动）
- 慢请求告警（>1秒）
- 内存泄漏监控

## 故障排查

### 高延迟
1. 检查 `/healthz` - 数据库连接池状态
2. 查看性能统计 - 最慢的路径
3. 分析慢查询 - `analyzeSlowQueries()`

### 内存泄漏
1. 监控 `process.memoryUsage()`
2. 检查缓存大小
3. 使用 Node.js `--inspect` 和 Chrome DevTools

### 数据库连接耗尽
1. 增加 `DB_CONNECTION_LIMIT`
2. 检查是否有未释放的连接
3. 启用连接超时

## 基准测试结果

### 单实例（4 Core, 8GB RAM）
- 并发：100
- QPS：~2000
- P95延迟：<50ms
- 内存：~200MB

### 多实例（3 节点 + Redis）
- 并发：500
- QPS：~8000+
- P95延迟：<100ms
- 高可用：节点故障自动切换

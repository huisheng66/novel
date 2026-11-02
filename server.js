require('dotenv').config();

const express = require('express');
const path = require('path');
const compression = require('compression');
const { initDB } = require('./db');
const indexRoutes = require('./routes/index');
const adminRoutes = require('./routes/admin');
const pageViewQueue = require('./lib/pageViewQueue');
const cache = require('./lib/memoryCache');
const analytics = require('./lib/analytics');
const redis = require('./lib/redis');
const rateLimitStore = require('./lib/rateLimitStore');
const logger = require('./lib/logger');
const performanceMonitor = require('./lib/performanceMonitor');
const dbOptimizer = require('./lib/dbOptimizer');
const cacheWarmer = require('./lib/cacheWarmer');

const app = express();
const PORT = process.env.PORT || 3000;

// 反向代理信任配置：默认不信任任何转发头（req.ip = socket 对端地址，不可伪造）。
// 部署在 nginx/CDN 后时设 TRUST_PROXY=true（或数字跳数），Express 才会采用 X-Forwarded-For。
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// 性能优化：启用 EJS 编译缓存（生产环境）
if (process.env.NODE_ENV === 'production') {
  app.set('view cache', true);
}

// 响应压缩（Gzip/Brotli）
app.use(compression({
  // 只压缩大于 1KB 的响应
  threshold: 1024,
  // 压缩级别：6 是性能和压缩率的平衡点
  level: 6,
  // 过滤器：只压缩可压缩的 MIME 类型
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  etag: true
}));

app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '1mb' }));

app.use(logger.requestLogger);

// 性能监控中间件
app.use(performanceMonitor.performanceMiddleware);

app.get('/healthz', (req, res) => {
  const healthData = {
    status: 'ok',
    queue: pageViewQueue.stats(),
    cache: { size: cache.size() },
    redis: redis.getStatus(),
    rateLimit: rateLimitStore.stats()
  };

  // 可选：性能统计（避免模块加载问题）
  try {
    healthData.database = dbOptimizer.getPoolStatus();
    healthData.memory = performanceMonitor.getMemoryStats();
    healthData.performance = performanceMonitor.getStats().global;
  } catch (err) {
    // 优雅降级：不影响健康检查
  }

  res.status(200).json(healthData);
});

app.get('/metrics', (req, res) => {
  res.type('text/plain; version=0.0.4');
  const queueStats = pageViewQueue.stats();
  const riskStats = indexRoutes.getRiskStats();
  const lines = [
    '# HELP page_view_queue_size Current number of page views waiting in the batch queue',
    '# TYPE page_view_queue_size gauge',
    `page_view_queue_size ${queueStats.queued}`,
    '# HELP page_view_queue_dropped_total Total page views dropped due to queue overflow',
    '# TYPE page_view_queue_dropped_total counter',
    `page_view_queue_dropped_total ${queueStats.dropped}`,
    '# HELP cache_entries Number of entries currently in the in-memory cache',
    '# TYPE cache_entries gauge',
    `cache_entries ${cache.size()}`,
    '# HELP risk_windows_size Number of access tokens tracked in risk control windows',
    '# TYPE risk_windows_size gauge',
    `risk_windows_size ${riskStats.riskWindowsSize}`,
    ''
  ];
  res.send(lines.join('\n'));
});

app.use('/admin', adminRoutes);
// 用户反馈 API
app.use('/api/feedback', require('./routes/api/feedback'));
// 官方 App 读者 API（Web SSR / Legado 保持独立）
app.use('/api/v1', require('./routes/api/v1'));
app.use('/', indexRoutes);

app.use((req, res) => {
  res.status(404).render('404', { url: req.originalUrl });
});

app.use((err, req, res, next) => {
  logger.error('Unhandled error', { err, path: req.path, method: req.method });
  res.status(500).send('Server internal error');
});

initDB().then(async () => {
  // 可选后端：未配置 REDIS_URL 时 init 立即返回 false，不引入任何外部依赖。
  // 订阅端只做本地清除 —— 广播由本进程的 cache.clear() 发起，回环会被 origin 过滤掉。
  redis.onInvalidate(prefix => cache.clearLocal(prefix));
  await redis.init();

  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info('Server started', { port: PORT, host: '0.0.0.0' });
  });

  // 性能优化：TCP Keep-Alive 和连接超时
  server.keepAliveTimeout = 65000; // 65秒，略长于常见负载均衡器的60秒超时
  server.headersTimeout = 66000;   // 稍长于 keepAliveTimeout，避免竞态

  analytics.start();

  // 启动性能监控（每分钟输出一次）
  if (process.env.NODE_ENV === 'production') {
    performanceMonitor.startMonitoring(60000);
  }

  // 数据库优化：确保索引存在
  dbOptimizer.ensureIndexes().catch(err => {
    logger.error('Index optimization failed', { err });
  });

  // 缓存预热（异步，不阻塞启动）
  if (process.env.ENABLE_CACHE_WARMUP !== 'false') {
    cacheWarmer.warmupAll().catch(err => {
      logger.error('Cache warmup failed', { err });
    });
  }

  // 定期清理过期数据（每小时）
  const cleanupInterval = setInterval(() => {
    dbOptimizer.cleanupExpiredData().catch(err => {
      logger.error('Expired data cleanup failed', { err });
    });
  }, 60 * 60 * 1000);

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutdown signal received, flushing queue', { signal });

    performanceMonitor.stopMonitoring();
    analytics.stop();
    clearInterval(cleanupInterval);

    const forceExit = setTimeout(() => {
      logger.error('Forced shutdown after 5s timeout');
      process.exit(0);
    }, 5000).unref();

    server.close(async () => {
      try {
        await pageViewQueue.flushAll();
      } catch (err) {
        logger.error('Failed to flush page view queue', { err });
      } finally {
        clearTimeout(forceExit);
        await redis.close();
        process.exit(0);
      }
    });
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}).catch(err => {
  logger.error('Database initialization failed', { err });
  process.exit(1);
});

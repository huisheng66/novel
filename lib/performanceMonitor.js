// 性能监控中间件
const logger = require('./logger');

// 慢请求阈值（毫秒）
const SLOW_REQUEST_THRESHOLD = parseInt(process.env.SLOW_REQUEST_THRESHOLD) || 1000;

// 请求统计
const stats = {
  total: 0,
  slow: 0,
  errors: 0,
  totalDuration: 0
};

// 路径级别统计（前100个最慢的路径）
const pathStats = new Map();
const MAX_PATH_STATS = 100;

/**
 * 性能监控中间件
 */
function performanceMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  const path = req.path;

  // 响应完成时记录
  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const duration = Number(end - start) / 1e6; // 转换为毫秒

    // 全局统计
    stats.total++;
    stats.totalDuration += duration;

    if (res.statusCode >= 500) {
      stats.errors++;
    }

    if (duration > SLOW_REQUEST_THRESHOLD) {
      stats.slow++;
      logger.warn('Slow request detected', {
        method: req.method,
        path,
        duration: duration.toFixed(2),
        statusCode: res.statusCode
      });
    }

    // 路径级别统计
    if (!pathStats.has(path)) {
      if (pathStats.size >= MAX_PATH_STATS) {
        // 删除最快的路径统计
        const slowest = Array.from(pathStats.entries())
          .sort((a, b) => a[1].avgDuration - b[1].avgDuration)[0];
        if (slowest) pathStats.delete(slowest[0]);
      }

      pathStats.set(path, {
        count: 0,
        totalDuration: 0,
        maxDuration: 0,
        minDuration: Infinity,
        avgDuration: 0
      });
    }

    const pathStat = pathStats.get(path);
    pathStat.count++;
    pathStat.totalDuration += duration;
    pathStat.maxDuration = Math.max(pathStat.maxDuration, duration);
    pathStat.minDuration = Math.min(pathStat.minDuration, duration);
    pathStat.avgDuration = pathStat.totalDuration / pathStat.count;
  });

  next();
}

/**
 * 获取性能统计
 */
function getStats() {
  const avgDuration = stats.total > 0 ? stats.totalDuration / stats.total : 0;

  return {
    global: {
      total: stats.total,
      slow: stats.slow,
      errors: stats.errors,
      avgDuration: avgDuration.toFixed(2),
      slowPercentage: stats.total > 0 ? ((stats.slow / stats.total) * 100).toFixed(2) : 0
    },
    slowestPaths: Array.from(pathStats.entries())
      .map(([path, stat]) => ({
        path,
        count: stat.count,
        avgDuration: stat.avgDuration.toFixed(2),
        maxDuration: stat.maxDuration.toFixed(2),
        minDuration: stat.minDuration === Infinity ? 0 : stat.minDuration.toFixed(2)
      }))
      .sort((a, b) => parseFloat(b.avgDuration) - parseFloat(a.avgDuration))
      .slice(0, 20)
  };
}

/**
 * 重置统计
 */
function resetStats() {
  stats.total = 0;
  stats.slow = 0;
  stats.errors = 0;
  stats.totalDuration = 0;
  pathStats.clear();
}

/**
 * 内存使用监控
 */
function getMemoryStats() {
  const mem = process.memoryUsage();
  return {
    rss: (mem.rss / 1024 / 1024).toFixed(2) + ' MB',
    heapTotal: (mem.heapTotal / 1024 / 1024).toFixed(2) + ' MB',
    heapUsed: (mem.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
    external: (mem.external / 1024 / 1024).toFixed(2) + ' MB',
    heapUsedPercentage: ((mem.heapUsed / mem.heapTotal) * 100).toFixed(2) + '%'
  };
}

/**
 * CPU 使用监控（简单版）
 */
function getCPUStats() {
  const usage = process.cpuUsage();
  return {
    user: (usage.user / 1000000).toFixed(2) + 's',
    system: (usage.system / 1000000).toFixed(2) + 's',
    uptime: process.uptime().toFixed(2) + 's'
  };
}

/**
 * 周期性日志（每分钟）
 */
let monitoringInterval = null;

function startMonitoring(intervalMs = 60000) {
  if (monitoringInterval) return;

  monitoringInterval = setInterval(() => {
    const perfStats = getStats();
    const memStats = getMemoryStats();
    const cpuStats = getCPUStats();

    logger.info('Performance metrics', {
      requests: perfStats.global,
      memory: memStats,
      cpu: cpuStats,
      slowestPaths: perfStats.slowestPaths.slice(0, 5)
    });
  }, intervalMs);
}

function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
}

module.exports = {
  performanceMiddleware,
  getStats,
  resetStats,
  getMemoryStats,
  getCPUStats,
  startMonitoring,
  stopMonitoring
};

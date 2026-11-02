// 数据库性能优化工具
const { pool } = require('../db');
const logger = require('./logger');

/**
 * 检查并创建缺失的索引
 */
async function ensureIndexes() {
  const conn = await pool.getConnection();
  try {
    // 检查索引是否存在
    async function indexExists(tableName, indexName) {
      const [rows] = await conn.execute(
        `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
         LIMIT 1`,
        [tableName, indexName]
      );
      return rows.length > 0;
    }

    // 关键查询的索引优化
    const indexes = [
      // novels 表
      { table: 'novels', name: 'idx_updated_at', sql: 'CREATE INDEX idx_updated_at ON novels(updated_at DESC)' },

      // chapters 表（已有 uk_novel_chapter 唯一索引）
      { table: 'chapters', name: 'idx_novel_updated', sql: 'CREATE INDEX idx_novel_updated ON chapters(novel_id, updated_at DESC)' },
      { table: 'chapters', name: 'idx_is_free', sql: 'CREATE INDEX idx_is_free ON chapters(is_free)' },

      // reading_progress 表
      { table: 'reading_progress', name: 'idx_user_updated', sql: 'CREATE INDEX idx_user_updated ON reading_progress(user_id, updated_at DESC)' },
      { table: 'reading_progress', name: 'idx_updated_at', sql: 'CREATE INDEX idx_updated_at ON reading_progress(updated_at DESC)' },

      // reading_bookmarks 表
      { table: 'reading_bookmarks', name: 'idx_user_novel', sql: 'CREATE INDEX idx_user_novel ON reading_bookmarks(user_id, novel_id)' },

      // bookshelf 表
      { table: 'bookshelf', name: 'idx_user_updated', sql: 'CREATE INDEX idx_user_updated ON bookshelf(user_id, updated_at DESC)' },

      // chapter_orders 表（付费订单）
      { table: 'chapter_orders', name: 'idx_user_novel', sql: 'CREATE INDEX idx_user_novel ON chapter_orders(user_id, novel_id)' },
      { table: 'chapter_orders', name: 'idx_user_created', sql: 'CREATE INDEX idx_user_created ON chapter_orders(user_id, created_at DESC)' },

      // novel_orders 表（整本购买）
      { table: 'novel_orders', name: 'idx_user_created', sql: 'CREATE INDEX idx_user_created ON novel_orders(user_id, created_at DESC)' },

      // wallet_transactions 表
      { table: 'wallet_transactions', name: 'idx_user_created', sql: 'CREATE INDEX idx_user_created ON wallet_transactions(user_id, created_at DESC)' },
      { table: 'wallet_transactions', name: 'idx_type', sql: 'CREATE INDEX idx_type ON wallet_transactions(transaction_type)' },

      // page_views 表（分析用）
      { table: 'page_views', name: 'idx_timestamp', sql: 'CREATE INDEX idx_timestamp ON page_views(timestamp DESC)' },
      { table: 'page_views', name: 'idx_novel_timestamp', sql: 'CREATE INDEX idx_novel_timestamp ON page_views(novel_id, timestamp DESC)' },

      // user_sessions 表
      { table: 'user_sessions', name: 'idx_expires_at', sql: 'CREATE INDEX idx_expires_at ON user_sessions(expires_at)' },

      // access_tokens 表
      { table: 'access_tokens', name: 'idx_expires_at', sql: 'CREATE INDEX idx_expires_at ON access_tokens(expires_at)' },

      // email_tokens 表
      { table: 'email_tokens', name: 'idx_expires_at', sql: 'CREATE INDEX idx_expires_at ON email_tokens(expires_at)' }
    ];

    const created = [];
    const skipped = [];

    for (const idx of indexes) {
      const exists = await indexExists(idx.table, idx.name);
      if (!exists) {
        try {
          await conn.execute(idx.sql);
          created.push(`${idx.table}.${idx.name}`);
          logger.info('Index created', { table: idx.table, index: idx.name });
        } catch (err) {
          if (err.code === 'ER_DUP_KEYNAME') {
            skipped.push(`${idx.table}.${idx.name} (duplicate)`);
          } else {
            logger.error('Index creation failed', { table: idx.table, index: idx.name, error: err.message });
          }
        }
      } else {
        skipped.push(`${idx.table}.${idx.name}`);
      }
    }

    logger.info('Index optimization complete', {
      created: created.length,
      skipped: skipped.length,
      total: indexes.length
    });

    return { created, skipped };
  } finally {
    conn.release();
  }
}

/**
 * 清理过期数据（定期任务）
 */
async function cleanupExpiredData() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 清理过期的 session
    const [sessionResult] = await conn.execute(
      'DELETE FROM user_sessions WHERE expires_at < NOW()'
    );

    // 清理过期的 access_tokens
    const [tokenResult] = await conn.execute(
      'DELETE FROM access_tokens WHERE expires_at < NOW()'
    );

    // 清理过期的 email_tokens
    const [emailResult] = await conn.execute(
      'DELETE FROM email_tokens WHERE expires_at < NOW()'
    );

    // 清理过期的充值码（已使用或过期）
    const [rechargeResult] = await conn.execute(
      'DELETE FROM recharge_codes WHERE expires_at < NOW() OR used_at IS NOT NULL'
    );

    await conn.commit();

    const stats = {
      sessions: sessionResult.affectedRows,
      tokens: tokenResult.affectedRows,
      emailTokens: emailResult.affectedRows,
      rechargeCodes: rechargeResult.affectedRows
    };

    logger.info('Expired data cleanup complete', stats);
    return stats;
  } catch (err) {
    await conn.rollback();
    logger.error('Expired data cleanup failed', { error: err.message });
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * 分析慢查询（需要 MySQL slow_query_log 开启）
 */
async function analyzeSlowQueries() {
  const conn = await pool.getConnection();
  try {
    // 检查慢查询日志是否开启
    const [[slowLogStatus]] = await conn.execute(
      "SHOW VARIABLES LIKE 'slow_query_log'"
    );

    if (slowLogStatus.Value !== 'ON') {
      return {
        enabled: false,
        message: '慢查询日志未开启。建议在 my.cnf 中设置: slow_query_log=1, long_query_time=1'
      };
    }

    // 获取最近的慢查询统计（需要 performance_schema）
    const [slowQueries] = await conn.execute(`
      SELECT
        DIGEST_TEXT as query,
        COUNT_STAR as exec_count,
        AVG_TIMER_WAIT/1000000000000 as avg_time_sec,
        MAX_TIMER_WAIT/1000000000000 as max_time_sec
      FROM performance_schema.events_statements_summary_by_digest
      WHERE SCHEMA_NAME = DATABASE()
      ORDER BY AVG_TIMER_WAIT DESC
      LIMIT 10
    `);

    return {
      enabled: true,
      slowQueries: slowQueries.map(q => ({
        query: q.query ? q.query.substring(0, 200) : '',
        execCount: q.exec_count,
        avgTimeSec: parseFloat(q.avg_time_sec).toFixed(3),
        maxTimeSec: parseFloat(q.max_time_sec).toFixed(3)
      }))
    };
  } catch (err) {
    logger.error('Slow query analysis failed', { error: err.message });
    return { enabled: false, error: err.message };
  } finally {
    conn.release();
  }
}

/**
 * 获取数据库连接池状态
 */
function getPoolStatus() {
  return {
    total: pool.pool._allConnections.length,
    active: pool.pool._allConnections.length - pool.pool._freeConnections.length,
    idle: pool.pool._freeConnections.length,
    queue: pool.pool._connectionQueue ? pool.pool._connectionQueue.length : 0
  };
}

module.exports = {
  ensureIndexes,
  cleanupExpiredData,
  analyzeSlowQueries,
  getPoolStatus
};

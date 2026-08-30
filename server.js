const express = require('express');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { pool, initDB } = require('./db');
const indexRoutes = require('./routes/index');
const adminRoutes = require('./routes/admin');
const webdavRoutes = require('./routes/webdav');
const { getAccessTokenValue, getVisitorUid, getClientIp } = require('./routes/middleware/auth');
const { getBaseUrl, parsePositiveInt } = require('./lib/util');
const pageViewQueue = require('./lib/pageViewQueue');
const cache = require('./lib/memoryCache');
const analytics = require('./lib/analytics');
const logger = require('./lib/logger');
const { createRateLimiter } = require('./lib/rateLimit');

const app = express();
const PORT = process.env.PORT || 3000;
// HTTP 明文端口默认只绑本机(开发调试用);局域网/公网访问请走 HTTPS
const HTTP_HOST = process.env.HTTP_HOST || '127.0.0.1';

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  etag: true
}));

app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '1mb' }));

app.use(logger.requestLogger);
app.use(require('./lib/securityHeaders'));

app.get('/healthz', (req, res) => {
  res.status(200).json({
    status: 'ok',
    queue: pageViewQueue.stats(),
    cache: { size: cache.size() }
  });
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
app.use('/webdav', webdavRoutes);

// 个人中心数据接口:返回当前 token 的阅读统计与订阅链接(不走页面缓存/统计中间件)
app.get('/api/me', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const token = getAccessTokenValue(req);
    if (!token) return res.json({ authenticated: false });

    const [[row]] = await pool.execute(
      `SELECT id, name, token, allowed_novel_id
       FROM access_tokens
       WHERE token = ? AND is_active = 1`,
      [token]
    );
    if (!row) return res.json({ authenticated: false });

    const [[stats]] = await pool.execute(
      `SELECT
         COUNT(DISTINCT CONCAT(pv.novel_id, ':', pv.chapter_id)) AS chapters_read,
         COALESCE(SUM(CHAR_LENGTH(c.content)), 0) AS total_words
       FROM page_views pv
       LEFT JOIN chapters c ON c.novel_id = pv.novel_id AND c.chapter_number = pv.chapter_id
       WHERE pv.access_token_id = ? AND pv.novel_id IS NOT NULL AND pv.chapter_id IS NOT NULL`,
      [row.id]
    );

    const baseUrl = getBaseUrl(req);
    res.json({
      authenticated: true,
      name: row.name,
      chaptersRead: Number(stats.chapters_read || 0),
      totalWords: Number(stats.total_words || 0),
      subscribeUrl: `${baseUrl}/?token=${encodeURIComponent(row.token)}`
    });
  } catch (err) {
    logger.error('Failed to fetch user stats', { err });
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// 登录:验证用户名 + token,设置 cookie
// 15 分钟内每 IP 最多 10 次失败,成功登录即清零
const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

app.post('/api/login', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const ip = getClientIp(req);
    const limit = loginLimiter.check(ip);
    if (limit.blocked) {
      return res.status(429).json({ success: false, error: `尝试次数过多,请约 ${Math.max(1, Math.ceil(limit.retryAfterSec / 60))} 分钟后再试` });
    }

    const { name, token } = req.body || {};
    if (!name || !token) {
      return res.status(400).json({ success: false, error: '请输入用户名和令牌' });
    }

    const [[row]] = await pool.execute(
      'SELECT id, name, token FROM access_tokens WHERE name = ? AND token = ? AND is_active = 1',
      [String(name).trim(), String(token).trim()]
    );

    if (!row) {
      loginLimiter.record(ip);
      return res.status(401).json({ success: false, error: '用户名或令牌无效' });
    }

    loginLimiter.reset(ip);

    res.cookie('access_token', row.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: 365 * 24 * 60 * 60 * 1000,
      path: '/'
    });

    res.json({ success: true, name: row.name });
  } catch (err) {
    logger.error('Login error', { err });
    res.status(500).json({ success: false, error: '登录失败' });
  }
});

// 登出:清除 cookie
app.post('/api/logout', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.clearCookie('access_token', { path: '/', httpOnly: true, sameSite: 'lax', secure: true });
  res.json({ success: true });
});

// 评论接口:获取评论列表
app.get('/api/novels/:id/comments', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const novelId = parsePositiveInt(req.params.id, 0);
    if (!novelId) return res.status(404).json({ error: '小说不存在' });

    const token = getAccessTokenValue(req);
    if (!token) return res.status(403).json({ error: '需要访问令牌' });
    const [[tokenRow]] = await pool.execute(
      'SELECT id FROM access_tokens WHERE token = ? AND is_active = 1',
      [token]
    );
    if (!tokenRow) return res.status(403).json({ error: '访问令牌无效' });

    const [comments] = await pool.execute(
      `SELECT id, name, content,
              DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
       FROM novel_comments
       WHERE novel_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [novelId]
    );
    res.json({ comments });
  } catch (err) {
    logger.error('Failed to fetch comments', { err });
    res.status(500).json({ error: '获取评论失败' });
  }
});

// 评论接口:发表评论(60 秒内限发一条)
app.post('/api/novels/:id/comments', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const novelId = parsePositiveInt(req.params.id, 0);
    if (!novelId) return res.status(404).json({ error: '小说不存在' });

    const token = getAccessTokenValue(req);
    if (!token) return res.status(403).json({ error: '需要访问令牌' });
    const [[tokenRow]] = await pool.execute(
      'SELECT id FROM access_tokens WHERE token = ? AND is_active = 1',
      [token]
    );
    if (!tokenRow) return res.status(403).json({ error: '访问令牌无效' });

    const [[novelRow]] = await pool.execute(
      'SELECT id FROM novels WHERE id = ?',
      [novelId]
    );
    if (!novelRow) return res.status(404).json({ error: '小说不存在' });

    const visitorUid = getVisitorUid(req);
    res.cookie('visitor_uid', visitorUid, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60 * 1000,
      path: '/'
    });

    // 频率限制:同一 token 或同一访客 60 秒内只能发一条。
    // visitor_uid 来自客户端 cookie 可随意轮换,必须叠加服务端校验的 access_token_id
    const [[recent]] = await pool.execute(
      `SELECT 1 FROM novel_comments
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 60 SECOND)
         AND (access_token_id = ? OR visitor_uid = ?)
       LIMIT 1`,
      [tokenRow.id, visitorUid]
    );
    if (recent) return res.status(429).json({ error: '评论太快了,请 1 分钟后再试' });

    const rawName = String(req.body && req.body.name || '').trim().slice(0, 30);
    const rawContent = String(req.body && req.body.content || '').trim().slice(0, 500);
    if (!rawContent) return res.status(400).json({ error: '评论内容不能为空' });

    const name = rawName || '匿名读者';
    const [result] = await pool.execute(
      `INSERT INTO novel_comments (novel_id, visitor_uid, access_token_id, name, content)
       VALUES (?, ?, ?, ?, ?)`,
      [novelId, visitorUid, tokenRow.id, name, rawContent]
    );

    const [[created]] = await pool.execute(
      `SELECT id, name, content,
              DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
       FROM novel_comments WHERE id = ?`,
      [result.insertId]
    );
    res.status(201).json({ comment: created });
  } catch (err) {
    logger.error('Failed to post comment', { err });
    res.status(500).json({ error: '发表评论失败' });
  }
});

app.use('/', indexRoutes);

app.use((req, res) => {
  res.status(404).render('404', { url: req.originalUrl });
});

app.use((err, req, res, next) => {
  logger.error('Unhandled error', { err, path: req.path, method: req.method });
  res.status(500).send('Server internal error');
});

initDB().then(() => {
  // HTTP — 仅本机调试;明文端口不再暴露到局域网/公网
  const httpServer = http.createServer(app).listen(PORT, HTTP_HOST, () => {
    logger.info('HTTP server started', { port: PORT, host: HTTP_HOST });
  });

  // HTTPS — ReadAny WebDAV 导入用
  const HTTPS_PORT = Number(PORT) + 435; // 3443
  const sslOptions = {
    key: fs.readFileSync(path.join(__dirname, 'certs/key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'certs/cert.pem')),
  };
  const httpsServer = https.createServer(sslOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
    logger.info('HTTPS server started', { port: HTTPS_PORT, host: '0.0.0.0' });
  });

  analytics.start();

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutdown signal received, flushing queue', { signal });
    analytics.stop();
    const forceExit = setTimeout(() => {
      logger.error('Forced shutdown after 5s timeout');
      process.exit(0);
    }, 5000).unref();
    httpServer.close();
    httpsServer.close(async () => {
      try {
        await pageViewQueue.flushAll();
      } catch (err) {
        logger.error('Failed to flush page view queue', { err });
      } finally {
        clearTimeout(forceExit);
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

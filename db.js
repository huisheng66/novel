const mysql = require('mysql2/promise');
const { parsePositiveInt } = require('./lib/util');
const logger = require('./lib/logger');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'novel',
  waitForConnections: true,
  connectionLimit: parsePositiveInt(process.env.DB_CONNECTION_LIMIT, 20),
  queueLimit: parsePositiveInt(process.env.DB_QUEUE_LIMIT, 0),
  charset: 'utf8mb4'
});

async function columnExists(conn, tableName, columnName) {
  const [rows] = await conn.execute(
    `SELECT 1
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function indexExists(conn, tableName, indexName) {
  const [rows] = await conn.execute(
    `SELECT 1
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  );
  return rows.length > 0;
}

async function constraintExists(conn, tableName, constraintName) {
  const [rows] = await conn.execute(
    `SELECT 1
     FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?
     LIMIT 1`,
    [tableName, constraintName]
  );
  return rows.length > 0;
}

async function ensureChapterSchema(conn) {
  const [[chapterCountRow]] = await conn.execute('SELECT COUNT(*) AS cnt FROM chapters');
  const [[novelCountRow]] = await conn.execute('SELECT COUNT(*) AS cnt FROM novels');

  if (chapterCountRow.cnt > 0 && novelCountRow.cnt === 0) {
    await conn.execute(
      'INSERT INTO novels (title, author, description) VALUES (?, ?, ?)',
      ['Imported Novel', 'Unknown', 'Imported from an older chapters table.']
    );
  }

  const [[defaultNovel]] = await conn.execute('SELECT id FROM novels ORDER BY id ASC LIMIT 1');
  const defaultNovelId = defaultNovel ? defaultNovel.id : 1;
  const hasChapterNo = await columnExists(conn, 'chapters', 'chapter_no');

  if (!await columnExists(conn, 'chapters', 'novel_id')) {
    await conn.execute('ALTER TABLE chapters ADD COLUMN novel_id INT NULL AFTER id');
  }

  if (!await columnExists(conn, 'chapters', 'chapter_number')) {
    await conn.execute('ALTER TABLE chapters ADD COLUMN chapter_number INT NULL AFTER novel_id');
  }

  await conn.execute('UPDATE chapters SET novel_id = ? WHERE novel_id IS NULL', [defaultNovelId]);

  if (hasChapterNo) {
    await conn.execute('UPDATE chapters SET chapter_number = chapter_no WHERE chapter_number IS NULL');
    await conn.execute('ALTER TABLE chapters MODIFY chapter_no INT UNSIGNED NULL');
  }
  await conn.execute('UPDATE chapters SET chapter_number = id WHERE chapter_number IS NULL');

  await conn.execute('ALTER TABLE chapters MODIFY novel_id INT NOT NULL');
  await conn.execute('ALTER TABLE chapters MODIFY chapter_number INT NOT NULL');

  if (!await indexExists(conn, 'chapters', 'uk_novel_chapter')) {
    try {
      await conn.execute('CREATE UNIQUE INDEX uk_novel_chapter ON chapters (novel_id, chapter_number)');
    } catch (err) {
      if (err && err.code !== 'ER_DUP_KEYNAME' && err.code !== 'ER_DUP_ENTRY') throw err;
    }
  }

  if (!await constraintExists(conn, 'chapters', 'fk_chapters_novel')) {
    try {
      await conn.execute(
        'ALTER TABLE chapters ADD CONSTRAINT fk_chapters_novel FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE'
      );
    } catch (err) {
      if (err && err.code !== 'ER_FK_DUP_NAME' && err.code !== 'ER_CANNOT_ADD_FOREIGN') throw err;
    }
  }
}

const SCHEMA_VERSION = 11;

async function ensureSchemaVersionTable(conn) {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INT NOT NULL PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function getAppliedSchemaVersion(conn) {
  const [rows] = await conn.execute(
    'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1'
  );
  return rows.length > 0 ? rows[0].version : 0;
}

async function recordSchemaVersion(conn, version) {
  await conn.execute(
    'INSERT IGNORE INTO schema_version (version) VALUES (?)',
    [version]
  );
}

// 历史迁移:仅对未记录 schema_version 的旧库执行一次,完成后写入版本号
async function runSchemaMigrations(conn) {
  if (!await columnExists(conn, 'novels', 'cover_image')) {
    await conn.execute('ALTER TABLE novels ADD COLUMN cover_image VARCHAR(255) DEFAULT NULL AFTER description');
  }

  await ensureChapterSchema(conn);

  if (!await columnExists(conn, 'access_tokens', 'allowed_novel_id')) {
    await conn.execute('ALTER TABLE access_tokens ADD COLUMN allowed_novel_id INT DEFAULT NULL AFTER token');
  }
  if (!await columnExists(conn, 'access_tokens', 'risk_paused_until')) {
    await conn.execute('ALTER TABLE access_tokens ADD COLUMN risk_paused_until DATETIME DEFAULT NULL AFTER is_active');
  }
  if (!await columnExists(conn, 'access_tokens', 'risk_reason')) {
    await conn.execute('ALTER TABLE access_tokens ADD COLUMN risk_reason VARCHAR(255) DEFAULT NULL AFTER risk_paused_until');
  }
  if (!await indexExists(conn, 'access_tokens', 'idx_access_tokens_novel')) {
    try {
      await conn.execute('CREATE INDEX idx_access_tokens_novel ON access_tokens (allowed_novel_id)');
    } catch (err) {
      if (err && err.code !== 'ER_DUP_KEYNAME') throw err;
    }
  }
  if (!await constraintExists(conn, 'access_tokens', 'fk_access_tokens_novel')) {
    try {
      await conn.execute(
        'ALTER TABLE access_tokens ADD CONSTRAINT fk_access_tokens_novel FOREIGN KEY (allowed_novel_id) REFERENCES novels(id) ON DELETE SET NULL'
      );
    } catch (err) {
      if (err && err.code !== 'ER_FK_DUP_NAME' && err.code !== 'ER_CANNOT_ADD_FOREIGN') throw err;
    }
  }

  try {
    await conn.execute("ALTER TABLE page_views ADD COLUMN visitor_uid VARCHAR(64) NOT NULL DEFAULT '' AFTER id");
  } catch (err) {
    if (err && err.code !== 'ER_DUP_FIELDNAME') throw err;
  }
  if (!await columnExists(conn, 'page_views', 'access_token_id')) {
    await conn.execute('ALTER TABLE page_views ADD COLUMN access_token_id INT DEFAULT NULL AFTER visitor_uid');
  }
  try {
    await conn.execute('CREATE INDEX idx_visitor_uid ON page_views (visitor_uid)');
  } catch (err) {
    if (err && err.code !== 'ER_DUP_KEYNAME') throw err;
  }
  if (!await indexExists(conn, 'page_views', 'idx_access_token_id')) {
    try {
      await conn.execute('CREATE INDEX idx_access_token_id ON page_views (access_token_id)');
    } catch (err) {
      if (err && err.code !== 'ER_DUP_KEYNAME') throw err;
    }
  }
  if (!await indexExists(conn, 'page_views', 'idx_token_chapter_recent')) {
    try {
      await conn.execute(
        'CREATE INDEX idx_token_chapter_recent ON page_views (access_token_id, created_at, novel_id, chapter_id)'
      );
    } catch (err) {
      if (err && err.code !== 'ER_DUP_KEYNAME') throw err;
    }
  }

  // v2: token 累计访问计数，避免 Token 页扫全表
  if (!await columnExists(conn, 'access_tokens', 'total_views')) {
    await conn.execute(
      'ALTER TABLE access_tokens ADD COLUMN total_views INT NOT NULL DEFAULT 0 AFTER risk_reason'
    );
  }
  if (!await columnExists(conn, 'access_tokens', 'last_seen_at')) {
    await conn.execute(
      'ALTER TABLE access_tokens ADD COLUMN last_seen_at DATETIME DEFAULT NULL AFTER total_views'
    );
  }

  // 从历史 page_views 回填一次（仅当计数全为 0 且有访问记录时）
  const [[{ token_rows }]] = await conn.execute(
    'SELECT COUNT(*) AS token_rows FROM access_tokens WHERE total_views > 0'
  );
  if (Number(token_rows) === 0) {
    await conn.execute(`
      UPDATE access_tokens t
      INNER JOIN (
        SELECT access_token_id AS id, COUNT(*) AS cnt, MAX(created_at) AS last_seen
        FROM page_views
        WHERE access_token_id IS NOT NULL
        GROUP BY access_token_id
      ) s ON s.id = t.id
      SET t.total_views = s.cnt, t.last_seen_at = s.last_seen
    `);
  }

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS analytics_totals (
      id TINYINT NOT NULL PRIMARY KEY DEFAULT 1,
      page_views BIGINT NOT NULL DEFAULT 0,
      sessions BIGINT NOT NULL DEFAULT 0,
      users BIGINT NOT NULL DEFAULT 0,
      readers BIGINT NOT NULL DEFAULT 0,
      unique_ips BIGINT NOT NULL DEFAULT 0,
      novel_views BIGINT NOT NULL DEFAULT 0,
      chapter_views BIGINT NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // v3: 官方 App /api/v1 — 用户、书架、进度、书/章同步字段
  await runSchemaMigrationsV3(conn);
  // v4: 书签/笔记、运营配置、设备订阅（更新通知）
  await runSchemaMigrationsV4(conn);
  // v5: 一次一码邀请码（自助注册）
  await runSchemaMigrationsV5(conn);
}

/**
 * 迁移清单：按 version 升序，仅执行 > 已应用版本的项。
 * 历史链（≤5）整体幂等但开销大（含 ALTER TABLE MODIFY、全表 UPDATE），
 * 因此不能每次升版本都整链重跑 —— 新增迁移往数组末尾追加即可。
 */
const MIGRATIONS = [
  { version: 5, name: '基础迁移链 v1~v5', run: runSchemaMigrations },
  { version: 6, name: '访问日志区分令牌与登录读者', run: runSchemaMigrationsV6 },
  { version: 7, name: 'updated_at 归一化（增量查询可走索引）', run: runSchemaMigrationsV7 },
  { version: 8, name: '章节付费分层与订单表', run: runSchemaMigrationsV8 },
  { version: 9, name: '钱包、流水与充值兑换码', run: runSchemaMigrationsV9 },
  { version: 10, name: '邮箱验证与找回密码令牌', run: runSchemaMigrationsV10 },
  { version: 11, name: '充值码加长（code 64）', run: runSchemaMigrationsV11 }
];

async function runPendingMigrations(conn) {
  const appliedVersion = await getAppliedSchemaVersion(conn);
  if (appliedVersion >= SCHEMA_VERSION) return;

  for (const migration of MIGRATIONS) {
    if (appliedVersion >= migration.version) continue;
    await migration.run(conn);
    await recordSchemaVersion(conn, migration.version);
    logger.info('数据库迁移完成', {
      schema_version: migration.version,
      name: migration.name
    });
  }
}

async function runSchemaMigrationsV3(conn) {
  if (!await columnExists(conn, 'novels', 'status')) {
    await conn.execute(
      "ALTER TABLE novels ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'serializing' AFTER cover_image"
    );
  }
  if (!await columnExists(conn, 'novels', 'updated_at')) {
    await conn.execute(
      'ALTER TABLE novels ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at'
    );
  }
  if (!await columnExists(conn, 'novels', 'last_chapter_number')) {
    await conn.execute(
      'ALTER TABLE novels ADD COLUMN last_chapter_number INT DEFAULT NULL AFTER status'
    );
  }
  if (!await columnExists(conn, 'novels', 'last_chapter_title')) {
    await conn.execute(
      'ALTER TABLE novels ADD COLUMN last_chapter_title VARCHAR(255) DEFAULT NULL AFTER last_chapter_number'
    );
  }

  if (!await columnExists(conn, 'chapters', 'updated_at')) {
    await conn.execute(
      'ALTER TABLE chapters ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at'
    );
  }
  if (!await columnExists(conn, 'chapters', 'content_hash')) {
    await conn.execute(
      'ALTER TABLE chapters ADD COLUMN content_hash CHAR(64) DEFAULT NULL AFTER content'
    );
  }
  if (!await indexExists(conn, 'chapters', 'idx_chapters_novel_updated')) {
    try {
      await conn.execute(
        'CREATE INDEX idx_chapters_novel_updated ON chapters (novel_id, updated_at)'
      );
    } catch (err) {
      if (err && err.code !== 'ER_DUP_KEYNAME') throw err;
    }
  }

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(64) NOT NULL,
      email VARCHAR(255) DEFAULT NULL,
      password_hash VARCHAR(255) NOT NULL,
      display_name VARCHAR(100) NOT NULL DEFAULT '',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_users_username (username),
      UNIQUE KEY uk_users_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      refresh_token_hash CHAR(64) NOT NULL,
      device_name VARCHAR(100) DEFAULT NULL,
      user_agent VARCHAR(255) DEFAULT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT NULL,
      UNIQUE KEY uk_user_sessions_refresh (refresh_token_hash),
      INDEX idx_user_sessions_user (user_id),
      INDEX idx_user_sessions_expires (expires_at),
      CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS bookshelf (
      user_id INT NOT NULL,
      novel_id INT NOT NULL,
      pinned TINYINT(1) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_opened_at DATETIME DEFAULT NULL,
      PRIMARY KEY (user_id, novel_id),
      INDEX idx_bookshelf_novel (novel_id),
      CONSTRAINT fk_bookshelf_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_bookshelf_novel FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS reading_progress (
      user_id INT NOT NULL,
      novel_id INT NOT NULL,
      chapter_number INT NOT NULL,
      chapter_id INT DEFAULT NULL,
      offset_ratio DOUBLE NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL,
      device_name VARCHAR(100) DEFAULT NULL,
      PRIMARY KEY (user_id, novel_id),
      INDEX idx_progress_updated (updated_at),
      CONSTRAINT fk_progress_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_progress_novel FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 回填章节 content_hash / updated_at（仅空 hash）
  const crypto = require('crypto');
  const [needHash] = await conn.execute(
    `SELECT id, content FROM chapters
     WHERE content_hash IS NULL OR content_hash = ''
     LIMIT 5000`
  );
  for (const row of needHash) {
    const hash = crypto.createHash('sha256').update(String(row.content || ''), 'utf8').digest('hex');
    await conn.execute(
      'UPDATE chapters SET content_hash = ?, updated_at = COALESCE(updated_at, created_at, NOW()) WHERE id = ?',
      [hash, row.id]
    );
  }

  // 回填 novels 最新章冗余字段
  await conn.execute(`
    UPDATE novels n
    LEFT JOIN (
      SELECT c.novel_id,
             c.chapter_number AS last_chapter_number,
             c.title AS last_chapter_title,
             c.updated_at AS chapter_updated_at
      FROM chapters c
      INNER JOIN (
        SELECT novel_id, MAX(chapter_number) AS max_num
        FROM chapters
        GROUP BY novel_id
      ) m ON m.novel_id = c.novel_id AND m.max_num = c.chapter_number
    ) x ON x.novel_id = n.id
    SET n.last_chapter_number = x.last_chapter_number,
        n.last_chapter_title = x.last_chapter_title,
        n.updated_at = COALESCE(x.chapter_updated_at, n.updated_at, n.created_at, NOW())
  `);
}

async function runSchemaMigrationsV4(conn) {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS reading_bookmarks (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      novel_id INT NOT NULL,
      chapter_number INT NOT NULL,
      chapter_id INT DEFAULT NULL,
      offset_ratio DOUBLE NOT NULL DEFAULT 0,
      note TEXT,
      color VARCHAR(32) DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bookmarks_user (user_id, updated_at),
      INDEX idx_bookmarks_user_novel (user_id, novel_id),
      CONSTRAINT fk_bookmarks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_bookmarks_novel FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 默认运营配置（仅当键不存在时插入）
  const defaults = [
    ['announcement', ''],
    ['announcement_enabled', '0'],
    ['min_client_version', '0.0.0'],
    ['force_update', '0'],
    ['force_update_message', '请更新到最新版本后继续使用'],
    ['store_url', '']
  ];
  for (const [key, value] of defaults) {
    await conn.execute(
      `INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES (?, ?)`,
      [key, value]
    );
  }

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS device_subscriptions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      device_id VARCHAR(128) NOT NULL,
      platform VARCHAR(32) DEFAULT NULL,
      push_token VARCHAR(512) DEFAULT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      last_seen_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_device_user (user_id, device_id),
      INDEX idx_device_enabled (user_id, enabled),
      CONSTRAINT fk_device_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function runSchemaMigrationsV5(conn) {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS invite_codes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(32) NOT NULL,
      note VARCHAR(255) DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME DEFAULT NULL,
      used_at DATETIME DEFAULT NULL,
      used_by_user_id INT DEFAULT NULL,
      UNIQUE KEY uk_invite_code (code),
      INDEX idx_invite_unused (used_at, expires_at),
      INDEX idx_invite_used_by (used_by_user_id),
      CONSTRAINT fk_invite_used_by FOREIGN KEY (used_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

/**
 * v6: 访问日志区分两类身份。
 * - access_token_id：分享 / Legado 令牌（匿名只读读者）
 * - user_id：登录读者（Web JWT / App 同一 users 账号）
 * 此前 JWT 读者访问完全不写 page_views，导致看板只反映持令牌的匿名流量。
 */
async function runSchemaMigrationsV6(conn) {
  if (!await columnExists(conn, 'page_views', 'user_id')) {
    await conn.execute('ALTER TABLE page_views ADD COLUMN user_id INT DEFAULT NULL AFTER access_token_id');
  }
  if (!await indexExists(conn, 'page_views', 'idx_user_id')) {
    try {
      await conn.execute('CREATE INDEX idx_user_id ON page_views (user_id)');
    } catch (err) {
      if (err && err.code !== 'ER_DUP_KEYNAME') throw err;
    }
  }

  // 登录读者数（DISTINCT user_id），与「访客数」（DISTINCT visitor_uid）分开统计
  if (!await columnExists(conn, 'analytics_daily', 'readers')) {
    await conn.execute('ALTER TABLE analytics_daily ADD COLUMN readers INT NOT NULL DEFAULT 0 AFTER users');
  }
  if (!await columnExists(conn, 'analytics_totals', 'readers')) {
    await conn.execute('ALTER TABLE analytics_totals ADD COLUMN readers BIGINT NOT NULL DEFAULT 0 AFTER users');
  }
}

/**
 * v7: 把 updated_at 归一化为「恒非空」，让增量查询能走索引。
 *
 * 原查询写作 COALESCE(updated_at, created_at) > ?，列被函数包裹后
 * idx_chapters_novel_updated(novel_id, updated_at) 无法用于范围扫描，
 * 只能按 novel_id 取出全部章节再 filesort（2000+ 章的书每次追更都全扫）。
 *
 * 回填后所有查询直接用 updated_at；新行由列默认值 CURRENT_TIMESTAMP 保证非空。
 * 刻意不做 ALTER ... NOT NULL：那会重建带 LONGTEXT 的 chapters 表，代价远大于收益。
 */
async function runSchemaMigrationsV7(conn) {
  const [[chapterNulls]] = await conn.execute(
    'SELECT COUNT(*) AS n FROM chapters WHERE updated_at IS NULL'
  );
  if (Number(chapterNulls.n) > 0) {
    const [res] = await conn.execute(
      'UPDATE chapters SET updated_at = COALESCE(created_at, NOW()) WHERE updated_at IS NULL'
    );
    logger.info('回填 chapters.updated_at', { rows: res.affectedRows });
  }

  if (await columnExists(conn, 'novels', 'updated_at')) {
    const [[novelNulls]] = await conn.execute(
      'SELECT COUNT(*) AS n FROM novels WHERE updated_at IS NULL'
    );
    if (Number(novelNulls.n) > 0) {
      const [res] = await conn.execute(
        'UPDATE novels SET updated_at = COALESCE(created_at, NOW()) WHERE updated_at IS NULL'
      );
      logger.info('回填 novels.updated_at', { rows: res.affectedRows });
    }
  }
}

/**
 * v8: 章节付费分层。
 *
 * 设计上「免费到第几章」不写死在章节行里，而是按书籍规则实时计算
 * （novel_paywall.free_until_chapter + platform_settings 全局默认），
 * 这样后台改一个数字立即生效，不需要回写几千行章节。
 *
 * chapters.is_free / price 是**按章覆盖**，NULL 表示「跟随书籍规则」。
 */
async function runSchemaMigrationsV8(conn) {
  if (!await columnExists(conn, 'chapters', 'is_free')) {
    await conn.execute(
      'ALTER TABLE chapters ADD COLUMN is_free TINYINT(1) DEFAULT NULL AFTER content_hash'
    );
  }
  if (!await columnExists(conn, 'chapters', 'price')) {
    await conn.execute('ALTER TABLE chapters ADD COLUMN price INT DEFAULT NULL AFTER is_free');
  }

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS novel_paywall (
      novel_id INT NOT NULL PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      free_until_chapter INT NOT NULL DEFAULT 0,
      price_per_chapter INT NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_paywall_novel FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 单章购买记录：唯一键防止重复扣费/重复入库
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS chapter_orders (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      novel_id INT NOT NULL,
      chapter_number INT NOT NULL,
      amount INT NOT NULL DEFAULT 0,
      channel VARCHAR(32) DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_order (user_id, novel_id, chapter_number),
      INDEX idx_orders_novel (novel_id, chapter_number),
      CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 全局默认：默认关闭，改造后站点行为与之前完全一致，由后台显式开启
  const defaults = [
    ['paywall_enabled', '0'],
    ['paywall_default_free_until', '0'],
    ['paywall_default_price', '0'],
    ['paywall_hide_from_source', '1']
  ];
  for (const [key, value] of defaults) {
    await conn.execute(
      'INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES (?, ?)',
      [key, value]
    );
  }
}

/**
 * v9: 钱包与充值。
 *
 * 余额统一以「分」为单位，与 chapters.price / novel_paywall.price_per_chapter 一致，
 * 避免元/分混用导致的展示错位。
 *
 * 充值走「兑换码」而不是支付通道：不依赖企业商户资质即可跑通「充值 → 购买 → 阅读」
 * 全链路，用于内测与人工发卡；微信/支付宝与 iOS IAP 属于后续阶段。
 */
async function runSchemaMigrationsV9(conn) {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS user_wallets (
      user_id INT NOT NULL PRIMARY KEY,
      balance INT NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 流水：每次余额变动都留痕，便于对账与排查「扣了钱没给章」
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      delta INT NOT NULL,
      balance_after INT NOT NULL,
      type VARCHAR(32) NOT NULL,
      ref VARCHAR(64) DEFAULT NULL,
      note VARCHAR(255) DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_wallet_tx_user (user_id, created_at),
      INDEX idx_wallet_tx_type (type, created_at),
      CONSTRAINT fk_wallet_tx_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS recharge_codes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(32) NOT NULL,
      amount INT NOT NULL,
      note VARCHAR(255) DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME DEFAULT NULL,
      used_at DATETIME DEFAULT NULL,
      used_by_user_id INT DEFAULT NULL,
      UNIQUE KEY uk_recharge_code (code),
      INDEX idx_recharge_unused (used_at, expires_at),
      CONSTRAINT fk_recharge_used_by FOREIGN KEY (used_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

/**
 * v10: 邮箱验证与找回密码。
 *
 * 令牌只存 sha256 哈希（与 refresh token 同策略），一次性、带过期时间；
 * 明文只在发信那一刻存在于内存里，库被读走也无法直接使用。
 *
 * 验证状态默认**不阻塞**任何功能（两个开关默认 0），由后台按需打开。
 */
async function runSchemaMigrationsV10(conn) {
  if (!await columnExists(conn, 'users', 'email_verified_at')) {
    await conn.execute('ALTER TABLE users ADD COLUMN email_verified_at DATETIME DEFAULT NULL AFTER email');
  }

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS email_tokens (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      kind VARCHAR(16) NOT NULL,
      token_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_email_token (token_hash),
      INDEX idx_email_token_user (user_id, kind, expires_at),
      CONSTRAINT fk_email_token_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const defaults = [
    ['email_verify_on_register', '1'],
    ['email_verify_required_login', '0'],
    ['email_verify_required_purchase', '0']
  ];
  for (const [key, value] of defaults) {
    await conn.execute(
      'INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES (?, ?)',
      [key, value]
    );
  }
}

/**
 * v11: 充值码加长。旧码 42 亿组合可被规模化枚举，新码 160 位随机（base32 32 字符，
 * 分组后 42 字符），列宽扩到 64。幂等：列宽已 ≥64 则跳过。
 */
async function runSchemaMigrationsV11(conn) {
  const [[col]] = await conn.execute(
    `SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS
     WHERE table_schema = DATABASE() AND table_name = 'recharge_codes' AND column_name = 'code'`
  );
  if (col && Number(col.len) < 64) {
    await conn.execute('ALTER TABLE recharge_codes MODIFY code VARCHAR(64) NOT NULL');
  }
}

async function initDB() {
  // Ensure database exists
  const dbName = process.env.DB_NAME || 'novel';
  const setupConn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || ''
  });
  await setupConn.execute(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4`);
  await setupConn.end();

  const conn = await pool.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS novels (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        author VARCHAR(255) NOT NULL,
        description TEXT,
        cover_image VARCHAR(255) DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS chapters (
        id INT AUTO_INCREMENT PRIMARY KEY,
        novel_id INT NOT NULL,
        chapter_number INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        content LONGTEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
        UNIQUE KEY uk_novel_chapter (novel_id, chapter_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS access_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        token VARCHAR(128) NOT NULL,
        allowed_novel_id INT DEFAULT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        risk_paused_until DATETIME DEFAULT NULL,
        risk_reason VARCHAR(255) DEFAULT NULL,
        total_views INT NOT NULL DEFAULT 0,
        last_seen_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_access_tokens_token (token),
        INDEX idx_access_tokens_active (is_active),
        INDEX idx_access_tokens_novel (allowed_novel_id),
        CONSTRAINT fk_access_tokens_novel FOREIGN KEY (allowed_novel_id) REFERENCES novels(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS page_views (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        visitor_uid VARCHAR(64) NOT NULL DEFAULT '',
        access_token_id INT DEFAULT NULL,
        user_id INT DEFAULT NULL,
        session_id VARCHAR(64) NOT NULL,
        visitor_ip VARCHAR(64) NOT NULL,
        user_agent VARCHAR(255) NOT NULL,
        path VARCHAR(255) NOT NULL,
        referrer VARCHAR(255) DEFAULT NULL,
        novel_id INT DEFAULT NULL,
        chapter_id INT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_created_at (created_at),
        INDEX idx_visitor_uid (visitor_uid),
        INDEX idx_access_token_id (access_token_id),
        INDEX idx_user_id (user_id),
        INDEX idx_session_id (session_id),
        INDEX idx_visitor_ip (visitor_ip),
        INDEX idx_path (path),
        INDEX idx_novel_id (novel_id),
        INDEX idx_chapter_id (chapter_id),
        INDEX idx_token_chapter_recent (access_token_id, created_at, novel_id, chapter_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS analytics_daily (
        stat_date DATE PRIMARY KEY,
        sessions INT NOT NULL DEFAULT 0,
        users INT NOT NULL DEFAULT 0,
        readers INT NOT NULL DEFAULT 0,
        page_views INT NOT NULL DEFAULT 0,
        unique_ips INT NOT NULL DEFAULT 0,
        novel_views INT NOT NULL DEFAULT 0,
        chapter_views INT NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS analytics_totals (
        id TINYINT NOT NULL PRIMARY KEY DEFAULT 1,
        page_views BIGINT NOT NULL DEFAULT 0,
        sessions BIGINT NOT NULL DEFAULT 0,
        users BIGINT NOT NULL DEFAULT 0,
        readers BIGINT NOT NULL DEFAULT 0,
        unique_ips BIGINT NOT NULL DEFAULT 0,
        novel_views BIGINT NOT NULL DEFAULT 0,
        chapter_views BIGINT NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        sid VARCHAR(64) NOT NULL PRIMARY KEY,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_expires_at (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // schema 版本管理：只跑尚未应用的迁移，避免每次升版本都重跑历史链
    await ensureSchemaVersionTable(conn);
    await runPendingMigrations(conn);

    // Seed data: only if novels table is empty
    const [rows] = await conn.execute('SELECT COUNT(*) AS cnt FROM novels');
    if (rows[0].cnt === 0) {
      await conn.execute(
        'INSERT INTO novels (title, author, description) VALUES (?, ?, ?)',
        ['星辰变', '我吃西红柿', '一部背景极大的奇幻修真小说。讲述主角秦羽从凡人一步步修炼成为宇宙掌控者的故事。']
      );

      const chapters = [
        { cn: 1, title: '第一章 秦羽', content: '时则七重锦，暖阁熏香。\n\n大楚皇宫的琉璃瓦上，积雪正消。\n\n秦羽跪在冰冷的金砖上，膝盖已经麻木。他的面前是一道珠帘，帘后隐约可见一抹明黄身影——那是他的父皇，大楚的皇帝陛下。\n\n"羽儿，你可知罪？"\n\n秦羽抬起头，露出一个苍白而倔强的笑容："儿臣不知。"\n\n珠帘轻轻晃动，皇帝的声音带着一丝疲惫："私闯禁宫，盗取镇国玉玺，这是死罪。"\n\n"父皇，"秦羽的声音很轻，却字字清晰，"玉玺本就在宗庙供奉，儿臣只是去祭拜母妃，恰巧路过。"\n\n大殿里安静了很久。久到秦羽以为皇帝已经离开了。' },
        { cn: 2, title: '第二章 星云流转', content: '秦羽被软禁在清凉殿的第三天，夜空中的星辰忽然动了。\n\n那天夜里，他照例盘膝打坐。这是他从小养成的习惯，也是母妃留给他的唯一功法——《星辰诀》。据说这是母妃家族的祖传秘法，修炼到极致可以引动诸天星辰之力。\n\n但秦羽修炼了十二年，始终没有感受到一丝灵气。\n\n直到今夜。\n\n当他闭上眼睛的那一刻，他"看到"了。不是用眼睛看，而是一种玄之又玄的感应——漫天星辰以一种奇妙的轨迹在运转，而他的身体里，仿佛有什么东西正在苏醒。\n\n那是一个星云般的气旋，在他的丹田处缓缓旋转。每转一圈，就有微弱的星光从夜空中被牵引下来，融入他的体内。\n\n"这就是……灵气？"' },
        { cn: 3, title: '第三章 夜探藏经阁', content: '引气入体之后，秦羽感觉整个世界都变得不一样了。\n\n他能听到殿外侍卫的呼吸声，能分辨出风中带来的各种气息，甚至能在黑暗中看清百步之外的一片落叶。\n\n但他知道，这只是开始。\n\n《星辰诀》上说，引气入体只是第一步，接下来需要吸收足够的星辰之力来淬炼肉身、开辟经脉。而这个过程，需要大量的功法典籍来参考印证。\n\n皇宫里藏书最多的地方，是藏经阁。\n\n那里收藏了楚国数百年来搜罗的各种功法秘籍——虽然大多是低阶功法，但对于现在的秦羽来说，已经足够了。\n\n问题是，他被软禁了。\n\n秦羽推开窗户，看着外面深沉的夜色，嘴角露出一丝微笑。软禁？对一个刚刚踏入修行门槛的人来说，这不过是一个小小的麻烦罢了。' }
      ];

      const crypto = require('crypto');
      for (const ch of chapters) {
        const contentHash = crypto.createHash('sha256').update(ch.content, 'utf8').digest('hex');
        await conn.execute(
          'INSERT INTO chapters (novel_id, chapter_number, title, content, content_hash) VALUES (?, ?, ?, ?, ?)',
          [1, ch.cn, ch.title, ch.content, contentHash]
        );
      }
      await conn.execute(`
        UPDATE novels n
        SET last_chapter_number = 3,
            last_chapter_title = '第三章 夜探藏经阁',
            updated_at = NOW(),
            status = 'serializing'
        WHERE id = 1
      `);
      logger.info('种子数据已插入', { novels: 1, chapters: 3 });
    }
  } finally {
    conn.release();
  }
}

module.exports = { pool, initDB };

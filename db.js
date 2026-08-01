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

const SCHEMA_VERSION = 1;

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
        page_views INT NOT NULL DEFAULT 0,
        unique_ips INT NOT NULL DEFAULT 0,
        novel_views INT NOT NULL DEFAULT 0,
        chapter_views INT NOT NULL DEFAULT 0,
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

    // schema 版本管理:已应用最新版本时跳过历史迁移检查,缩短启动时间
    await ensureSchemaVersionTable(conn);
    const appliedVersion = await getAppliedSchemaVersion(conn);
    if (appliedVersion < SCHEMA_VERSION) {
      await runSchemaMigrations(conn);
      await recordSchemaVersion(conn, SCHEMA_VERSION);
      logger.info('数据库迁移完成', { schema_version: SCHEMA_VERSION });
    }

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

      for (const ch of chapters) {
        await conn.execute(
          'INSERT INTO chapters (novel_id, chapter_number, title, content) VALUES (?, ?, ?, ?)',
          [1, ch.cn, ch.title, ch.content]
        );
      }
      logger.info('种子数据已插入', { novels: 1, chapters: 3 });
    }
  } finally {
    conn.release();
  }
}

module.exports = { pool, initDB };

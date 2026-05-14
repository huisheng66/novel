const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'novel',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4'
});

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
      console.log('种子数据已插入：1 本小说 + 3 章');
    }
  } finally {
    conn.release();
  }
}

module.exports = { pool, initDB };

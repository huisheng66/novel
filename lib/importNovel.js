// 通用小说 TXT 导入：解析章节 → 按 title+author 复用或新建 → 批量写库

const fs = require('fs');
const { pool } = require('../db');
const {
  decodeTxt,
  splitTextIntoChapters,
  formatChapterContent
} = require('./chapterText');

const DEFAULT_BATCH = 50;

/**
 * @param {object} options
 * @param {string} options.file 本地 txt 路径
 * @param {string} options.title
 * @param {string} options.author
 * @param {string} [options.description]
 * @param {number} [options.batch]
 * @param {(msg: string) => void} [options.log]
 * @returns {Promise<{ novelId: number, chapterCount: number, first3: any[], last: any }>}
 */
async function importNovelFromTxt(options) {
  const {
    file,
    title,
    author,
    description = '',
    batch = DEFAULT_BATCH,
    log = console.log
  } = options;

  if (!file || !title || !author) {
    throw new Error('importNovelFromTxt requires file, title, author');
  }

  const started = Date.now();
  log(`reading ${file}...`);
  const text = decodeTxt(fs.readFileSync(file));
  log(`decoded chars: ${text.length}`);

  const chapters = splitTextIntoChapters(text, title);
  log(`chapters: ${chapters.length}`);
  if (!chapters.length) throw new Error('no chapters parsed');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [existing] = await conn.execute(
      'SELECT id FROM novels WHERE title = ? AND author = ? LIMIT 1',
      [title, author]
    );

    let novelId;
    if (existing.length) {
      novelId = existing[0].id;
      log(`found existing novel id=${novelId}, replacing chapters...`);
      await conn.execute('DELETE FROM chapters WHERE novel_id = ?', [novelId]);
      await conn.execute('UPDATE novels SET description = ? WHERE id = ?', [description, novelId]);
    } else {
      const [result] = await conn.execute(
        'INSERT INTO novels (title, author, description) VALUES (?, ?, ?)',
        [title, author, description]
      );
      novelId = result.insertId;
      log(`created novel id=${novelId}`);
    }

    let inserted = 0;
    for (let i = 0; i < chapters.length; i += batch) {
      const slice = chapters.slice(i, i + batch);
      const placeholders = slice.map(() => '(?, ?, ?, ?)').join(',');
      const params = [];
      for (let j = 0; j < slice.length; j++) {
        params.push(
          novelId,
          i + j + 1,
          slice[j].title,
          formatChapterContent(slice[j].content)
        );
      }
      await conn.execute(
        `INSERT INTO chapters (novel_id, chapter_number, title, content) VALUES ${placeholders}`,
        params
      );
      inserted += slice.length;
      if (inserted % 200 === 0 || inserted === chapters.length) {
        log(`inserted ${inserted}/${chapters.length}`);
      }
    }

    await conn.commit();

    const [[countRow]] = await conn.execute(
      'SELECT COUNT(*) AS cnt FROM chapters WHERE novel_id = ?',
      [novelId]
    );
    const [first3] = await conn.execute(
      'SELECT chapter_number, title, CHAR_LENGTH(content) AS len FROM chapters WHERE novel_id = ? ORDER BY chapter_number ASC LIMIT 3',
      [novelId]
    );
    const [lastRows] = await conn.execute(
      'SELECT chapter_number, title, CHAR_LENGTH(content) AS len FROM chapters WHERE novel_id = ? ORDER BY chapter_number DESC LIMIT 1',
      [novelId]
    );

    const result = {
      novelId,
      chapterCount: countRow.cnt,
      first3,
      last: lastRows[0] || null,
      elapsedMs: Date.now() - started
    };
    log(`DONE novel_id=${result.novelId} count=${result.chapterCount} elapsed_ms=${result.elapsedMs}`);
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { importNovelFromTxt, DEFAULT_BATCH };

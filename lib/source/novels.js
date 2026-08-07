// 书源侧小说查询：统一 SQL 片段，避免 book/toc/search 三处复制

const { pool } = require('../../db');

const NOVEL_FIELDS = `
  n.id,
  n.title,
  n.author,
  n.description,
  n.cover_image,
  COUNT(c.id) AS chapter_count,
  SUBSTRING_INDEX(
    GROUP_CONCAT(c.title ORDER BY c.chapter_number DESC SEPARATOR '\\n'),
    '\\n',
    1
  ) AS last_chapter
`;

const NOVEL_FROM = `
  FROM novels n
  LEFT JOIN chapters c ON c.novel_id = n.id
`;

const NOVEL_GROUP = 'GROUP BY n.id, n.title, n.author, n.description, n.cover_image';

async function getSourceNovelById(novelId, allowedNovelId) {
  const params = [novelId];
  const where = ['n.id = ?'];
  if (allowedNovelId) {
    where.push('n.id = ?');
    params.push(allowedNovelId);
  }

  const [rows] = await pool.execute(
    `SELECT ${NOVEL_FIELDS} ${NOVEL_FROM}
     WHERE ${where.join(' AND ')}
     ${NOVEL_GROUP}
     LIMIT 1`,
    params
  );
  return rows[0] || null;
}

async function resolveReadableNovel(requestedNovelId, allowedNovelId) {
  const params = [];
  const where = [];

  if (allowedNovelId) {
    where.push('n.id = ?');
    params.push(allowedNovelId);
  } else if (requestedNovelId) {
    where.push('(n.id = ? OR n.id <> ?)');
    params.push(requestedNovelId, requestedNovelId);
  }

  const [rows] = await pool.execute(
    `SELECT ${NOVEL_FIELDS} ${NOVEL_FROM}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ${NOVEL_GROUP}
     HAVING COUNT(c.id) > 0
     ORDER BY
       CASE WHEN n.id = ? THEN 0 ELSE 1 END,
       n.id ASC
     LIMIT 1`,
    [...params, Number(requestedNovelId) || 0]
  );
  return rows[0] || null;
}

/**
 * 解析书源可见小说。
 * 请求 id 无章节时，可读内容回退到有章节的书，但 display 仍用请求书的元信息。
 */
async function resolveSourceNovel(requestedNovelId, allowedNovelId) {
  const requested = await getSourceNovelById(requestedNovelId, allowedNovelId);
  const requestedHasChapters = requested && Number(requested.chapter_count || 0) > 0;
  const readable = requestedHasChapters
    ? requested
    : await resolveReadableNovel(requestedNovelId, allowedNovelId);

  if (!readable) return null;

  if (requested && !requestedHasChapters) {
    return {
      display: {
        ...readable,
        id: requested.id,
        title: requested.title,
        author: requested.author || readable.author,
        description: requested.description || readable.description,
        cover_image: requested.cover_image || readable.cover_image,
        last_chapter: readable.last_chapter
      },
      readable
    };
  }

  return { display: readable, readable };
}

async function searchSourceNovels(keyword, allowedNovelId) {
  const params = [];
  const where = [];

  if (allowedNovelId) {
    where.push('n.id = ?');
    params.push(allowedNovelId);
  }
  if (keyword) {
    where.push('(n.title LIKE ? OR n.author LIKE ? OR n.description LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }

  const [rows] = await pool.execute(
    `SELECT
       ${NOVEL_FIELDS},
       MAX(c.chapter_number) AS last_chapter_number
     ${NOVEL_FROM}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ${NOVEL_GROUP}
     ${keyword ? '' : 'HAVING COUNT(c.id) > 0'}
     ORDER BY
       CASE WHEN COUNT(c.id) > 0 THEN 0 ELSE 1 END,
       n.id ASC`,
    params
  );

  if (!keyword) return rows;

  const readable = await resolveReadableNovel(0, allowedNovelId);
  return rows.map(row => {
    if (Number(row.chapter_count || 0) > 0 || !readable) return row;
    return {
      ...row,
      cover_image: row.cover_image || readable.cover_image,
      last_chapter: readable.last_chapter,
      last_chapter_number: readable.last_chapter_number
    };
  });
}

async function getSourceChapters(novelId) {
  const [chapters] = await pool.execute(
    `SELECT chapter_number, title
     FROM chapters
     WHERE novel_id = ?
     ORDER BY chapter_number ASC`,
    [novelId]
  );
  return chapters;
}

async function getSourceChapter(novelId, chapterNumber) {
  const [[chapter]] = await pool.execute(
    `SELECT chapter_number, title, content
     FROM chapters
     WHERE novel_id = ? AND chapter_number = ?`,
    [novelId, chapterNumber]
  );
  return chapter || null;
}

module.exports = {
  getSourceNovelById,
  resolveReadableNovel,
  resolveSourceNovel,
  searchSourceNovels,
  getSourceChapters,
  getSourceChapter
};

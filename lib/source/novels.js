// 书源侧小说查询：统一 SQL 片段，避免 book/toc/search 三处复制

const { pool } = require('../../db');
const paywall = require('../paywall');

const NOVEL_FIELDS = `
  n.id,
  n.title,
  n.author,
  n.description,
  n.cover_image,
  n.last_chapter_number,
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

const NOVEL_GROUP = 'GROUP BY n.id, n.title, n.author, n.description, n.cover_image, n.last_chapter_number';

/**
 * 这本书是否应从书源中整体隐藏。
 * 理由：目录里留着付费章节、正文却抓不到，只会把读者赶去别处，不如不给。
 * 由后台开关 paywall_hide_from_source 控制；也允许把开关关掉做「试读引流」。
 */
async function isHiddenFromSource(novel) {
  if (!novel) return false;
  const settings = await paywall.getSettings();
  if (!settings.hideFromSource) return false;

  const rule = await paywall.resolveRule(novel.id);
  if (!rule.enabled) return false;

  const overrides = await paywall.getOverrides(novel.id);
  for (const ov of overrides.values()) {
    if (ov.isFree === 0 || ov.isFree === false) return true;
  }

  const freeUntil = Number(rule.freeUntil || 0);
  if (freeUntil === 0) return true; // 整本收费

  const last = Number(novel.last_chapter_number || 0);
  return last > freeUntil;
}

/** 过滤出书源可见的章节 */
async function filterSourceChapters(novelId, chapters) {
  const rule = await paywall.resolveRule(novelId);
  if (!rule.enabled) return chapters;

  const overrides = await paywall.getOverrides(novelId);
  return chapters.filter(ch => {
    const ov = overrides.get(Number(ch.chapter_number)) || null;
    return !paywall.isChapterPaid({
      chapterNumber: ch.chapter_number,
      chapterIsFree: ov ? ov.isFree : null,
      rule
    });
  });
}

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
  if (await isHiddenFromSource(requested) || await isHiddenFromSource(readable)) return null;

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
       ${NOVEL_FIELDS}
     ${NOVEL_FROM}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ${NOVEL_GROUP}
     ${keyword ? '' : 'HAVING COUNT(c.id) > 0'}
     ORDER BY
       CASE WHEN COUNT(c.id) > 0 THEN 0 ELSE 1 END,
       n.id ASC`,
    params
  );

  const visible = [];
  for (const row of rows) {
    if (!await isHiddenFromSource(row)) visible.push(row);
  }
  if (!keyword) return visible;

  const readable = await resolveReadableNovel(0, allowedNovelId);
  return visible.map(row => {
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
  return filterSourceChapters(novelId, chapters);
}

async function getSourceChapter(novelId, chapterNumber) {
  const [[chapter]] = await pool.execute(
    `SELECT chapter_number, title, content
     FROM chapters
     WHERE novel_id = ? AND chapter_number = ?`,
    [novelId, chapterNumber]
  );
  if (!chapter) return null;

  // 付费章节在书源侧一律视为不存在（返回 404，不提示「该章需付费」以免被用来探测）
  const rule = await paywall.resolveRule(novelId);
  if (rule.enabled) {
    const overrides = await paywall.getOverrides(novelId);
    const ov = overrides.get(Number(chapterNumber)) || null;
    const paid = paywall.isChapterPaid({
      chapterNumber,
      chapterIsFree: ov ? ov.isFree : null,
      rule
    });
    if (paid) return null;
  }

  return chapter;
}

module.exports = {
  getSourceNovelById,
  resolveReadableNovel,
  resolveSourceNovel,
  searchSourceNovels,
  getSourceChapters,
  getSourceChapter,
  isHiddenFromSource,
  filterSourceChapters
};

// 前台 HTML 缓存键的唯一构造点。
//
// 段序原则：「失效维度在前，Host 在后」。
//   html:home:{host}:{allowedId|all}
//   html:novel:{novelId}:{host}
//   html:chapter:{novelId}:{chapterNum}:{host}
//
// 这样后台只需 cache.clear(前缀) 就能精准失效（novel/chapter 均可按小说收敛），
// 同时 Host 仍参与键值 —— 恶意 Host 渲染出的页面不会污染正常 Host（CWE-644）。
// 曾经把 {host} 放在第二段，导致 admin 侧的清理前缀全部落空、内容改动要等 TTL 过期，
// 因此所有键必须经由本模块构造，不要在业务里手写字符串。

const ALL_PREFIX = 'html:';
const HOME_PREFIX = 'html:home:';
const NOVEL_PREFIX = 'html:novel:';
const CHAPTER_PREFIX = 'html:chapter:';

/**
 * 缓存键用的 Host 段。Host 头由客户端控制，必须归一化后再入键。
 * @param {import('express').Request} req
 */
function hostOf(req) {
  const host = String(req.get('host') || 'default')
    .toLowerCase()
    .replace(/[^a-z0-9.:-]/g, '_')
    .slice(0, 64);
  return host || 'default';
}

function homeKey(host, allowedNovelId) {
  return `${HOME_PREFIX}${host}:${allowedNovelId || 'all'}`;
}

function novelKey(host, novelId) {
  return `${NOVEL_PREFIX}${novelId}:${host}`;
}

function chapterKey(host, novelId, chapterNum) {
  return `${CHAPTER_PREFIX}${novelId}:${chapterNum}:${host}`;
}

/** 清空某本小说的目录页（所有 Host） */
function novelPrefix(novelId) {
  return `${NOVEL_PREFIX}${novelId}:`;
}

/** 清空某本小说的全部章节页（所有 Host） */
function chapterPrefix(novelId) {
  return `${CHAPTER_PREFIX}${novelId}:`;
}

module.exports = {
  ALL_PREFIX,
  HOME_PREFIX,
  hostOf,
  homeKey,
  novelKey,
  chapterKey,
  novelPrefix,
  chapterPrefix
};

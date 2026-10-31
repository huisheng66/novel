// 前台 HTML / 段落 / token 缓存失效
//
// 键格式由 lib/htmlCacheKey.js 统一构造（失效维度在前、Host 在后），
// 因此这里只能用该模块导出的前缀，不要手写 'html:xxx:' 字符串 —— 手写即为本文件曾出现过的
// “前缀与实际键差一段、clear 全部落空、内容改动要等 TTL 过期” 的根因。

const cache = require('../../../lib/memoryCache');
const htmlCacheKey = require('../../../lib/htmlCacheKey');
const { clearNovelsCache } = require('./novels');

const PARAGRAPHS_PREFIX = 'paragraphs:';

function clearApiCache() {
  // 一期 API 以 DB 为准、短缓存；预留统一失效前缀
  cache.clear('api:');
}

function clearAccessTokenCache() {
  cache.clear('access-token:');
  cache.clear('web-access-token:');
  cache.clear('api-access-token:');
}

/** 首页列表：所有 Host、所有 token 视角 */
function clearHomePages() {
  cache.clear(htmlCacheKey.HOME_PREFIX);
}

/** 某本小说的目录页 + 全部章节页（所有 Host）；novelId 缺失时全清 */
function clearNovelPages(novelId) {
  if (!novelId) {
    cache.clear(htmlCacheKey.ALL_PREFIX);
    return;
  }
  cache.clear(htmlCacheKey.novelPrefix(novelId));
  cache.clear(htmlCacheKey.chapterPrefix(novelId));
}

function clearHomeCache() {
  clearHomePages();
  clearNovelsCache();
  clearApiCache();
}

function clearNovelCache(novelId) {
  clearNovelsCache();
  clearApiCache();
  if (!novelId) {
    // 小说集合本身变了（新增/删除）：首页、目录、章节、段落全部失效
    cache.clear(htmlCacheKey.ALL_PREFIX);
    cache.clear(PARAGRAPHS_PREFIX);
    return;
  }
  clearHomePages();
  clearNovelPages(novelId);
  // 段落缓存以 chapter.id 为键，小说级无法反查章节 id，故交给 clearChapterCache 精准清
}

function clearChapterCache(novelId, chapterId) {
  clearNovelsCache();
  clearApiCache();
  if (novelId) {
    clearHomePages();
    clearNovelPages(novelId);
  } else {
    cache.clear(htmlCacheKey.ALL_PREFIX);
  }
  // 段落缓存键：paragraphs:v3:{chapterId}
  if (chapterId) {
    cache.clear(`${PARAGRAPHS_PREFIX}v3:${chapterId}`);
  } else {
    cache.clear(PARAGRAPHS_PREFIX);
  }
}

module.exports = {
  clearHomeCache,
  clearAccessTokenCache,
  clearNovelCache,
  clearChapterCache,
  clearApiCache
};

// 前台 HTML / 段落 / token 缓存失效

const cache = require('../../../lib/memoryCache');
const { clearNovelsCache } = require('./novels');

function clearApiCache() {
  // 一期 API 以 DB 为准、短缓存；预留统一失效前缀
  cache.clear('api:');
}

function clearHomeCache() {
  cache.clear('html:home:');
  clearNovelsCache();
  clearApiCache();
}

function clearAccessTokenCache() {
  cache.clear('access-token:');
  cache.clear('web-access-token:');
  cache.clear('api-access-token:');
}

function clearNovelCache(novelId) {
  clearNovelsCache();
  clearApiCache();
  if (!novelId) {
    cache.clear('html:');
    cache.clear('paragraphs:');
    return;
  }
  cache.clear(`html:novel:${novelId}`);
  // 章节键以 chapter.id 为主，无法按 novel 精准失效
  cache.clear('html:chapter:');
  cache.clear('html:home:');
}

function clearChapterCache(novelId, chapterId) {
  clearNovelsCache();
  clearApiCache();
  if (novelId) {
    cache.clear(`html:novel:${novelId}`);
    cache.clear('html:home:');
  }
  // 键格式: html:chapter:v4:{novelId}:{chapterNum}、paragraphs:v3:{id}
  // 章节号可能变化，按前缀整清最稳妥
  cache.clear('html:chapter:');
  if (chapterId) {
    cache.clear(`paragraphs:v3:${chapterId}`);
  } else {
    cache.clear('paragraphs:');
  }
}

module.exports = {
  clearHomeCache,
  clearAccessTokenCache,
  clearNovelCache,
  clearChapterCache,
  clearApiCache
};

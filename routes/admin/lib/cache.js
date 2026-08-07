// 前台 HTML / 段落 / token 缓存失效

const cache = require('../../../lib/memoryCache');

function clearHomeCache() {
  cache.clear('html:home:');
}

function clearAccessTokenCache() {
  cache.clear('access-token:');
}

function clearNovelCache(novelId) {
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
  if (novelId) {
    cache.clear(`html:novel:${novelId}`);
    cache.clear('html:home:');
  }
  // 键格式: html:chapter:v3:{id}、paragraphs:v3:{id}
  if (chapterId) {
    cache.clear(`html:chapter:v3:${chapterId}`);
    cache.clear(`paragraphs:v3:${chapterId}`);
  } else {
    cache.clear('html:chapter:');
    cache.clear('paragraphs:');
  }
}

module.exports = {
  clearHomeCache,
  clearAccessTokenCache,
  clearNovelCache,
  clearChapterCache
};

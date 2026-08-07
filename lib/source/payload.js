// 书源 JSON payload + Legado 书源配置（token 由路由层传入，避免 lib→routes 反向依赖）

const { getBaseUrl, toAbsoluteUrl } = require('../util');

function tokenQuery(token) {
  return `token=${encodeURIComponent(token || '')}`;
}

function getSourceChapterUrl(req, novelId, chapterNumber, token, format = 'json') {
  const segment = format === 'html' ? '/source/html/content' : '/source/content';
  return `${getBaseUrl(req)}${segment}/${novelId}/${chapterNumber}?${tokenQuery(token)}`;
}

function buildSourceBookPayload(req, novel, token) {
  const base = getBaseUrl(req);
  const q = tokenQuery(token);
  return {
    id: novel.id,
    name: novel.title,
    author: novel.author || '',
    intro: novel.description || '',
    kind: '自建书源',
    coverUrl: toAbsoluteUrl(req, novel.cover_image),
    lastChapter: novel.last_chapter || '',
    bookUrl: `${base}/source/book/${novel.id}?${q}`,
    tocUrl: `${base}/source/toc/${novel.id}?${q}`
  };
}

function buildSourceChapterListPayload(req, novel, chapters, token) {
  return {
    ...buildSourceBookPayload(req, novel, token),
    chapters: chapters.map(chapter => ({
      title: chapter.title,
      url: getSourceChapterUrl(req, novel.id, chapter.chapter_number, token),
      chapterNumber: chapter.chapter_number
    }))
  };
}

function withDataPayload(payload) {
  return { ...payload, data: payload };
}

function buildLegadoSource(req, token) {
  const baseUrl = getBaseUrl(req);
  const encodedToken = encodeURIComponent(token);

  return {
    bookSourceComment: '自建小说站书源，已自动绑定当前 token',
    bookSourceGroup: '自建',
    bookSourceName: `Novel 书源(${req.get('host')})`,
    bookSourceType: 0,
    bookSourceUrl: baseUrl,
    bookUrlPattern: '',
    customOrder: 0,
    enabled: true,
    enabledExplore: false,
    header: '{\n  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"\n}',
    lastUpdateTime: Date.now(),
    loginUrl: '',
    exploreUrl: '',
    ruleBookInfo: {
      name: '@css:.source-book-name@text',
      author: '@css:.source-book-author@text',
      intro: '@css:.source-book-intro@text',
      kind: '@css:.source-book-kind@text',
      coverUrl: '@css:.source-book-cover@src',
      lastChapter: '@css:.source-book-last@text',
      tocUrl: '@css:#source-toc-link@href'
    },
    ruleContent: {
      content: '@css:.source-content@html',
      nextContentUrl: ''
    },
    ruleExplore: {},
    ruleSearch: {
      bookList: '@css:.source-book',
      name: '@css:.source-book-title@text',
      author: '@css:.source-book-author@text',
      intro: '@css:.source-book-intro@text',
      kind: '@css:.source-book-kind@text',
      coverUrl: '@css:.source-book-cover@src',
      lastChapter: '@css:.source-book-last@text',
      bookUrl: '@css:.source-book-link@href'
    },
    ruleToc: {
      chapterList: '@css:.source-chapter-item',
      chapterName: '@css:.source-chapter-link@text',
      chapterUrl: '@css:.source-chapter-link@href',
      isVip: '',
      isPay: ''
    },
    searchUrl: `${baseUrl}/source/html/search?key={{key}}&page={{page}}&token=${encodedToken}`,
    weight: 0
  };
}

module.exports = {
  tokenQuery,
  getSourceChapterUrl,
  buildSourceBookPayload,
  buildSourceChapterListPayload,
  withDataPayload,
  buildLegadoSource
};

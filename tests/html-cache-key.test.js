// 回归测试：HTML 缓存键与失效前缀必须始终对齐。
// 历史 bug：键曾改为 html:{host}:novel:{id}，而清理仍用 html:novel:{id} 前缀，
// 导致后台改完内容前台要等 TTL 过期。这里用真实键构造器 + 真实清理函数交叉验证。

const test = require('node:test');
const assert = require('node:assert/strict');

const cache = require('../lib/memoryCache');
const keys = require('../lib/htmlCacheKey');
const { pool } = require('../db');
const {
  clearHomeCache,
  clearNovelCache,
  clearChapterCache
} = require('../routes/admin/lib/cache');

function seed() {
  cache.clear('');
  const entries = {
    homeA: keys.homeKey('a.test', null),
    homeB: keys.homeKey('b.test', null),
    homeScoped: keys.homeKey('a.test', 5),
    novel5A: keys.novelKey('a.test', 5),
    novel5B: keys.novelKey('b.test', 5),
    novel6A: keys.novelKey('a.test', 6),
    chap5A: keys.chapterKey('a.test', 5, 1),
    chap5B: keys.chapterKey('b.test', 5, 1),
    chap6A: keys.chapterKey('a.test', 6, 1),
    paragraphs: 'paragraphs:v3:9001',
    otherNovelMicro: keys.novelKey('a.test', 12)
  };
  for (const key of Object.values(entries)) cache.set(key, '<html>');
  return entries;
}

function alive(entries) {
  return Object.fromEntries(
    Object.entries(entries).map(([name, key]) => [name, cache.get(key) !== null])
  );
}

test('键格式：失效维度在前，Host 在后', () => {
  assert.equal(keys.homeKey('a.test', null), 'html:home:a.test:all');
  assert.equal(keys.homeKey('a.test', 5), 'html:home:a.test:5');
  assert.equal(keys.novelKey('a.test', 5), 'html:novel:5:a.test');
  assert.equal(keys.chapterKey('a.test', 5, 1), 'html:chapter:5:1:a.test');
});

test('同一内容在不同 Host 下不共享键（CWE-644 隔离仍然成立）', () => {
  assert.notEqual(keys.novelKey('a.test', 5), keys.novelKey('b.test', 5));
  assert.notEqual(keys.chapterKey('a.test', 5, 1), keys.chapterKey('b.test', 5, 1));
  assert.notEqual(keys.homeKey('a.test', null), keys.homeKey('b.test', null));
});

test('失效前缀能命中真实键，且不会误伤相邻小说编号', () => {
  const entries = seed();
  assert.ok(entries.novel5A.startsWith(keys.novelPrefix(5)));
  assert.ok(entries.chap5A.startsWith(keys.chapterPrefix(5)));
  assert.ok(!entries.novel5A.startsWith(keys.novelPrefix(50)));
  // novel 12 不能被 novel 1 的前缀误清
  assert.ok(!entries.otherNovelMicro.startsWith(keys.novelPrefix(1)));
});

test('clearNovelCache 只清目标小说 + 首页，保留其他小说与其他 Host 的缓存', () => {
  const entries = seed();
  clearNovelCache(5);
  const state = alive(entries);

  assert.equal(state.homeA, false, '首页缓存应失效');
  assert.equal(state.homeB, false, '所有 Host 的首页都应失效');
  assert.equal(state.homeScoped, false, '带 token 限书的首页也应失效');
  assert.equal(state.novel5A, false, '目标小说目录应失效（host a）');
  assert.equal(state.novel5B, false, '目标小说目录应失效（host b）');
  assert.equal(state.chap5A, false, '目标小说章节页应失效');
  assert.equal(state.chap5B, false);
  assert.equal(state.novel6A, true, '其他小说目录必须保留');
  assert.equal(state.chap6A, true, '其他小说章节页必须保留');
  assert.equal(state.otherNovelMicro, true);
});

test('clearChapterCache 清该小说页面与该章段落，保留其他段落', () => {
  const entries = seed();
  cache.set('paragraphs:v3:9002', '<p>');

  clearChapterCache(5, 9001);
  const state = alive(entries);

  assert.equal(state.chap5A, false);
  assert.equal(state.novel5A, false);
  assert.equal(state.homeA, false);
  assert.equal(state.paragraphs, false, '被改章节的段落缓存应失效');
  assert.equal(cache.get('paragraphs:v3:9002'), '<p>', '其他章节段落缓存应保留');
  assert.equal(state.novel6A, true);
  assert.equal(state.chap6A, true);
});

test('clearNovelCache 无 novelId 时全清 HTML 缓存', () => {
  const entries = seed();
  clearNovelCache();
  const state = alive(entries);
  for (const [name, isAlive] of Object.entries(state)) {
    assert.equal(isAlive, false, `${name} 应被全清`);
  }
});

test('clearHomeCache 只清首页，不碰目录与章节页', () => {
  const entries = seed();
  clearHomeCache();
  const state = alive(entries);
  assert.equal(state.homeA, false);
  assert.equal(state.homeScoped, false);
  assert.equal(state.novel5A, true);
  assert.equal(state.chap5A, true);
});

test.after(() => pool.end());

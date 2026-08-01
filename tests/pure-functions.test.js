const test = require('node:test');
const assert = require('node:assert/strict');

const util = require('../lib/util');
const {
  normalizeText,
  formatChapterContent,
  cleanChapterTitle,
  isChapterTitleLine,
  splitTextIntoChapters,
  decodeTxt
} = require('../lib/chapterText');

/* ===== lib/util.js ===== */

test('parsePositiveInt returns parsed value for valid positive integer', () => {
  assert.equal(util.parsePositiveInt('42', 10), 42);
  assert.equal(util.parsePositiveInt(7, 10), 7);
});

test('parsePositiveInt returns fallback for invalid input', () => {
  assert.equal(util.parsePositiveInt('abc', 10), 10);
  assert.equal(util.parsePositiveInt('-5', 10), 10);
  assert.equal(util.parsePositiveInt('0', 10), 10);
  assert.equal(util.parsePositiveInt('', 10), 10);
  assert.equal(util.parsePositiveInt(null, 10), 10);
});

test('parsePositiveInt returns fallback when fallback is 0', () => {
  assert.equal(util.parsePositiveInt('abc', 0), 0);
});

test('getBaseUrl extracts protocol and host from request', () => {
  const req = {
    headers: { 'x-forwarded-proto': 'https' },
    protocol: 'http',
    get(name) { return name === 'host' ? 'example.com' : undefined; }
  };
  assert.equal(util.getBaseUrl(req), 'https://example.com');
});

test('getBaseUrl falls back to req.protocol when no x-forwarded-proto', () => {
  const req = {
    headers: {},
    protocol: 'http',
    get(name) { return name === 'host' ? 'localhost:3000' : undefined; }
  };
  assert.equal(util.getBaseUrl(req), 'http://localhost:3000');
});

test('toAbsoluteUrl returns absolute URL unchanged', () => {
  const req = { headers: {}, protocol: 'http', get: () => 'host' };
  assert.equal(util.toAbsoluteUrl(req, 'https://cdn.example.com/img.png'), 'https://cdn.example.com/img.png');
  assert.equal(util.toAbsoluteUrl(req, 'http://example.com/page'), 'http://example.com/page');
});

test('toAbsoluteUrl prepends baseUrl to relative path', () => {
  const req = { headers: {}, protocol: 'http', get: () => 'example.com' };
  assert.equal(util.toAbsoluteUrl(req, '/uploads/cover.jpg'), 'http://example.com/uploads/cover.jpg');
  assert.equal(util.toAbsoluteUrl(req, 'uploads/cover.jpg'), 'http://example.com/uploads/cover.jpg');
});

test('toAbsoluteUrl returns empty string for empty input', () => {
  const req = { headers: {}, protocol: 'http', get: () => 'host' };
  assert.equal(util.toAbsoluteUrl(req, ''), '');
  assert.equal(util.toAbsoluteUrl(req, null), '');
});

test('escapeHtml escapes special characters', () => {
  assert.equal(util.escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(util.escapeHtml("a'b&c"), 'a&#39;b&amp;c');
  assert.equal(util.escapeHtml(null), '');
  assert.equal(util.escapeHtml(undefined), '');
});

/* ===== normalizeText ===== */

test('normalizeText normalizes line endings', () => {
  assert.equal(normalizeText('line1\r\nline2\rline3'), 'line1\nline2\nline3');
});

test('normalizeText removes null bytes', () => {
  assert.equal(normalizeText('hello\u0000world'), 'helloworld');
});

test('normalizeText trims whitespace', () => {
  assert.equal(normalizeText('  hello  '), 'hello');
});

test('normalizeText returns empty string for null/undefined', () => {
  assert.equal(normalizeText(null), '');
  assert.equal(normalizeText(undefined), '');
});

/* ===== cleanChapterTitle ===== */

test('cleanChapterTitle strips markdown and whitespace', () => {
  assert.equal(cleanChapterTitle('  ## 第1章 测试  '), '第1章 测试');
  assert.equal(cleanChapterTitle('**第2章**'), '第2章');
});

test('cleanChapterTitle trims full-width spaces', () => {
  assert.equal(cleanChapterTitle('　第3章 开端　'), '第3章 开端');
});

/* ===== isChapterTitleLine ===== */

test('isChapterTitleLine recognizes Chinese chapter titles', () => {
  assert.ok(isChapterTitleLine('第一章 风起'));
  assert.ok(isChapterTitleLine('第1章 测试'));
  assert.ok(isChapterTitleLine('第123回 红尘'));
  assert.ok(isChapterTitleLine('第二节 暗流'));
});

test('isChapterTitleLine recognizes Arabic chapter titles', () => {
  assert.ok(isChapterTitleLine('Chapter 1'));
  assert.ok(isChapterTitleLine('chapter 42 The Beginning'));
  assert.ok(isChapterTitleLine('CHAPTER 99'));
});

test('isChapterTitleLine recognizes prefixed chapter titles', () => {
  assert.ok(isChapterTitleLine('1. 第1章 开端'));
  assert.ok(isChapterTitleLine('12. 序章'));
});

test('isChapterTitleLine rejects non-title lines', () => {
  assert.ok(!isChapterTitleLine('这是一段普通的正文文字'));
  assert.ok(!isChapterTitleLine(''));
  assert.ok(!isChapterTitleLine('   '));
});

test('isChapterTitleLine rejects overly long titles', () => {
  const longTitle = '第' + '一'.repeat(100) + '章';
  assert.ok(!isChapterTitleLine(longTitle));
});

/* ===== formatChapterContent ===== */

test('formatChapterContent splits into paragraphs on sentence boundaries', () => {
  const text = '第一段内容。第二段内容！第三段内容？';
  const result = formatChapterContent(text);
  const paragraphs = result.split('\n\n');
  assert.equal(paragraphs.length, 3);
});

test('formatChapterContent returns empty string for empty input', () => {
  assert.equal(formatChapterContent(''), '');
  assert.equal(formatChapterContent(null), '');
});

test('formatChapterContent collapses excessive whitespace', () => {
  const result = formatChapterContent('字\t\t字  \n\n\n  字');
  assert.ok(!result.includes('\t'));
  assert.ok(!result.includes('  '));
});

/* ===== splitTextIntoChapters ===== */

test('splitTextIntoChapters splits by chapter headings', () => {
  const text = [
    '第1章 开端',
    '这是第一章的内容。',
    '第2章 发展',
    '这是第二章的内容。'
  ].join('\n');

  const chapters = splitTextIntoChapters(text, '默认标题');
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].title, '第1章 开端');
  assert.ok(chapters[0].content.includes('第一章的内容'));
  assert.equal(chapters[1].title, '第2章 发展');
  assert.ok(chapters[1].content.includes('第二章的内容'));
});

test('splitTextIntoChapters returns single chapter with fallback title when no headings', () => {
  const text = '这是一段没有章节标题的文本。';
  const chapters = splitTextIntoChapters(text, '默认标题');
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].title, '默认标题');
});

test('splitTextIntoChapters returns empty array for empty input', () => {
  assert.deepEqual(splitTextIntoChapters('', '标题'), []);
  assert.deepEqual(splitTextIntoChapters(null, '标题'), []);
});

/* ===== decodeTxt ===== */

test('decodeTxt decodes UTF-8 with BOM', () => {
  const text = '你好世界';
  const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
  assert.equal(decodeTxt(buf), text);
});

test('decodeTxt decodes UTF-16 LE', () => {
  const text = '测试文本';
  const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  assert.equal(decodeTxt(buf), text);
});

test('decodeTxt decodes plain UTF-8', () => {
  const text = '普通UTF-8文本';
  assert.equal(decodeTxt(Buffer.from(text, 'utf8')), text);
});

test('decodeTxt decodes ASCII text', () => {
  assert.equal(decodeTxt(Buffer.from('Hello World', 'ascii')), 'Hello World');
});

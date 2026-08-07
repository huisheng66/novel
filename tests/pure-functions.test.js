const test = require('node:test');
const assert = require('node:assert/strict');

const util = require('../lib/util');
const {
  normalizeText,
  formatChapterContent,
  buildReaderChapterTitle,
  mergeParagraphsForReader,
  cleanChapterTitle,
  isChapterTitleLine,
  dedupeVolumePrefixes,
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
  assert.ok(isChapterTitleLine('第一节：纵身亡魔心仍不悔'));
  assert.ok(isChapterTitleLine('第一百零一节：心老人便老'));
  assert.ok(isChapterTitleLine('第三百一十七节：三尊图谋幽魂'));
  assert.ok(isChapterTitleLine('第001章 肉身十重'));
  assert.ok(isChapterTitleLine('第342章危危可急'));
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

test('isChapterTitleLine recognizes preface titles', () => {
  assert.ok(isChapterTitleLine('序'));
  assert.ok(isChapterTitleLine('序：不是走向成功，就是走向毁灭'));
  assert.ok(isChapterTitleLine('前序'));
  assert.ok(isChapterTitleLine('序章 开篇'));
  assert.ok(isChapterTitleLine('楔子'));
  assert.ok(isChapterTitleLine('引子：夜雨'));
  assert.ok(isChapterTitleLine('前言'));
  assert.ok(isChapterTitleLine('后记'));
  assert.ok(isChapterTitleLine('番外：旧事'));
});

test('isChapterTitleLine rejects non-title lines', () => {
  assert.ok(!isChapterTitleLine('这是一段普通的正文文字'));
  assert.ok(!isChapterTitleLine(''));
  assert.ok(!isChapterTitleLine('   '));
});

test('isChapterTitleLine rejects body text that looks like 第N幕 prose', () => {
  assert.ok(!isChapterTitleLine('第一幕徐徐在他眼前消散，很快，他进入了第二幕。'));
  assert.ok(!isChapterTitleLine('第二幕梦境比第一幕要冗长一些'));
  assert.ok(!isChapterTitleLine('第二幕。'));
  assert.ok(!isChapterTitleLine('第五幕梦境。'));
});

test('isChapterTitleLine does not treat volume titles as chapters', () => {
  assert.ok(!isChapterTitleLine('第一卷：魔性不改'));
  assert.ok(!isChapterTitleLine('第六卷：魔尊永生'));
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

test('buildReaderChapterTitle prefixes 第N章 for 节/序 titles', () => {
  assert.equal(
    buildReaderChapterTitle(2, '第一卷：魔性不改 第一节：纵身亡魔心仍不悔'),
    '第2章 第一节：纵身亡魔心仍不悔'
  );
  assert.equal(
    buildReaderChapterTitle(1, '序：不是走向成功，就是走向毁灭'),
    '第1章 序：不是走向成功，就是走向毁灭'
  );
  assert.equal(buildReaderChapterTitle(3, '第003章 肉身十重'), '第003章 肉身十重');
  assert.equal(
    buildReaderChapterTitle(1, '第一卷 第1章 若有轮回'),
    '第1章 若有轮回'
  );
});

test('mergeParagraphsForReader merges short dialogue lines', () => {
  const merged = mergeParagraphsForReader(['短句一。', '短句二。', '短句三。', '这是一段比较长的正文内容用于结束缓冲。'], 20);
  assert.ok(merged.length < 4);
  assert.ok(merged[0].includes('短句一'));
  assert.ok(merged[0].length >= 20 || merged.length === 1);
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

test('splitTextIntoChapters captures preface and volume only on first chapter of each volume', () => {
  const text = [
    '书名：测试',
    '序：作者的话',
    '这是序言正文。',
    '第一卷：魔性不改',
    '第一节：开端',
    '卷一第一节内容。',
    '第二节：延续',
    '卷一第二节内容。',
    '第二卷：魔子出山',
    '第一节：再起',
    '卷二第一节内容。',
    '第一幕徐徐在他眼前消散，这是正文不是标题。'
  ].join('\n');

  const chapters = splitTextIntoChapters(text, '默认标题');
  assert.equal(chapters.length, 4);
  assert.equal(chapters[0].title, '序：作者的话');
  assert.ok(chapters[0].content.includes('这是序言正文'));
  // 卷名只出现在该卷第一章
  assert.equal(chapters[1].title, '第一卷：魔性不改 第一节：开端');
  assert.ok(chapters[1].content.includes('卷一第一节内容'));
  assert.ok(!chapters[1].content.includes('第二卷'));
  assert.equal(chapters[2].title, '第二节：延续');
  assert.ok(chapters[2].content.includes('卷一第二节内容'));
  assert.equal(chapters[3].title, '第二卷：魔子出山 第一节：再起');
  assert.ok(chapters[3].content.includes('卷二第一节内容'));
  assert.ok(chapters[3].content.includes('第一幕徐徐'));
});

test('dedupeVolumePrefixes keeps volume only on first chapter of each volume', () => {
  const cleaned = dedupeVolumePrefixes([
    '序：开篇',
    '第一卷：魔性不改 第一节：开端',
    '第一卷：魔性不改 第二节：延续',
    '第一卷：魔性不改 第三节：收束',
    '第二卷：魔子出山 第一节：再起',
    '第二卷：魔子出山 第二节：深入'
  ]);
  assert.deepEqual(cleaned, [
    '序：开篇',
    '第一卷：魔性不改 第一节：开端',
    '第二节：延续',
    '第三节：收束',
    '第二卷：魔子出山 第一节：再起',
    '第二节：深入'
  ]);
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

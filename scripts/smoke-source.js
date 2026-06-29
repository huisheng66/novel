#!/usr/bin/env node

const assert = require('assert/strict');

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3008').replace(/\/+$/, '');
const TOKEN = process.env.SOURCE_TOKEN || '';
const BOOK_ID = process.env.SOURCE_BOOK_ID || '7';
const CHAPTER_NUMBER = process.env.SOURCE_CHAPTER_NUMBER || '1';
const SEARCH_KEY = process.env.SOURCE_SEARCH_KEY || '众仙俯首';

async function fetchText(pathname) {
  const response = await fetch(`${BASE_URL}${pathname}`);
  const text = await response.text();
  return {
    response,
    text
  };
}

function requireToken() {
  assert.match(
    TOKEN,
    /^[A-Za-z0-9_-]{8,128}$/,
    'Set SOURCE_TOKEN to a valid access token before running this smoke test.'
  );
}

async function assertOkText(pathname, expectedText) {
  const { response, text } = await fetchText(pathname);
  assert.equal(response.status, 200, `${pathname} returned ${response.status}: ${text.slice(0, 160)}`);
  assert.match(text, expectedText, `${pathname} did not contain expected text`);
}

async function assertImportJson() {
  const { response, text } = await fetchText(`/source/import/${encodeURIComponent(TOKEN)}.json`);
  assert.equal(response.status, 200, `import returned ${response.status}: ${text.slice(0, 160)}`);
  assert.match(response.headers.get('content-type') || '', /application\/json/i);

  const payload = JSON.parse(text);
  assert.ok(Array.isArray(payload), 'Legado import payload must be a JSON array');
  assert.equal(payload.length, 1, 'Legado import should contain one source');
  assert.equal(payload[0].ruleContent.content, '@css:.source-content@html');
}

async function assertSearch() {
  const key = encodeURIComponent(SEARCH_KEY);
  const token = encodeURIComponent(TOKEN);
  const { response, text } = await fetchText(`/source/html/search?key=${key}&token=${token}`);
  assert.equal(response.status, 200, `search returned ${response.status}: ${text.slice(0, 160)}`);
  assert.match(text, /source-book/);
  assert.match(text, new RegExp(SEARCH_KEY));
}

async function assertTocAndContent() {
  const token = encodeURIComponent(TOKEN);
  const toc = await fetchText(`/source/html/toc/${encodeURIComponent(BOOK_ID)}?token=${token}`);
  assert.equal(toc.response.status, 200, `toc returned ${toc.response.status}: ${toc.text.slice(0, 160)}`);
  const chapterCount = (toc.text.match(/source-chapter-item/g) || []).length;
  assert.ok(chapterCount > 0, 'TOC should contain chapter items');

  const content = await fetchText(
    `/source/html/content/${encodeURIComponent(BOOK_ID)}/${encodeURIComponent(CHAPTER_NUMBER)}?token=${token}`
  );
  assert.equal(content.response.status, 200, `content returned ${content.response.status}: ${content.text.slice(0, 160)}`);
  assert.match(content.text, /source-content/);
  assert.ok((content.text.match(/<p>/g) || []).length > 0, 'Content page should contain paragraphs');
}

async function main() {
  requireToken();
  await assertOkText('/healthz', /^ok$/);
  await assertImportJson();
  await assertSearch();
  await assertTocAndContent();
  console.log('source smoke ok');
}

main().catch(err => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});

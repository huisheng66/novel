// 第 4 期纯函数：ops parseBool、etag 匹配（驱动真实 lib 导出）

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseBool } = require('../lib/api/ops');
const { etagMatches, parseSince } = require('../lib/api/books');
const { ApiError } = require('../lib/api/errors');

describe('lib/api/ops.parseBool', () => {
  it('accepts truthy tokens', () => {
    assert.equal(parseBool('1'), true);
    assert.equal(parseBool('true'), true);
    assert.equal(parseBool('YES'), true);
  });
  it('rejects falsy tokens', () => {
    assert.equal(parseBool('0'), false);
    assert.equal(parseBool('false'), false);
    assert.equal(parseBool(''), false);
  });
});

describe('lib/api/books.etagMatches', () => {
  const hash = 'abc123def';
  it('matches quoted etag', () => {
    assert.equal(etagMatches(`"${hash}"`, hash), true);
  });
  it('matches weak etag', () => {
    assert.equal(etagMatches(`W/"${hash}"`, hash), true);
  });
  it('matches bare hash', () => {
    assert.equal(etagMatches(hash, hash), true);
  });
  it('rejects mismatch', () => {
    assert.equal(etagMatches('"other"', hash), false);
  });
});

describe('lib/api/books.parseSince', () => {
  it('parses ISO date', () => {
    const d = parseSince('2020-01-01T00:00:00.000Z');
    assert.ok(d instanceof Date);
    assert.equal(d.toISOString(), '2020-01-01T00:00:00.000Z');
  });
  it('throws ApiError on invalid', () => {
    assert.throws(() => parseSince('not-a-date'), (err) => err instanceof ApiError && err.status === 400);
  });
});

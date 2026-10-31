// 访问队列：列顺序与归一化必须与 page_views 表结构一致。
// 这类「加了一列但数组没跟着加」的错位只会在 flush 时报 SQL 参数不匹配，很难在本地发现，
// 因此在这里用纯函数锁死形状。

const test = require('node:test');
const assert = require('node:assert/strict');

const { COLUMNS, normalizeEvent } = require('../lib/pageViewQueue');
const { pool } = require('../db');

const BASE_EVENT = {
  visitorUid: 'uid-1',
  accessTokenId: null,
  userId: null,
  sessionId: 'sess-1',
  visitorIp: '1.2.3.4',
  userAgent: 'UA/1.0',
  path: '/novel/5/1',
  referrer: null,
  novelId: 5,
  chapterId: 1
};

function rowOf(event) {
  return Object.fromEntries(COLUMNS.map((col, i) => [col, normalizeEvent(event)[i]]));
}

test('COLUMNS 覆盖 page_views 的两类身份列', () => {
  assert.ok(COLUMNS.includes('access_token_id'), '站点令牌列必须存在');
  assert.ok(COLUMNS.includes('user_id'), '登录读者列必须存在');
  assert.equal(COLUMNS.length, 10);
});

test('normalizeEvent 输出长度与 COLUMNS 严格一致', () => {
  assert.equal(normalizeEvent(BASE_EVENT).length, COLUMNS.length);
});

test('登录读者：user_id 写入，access_token_id 为 null', () => {
  const row = rowOf({ ...BASE_EVENT, userId: 42 });
  assert.equal(row.user_id, 42);
  assert.equal(row.access_token_id, null);
});

test('站点令牌：access_token_id 写入，user_id 为 null', () => {
  const row = rowOf({ ...BASE_EVENT, accessTokenId: 7 });
  assert.equal(row.access_token_id, 7);
  assert.equal(row.user_id, null);
});

test('两者并存时都保留（令牌 + 已登录读者）', () => {
  const row = rowOf({ ...BASE_EVENT, accessTokenId: 7, userId: 42 });
  assert.equal(row.access_token_id, 7);
  assert.equal(row.user_id, 42);
});

test('缺省值：uid/session/ip/ua 兜底，path 兜底为 /', () => {
  const row = rowOf({});
  assert.equal(row.visitor_uid, 'unknown');
  assert.equal(row.session_id, 'unknown');
  assert.equal(row.visitor_ip, 'unknown');
  assert.equal(row.user_agent, 'unknown');
  assert.equal(row.path, '/');
  assert.equal(row.referrer, null);
  assert.equal(row.novel_id, null);
  assert.equal(row.chapter_id, null);
});

test('超长字段按列宽截断', () => {
  const row = rowOf({
    ...BASE_EVENT,
    userAgent: 'u'.repeat(400),
    path: '/' + 'p'.repeat(400),
    visitorUid: 'v'.repeat(100)
  });
  assert.equal(row.user_agent.length, 255);
  assert.equal(row.path.length, 255);
  assert.equal(row.visitor_uid.length, 64);
});

test('novelId / chapterId 为 0 时落为 null，避免写入非法 ID', () => {
  const row = rowOf({ ...BASE_EVENT, novelId: 0, chapterId: 0 });
  assert.equal(row.novel_id, null);
  assert.equal(row.chapter_id, null);
});

test.after(() => pool.end());

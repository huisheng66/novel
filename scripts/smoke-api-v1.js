// 本地冒烟：/api/v1 注册登录 → 书库 → 书架 → 进度
// 用法: node --env-file=.env scripts/smoke-api-v1.js
// 可选: API_BASE=http://127.0.0.1:3008

const base = String(process.env.API_BASE || `http://127.0.0.1:${process.env.PORT || 3008}`).replace(/\/$/, '');

async function req(method, path, { token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, headers: res.headers, data };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log('API base:', base);

  const health = await req('GET', '/api/v1/health');
  assert(health.status === 200 && health.data && health.data.apiVersion === 1, 'health failed');
  console.log('OK health');

  const username = `smoke_${Date.now().toString(36)}`;
  const password = 'smoke-pass-123';

  const reg = await req('POST', '/api/v1/auth/register', {
    body: { username, password, displayName: 'Smoke', deviceName: 'smoke-script' }
  });
  assert(reg.status === 201 && reg.data.accessToken, `register failed: ${JSON.stringify(reg.data)}`);
  let access = reg.data.accessToken;
  const refresh = reg.data.refreshToken;
  console.log('OK register', username);

  const me = await req('GET', '/api/v1/me', { token: access });
  assert(me.status === 200 && me.data.user && me.data.user.username === username, 'me failed');
  console.log('OK me');

  const books = await req('GET', '/api/v1/books?pageSize=5', { token: access });
  assert(books.status === 200 && Array.isArray(books.data.items), 'books failed');
  assert(books.data.items.length > 0, 'no books in library');
  const bookId = books.data.items[0].id;
  console.log('OK books', { count: books.data.total, first: bookId });

  const book = await req('GET', `/api/v1/books/${bookId}`, { token: access });
  assert(book.status === 200 && book.data.id === bookId, 'book detail failed');
  console.log('OK book detail');

  const toc = await req('GET', `/api/v1/books/${bookId}/toc?pageSize=10`, { token: access });
  assert(toc.status === 200 && Array.isArray(toc.data.items), 'toc failed');
  assert(toc.data.items.length > 0, 'toc empty');
  const chapterNumber = toc.data.items[0].chapterNumber;
  console.log('OK toc', { total: toc.data.total, firstChapter: chapterNumber });

  const chapter = await req('GET', `/api/v1/books/${bookId}/chapters/${chapterNumber}`, { token: access });
  assert(chapter.status === 200 && chapter.data.content, 'chapter failed');
  const contentHash = chapter.data.contentHash;
  console.log('OK chapter', { title: chapter.data.title, hash: contentHash && contentHash.slice(0, 8) });

  // ETag / If-None-Match（第 2 期）
  const etagRes = await fetch(`${base}/api/v1/books/${bookId}/chapters/${chapterNumber}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${access}`,
      'If-None-Match': `"${contentHash}"`
    }
  });
  assert(etagRes.status === 304, `etag 304 expected, got ${etagRes.status}`);
  console.log('OK chapter etag 304');

  const weakEtag = await fetch(`${base}/api/v1/books/${bookId}/chapters/${chapterNumber}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${access}`,
      'If-None-Match': `W/"${contentHash}"`
    }
  });
  assert(weakEtag.status === 304, `weak etag 304 expected, got ${weakEtag.status}`);
  console.log('OK chapter weak etag 304');

  // TOC delta
  const past = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
  const delta = await req('GET', `/api/v1/books/${bookId}/toc/delta?since=${encodeURIComponent(past)}&limit=20`, { token: access });
  assert(delta.status === 200 && Array.isArray(delta.data.items), `toc delta failed: ${JSON.stringify(delta.data)}`);
  assert(delta.data.serverTime && delta.data.since, 'toc delta missing timestamps');
  console.log('OK toc delta', { totalChanged: delta.data.totalChanged, items: delta.data.items.length });

  const badDelta = await req('GET', `/api/v1/books/${bookId}/toc/delta`, { token: access });
  assert(badDelta.status === 400, 'toc delta should require since');
  console.log('OK toc delta requires since');

  const shelfAdd = await req('POST', '/api/v1/me/shelf', { token: access, body: { novelId: bookId } });
  assert(shelfAdd.status === 201, 'shelf add failed');
  console.log('OK shelf add');

  const now = new Date().toISOString();
  const prog = await req('PUT', '/api/v1/me/progress', {
    token: access,
    body: {
      novelId: bookId,
      chapterNumber,
      offsetRatio: 0.42,
      updatedAt: now,
      deviceName: 'smoke-script'
    }
  });
  assert(prog.status === 200 && prog.data.applied === true, `progress put failed: ${JSON.stringify(prog.data)}`);
  console.log('OK progress put');

  const older = await req('PUT', '/api/v1/me/progress', {
    token: access,
    body: {
      novelId: bookId,
      chapterNumber,
      offsetRatio: 0.1,
      updatedAt: new Date(Date.now() - 60000).toISOString(),
      deviceName: 'smoke-old'
    }
  });
  assert(older.status === 200 && older.data.applied === false, 'LWW should reject older progress');
  assert(Number(older.data.progress.offsetRatio) === 0.42, 'LWW kept wrong offset');
  console.log('OK progress LWW');

  // progress batch（第 3 期）
  const batch = await req('POST', '/api/v1/me/progress/batch', {
    token: access,
    body: {
      items: [
        {
          novelId: bookId,
          chapterNumber,
          offsetRatio: 0.55,
          updatedAt: new Date().toISOString(),
          deviceName: 'smoke-batch'
        },
        {
          novelId: 99999999,
          chapterNumber: 1,
          offsetRatio: 0.1,
          updatedAt: new Date().toISOString(),
          deviceName: 'smoke-batch'
        }
      ]
    }
  });
  assert(batch.status === 200, `batch failed: ${JSON.stringify(batch.data)}`);
  assert(batch.data.appliedCount >= 1, 'batch appliedCount');
  assert(batch.data.errorCount >= 1, 'batch should report missing book error');
  assert(Array.isArray(batch.data.results) && batch.data.results.length === 2, 'batch results length');
  console.log('OK progress batch', {
    applied: batch.data.appliedCount,
    errors: batch.data.errorCount
  });

  const emptyBatch = await req('POST', '/api/v1/me/progress/batch', {
    token: access,
    body: { items: [] }
  });
  assert(emptyBatch.status === 400, 'empty batch should 400');
  console.log('OK progress batch empty rejected');

  const shelf = await req('GET', '/api/v1/me/shelf', { token: access });
  assert(shelf.status === 200 && shelf.data.items.some(i => i.novelId === bookId), 'shelf list failed');
  console.log('OK shelf list');

  // shelf updates（since 很早 → 至少能返回结构；有进度落后时会有 hasUpdate 项）
  const updates = await req(
    'GET',
    `/api/v1/me/shelf/updates?since=${encodeURIComponent(past)}`,
    { token: access }
  );
  assert(updates.status === 200 && Array.isArray(updates.data.items), `shelf updates failed: ${JSON.stringify(updates.data)}`);
  console.log('OK shelf updates', { count: updates.data.items.length });

  const badUpdates = await req('GET', '/api/v1/me/shelf/updates', { token: access });
  assert(badUpdates.status === 400, 'shelf updates should require since');
  console.log('OK shelf updates requires since');

  // —— 第 4 期：书签 CRUD ——
  const bmCreate = await req('POST', '/api/v1/me/bookmarks', {
    token: access,
    body: {
      novelId: bookId,
      chapterNumber,
      offsetRatio: 0.33,
      note: 'smoke-bookmark-note',
      color: 'yellow'
    }
  });
  assert(bmCreate.status === 201 && bmCreate.data.id, `bookmark create failed: ${JSON.stringify(bmCreate.data)}`);
  assert(bmCreate.data.novelId === bookId, 'bookmark novelId');
  assert(Number(bmCreate.data.chapterNumber) === chapterNumber, 'bookmark chapter');
  assert(bmCreate.data.note === 'smoke-bookmark-note', 'bookmark note');
  const bmId = bmCreate.data.id;
  console.log('OK bookmark create', { id: bmId });

  const bmList = await req('GET', `/api/v1/me/bookmarks?novelId=${bookId}`, { token: access });
  assert(bmList.status === 200 && bmList.data.items.some(i => i.id === bmId), 'bookmark list missing id');
  console.log('OK bookmark list');

  const bmUpdate = await req('PUT', `/api/v1/me/bookmarks/${bmId}`, {
    token: access,
    body: { note: 'smoke-bookmark-updated', offsetRatio: 0.5 }
  });
  assert(bmUpdate.status === 200 && bmUpdate.data.note === 'smoke-bookmark-updated', 'bookmark update failed');
  assert(Number(bmUpdate.data.offsetRatio) === 0.5, 'bookmark offset');
  console.log('OK bookmark update');

  const bmDel = await req('DELETE', `/api/v1/me/bookmarks/${bmId}`, { token: access });
  assert(bmDel.status === 200 && bmDel.data.deleted === true, 'bookmark delete failed');
  const bmList2 = await req('GET', `/api/v1/me/bookmarks?novelId=${bookId}`, { token: access });
  assert(bmList2.status === 200 && !bmList2.data.items.some(i => i.id === bmId), 'bookmark still listed after delete');
  console.log('OK bookmark delete');

  // —— 运营面 ——
  const opsGet = await req('GET', '/api/v1/ops');
  assert(opsGet.status === 200 && opsGet.data.announcement && opsGet.data.updatePolicy, `ops get failed: ${JSON.stringify(opsGet.data)}`);
  assert(typeof opsGet.data.updatePolicy.minClientVersion === 'string', 'ops minClientVersion');
  console.log('OK ops get');

  const adminKey = process.env.API_OPS_ADMIN_KEY || process.env.ADMIN_PASSWORD || '';
  if (!adminKey) {
    console.error('SKIP ops put: API_OPS_ADMIN_KEY/ADMIN_PASSWORD 未设置');
  } else {
    const opsPutRes = await fetch(`${base}/api/v1/ops`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Ops-Admin-Key': adminKey
      },
      body: JSON.stringify({
        announcement: { enabled: true, text: 'smoke-announcement' },
        updatePolicy: {
          minClientVersion: '1.0.0',
          forceUpdate: false,
          message: 'smoke-force-msg',
          storeUrl: 'https://example.com/app'
        }
      })
    });
    const opsPutBody = await opsPutRes.json();
    assert(opsPutRes.status === 200, `ops put failed: ${JSON.stringify(opsPutBody)}`);
    assert(opsPutBody.announcement && opsPutBody.announcement.text === 'smoke-announcement', 'ops announcement text');
    assert(opsPutBody.updatePolicy.minClientVersion === '1.0.0', 'ops min version');
    console.log('OK ops put');

    const opsGet2 = await req('GET', '/api/v1/ops');
    assert(opsGet2.data.announcement.text === 'smoke-announcement', 'ops re-read announcement');
    console.log('OK ops re-read');
  }

  // —— 设备 + 更新通知 ——
  const dev = await req('POST', '/api/v1/me/devices', {
    token: access,
    body: { deviceId: `smoke-device-${Date.now()}`, platform: 'android', pushToken: 'fake-token', enabled: true }
  });
  assert(dev.status === 201 && dev.data.deviceId, `device register failed: ${JSON.stringify(dev.data)}`);
  console.log('OK device register');

  // 进度停在第 1 章时，若全书有更多章 → notices 应有 new_chapters
  const bookMeta = await req('GET', `/api/v1/books/${bookId}`, { token: access });
  const lastCh = bookMeta.data.lastChapterNumber;
  if (lastCh != null && lastCh > chapterNumber) {
    const notices = await req('GET', '/api/v1/me/notices/updates', { token: access });
    assert(notices.status === 200 && Array.isArray(notices.data.items), `notices failed: ${JSON.stringify(notices.data)}`);
    const hit = notices.data.items.find(i => i.novelId === bookId && i.type === 'new_chapters');
    assert(hit, `expected new_chapters notice for novel ${bookId}, got ${JSON.stringify(notices.data.items)}`);
    assert(hit.newChapterCount > 0, 'newChapterCount');
    console.log('OK notices updates', { newChapterCount: hit.newChapterCount });
  } else {
    console.log('SKIP notices (book has only one chapter)');
  }

  const refreshed = await req('POST', '/api/v1/auth/refresh', { body: { refreshToken: refresh } });
  assert(refreshed.status === 200 && refreshed.data.accessToken, 'refresh failed');
  access = refreshed.data.accessToken;
  console.log('OK refresh');

  await req('POST', '/api/v1/auth/logout', { body: { refreshToken: refreshed.data.refreshToken } });
  console.log('OK logout');

  console.log('\nAll smoke-api-v1 checks passed (phase 0-4).');
}

main().catch(err => {
  console.error('SMOKE FAILED:', err.message || err);
  process.exit(1);
});

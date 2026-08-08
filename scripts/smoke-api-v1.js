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
  console.log('OK chapter', { title: chapter.data.title, hash: chapter.data.contentHash && chapter.data.contentHash.slice(0, 8) });

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

  const shelf = await req('GET', '/api/v1/me/shelf', { token: access });
  assert(shelf.status === 200 && shelf.data.items.some(i => i.novelId === bookId), 'shelf list failed');
  console.log('OK shelf list');

  const refreshed = await req('POST', '/api/v1/auth/refresh', { body: { refreshToken: refresh } });
  assert(refreshed.status === 200 && refreshed.data.accessToken, 'refresh failed');
  access = refreshed.data.accessToken;
  console.log('OK refresh');

  await req('POST', '/api/v1/auth/logout', { body: { refreshToken: refreshed.data.refreshToken } });
  console.log('OK logout');

  console.log('\nAll smoke-api-v1 checks passed.');
}

main().catch(err => {
  console.error('SMOKE FAILED:', err.message || err);
  process.exit(1);
});

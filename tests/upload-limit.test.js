const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { File } = require('node:buffer');
const mysql = require('mysql2/promise');

const CHAPTER_ACCEPT_BYTES = 22 * 1024 * 1024;
const CHAPTER_REJECT_BYTES = 31 * 1024 * 1024;
const COVER_ACCEPT_BYTES = 22 * 1024 * 1024;
const COVER_REJECT_BYTES = 31 * 1024 * 1024;

const SKIP_REASON = '需要可连接的 MySQL（DB_HOST/DB_USER/DB_PASSWORD），当前连不上，跳过集成测试';

let serverProcess;
let serverOutput = '';
let baseUrl = '';
let adminCookie = '';
let dbAvailable = false;

/** 这组用例会拉起真实服务，服务启动依赖 MySQL；连不上就跳过而不是判失败。 */
async function canConnectDb() {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'novel',
      connectTimeout: 3000
    });
    await conn.query('SELECT 1');
    return true;
  } catch (err) {
    return false;
  } finally {
    if (conn) {
      try {
        await conn.end();
      } catch (err) {
        /* ignore */
      }
    }
  }
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(closeErr => {
        if (closeErr) {
          reject(closeErr);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (serverProcess && serverProcess.exitCode !== null) {
      throw new Error(`server exited early\n${serverOutput}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {}

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`health check timed out\n${serverOutput}`);
}

async function startServer() {
  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['--env-file=.env', 'server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stdout.on('data', chunk => {
    serverOutput += chunk.toString();
  });
  serverProcess.stderr.on('data', chunk => {
    serverOutput += chunk.toString();
  });

  await waitForHealth(`${baseUrl}/healthz`);
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) {
    return;
  }

  serverProcess.kill('SIGTERM');
  await once(serverProcess, 'exit');
}

async function loginAsAdmin() {
  const body = new URLSearchParams({
    password: process.env.ADMIN_PASSWORD || 'admin123',
    next: '/admin'
  });

  const response = await fetch(`${baseUrl}/admin/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body
  });

  assert.equal(response.status, 302);
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie, 'admin login should return a session cookie');
  adminCookie = setCookie.split(';', 1)[0];
}

function makeChapterFile(sizeBytes) {
  return new File([Buffer.alloc(sizeBytes, 'a')], 'sample.txt', {
    type: 'text/plain'
  });
}

function makeCoverFile(sizeBytes) {
  return new File([Buffer.alloc(sizeBytes, 0)], 'cover.png', {
    type: 'image/png'
  });
}

async function postChapterUpload(sizeBytes) {
  const form = new FormData();
  form.append('novel_id', '0');
  form.append('start_number', '1');
  form.append('upload_mode', 'append');
  form.append('chapter_files', makeChapterFile(sizeBytes));

  return await fetch(`${baseUrl}/admin/chapters/upload`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: adminCookie
    },
    body: form
  });
}

async function postCoverUpload(sizeBytes) {
  const form = new FormData();
  form.append('cover_image', makeCoverFile(sizeBytes));

  return await fetch(`${baseUrl}/admin/novels/999999/cover`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: adminCookie
    },
    body: form
  });
}

function getRedirectError(response) {
  const location = response.headers.get('location');
  assert.ok(location, 'expected redirect location');
  return new URL(location, baseUrl).searchParams.get('error');
}

test.before(async () => {
  dbAvailable = await canConnectDb();
  if (!dbAvailable) {
    // 环境问题不应表现为测试失败：CI/新机器没起数据库时，这组用例标记为跳过
    process.stderr.write(`[upload-limit] ${SKIP_REASON}\n`);
    return;
  }
  await startServer();
  await loginAsAdmin();
});

test.after(async () => {
  await stopServer();
});

test('chapter upload accepts files smaller than 30MB', async (t) => {
  if (!dbAvailable) return t.skip(SKIP_REASON);
  const response = await postChapterUpload(CHAPTER_ACCEPT_BYTES);
  assert.equal(response.status, 302);
  assert.equal(getRedirectError(response), '请先选择小说');
});

test('chapter upload rejects files larger than 30MB', async (t) => {
  if (!dbAvailable) return t.skip(SKIP_REASON);
  const response = await postChapterUpload(CHAPTER_REJECT_BYTES);
  assert.equal(response.status, 500);
  assert.match(await response.text(), /Server internal error/);
});

test('cover upload accepts files smaller than 30MB', async (t) => {
  if (!dbAvailable) return t.skip(SKIP_REASON);
  const response = await postCoverUpload(COVER_ACCEPT_BYTES);
  assert.equal(response.status, 302);
  assert.equal(getRedirectError(response), '小说不存在');
});

test('cover upload rejects files larger than 30MB', async (t) => {
  if (!dbAvailable) return t.skip(SKIP_REASON);
  const response = await postCoverUpload(COVER_REJECT_BYTES);
  assert.equal(response.status, 302);
  assert.equal(getRedirectError(response), '封面图片不能超过 30MB');
});

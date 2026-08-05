// WebDAV 服务端 — 将小说暴露为 EPUB 文件供 ReadAny 浏览/导入
// 鉴权: HTTP Basic Auth, 密码 = access token

const express = require('express');
const { pool } = require('../db');
const logger = require('../lib/logger');
const { generateEpubStream } = require('../lib/epub-generator');

const router = express.Router();

/**
 * 将小说标题转为安全的文件名
 */
function sanitizeFilename(title) {
  return String(title || '').replace(/[/\\:*?"<>|]/g, '_').trim() + '.epub';
}

/**
 * 从文件名提取小说标题(去 .epub 后缀)
 */
function filenameToTitle(filename) {
  const decoded = decodeURIComponent(filename);
  return decoded.replace(/\.epub$/i, '');
}

/**
 * 获取小说的 ETag 和最后修改时间
 */
async function getNovelMeta(novelId) {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) as cnt, UNIX_TIMESTAMP(MAX(created_at)) as ts
     FROM chapters WHERE novel_id = ?`,
    [novelId]
  );
  const count = row.cnt || 0;
  const ts = row.ts || 0;
  return {
    etag: `"novel-${novelId}-ch${count}-${ts}"`,
    lastModified: ts ? new Date(ts * 1000).toUTCString() : new Date().toUTCString(),
    chapterCount: count,
    ts
  };
}

/**
 * 查询所有可访问的小说
 */
async function getAccessibleNovels(allowedNovelId) {
  if (allowedNovelId) {
    const [[novel]] = await pool.execute(
      'SELECT id, title, author FROM novels WHERE id = ?',
      [allowedNovelId]
    );
    return novel ? [novel] : [];
  }
  const [novels] = await pool.execute(
    'SELECT id, title, author FROM novels ORDER BY id'
  );
  return novels;
}

/**
 * 根据文件名查找小说
 */
async function findNovelByFilename(filename, allowedNovelId) {
  const title = filenameToTitle(filename);
  if (allowedNovelId) {
    const [[novel]] = await pool.execute(
      'SELECT id, title, author, description, cover_image, created_at FROM novels WHERE id = ? AND title = ?',
      [allowedNovelId, title]
    );
    return novel || null;
  }
  const [[novel]] = await pool.execute(
    'SELECT id, title, author, description, cover_image, created_at FROM novels WHERE title = ? LIMIT 1',
    [title]
  );
  return novel || null;
}

// ── Basic Auth 中间件 ──────────────────────────────

async function webdavAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Novel WebDAV"');
    return res.status(401).send('Authentication required');
  }

  try {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf-8');
    const colonIdx = decoded.indexOf(':');
    const password = decoded.slice(colonIdx + 1);

    const [[tokenRow]] = await pool.execute(
      'SELECT id, name, token, allowed_novel_id FROM access_tokens WHERE token = ? AND is_active = 1',
      [password]
    );

    if (!tokenRow) {
      res.set('WWW-Authenticate', 'Basic realm="Novel WebDAV"');
      return res.status(401).send('Invalid token');
    }

    req.accessTokenId = tokenRow.id;
    req.accessToken = tokenRow;
    next();
  } catch (err) {
    logger.error('WebDAV auth error', { err });
    res.status(500).send('Authentication error');
  }
}

router.use(webdavAuth);

// ── 统一请求处理 ────────────────────────────────────

router.use(async (req, res, next) => {
  const method = req.method.toUpperCase();
  const reqPath = req.path === '/' ? '/' : req.path.replace(/\/+$/, '');

  try {
    if (method === 'OPTIONS') return handleOptions(req, res);
    if (method === 'PROPFIND') return handlePropfind(req, res, reqPath);
    if (method === 'GET') return handleGet(req, res, reqPath);
    if (method === 'HEAD') return handleHead(req, res, reqPath);
    // MKCOL: ReadAny 导入时会尝试创建目录,虚拟文件系统无需真正创建,返回 201 让客户端继续
    if (method === 'MKCOL') {
      logger.debug('WebDAV MKCOL (virtual)', { path: reqPath });
      res.set('DAV', '1, 2');
      return res.status(201).send();
    }
    next();
  } catch (err) {
    logger.error('WebDAV error', { err, method, path: reqPath });
    res.status(500).send('Internal error');
  }
});

// ── OPTIONS: WebDAV 能力声明 ────────────────────────

function handleOptions(req, res) {
  res.set({
    'DAV': '1, 2',
    'Allow': 'OPTIONS, PROPFIND, GET, HEAD, MKCOL',
    'MS-Author-Via': 'DAV',
    'Content-Length': '0'
  });
  res.status(200).send();
}

// ── PROPFIND: 目录列表 / 文件属性 ──────────────────

async function handlePropfind(req, res, reqPath) {
  const depth = (req.headers['depth'] || '1').toString();
  const allowedNovelId = req.accessToken.allowed_novel_id;
  const responses = [];

  if (reqPath === '/' || reqPath === '') {
    // 根目录 — collection
    responses.push({
      href: '/webdav/',
      isCollection: true,
      displayname: 'Novels'
    });

    if (depth === '1' || depth === 'infinity') {
      const novels = await getAccessibleNovels(allowedNovelId);
      for (const novel of novels) {
        const meta = await getNovelMeta(novel.id);
        responses.push({
          href: `/webdav/${encodeURIComponent(sanitizeFilename(novel.title))}`,
          isCollection: false,
          displayname: sanitizeFilename(novel.title),
          contentType: 'application/epub+zip',
          lastModified: meta.lastModified,
          etag: meta.etag
        });
      }
    }
  } else {
    // 单个文件
    const filename = reqPath.replace(/^\//, '');
    const novel = await findNovelByFilename(filename, allowedNovelId);
    if (!novel) {
      res.status(404).send('Not found');
      return;
    }
    const meta = await getNovelMeta(novel.id);
    responses.push({
      href: `/webdav/${encodeURIComponent(sanitizeFilename(novel.title))}`,
      isCollection: false,
      displayname: sanitizeFilename(novel.title),
      contentType: 'application/epub+zip',
      lastModified: meta.lastModified,
      etag: meta.etag
    });
  }

  const xml = buildMultistatusXml(responses);
  res.set({
    'Content-Type': 'application/xml; charset=utf-8',
    'DAV': '1, 2'
  });
  res.status(207).send(xml);
}

function buildMultistatusXml(responses) {
  const responseXml = responses.map(r => {
    const propParts = [];
    if (r.isCollection) {
      propParts.push('        <D:resourcetype><D:collection/></D:resourcetype>');
    } else {
      propParts.push('        <D:resourcetype/>');
    }
    if (r.displayname) {
      propParts.push(`        <D:displayname>${escapeXml(r.displayname)}</D:displayname>`);
    }
    if (r.contentType) {
      propParts.push(`        <D:getcontenttype>${r.contentType}</D:getcontenttype>`);
    }
    if (r.lastModified) {
      propParts.push(`        <D:getlastmodified>${r.lastModified}</D:getlastmodified>`);
    }
    if (r.etag) {
      propParts.push(`        <D:getetag>${r.etag}</D:getetag>`);
    }

    return `  <D:response>
    <D:href>${r.href}</D:href>
    <D:propstat>
      <D:prop>
${propParts.join('\n')}
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
${responseXml}
</D:multistatus>`;
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── GET: 生成并流式返回 EPUB ────────────────────────

async function handleGet(req, res, reqPath) {
  const filename = reqPath.replace(/^\//, '');
  const allowedNovelId = req.accessToken.allowed_novel_id;
  const novel = await findNovelByFilename(filename, allowedNovelId);

  if (!novel) {
    res.status(404).send('Not found');
    return;
  }

  const [chapters] = await pool.execute(
    'SELECT chapter_number, title, content FROM chapters WHERE novel_id = ? ORDER BY chapter_number',
    [novel.id]
  );

  const meta = await getNovelMeta(novel.id);
  const lastUpdated = meta.ts ? new Date(meta.ts * 1000).toISOString() : new Date().toISOString();

  res.set({
    'Content-Type': 'application/epub+zip',
    'ETag': meta.etag,
    'Last-Modified': meta.lastModified,
    'Cache-Control': 'no-cache'
  });

  const stream = generateEpubStream(novel, chapters, lastUpdated);
  stream.on('error', (err) => {
    logger.error('EPUB stream error', { err, novelId: novel.id });
    if (!res.headersSent) {
      res.status(500).send('EPUB generation error');
    }
  });
  stream.pipe(res);
}

// ── HEAD: 只返回头 ──────────────────────────────────

async function handleHead(req, res, reqPath) {
  const filename = reqPath.replace(/^\//, '');
  const allowedNovelId = req.accessToken.allowed_novel_id;
  const novel = await findNovelByFilename(filename, allowedNovelId);

  if (!novel) {
    res.status(404).send('Not found');
    return;
  }

  const meta = await getNovelMeta(novel.id);

  res.set({
    'Content-Type': 'application/epub+zip',
    'ETag': meta.etag,
    'Last-Modified': meta.lastModified,
    'Cache-Control': 'no-cache'
  });
  res.status(200).send();
}

module.exports = router;

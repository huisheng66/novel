// EPUB 3 生成模块 — 将小说 + 章节生成为 EPUB 流
// 内嵌 source.json 供 ReadAny 自动更新使用

const { ZipArchive } = require('archiver');
const { escapeHtml } = require('./util');

/**
 * 将纯文本章节内容转为 XHTML
 */
function contentToXhtml(title, content, chapterNum) {
  const paragraphs = String(content || '')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => `      <p>${escapeHtml(line)}</p>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <section epub:type="chapter" id="chapter-${chapterNum}">
    <h1>${escapeHtml(title)}</h1>
${paragraphs}
  </section>
</body>
</html>`;
}

/**
 * 生成 content.opf
 */
function buildContentOpf(novel, chapterCount, hasCover) {
  const manifestItems = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
  ];
  if (hasCover) {
    manifestItems.push('<item id="cover" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>');
  }
  for (let i = 1; i <= chapterCount; i++) {
    manifestItems.push(`<item id="chap-${i}" href="chapter-${i}.xhtml" media-type="application/xhtml+xml"/>`);
  }

  const spineItems = [];
  for (let i = 1; i <= chapterCount; i++) {
    spineItems.push(`<itemref idref="chap-${i}"/>`);
  }

  const metaCover = hasCover ? '\n    <meta name="cover" content="cover"/>' : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="bookid">urn:uuid:novel-${novel.id}</dc:identifier>
    <dc:title>${escapeHtml(novel.title)}</dc:title>
    <dc:creator>${escapeHtml(novel.author)}</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:description>${escapeHtml(novel.description || '')}</dc:description>
    <dc:date>${new Date(novel.created_at).toISOString().split('T')[0]}</dc:date>
    <meta property="dcterms:modified">${new Date().toISOString().split('.')[0]}Z</meta>${metaCover}
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${spineItems.join('\n    ')}
  </spine>
</package>`;
}

/**
 * 生成 nav.xhtml (EPUB 3 导航)
 */
function buildNavXhtml(novel, chapters) {
  const navPoints = chapters
    .map((ch, i) => `      <li><a href="chapter-${ch.chapter_number}.xhtml">${escapeHtml(ch.title)}</a></li>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN">
<head>
  <meta charset="UTF-8"/>
  <title>目录</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
${navPoints}
    </ol>
  </nav>
</body>
</html>`;
}

/**
 * 生成 toc.ncx (EPUB 2 兼容)
 */
function buildTocNcx(novel, chapters) {
  const navPoints = chapters
    .map((ch, i) => `    <navPoint id="navpoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escapeHtml(ch.title)}</text></navLabel>
      <content src="chapter-${ch.chapter_number}.xhtml"/>
    </navPoint>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:novel-${novel.id}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeHtml(novel.title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`;
}

const CSS = `body { margin: 5%; font-family: "Noto Serif SC", Georgia, serif; line-height: 1.8; }
h1 { font-size: 1.4em; text-align: center; margin-bottom: 1em; border-bottom: 1px solid #ccc; padding-bottom: 0.5em; }
p { text-indent: 2em; margin: 0.5em 0; }`;

/**
 * 生成 EPUB 流
 * @param {object} novel - { id, title, author, description, cover_image, created_at }
 * @param {array} chapters - [{ chapter_number, title, content }]
 * @param {string} lastUpdated - ISO timestamp of last chapter update
 * @returns {import('stream').Readable} archiver stream
 */
function generateEpubStream(novel, chapters, lastUpdated) {
  const archive = new ZipArchive();

  // mimetype 必须第一个写入且不压缩
  archive.append('application/epub+zip', { name: 'mimetype', store: true });

  // META-INF/container.xml
  archive.append(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`, { name: 'META-INF/container.xml' });

  const hasCover = false; // 封面图暂不处理,可后续扩展

  // OEBPS/content.opf
  archive.append(buildContentOpf(novel, chapters.length, hasCover), { name: 'OEBPS/content.opf' });

  // OEBPS/nav.xhtml
  archive.append(buildNavXhtml(novel, chapters), { name: 'OEBPS/nav.xhtml' });

  // OEBPS/toc.ncx
  archive.append(buildTocNcx(novel, chapters), { name: 'OEBPS/toc.ncx' });

  // OEBPS/style.css
  archive.append(CSS, { name: 'OEBPS/style.css' });

  // OEBPS/chapter-N.xhtml
  for (const ch of chapters) {
    archive.append(
      contentToXhtml(ch.title, ch.content, ch.chapter_number),
      { name: `OEBPS/chapter-${ch.chapter_number}.xhtml` }
    );
  }

  // OEBPS/source.json — 书源元数据,ReadAny 用于自动更新
  archive.append(JSON.stringify({
    type: 'novel-webdav',
    novelId: novel.id,
    novelTitle: novel.title,
    chapterCount: chapters.length,
    lastUpdated: lastUpdated || new Date().toISOString()
  }), { name: 'OEBPS/source.json' });

  archive.finalize();
  return archive;
}

module.exports = { generateEpubStream };

// 书源 HTML 片段渲染（Legado CSS 规则依赖固定 class）

const { escapeHtml } = require('../util');

function renderPage(title, body) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 24px; color: #222; background: #f7f7f7; }
    main { max-width: 880px; margin: 0 auto; }
    .source-card, .source-book, .source-chapter-wrap, .source-content-wrap { background: #fff; border: 1px solid #e6e6e6; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
    .source-book-cover { width: 96px; height: 128px; object-fit: cover; border-radius: 8px; display: block; background: #eee; }
    .source-book-grid { display: grid; grid-template-columns: 96px 1fr; gap: 16px; align-items: start; }
    .source-book-title, .source-book-name, .source-chapter-title { font-size: 24px; font-weight: 700; margin: 0 0 12px; }
    .source-book-meta { margin: 6px 0; color: #555; }
    .source-book-intro { line-height: 1.8; white-space: pre-wrap; }
    .source-action { display: inline-block; margin-top: 16px; padding: 10px 14px; background: #111; color: #fff; text-decoration: none; border-radius: 8px; }
    .source-chapter-list { list-style: none; padding: 0; margin: 0; }
    .source-chapter-item { border-bottom: 1px solid #eee; }
    .source-chapter-item:last-child { border-bottom: 0; }
    .source-chapter-link { display: block; padding: 12px 0; color: #111; text-decoration: none; }
    .source-content p { line-height: 1.95; margin: 0 0 1.2em; }
  </style>
</head>
<body>
  <main>
    ${body}
  </main>
</body>
</html>`;
}

function renderSearchCards(rows, makeLink, toCover) {
  if (!rows.length) {
    return '<section class="source-card"><p>未找到结果</p></section>';
  }

  return rows.map(row => {
    const cover = toCover(row.cover_image);
    const link = makeLink(row.id);
    return `<article class="source-book source-card">
  <div class="source-book-grid">
    ${cover ? `<img class="source-book-cover" src="${escapeHtml(cover)}" alt="${escapeHtml(row.title)}">` : '<div class="source-book-cover"></div>'}
    <div>
      <h2 class="source-book-title">${escapeHtml(row.title)}</h2>
      <div class="source-book-author">${escapeHtml(row.author || '')}</div>
      <div class="source-book-kind">自建书源</div>
      <div class="source-book-last">${escapeHtml(row.last_chapter || '')}</div>
      <div class="source-book-intro">${escapeHtml(row.description || '')}</div>
      <a class="source-book-link source-action" href="${escapeHtml(link)}">查看详情</a>
    </div>
  </div>
</article>`;
  }).join('\n');
}

function renderBookDetail(display, tocUrl) {
  const cover = display.coverHtml || '';
  const chapterCount = Number(display.chapter_count || 0);
  return `<section class="source-card">
  <div class="source-book-grid">
    ${cover}
    <div>
      <h1 class="source-book-name">${escapeHtml(display.title)}</h1>
      <div class="source-book-author">${escapeHtml(display.author || '')}</div>
      <div class="source-book-kind">自建书源</div>
      <div class="source-book-last">${escapeHtml(display.last_chapter || '')}</div>
      <div class="source-book-meta">共 ${chapterCount} 章</div>
      <div class="source-book-intro">${escapeHtml(display.description || '')}</div>
      <a id="source-toc-link" class="source-action" href="${escapeHtml(tocUrl)}">目录</a>
    </div>
  </div>
</section>`;
}

function coverHtml(url, title) {
  if (!url) return '<div class="source-book-cover"></div>';
  return `<img class="source-book-cover" src="${escapeHtml(url)}" alt="${escapeHtml(title)}">`;
}

function renderChapterList(title, itemsHtml) {
  return `<section class="source-chapter-wrap">
  <h1 class="source-chapter-title">${escapeHtml(title)}</h1>
  <ul class="source-chapter-list">
    ${itemsHtml}
  </ul>
</section>`;
}

function renderChapterItems(chapters, makeUrl) {
  return chapters.map(chapter => {
    const url = makeUrl(chapter.chapter_number);
    return `<li class="source-chapter-item"><a class="source-chapter-link" href="${escapeHtml(url)}">${escapeHtml(chapter.title)}</a></li>`;
  }).join('\n');
}

function renderContent(bookTitle, chapterTitle, content) {
  const paragraphs = String(content || '')
    .split(/\n{2,}/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => `<p>${escapeHtml(item)}</p>`)
    .join('\n');

  return {
    pageTitle: `${chapterTitle} - ${bookTitle}`,
    body: `<section class="source-content-wrap">
  <h1 class="source-chapter-title">${escapeHtml(chapterTitle)}</h1>
  <div class="source-content">
    ${paragraphs}
  </div>
</section>`
  };
}

module.exports = {
  renderPage,
  renderSearchCards,
  renderBookDetail,
  coverHtml,
  renderChapterList,
  renderChapterItems,
  renderContent
};

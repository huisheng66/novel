// 极简 DOM 助手：不用框架，也不拼 HTML 字符串（正文一律走 textContent，天然防注入）

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') {
      node.innerHTML = value; // 仅用于内联 SVG 之类可信内容，正文不要用
    } else {
      node.setAttribute(key, String(value));
    }
  }

  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function spinner() {
  return el('div', { class: 'spinner' });
}

export function empty(text) {
  return el('p', { class: 'empty', text });
}

let toastTimer = null;

export function toast(message) {
  const box = document.getElementById('toast');
  if (!box) return;
  box.textContent = String(message);
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    box.hidden = true;
  }, 2600);
}

export function money(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

export function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-CN');
}

export function cover(url, title) {
  if (!url) {
    return el('div', { class: 'book-cover placeholder', text: '书' });
  }
  const img = el('img', { class: 'book-cover', src: url, alt: title || '', loading: 'lazy' });
  img.addEventListener('error', () => {
    img.replaceWith(el('div', { class: 'book-cover placeholder', text: '书' }));
  });
  return img;
}

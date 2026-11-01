// 路由与启动：hash 路由 + 登录守卫 + 顶栏/底栏切换

import * as store from './store.js';
import { el, clear } from './ui.js?v=20261101a';
import {
  LoginScreen,
  RegisterScreen,
  LibraryScreen,
  ShelfScreen,
  BookScreen,
  ReaderScreen,
  WalletScreen
} from './screens.js?v=20261101a';

const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('back-btn');
const tabbar = document.getElementById('tabbar');

const ROUTES = [
  { re: /^#\/login$/, screen: LoginScreen, isPublic: true },
  { re: /^#\/register$/, screen: RegisterScreen, isPublic: true },
  { re: /^#\/library$/, screen: LibraryScreen, tab: 'library' },
  { re: /^#\/shelf$/, screen: ShelfScreen, tab: 'shelf' },
  { re: /^#\/wallet$/, screen: WalletScreen, tab: 'wallet' },
  { re: /^#\/book\/(\d+)$/, screen: BookScreen, params: ['id'], tab: 'library' },
  { re: /^#\/read\/(\d+)\/(\d+)$/, screen: ReaderScreen, params: ['id', 'n'] }
];

let cleanup = null;
let seq = 0;

function parseHash() {
  const hash = location.hash || '#/library';
  for (const route of ROUTES) {
    const match = hash.match(route.re);
    if (!match) continue;
    const params = {};
    (route.params || []).forEach((name, index) => {
      params[name] = match[index + 1];
    });
    return { route, params };
  }
  return null;
}

async function render() {
  const parsed = parseHash();

  if (!parsed) {
    location.hash = '#/library';
    return;
  }

  const { route, params } = parsed;
  const mySeq = ++seq;

  if (!route.isPublic && !store.isLoggedIn()) {
    location.hash = '#/login';
    return;
  }

  if (cleanup) {
    try {
      cleanup();
    } catch (err) {
      /* ignore */
    }
    cleanup = null;
  }

  document.body.classList.remove('reading');
  backBtn.hidden = true;
  clear(view);
  view.setAttribute('aria-busy', 'true');
  view.appendChild(el('div', { class: 'loading-state', role: 'status' },
    el('span', { class: 'spinner', 'aria-hidden': 'true' }),
    el('span', { text: '页面加载中…' })
  ));

  let result = null;
  try {
    result = await route.screen(params);
  } catch (err) {
    result = {
      title: '出错了',
      node: el('div', { class: 'alert alert-error', text: err.message || '页面加载失败' }),
      back: true
    };
  }

  // 用户在加载期间又点了别的地方：丢弃这次结果
  if (mySeq !== seq || !result) return;

  const pageTitle = result.title || '书库';
  titleEl.textContent = pageTitle;
  document.title = pageTitle === '书库' ? '书库' : `${pageTitle} - 书库`;
  clear(view);
  view.appendChild(result.node);
  view.setAttribute('aria-busy', 'false');

  cleanup = result.cleanup || null;
  backBtn.hidden = !result.back;
  document.body.classList.toggle('reading', Boolean(result.reading));
  tabbar.style.display = result.reading ? 'none' : '';

  for (const link of tabbar.querySelectorAll('a')) {
    const current = link.dataset.tab === route.tab;
    link.classList.toggle('active', current);
    if (current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  view.focus({ preventScroll: true });
  if (!result.reading) window.scrollTo(0, 0);
}

backBtn.addEventListener('click', () => {
  if (history.length > 1) history.back();
  else location.hash = '#/library';
});

window.addEventListener('hashchange', render);
// 页面内需要强制刷新自己（购买成功、书架切换等）时用这个，避免 hash 未变导致不触发
window.addEventListener('app:reload', render);

store.applyTheme(store.getPrefs().theme);

// 跟随系统深浅色
if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (store.getPrefs().theme === 'auto') store.applyTheme('auto');
  };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
}

if (!location.hash) location.hash = store.isLoggedIn() ? '#/library' : '#/login';
render();

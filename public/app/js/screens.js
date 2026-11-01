// 各页面：登录、注册、书库、书架、详情/目录、阅读、钱包。
// 每个 screen 返回 { title, node, back?, reading?, actions? }，由 app.js 负责挂载。

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, spinner, empty, toast, money, cover, formatDate } from './ui.js?v=20261101a';

/* ---------------- 通用 ---------------- */

function field(labelText, input, hint = '') {
  const hintId = hint && input.id ? `${input.id}-hint` : null;
  return el('label', { class: 'field' },
    el('span', { class: 'field-label', text: labelText }),
    input,
    hint ? el('span', { class: 'field-hint', id: hintId, text: hint }) : null
  );
}

function alertBox(message, kind = 'error', id = null) {
  return el('div', {
    class: `alert alert-${kind}`,
    id,
    role: 'alert',
    'aria-atomic': 'true',
    text: message
  });
}

function loginHint() {
  return el('p', { class: 'muted' },
    '还没有账号？', el('a', { href: '#/register', text: '去注册' }));
}

/* ---------------- 登录 ---------------- */

export async function LoginScreen() {
  const identity = el('input', {
    id: 'login-identity',
    name: 'login',
    type: 'text',
    placeholder: '邮箱或用户名',
    autocomplete: 'username',
    required: true,
    'aria-describedby': 'login-identity-hint login-error'
  });
  const pwd = el('input', {
    id: 'login-password',
    name: 'password',
    type: 'password',
    placeholder: '请输入密码',
    autocomplete: 'current-password',
    required: true,
    'aria-describedby': 'login-error'
  });
  const box = alertBox('', 'error', 'login-error');
  const submit = el('button', { class: 'primary', type: 'submit' }, '登录');

  for (const input of [identity, pwd]) {
    input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
  }

  const form = el('form', {
    novalidate: false,
    onsubmit: async (ev) => {
      ev.preventDefault();
      clear(box);
      identity.removeAttribute('aria-invalid');
      pwd.removeAttribute('aria-invalid');
      submit.disabled = true;
      submit.textContent = '登录中…';
      try {
        await api.login({ login: identity.value.trim(), password: pwd.value });
        location.hash = '#/library';
      } catch (err) {
        identity.setAttribute('aria-invalid', 'true');
        pwd.setAttribute('aria-invalid', 'true');
        box.textContent = err.message || '登录失败，请检查后重试。';
        box.focus?.();
      } finally {
        submit.disabled = false;
        submit.textContent = '登录';
      }
    }
  }, box,
    field('邮箱或用户名', identity, '可使用注册邮箱或用户名登录'),
    field('密码', pwd),
    submit
  );

  return {
    title: '登录',
    node: el('div', { class: 'screen auth-screen' },
      form,
      el('p', { class: 'muted auth-links' },
        el('a', { href: '/forgot-password', text: '忘记密码？' })),
      loginHint()
    )
  };
}

/* ---------------- 注册 ---------------- */

export async function RegisterScreen() {
  const email = el('input', {
    id: 'register-email',
    name: 'email',
    type: 'email',
    placeholder: 'you@example.com',
    autocomplete: 'email',
    required: true,
    'aria-describedby': 'register-email-hint register-error'
  });
  const pwd = el('input', {
    id: 'register-password',
    name: 'password',
    type: 'password',
    placeholder: '至少 8 位',
    autocomplete: 'new-password',
    minlength: 8,
    required: true,
    'aria-describedby': 'register-password-hint register-error'
  });
  const invite = el('input', {
    id: 'register-invite',
    name: 'inviteCode',
    type: 'text',
    placeholder: '有就填，没有可留空',
    autocomplete: 'off'
  });
  const box = alertBox('', 'error', 'register-error');
  const submit = el('button', { class: 'primary', type: 'submit' }, '注册');

  for (const input of [email, pwd]) {
    input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
  }

  const form = el('form', {
    onsubmit: async (ev) => {
      ev.preventDefault();
      clear(box);
      email.removeAttribute('aria-invalid');
      pwd.removeAttribute('aria-invalid');
      submit.disabled = true;
      submit.textContent = '注册中…';
      try {
        const result = await api.register({
          email: email.value.trim(),
          password: pwd.value,
          inviteCode: invite.value.trim()
        });
        toast(result.emailVerificationSent ? '注册成功，验证邮件已发送' : '注册成功');
        location.hash = '#/library';
      } catch (err) {
        email.setAttribute('aria-invalid', 'true');
        pwd.setAttribute('aria-invalid', 'true');
        box.textContent = err.message || '注册失败，请检查后重试。';
      } finally {
        submit.disabled = false;
        submit.textContent = '注册';
      }
    }
  }, box,
    field('邮箱', email, '用于登录和接收验证邮件'),
    field('密码', pwd, '密码至少 8 位'),
    field('邀请码（选填）', invite),
    submit
  );

  return {
    title: '注册',
    node: el('div', { class: 'screen auth-screen' },
      form,
      el('p', { class: 'muted auth-links' },
        '已有账号？', el('a', { href: '#/login', text: '去登录' }))
    )
  };
}

/* ---------------- 书库 ---------------- */

export async function LibraryScreen() {
  const list = el('ul', { class: 'book-list', id: 'library-results' });
  const status = el('p', {
    class: 'muted result-status',
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true'
  });
  const resultState = el('div', { class: 'results-state' });
  const search = el('input', {
    id: 'library-search',
    name: 'q',
    type: 'search',
    placeholder: '输入书名或作者',
    autocomplete: 'off',
    'aria-controls': 'library-results',
    'aria-describedby': 'library-search-hint'
  });
  const more = el('button', {
    class: 'ghost load-more',
    type: 'button',
    onclick: () => load(false)
  }, '加载更多');

  let page = 1;
  let keyword = '';
  let total = 0;
  let loaded = 0;
  let loading = false;
  let requestSeq = 0;
  let lastLoadReset = true;
  let timer = null;

  function bookNode(item) {
    return el('li', {},
      el('a', { class: 'book-item', href: `#/book/${item.id}` },
        cover(item.coverUrl, item.title),
        el('div', { class: 'book-meta' },
          el('p', { class: 'book-title', text: item.title }),
          el('p', { class: 'book-sub', text: `${item.author || '佚名'} · 共 ${item.chapterCount} 章` }),
          el('p', { class: 'book-sub', text: item.lastChapterTitle ? `最新：${item.lastChapterTitle}` : '暂无章节' })
        )
      )
    );
  }

  async function load(reset) {
    if (loading && !reset) return;

    const requestId = ++requestSeq;
    const requestedPage = reset ? 1 : page;
    const requestedKeyword = keyword;
    lastLoadReset = reset;
    loading = true;
    more.disabled = true;
    more.textContent = '加载中…';
    clear(resultState);
    list.setAttribute('aria-busy', 'true');

    if (reset) {
      page = 1;
      total = 0;
      loaded = 0;
      clear(list);
      more.hidden = true;
    }
    status.textContent = requestedPage === 1 ? '正在加载书籍…' : '正在加载更多书籍…';

    try {
      const data = await api.books({ q: requestedKeyword, page: requestedPage, pageSize: 20 });
      if (requestId !== requestSeq) return;

      const items = Array.isArray(data.items) ? data.items : [];
      total = Number(data.total) || 0;
      for (const item of items) list.appendChild(bookNode(item));
      loaded += items.length;
      page = requestedPage + 1;

      if (loaded === 0) {
        resultState.appendChild(empty(requestedKeyword ? '没有找到匹配的书，请换个关键词。' : '书库暂时没有书籍。'));
        status.textContent = requestedKeyword ? '搜索完成，没有找到结果。' : '书库为空。';
      } else {
        status.textContent = `已显示 ${loaded} / ${total} 本`;
      }
      more.hidden = loaded === 0 || loaded >= total;
    } catch (err) {
      if (requestId !== requestSeq) return;
      status.textContent = '书籍加载失败。';
      more.hidden = true;
      const retry = el('button', {
        class: 'ghost',
        type: 'button',
        onclick: () => load(lastLoadReset)
      }, '重新加载');
      resultState.appendChild(alertBox(err.message || '加载失败，请检查网络后重试。'));
      resultState.appendChild(el('p', { class: 'state-action' }, retry));
    } finally {
      if (requestId === requestSeq) {
        loading = false;
        list.setAttribute('aria-busy', 'false');
        more.disabled = false;
        more.textContent = '加载更多';
      }
    }
  }

  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      keyword = search.value.trim();
      load(true);
    }, 300);
  });

  await load(true);

  return {
    title: '书库',
    node: el('div', { class: 'screen' },
      el('div', { class: 'search-box' },
        el('label', { class: 'sr-only', for: 'library-search', text: '搜索书名或作者' }),
        search,
        el('p', { class: 'field-hint', id: 'library-search-hint', text: '输入关键词后会自动搜索。' })
      ),
      status,
      resultState,
      list,
      more
    ),
    cleanup: () => {
      clearTimeout(timer);
      requestSeq += 1;
    }
  };
}

/* ---------------- 书架 ---------------- */

export async function ShelfScreen() {
  const node = el('div', { class: 'screen' }, spinner());
  try {
    const data = await api.shelf();
    clear(node);

    if (!data.items || data.items.length === 0) {
      node.appendChild(empty('书架还是空的，去书库挑一本吧。'));
      node.appendChild(el('p', { class: 'state-action' },
        el('a', { class: 'ghost', href: '#/library', text: '去书库看看' })));
      return { title: '书架', node };
    }

    const list = el('ul', { class: 'book-list' });
    for (const item of data.items) {
      const progress = item.progress || null;
      const target = progress
        ? `#/read/${item.novelId}/${progress.chapterNumber}`
        : (item.lastChapterNumber ? `#/read/${item.novelId}/1` : `#/book/${item.novelId}`);

      list.appendChild(el('li', {},
        el('a', { class: 'book-item', href: target },
          cover(item.coverUrl, item.title),
          el('div', { class: 'book-meta' },
            el('p', { class: 'book-title', text: item.title }),
            el('p', { class: 'book-sub', text: progress ? `读到第 ${progress.chapterNumber} 章` : '尚未开始' }),
            el('p', { class: 'book-sub', text: item.hasUpdate ? '有更新 · 点击继续' : (item.lastChapterTitle || '') })
          )
        )
      ));
    }
    node.appendChild(list);
  } catch (err) {
    clear(node);
    node.appendChild(alertBox(err.message));
  }
  return { title: '书架', node };
}

/* ---------------- 书籍详情 / 目录 ---------------- */

export async function BookScreen({ id }) {
  const node = el('div', { class: 'screen' }, spinner());
  let pageTitle = '书籍详情';

  try {
    const [book, toc] = await Promise.all([api.book(id), api.toc(id, { page: 1, pageSize: 200 })]);
    clear(node);
    pageTitle = book.title || '书籍详情';

    const local = store.getLocalProgress(id);

    node.appendChild(el('section', { class: 'card book-overview', 'aria-labelledby': 'book-title' },
      el('div', { class: 'row' },
        cover(book.coverUrl, book.title),
        el('div', { class: 'book-meta' },
          el('h2', { class: 'book-title', id: 'book-title', text: book.title }),
          el('p', { class: 'book-sub', text: `${book.author || '佚名'} · ${book.chapterCount} 章` }),
          el('p', { class: 'book-sub', text: book.lastChapterTitle ? `最新：${book.lastChapterTitle}` : '' })
        )
      ),
      book.description ? el('p', { class: 'muted book-description', text: book.description }) : null
    ));

    const startAt = local && local.chapterNumber ? local.chapterNumber : 1;
    const actions = el('div', { class: 'row book-actions' },
      el('button', {
        class: 'primary',
        type: 'button',
        onclick: () => { location.hash = `#/read/${id}/${startAt}`; }
      }, local ? `继续阅读 · 第 ${startAt} 章` : '开始阅读')
    );
    node.appendChild(actions);

    const shelfBtn = el('button', { class: 'ghost', type: 'button' }, '加入书架');
    let inShelf = false;

    api.shelf()
      .then(data => {
        inShelf = (data.items || []).some(item => Number(item.novelId) === Number(id));
        shelfBtn.textContent = inShelf ? '移出书架' : '加入书架';
      })
      .catch(() => { /* 未登录或离线：保持默认文案 */ });

    shelfBtn.onclick = async () => {
      shelfBtn.disabled = true;
      try {
        if (inShelf) {
          await api.removeShelf(id);
          inShelf = false;
          shelfBtn.textContent = '加入书架';
          toast('已移出书架');
        } else {
          await api.addShelf(id);
          inShelf = true;
          shelfBtn.textContent = '移出书架';
          toast('已加入书架');
        }
      } catch (err) {
        toast(err.message);
      } finally {
        shelfBtn.disabled = false;
      }
    };
    actions.appendChild(shelfBtn);

    node.appendChild(el('h2', { class: 'section-title', text: `目录（共 ${toc.total} 章）` }));
    const list = el('ul', { class: 'toc-list' });
    for (const ch of toc.items) {
      list.appendChild(el('li', {},
        el('a', { href: `#/read/${id}/${ch.chapterNumber}` },
          el('span', { class: 'toc-num', text: String(ch.chapterNumber) }),
          el('span', { class: 'toc-title', text: ch.title }),
          ch.isFree ? null : el('span', { class: 'lock-tag', text: ch.price ? `¥${money(ch.price)}` : '付费' })
        )
      ));
    }
    node.appendChild(list);

    // 目录分页：超出首屏的部分按需加载
    if (toc.totalPages > 1) {
      let page = 1;
      const more = el('button', { class: 'ghost', type: 'button' }, '加载更多章节');
      more.onclick = async () => {
        more.disabled = true;
        try {
          page += 1;
          const next = await api.toc(id, { page, pageSize: 200 });
          for (const ch of next.items) {
            list.appendChild(el('li', {},
              el('a', { href: `#/read/${id}/${ch.chapterNumber}` },
                el('span', { class: 'toc-num', text: String(ch.chapterNumber) }),
                el('span', { class: 'toc-title', text: ch.title }),
                ch.isFree ? null : el('span', { class: 'lock-tag', text: ch.price ? `¥${money(ch.price)}` : '付费' })
              )
            ));
          }
          if (page >= next.totalPages) more.hidden = true;
        } catch (err) {
          toast(err.message);
        } finally {
          more.disabled = false;
        }
      };
      node.appendChild(el('div', { class: 'pager' }, more));
    }
  } catch (err) {
    clear(node);
    node.appendChild(alertBox(err.message));
  }

  return { title: pageTitle, node, back: true };
}

/* ---------------- 阅读 ---------------- */

export async function ReaderScreen({ id, n }) {
  const node = el('div', { class: 'reader' }, spinner());
  const chapterNumber = Number(n);

  document.body.classList.add('reading');

  let cloudTimer = null;
  let lastRatio = 0;

  function currentRatio() {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    if (max <= 0) return 0;
    return Math.min(1, Math.max(0, window.scrollY / max));
  }

  function persist() {
    const ratio = currentRatio();
    lastRatio = ratio;
    store.saveLocalProgress(id, { chapterNumber, offsetRatio: ratio });

    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(() => {
      api.putProgress({
        novelId: Number(id),
        chapterNumber,
        offsetRatio: lastRatio,
        updatedAt: new Date().toISOString()
      }).catch(() => { /* 离线时静默失败，本地已存 */ });
    }, 1500);
  }

  function onScroll() {
    persist();
  }

  let onKey = null;

  function cleanup() {
    window.removeEventListener('scroll', onScroll);
    if (onKey) window.removeEventListener('keydown', onKey);
    clearTimeout(cloudTimer);
    document.body.classList.remove('reading');

    // 还没到防抖时间就离开：补一次云端进度（失败无所谓，本地已存）
    if (lastRatio > 0) {
      api.putProgress({
        novelId: Number(id),
        chapterNumber,
        offsetRatio: lastRatio,
        updatedAt: new Date().toISOString()
      }).catch(() => {});
    }
  }

  try {
    const data = await api.chapter(id, chapterNumber);
    clear(node);

    node.appendChild(el('h2', { text: data.title || `第 ${chapterNumber} 章` }));

    const body = el('div', { class: 'reader-body' });
    const paragraphs = Array.isArray(data.paragraphs) && data.paragraphs.length
      ? data.paragraphs
      : String(data.content || '').split(/\n{2,}/).filter(Boolean);
    for (const p of paragraphs) {
      body.appendChild(el('p', { text: p }));
    }
    node.appendChild(body);

    node.appendChild(el('div', { class: 'reader-nav' },
      data.prev ? el('a', { href: `#/read/${id}/${data.prev}`, text: '‹ 上一章' }) : el('span', { class: 'muted', text: '已是第一章' }),
      el('a', { href: `#/book/${id}`, text: '目录' }),
      data.next ? el('a', { href: `#/read/${id}/${data.next}`, text: '下一章 ›' }) : el('span', { class: 'muted', text: '已是最后一章' })
    ));

    // 恢复进度：本地与云端取较新的一条（与后端 LWW 语义一致）
    const local = store.getLocalProgress(id);
    let ratio = null;
    if (local && Number(local.chapterNumber) === chapterNumber) ratio = local.offsetRatio;

    try {
      const remote = await api.getProgress(id);
      if (remote && Number(remote.chapterNumber) === chapterNumber) {
        const remoteAt = new Date(remote.updatedAt).getTime();
        const localAt = local ? new Date(local.updatedAt).getTime() : 0;
        if (!local || remoteAt >= localAt) ratio = remote.offsetRatio;
      }
    } catch (err) {
      /* 没有云端进度是正常情况 */
    }

    if (ratio && ratio > 0) {
      requestAnimationFrame(() => {
        const doc = document.documentElement;
        const max = doc.scrollHeight - window.innerHeight;
        if (max > 0) window.scrollTo(0, Math.round(max * ratio));
      });
    } else {
      window.scrollTo(0, 0);
    }

    window.addEventListener('scroll', onScroll, { passive: true });

    // 工具栏：字号 / 主题 / 目录
    const decrease = el('button', {
      type: 'button',
      'aria-label': '减小正文字号',
      title: '减小正文字号'
    }, 'A−');
    const increase = el('button', {
      type: 'button',
      'aria-label': '增大正文字号',
      title: '增大正文字号'
    }, 'A+');
    const fontStatus = el('span', {
      class: 'sr-only',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true'
    });
    const themeButton = el('button', { class: 'theme-button', type: 'button' });
    const themeNames = { auto: '跟随系统', light: '浅色', dark: '深色', sepia: '护眼' };

    function updateFontControls() {
      const size = store.getPrefs().fontSize;
      decrease.disabled = size <= 14;
      increase.disabled = size >= 28;
      fontStatus.textContent = `正文字号 ${size} 像素`;
    }

    function changeFontSize(delta) {
      const size = Math.min(28, Math.max(14, store.getPrefs().fontSize + delta));
      store.setPrefs({ fontSize: size });
      store.applyTheme(store.getPrefs().theme);
      updateFontControls();
      toast(`正文字号已调整为 ${size} 像素`);
    }

    function updateThemeButton() {
      const theme = store.getPrefs().theme;
      const name = themeNames[theme] || themeNames.auto;
      themeButton.textContent = `主题：${name}`;
      themeButton.setAttribute('aria-label', `切换阅读主题，当前为${name}`);
      themeButton.title = '点击切换浅色、深色、护眼或跟随系统';
    }

    decrease.addEventListener('click', () => changeFontSize(-1));
    increase.addEventListener('click', () => changeFontSize(1));
    themeButton.addEventListener('click', () => {
      const order = ['auto', 'light', 'dark', 'sepia'];
      const next = order[(order.indexOf(store.getPrefs().theme) + 1) % order.length];
      store.setPrefs({ theme: next });
      store.applyTheme(next);
      updateThemeButton();
      toast(`阅读主题：${themeNames[next]}`);
    });
    updateFontControls();
    updateThemeButton();

    const toolbar = el('div', {
      class: 'reader-toolbar',
      role: 'toolbar',
      'aria-label': '阅读设置'
    },
      decrease,
      increase,
      themeButton,
      fontStatus,
      el('a', { class: 'toolbar-link', href: `#/book/${id}`, 'aria-label': '返回本书目录' }, '目录')
    );
    node.appendChild(toolbar);

    onKey = (ev) => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
      const target = ev.target;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (ev.key === 'ArrowLeft' && data.prev) location.hash = `#/read/${id}/${data.prev}`;
      if (ev.key === 'ArrowRight' && data.next) location.hash = `#/read/${id}/${data.next}`;
    };
    window.addEventListener('keydown', onKey);

    return { title: data.title || `第 ${chapterNumber} 章`, node, back: true, reading: true, cleanup };
  } catch (err) {
    clear(node);

    // 付费章节未解锁：给试读 + 购买入口
    if (err.code === 'PAYMENT_REQUIRED' || err.status === 402) {
      const info = (err.payload && err.payload.error) || {};
      node.appendChild(el('h2', { text: `第 ${chapterNumber} 章` }));
      if (info.teaser) {
        node.appendChild(el('div', { class: 'reader-body teaser' }, el('p', { text: info.teaser })));
      }
      node.appendChild(el('div', { class: 'paywall' },
        el('p', { class: 'muted', text: '本章为付费章节' }),
        el('p', { class: 'price', text: info.price ? `¥${money(info.price)}` : '需解锁' }),
        el('button', {
          class: 'primary',
          type: 'button',
          onclick: async (ev) => {
            const button = ev.currentTarget;
            button.disabled = true;
            button.textContent = '购买中…';
            try {
              const result = await api.purchase({ novelId: Number(id), chapterNumber });
              toast(result.alreadyOwned ? '该章已购买' : `购买成功，扣除 ¥${money(result.amount)}`);
              window.dispatchEvent(new Event('app:reload'));
            } catch (e) {
              if (e.code === 'INSUFFICIENT_BALANCE') {
                toast('余额不足，请先在“我的”页面充值');
                location.hash = '#/wallet';
              } else {
                toast(e.message);
                button.disabled = false;
                button.textContent = '购买本章';
              }
            }
          }
        }, '购买本章'),
        el('p', { class: 'muted', style: 'margin-top:0.7rem' },
          el('a', { href: '#/wallet', text: '查看余额与充值' }))
      ));
      return { title: '付费章节', node, back: true, reading: true, cleanup };
    }

    node.appendChild(alertBox(err.message));
    return { title: '出错了', node, back: true, cleanup };
  }
}

/* ---------------- 钱包 / 我的 ---------------- */

export async function WalletScreen() {
  const node = el('div', { class: 'screen' }, spinner());

  try {
    const [wallet, purchases, user] = await Promise.all([
      api.wallet(),
      api.purchases().catch(() => ({ items: [] })),
      api.me().catch(() => null)
    ]);

    clear(node);

    const me = (user && user.user) || store.getUser() || {};
    node.appendChild(el('div', { class: 'card' },
      el('p', { class: 'muted', style: 'margin:0', text: me.displayName || me.username || '读者' }),
      el('p', { class: 'balance', text: `¥${money(wallet.balance)}` }),
      el('p', { class: 'muted', style: 'margin:0' },
        me.email ? `${me.email}${me.emailVerified ? '（已验证）' : '（未验证）'}` : '未绑定邮箱')
    ));

    const code = el('input', {
      id: 'redeem-code',
      name: 'code',
      type: 'text',
      placeholder: '例如 RC-XXXXXXXX',
      autocomplete: 'off',
      required: true,
      'aria-describedby': 'redeem-code-hint redeem-error'
    });
    const redeemError = alertBox('', 'error', 'redeem-error');
    const redeemBtn = el('button', { class: 'primary', type: 'submit' }, '充值');
    code.addEventListener('input', () => code.removeAttribute('aria-invalid'));

    const redeemForm = el('form', {
      onsubmit: async (ev) => {
        ev.preventDefault();
        const value = code.value.trim();
        clear(redeemError);
        code.removeAttribute('aria-invalid');
        if (!value) {
          code.setAttribute('aria-invalid', 'true');
          redeemError.textContent = '请输入兑换码。';
          code.focus();
          return;
        }
        redeemBtn.disabled = true;
        redeemBtn.textContent = '充值中…';
        try {
          const result = await api.redeem(value);
          toast(`充值成功 ¥${money(result.amount)}，余额 ¥${money(result.balance)}`);
          window.dispatchEvent(new Event('app:reload'));
        } catch (err) {
          code.setAttribute('aria-invalid', 'true');
          redeemError.textContent = err.message || '充值失败，请检查兑换码后重试。';
        } finally {
          redeemBtn.disabled = false;
          redeemBtn.textContent = '充值';
        }
      }
    }, field('兑换码', code, '输入有效兑换码为账户充值'), redeemError, redeemBtn);

    node.appendChild(el('section', { class: 'card', 'aria-labelledby': 'redeem-title' },
      el('h2', { class: 'section-title', id: 'redeem-title', text: '兑换码充值' }),
      redeemForm
    ));

    const txs = wallet.transactions || [];
    node.appendChild(el('div', { class: 'card' },
      el('p', { class: 'muted', style: 'margin:0 0 0.5rem', text: '消费记录' }),
      txs.length === 0
        ? el('p', { class: 'muted', style: 'margin:0', text: '暂无记录' })
        : el('ul', { class: 'tx-list' }, ...txs.map(tx => el('li', {},
            el('span', { text: `${tx.type === 'recharge' ? '充值' : tx.type === 'purchase' ? '购买' : '调整'} · ${formatDate(tx.createdAt)}` }),
            el('span', { class: tx.delta < 0 ? 'tx-out' : 'tx-in', text: `${tx.delta < 0 ? '-' : '+'}¥${money(Math.abs(tx.delta))}` })
          )))
    ));

    const items = (purchases && purchases.items) || [];
    node.appendChild(el('div', { class: 'card' },
      el('p', { class: 'muted', style: 'margin:0 0 0.5rem', text: '已购章节' }),
      items.length === 0
        ? el('p', { class: 'muted', style: 'margin:0', text: '还没有购买过章节' })
        : el('ul', { class: 'tx-list' }, ...items.slice(0, 20).map(p => el('li', {},
            el('a', { href: `#/read/${p.novelId}/${p.chapterNumber}`, text: `书 ${p.novelId} · 第 ${p.chapterNumber} 章` }),
            el('span', { class: 'muted', text: `¥${money(p.amount)}` })
          )))
    ));

    const logout = el('button', { class: 'ghost', type: 'button', style: 'width:100%', }, '退出登录');
    logout.onclick = () => {
      store.clearSession();
      location.hash = '#/login';
    };
    node.appendChild(logout);
  } catch (err) {
    clear(node);
    node.appendChild(alertBox(err.message));
  }

  return { title: '我的', node };
}

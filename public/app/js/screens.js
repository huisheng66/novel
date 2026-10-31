// 各页面：登录、注册、书库、书架、详情/目录、阅读、钱包。
// 每个 screen 返回 { title, node, back?, reading?, actions? }，由 app.js 负责挂载。

import { api } from './api.js';
import * as store from './store.js';
import { el, clear, spinner, empty, toast, money, cover, formatDate } from './ui.js';

/* ---------------- 通用 ---------------- */

function field(labelText, input) {
  return el('label', { class: 'field' }, el('span', { text: labelText }), input);
}

function alertBox(message, kind = 'error') {
  return el('div', { class: `alert alert-${kind}`, text: message });
}

function loginHint() {
  return el('p', { class: 'muted' },
    '还没有账号？', el('a', { href: '#/register', text: '去注册' }));
}

/* ---------------- 登录 ---------------- */

export async function LoginScreen() {
  const email = el('input', { type: 'email', placeholder: '邮箱或用户名', autocomplete: 'username' });
  const pwd = el('input', { type: 'password', placeholder: '密码', autocomplete: 'current-password' });
  const box = el('div');
  const submit = el('button', { class: 'primary', type: 'submit' }, '登录');

  const form = el('form', {
    onsubmit: async (ev) => {
      ev.preventDefault();
      clear(box);
      submit.disabled = true;
      try {
        await api.login({ login: email.value.trim(), password: pwd.value });
        location.hash = '#/library';
      } catch (err) {
        box.appendChild(alertBox(err.message));
      } finally {
        submit.disabled = false;
      }
    }
  }, box, field('邮箱或用户名', email), field('密码', pwd), submit);

  return {
    title: '登录',
    node: el('div', {},
      form,
      el('p', { class: 'muted', style: 'margin-top:1rem' },
        el('a', { href: '/forgot-password', text: '忘记密码？' })),
      loginHint()
    )
  };
}

/* ---------------- 注册 ---------------- */

export async function RegisterScreen() {
  const email = el('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'email' });
  const pwd = el('input', { type: 'password', placeholder: '至少 8 位', autocomplete: 'new-password' });
  const invite = el('input', { type: 'text', placeholder: '有就填，没有可留空' });
  const box = el('div');
  const submit = el('button', { class: 'primary', type: 'submit' }, '注册');

  const form = el('form', {
    onsubmit: async (ev) => {
      ev.preventDefault();
      clear(box);
      submit.disabled = true;
      try {
        const result = await api.register({
          email: email.value.trim(),
          password: pwd.value,
          inviteCode: invite.value.trim()
        });
        toast(result.emailVerificationSent ? '注册成功，验证邮件已发送' : '注册成功');
        location.hash = '#/library';
      } catch (err) {
        box.appendChild(alertBox(err.message));
      } finally {
        submit.disabled = false;
      }
    }
  }, box,
    field('邮箱', email),
    field('密码', pwd),
    field('邀请码（选填）', invite),
    submit);

  return {
    title: '注册',
    node: el('div', {},
      form,
      el('p', { class: 'muted', style: 'margin-top:1rem' },
        '已有账号？', el('a', { href: '#/login', text: '去登录' }))
    )
  };
}

/* ---------------- 书库 ---------------- */

export async function LibraryScreen() {
  const list = el('ul', { class: 'book-list' });
  const status = el('p', { class: 'muted' });
  const search = el('input', { type: 'search', placeholder: '搜索书名或作者' });

  let page = 1;
  let keyword = '';
  let total = 0;
  let loaded = 0;

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
    if (reset) {
      page = 1;
      loaded = 0;
      clear(list);
    }
    status.textContent = '加载中…';
    try {
      const data = await api.books({ q: keyword, page, pageSize: 20 });
      total = data.total;
      for (const item of data.items) list.appendChild(bookNode(item));
      loaded += data.items.length;
      page += 1;
      status.textContent = total === 0 ? '' : `已显示 ${loaded} / ${total} 本`;
      if (loaded < total) {
        more.hidden = false;
      } else {
        more.hidden = true;
      }
      if (total === 0) list.appendChild(empty('没有找到匹配的书'));
    } catch (err) {
      status.textContent = '';
      list.appendChild(alertBox(err.message));
    }
  }

  const more = el('button', { class: 'ghost', type: 'button', onclick: () => load(false) }, '加载更多');

  let timer = null;
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
    node: el('div', {}, el('div', { style: 'margin-bottom:0.8rem' }, search), list, status, more)
  };
}

/* ---------------- 书架 ---------------- */

export async function ShelfScreen() {
  const node = el('div', {}, spinner());
  try {
    const data = await api.shelf();
    clear(node);

    if (!data.items || data.items.length === 0) {
      node.appendChild(empty('书架还是空的，去书库挑一本'));
      node.appendChild(el('p', { style: 'text-align:center' },
        el('a', { class: 'ghost', href: '#/library', style: 'display:inline-block;padding:0.5rem 1rem;text-decoration:none', text: '去书库' })));
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
  const node = el('div', {}, spinner());

  try {
    const [book, toc] = await Promise.all([api.book(id), api.toc(id, { page: 1, pageSize: 200 })]);
    clear(node);

    const local = store.getLocalProgress(id);

    node.appendChild(el('div', { class: 'card' },
      el('div', { class: 'row' },
        cover(book.coverUrl, book.title),
        el('div', { class: 'book-meta' },
          el('p', { class: 'book-title', text: book.title }),
          el('p', { class: 'book-sub', text: `${book.author || '佚名'} · ${book.chapterCount} 章` }),
          el('p', { class: 'book-sub', text: book.lastChapterTitle ? `最新：${book.lastChapterTitle}` : '' })
        )
      ),
      book.description ? el('p', { class: 'muted', style: 'margin:0.7rem 0 0', text: book.description }) : null
    ));

    const startAt = local && local.chapterNumber ? local.chapterNumber : 1;
    const actions = el('div', { class: 'row', style: 'margin-bottom:0.9rem' },
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

    node.appendChild(el('p', { class: 'book-sub', text: `目录（共 ${toc.total} 章）` }));
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

  return { title: '详情', node, back: true };
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
    const prefs = store.getPrefs();
    const toolbar = el('div', { class: 'reader-toolbar' },
      el('button', {
        type: 'button',
        onclick: () => { store.setPrefs({ fontSize: Math.max(14, store.getPrefs().fontSize - 1) }); store.applyTheme(store.getPrefs().theme); }
      }, 'A-'),
      el('button', {
        type: 'button',
        onclick: () => { store.setPrefs({ fontSize: Math.min(28, store.getPrefs().fontSize + 1) }); store.applyTheme(store.getPrefs().theme); }
      }, 'A+'),
      el('button', {
        type: 'button',
        onclick: () => {
          const order = ['auto', 'light', 'dark', 'sepia'];
          const next = order[(order.indexOf(store.getPrefs().theme) + 1) % order.length];
          store.setPrefs({ theme: next });
          store.applyTheme(next);
          toast({ auto: '跟随系统', light: '浅色', dark: '深色', sepia: '护眼' }[next]);
        }
      }, '主题'),
      el('span', { class: 'spacer' }),
      el('a', { href: `#/book/${id}`, style: 'color:inherit;text-decoration:none;padding:0.35rem 0.5rem' }, '目录')
    );
    node.appendChild(toolbar);

    onKey = (ev) => {
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
            ev.target.disabled = true;
            try {
              const result = await api.purchase({ novelId: Number(id), chapterNumber });
              toast(result.alreadyOwned ? '该章已购买' : `购买成功，扣除 ¥${money(result.amount)}`);
              window.dispatchEvent(new Event('app:reload'));
            } catch (e) {
              if (e.code === 'INSUFFICIENT_BALANCE') {
                toast('余额不足，去钱包充值');
                location.hash = '#/wallet';
              } else {
                toast(e.message);
                ev.target.disabled = false;
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
  const node = el('div', {}, spinner());

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

    const code = el('input', { type: 'text', placeholder: '输入兑换码，如 RC-XXXXXXXX' });
    const redeemBtn = el('button', { class: 'primary', type: 'button', style: 'margin-top:0.6rem' }, '充值');
    redeemBtn.onclick = async () => {
      const value = code.value.trim();
      if (!value) return toast('请输入兑换码');
      redeemBtn.disabled = true;
      try {
        const result = await api.redeem(value);
        toast(`充值成功 ¥${money(result.amount)}，余额 ¥${money(result.balance)}`);
        window.dispatchEvent(new Event('app:reload'));
      } catch (err) {
        toast(err.message);
      } finally {
        redeemBtn.disabled = false;
      }
    };
    node.appendChild(el('div', { class: 'card' }, el('p', { class: 'muted', style: 'margin:0 0 0.5rem', text: '兑换码充值' }), code, redeemBtn));

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

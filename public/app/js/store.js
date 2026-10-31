// 本地状态：登录凭据、阅读偏好、离线进度与最近阅读。
// 全部落在 localStorage —— 体量小、同步读写、无需 IndexedDB 的复杂度。

const K = {
  access: 'cn.access',
  refresh: 'cn.refresh',
  user: 'cn.user',
  prefs: 'cn.prefs',
  progress: 'cn.progress',
  recent: 'cn.recent'
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    /* 隐私模式/配额满：忽略，不影响阅读 */
  }
}

function drop(key) {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    /* ignore */
  }
}

export function getAccess() {
  return read(K.access, '');
}
export function getRefresh() {
  return read(K.refresh, '');
}
export function getUser() {
  return read(K.user, null);
}

export function setSession(payload) {
  if (!payload) return;
  if (payload.accessToken) write(K.access, payload.accessToken);
  if (payload.refreshToken) write(K.refresh, payload.refreshToken);
  if (payload.user) write(K.user, payload.user);
}

export function clearSession() {
  drop(K.access);
  drop(K.refresh);
  drop(K.user);
}

export function isLoggedIn() {
  return Boolean(getAccess() || getRefresh());
}

/* ===== 阅读偏好 ===== */

const DEFAULT_PREFS = { theme: 'auto', fontSize: 18 };

export function getPrefs() {
  return { ...DEFAULT_PREFS, ...read(K.prefs, {}) };
}

export function setPrefs(patch) {
  write(K.prefs, { ...getPrefs(), ...patch });
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (!theme || theme === 'auto') {
    const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', theme);
  }
  root.style.setProperty('--reader-size', `${getPrefs().fontSize}px`);
}

/* ===== 进度（本地副本，云端以 LWW 合并） ===== */

function progressMap() {
  return read(K.progress, {});
}

export function getLocalProgress(novelId) {
  return progressMap()[String(novelId)] || null;
}

export function saveLocalProgress(novelId, { chapterNumber, offsetRatio }) {
  const all = progressMap();
  all[String(novelId)] = {
    chapterNumber: Number(chapterNumber),
    offsetRatio: Number(offsetRatio) || 0,
    updatedAt: new Date().toISOString()
  };
  write(K.progress, all);
  touchRecent(novelId);
  return all[String(novelId)];
}

/* ===== 最近阅读 ===== */

export function getRecent() {
  return read(K.recent, []);
}

export function touchRecent(novelId) {
  const id = Number(novelId);
  const list = getRecent().filter(x => x !== id);
  list.unshift(id);
  write(K.recent, list.slice(0, 20));
}

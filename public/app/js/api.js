// API 客户端：Bearer + 自动刷新（refresh 单飞，避免并发刷新互相作废）
import * as store from './store.js';

const BASE = '/api/v1';

async function raw(path, { method = 'GET', body, token } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    data = { raw: text };
  }
  return { res, data };
}

function toError(res, data) {
  const info = (data && data.error) || {};
  const err = new Error(info.message || `请求失败（${res.status}）`);
  err.status = res.status;
  err.code = info.code || null;
  err.payload = data;
  return err;
}

let refreshing = null;

async function refreshTokens() {
  if (refreshing) return refreshing;

  const token = store.getRefresh();
  if (!token) return false;

  refreshing = (async () => {
    try {
      const { res, data } = await raw('/auth/refresh', { method: 'POST', body: { refreshToken: token } });
      if (!res.ok || !data) {
        store.clearSession();
        return false;
      }
      store.setSession(data);
      return true;
    } catch (err) {
      return false;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

export async function request(path, options = {}) {
  const first = await raw(path, { ...options, token: store.getAccess() });

  // access token 2 小时过期：401 时静默刷新一次再重试
  if (first.res.status === 401 && store.getRefresh()) {
    const ok = await refreshTokens();
    if (ok) {
      const retry = await raw(path, { ...options, token: store.getAccess() });
      if (!retry.res.ok) throw toError(retry.res, retry.data);
      return retry.data;
    }
  }

  if (!first.res.ok) throw toError(first.res, first.data);
  return first.data;
}

export const api = {
  /* ---- 认证 ---- */
  async login({ login, password }) {
    const data = await request('/auth/login', { method: 'POST', body: { login, password } });
    store.setSession(data);
    return data;
  },

  async register({ email, password, inviteCode }) {
    const data = await request('/auth/register', {
      method: 'POST',
      body: { email, password, inviteCode: inviteCode || undefined }
    });
    store.setSession(data);
    return data;
  },

  me() {
    return request('/me');
  },

  /* ---- 书库 ---- */
  books({ q = '', page = 1, pageSize = 20 } = {}) {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (q) qs.set('q', q);
    return request(`/books?${qs}`);
  },

  book(id) {
    return request(`/books/${id}`);
  },

  toc(id, { page = 1, pageSize = 200 } = {}) {
    return request(`/books/${id}/toc?page=${page}&pageSize=${pageSize}`);
  },

  chapter(id, n) {
    return request(`/books/${id}/chapters/${n}`);
  },

  /* ---- 书架 ---- */
  shelf() {
    return request('/me/shelf');
  },

  addShelf(novelId) {
    return request('/me/shelf', { method: 'POST', body: { novelId } });
  },

  removeShelf(novelId) {
    return request(`/me/shelf/${novelId}`, { method: 'DELETE' });
  },

  /* ---- 进度 ---- */
  getProgress(novelId) {
    return request(`/me/progress/${novelId}`);
  },

  putProgress({ novelId, chapterNumber, offsetRatio, updatedAt }) {
    return request('/me/progress', {
      method: 'PUT',
      body: { novelId, chapterNumber, offsetRatio, updatedAt, deviceName: 'app' }
    });
  },

  /* ---- 钱包与购买 ---- */
  wallet() {
    return request('/me/wallet');
  },

  redeem(code) {
    return request('/me/wallet/redeem', { method: 'POST', body: { code } });
  },

  purchase({ novelId, chapterNumber }) {
    return request('/me/purchases', { method: 'POST', body: { novelId, chapterNumber } });
  },

  purchases() {
    return request('/me/purchases');
  }
};

import { reactive } from 'vue';

const KEY = 'rent_session';
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const apiUrl = (path) => {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const requestPath = normalized.startsWith('/api') ? normalized : `/api${normalized}`;
  if (!API_BASE) return requestPath;
  const base = API_BASE.replace(/\/api$/, '');
  return `${base}${requestPath}`;
};

function storage() {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function load() {
  const store = storage();
  if (!store) return { token: null, user: null };
  try {
    return JSON.parse(store.getItem(KEY)) || { token: null, user: null };
  } catch {
    return { token: null, user: null };
  }
}

export const session = reactive(load());

export function setSession(token, user) {
  session.token = token;
  session.user = user;
  const store = storage();
  if (!store) return;
  if (token) store.setItem(KEY, JSON.stringify({ token, user }));
  else store.removeItem(KEY);
}

export function logout(expired = false) {
  setSession(null, null);
  window.location.assign(expired ? '/login?expired=1' : '/login');
}

export const isLoggedIn = () => Boolean(session.token);
export const canManage = () => ['admin', 'landlord'].includes(session.user?.role);

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

const OFFLINE = "We can't reach the server right now. Please check your internet connection and try again.";
const SERVER = 'Something went wrong on our side. Please try again in a moment.';

function friendly(status, message) {
  if (status >= 500) return SERVER;
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404 && !message) return 'We could not find what you were looking for.';
  return message || SERVER;
}

/** JSON request. Pass `payToken` for the public tenant endpoints. Throws ApiError with a friendly message. */
export async function api(path, { method = 'GET', body, payToken } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (payToken) headers['X-Pay-Token'] = payToken;
  else if (session.token) headers.Authorization = `Bearer ${session.token}`;

  let res;
  try {
    res = await fetch(apiUrl(path), { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(OFFLINE);
  }
  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && !payToken && session.token) {
    logout(true);
    throw new ApiError('Your session has ended. Please sign in again.', 401);
  }
  if (!res.ok) throw new ApiError(friendly(res.status, data.message), res.status);
  return data;
}

/* ---------- formatting ---------- */
export const kes = (n) => `KES ${Number(n ?? 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

const asDate = (d) => (typeof d === 'string' && d.length === 10 ? new Date(`${d}T00:00:00`) : new Date(d));

export const fmtDate = (d) =>
  d ? asDate(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

export const fmtDateTime = (d) =>
  d ? asDate(d).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

export function ago(d, now = Date.now()) {
  const s = Math.max(0, Math.round((now - asDate(d).getTime()) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return fmtDate(d);
}

export const initials = (name) =>
  String(name ?? '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';

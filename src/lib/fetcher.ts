/** 客户端调用自家 API 的薄封装：统一解包 {ok,data} / {ok:false,error}。 */

import { BASE_PATH, withBase } from '@/lib/base-path';

export class ApiError extends Error {
  status: number;
  /** 服务端给的机器可读原因，401 时是 'unauthenticated' */
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(`服务器返回了非 JSON 响应（HTTP ${res.status}）`, res.status);
  }
  const payload = json as { ok?: boolean; data?: T; error?: string; code?: string };
  if (!res.ok || payload?.ok === false) {
    throw new ApiError(payload?.error || `请求失败（HTTP ${res.status}）`, res.status, payload?.code);
  }
  return payload.data as T;
}

/* ---------- 登录态过期的自动续期 ---------- */

/**
 * 正在跑的续期请求。
 *
 * 一个页面常常同时发好几个请求（首屏就有 dashboard 那几个），
 * 过期时它们会一起撞上 401。没有这个去重，就会并发打好几次 /api/auth/refresh，
 * 而上游的 refresh token 是轮换的 —— 并发续期里只有一个能拿到新票据，
 * 其余几个反而会把刚发下来的那份作废，结果是「一刷新就掉线」。
 */
let renewing: Promise<boolean> | null = null;

function renew(): Promise<boolean> {
  renewing ??= fetch(withBase('/api/auth/refresh'), { method: 'POST', cache: 'no-store' })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      renewing = null;
    });
  return renewing;
}

/** 去登录页，并记下现在这一页好登录后跳回来。 */
function toLogin(): void {
  if (typeof window === 'undefined') return;
  const here = location.pathname.slice(BASE_PATH.length) + location.search;
  const target = withBase(`/login?next=${encodeURIComponent(here || '/')}`);
  // 已经在登录页就别再跳了，否则会连环刷新
  if (location.pathname === withBase('/login')) return;
  location.assign(target);
}

/**
 * 发一次请求；如果是因为登录态过期失败，续期后再发一次。
 *
 * 只对 code === 'unauthenticated' 重试。别的 401（比如上游把账号停用了）
 * 重试也是同样的结果，重复打上游没意义。
 */
async function request<T>(path: string, init: RequestInit, retry = true): Promise<T> {
  const res = await fetch(withBase(path), init);
  try {
    return await unwrap<T>(res);
  } catch (err) {
    if (!retry || !(err instanceof ApiError) || err.code !== 'unauthenticated') throw err;
    if (await renew()) return request<T>(path, init, false);
    toLogin();
    throw err;
  }
}

/**
 * 子路径部署时，调用处写的 '/api/xxx' 得补上前缀才打得到人。
 * 统一在这几个函数里做，调用处一律照旧写相对根的路径。
 */
export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, { ...init, method: 'GET', cache: 'no-store' });
}

export async function apiPost<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return request<T>(path, {
    ...init,
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    body: JSON.stringify(body ?? {}),
  });
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

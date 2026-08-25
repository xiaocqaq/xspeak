/** 客户端调用自家 API 的薄封装：统一解包 {ok,data} / {ok:false,error}。 */

import { withBase } from '@/lib/base-path';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(`服务器返回了非 JSON 响应（HTTP ${res.status}）`, res.status);
  }
  const payload = json as { ok?: boolean; data?: T; error?: string };
  if (!res.ok || payload?.ok === false) {
    throw new ApiError(payload?.error || `请求失败（HTTP ${res.status}）`, res.status);
  }
  return payload.data as T;
}

/**
 * 子路径部署时，调用处写的 '/api/xxx' 得补上前缀才打得到人。
 * 统一在这三个函数里做，调用处一律照旧写相对根的路径。
 */
export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(withBase(path), { ...init, method: 'GET', cache: 'no-store' });
  return unwrap<T>(res);
}

export async function apiPost<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(withBase(path), {
    ...init,
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    body: JSON.stringify(body ?? {}),
  });
  return unwrap<T>(res);
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(withBase(path), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return unwrap<T>(res);
}

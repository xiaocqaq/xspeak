/**
 * 鉴权的类型门面 + Next 侧的 cookie 读写。
 *
 * 运行时逻辑在同目录的三个 .mjs 里（server.mjs 和 WebSocket 中转层要用，
 * 见 config.mjs 的头注释）。这里补类型，并加上只有 Next 环境才有的部分：
 * cookies() 读写、basePath 作用域、以及「令牌快过期了自动续期」。
 */

import { cookies } from 'next/headers';
import {
  authConfig as rawConfig,
  isAllowed as rawIsAllowed,
  isAdminUser as rawIsAdminUser,
} from './config.mjs';
import {
  login as rawLogin,
  verify2fa as rawVerify2fa,
  refresh as rawRefresh,
  me as rawMe,
  logout as rawLogout,
  AuthUpstreamError,
} from './upstream.mjs';
import {
  identityFromToken as rawIdentityFromToken,
  tokenFromCookieHeader as rawTokenFromCookieHeader,
  parseCookies as rawParseCookies,
  forgetSession as rawForgetSession,
} from './session.mjs';
import { BASE_PATH } from '@/lib/base-path';

export type AuthConfig = {
  /** 配了 AUTH_UPSTREAM_URL 才算开启；没配就是单人模式 */
  enabled: boolean;
  upstreamUrl: string | undefined;
  cookiePrefix: string;
  sessionCookie: string;
  refreshCookie: string;
  /** 空数组 = 全放行 */
  allowUsers: string[];
  /** 空数组 = 没有管理员（注意和 allowUsers 相反，空不是全放行） */
  adminUsers: string[];
  /** 0 = 不接管历史档案 */
  adoptUserId: number;
  sessionTtlMs: number;
};

/** 上游身份，压到 xSpeak 只关心的字段。 */
export type Identity = {
  externalId: string;
  publicId: string;
  username: string;
  email: string;
  displayName: string;
  status: string;
};

/** 登录 / 2FA / 续期共用的返回结构。 */
export type LoginResult = {
  twoFactorRequired: boolean;
  challengeToken: string | null;
  verificationMethods: string[];
  accessToken: string | null;
  expiresAt: string | null;
  sessionId: string | null;
  refreshCookie: string | null;
  user: Identity | null;
};

export const authConfig = rawConfig as () => AuthConfig;
export const isAllowed = rawIsAllowed as (
  identity: { username?: string; email?: string },
  allow: string[],
) => boolean;
export const isAdminUser = rawIsAdminUser as (
  identity: { username?: string; email?: string },
  admins: string[],
) => boolean;

export const login = rawLogin as (username: string, password: string) => Promise<LoginResult>;
export const verify2fa = rawVerify2fa as (
  challengeToken: string,
  code: string,
) => Promise<LoginResult>;
export const refreshUpstream = rawRefresh as (refreshCookie: string) => Promise<LoginResult>;
export const fetchMe = rawMe as (token: string) => Promise<Identity | null>;
export const logoutUpstream = rawLogout as (token: string) => Promise<void>;

export const identityFromToken = rawIdentityFromToken as (
  token: string | null,
) => Promise<Identity | null>;
export const tokenFromCookieHeader = rawTokenFromCookieHeader as (
  header: string | null | undefined,
) => string | null;
export const parseCookies = rawParseCookies as (
  header: string | null | undefined,
) => Record<string, string>;
export const forgetSession = rawForgetSession as (token: string | null) => void;

export { AuthUpstreamError };

/**
 * cookie 的作用域。
 *
 * 必须是 BASE_PATH 而不是 '/' —— xlearn 挂在共享域名的子路径下
 * （test.xlingo.fun/xlearn），path 写 '/' 会把会话 cookie 发给同域下别人的站。
 * 和 next.config.ts 里 Service-Worker-Allowed 只给到 basePath 是同一个道理。
 */
function cookiePath(): string {
  return BASE_PATH || '/';
}

/** 令牌快过期时提前续期的余量：剩不到 5 分钟就换。 */
const RENEW_MARGIN_MS = 5 * 60 * 1000;

function expiresSoon(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return false;
  return t - Date.now() < RENEW_MARGIN_MS;
}

/**
 * 把登录结果写进 cookie。
 *
 * 三个 cookie：
 * - session：accessToken，httpOnly。真正的凭证
 * - refresh：上游的 refresh cookie 原文，httpOnly。续期时原样发回上游
 * - expires：accessToken 到期时间，**不是** httpOnly ——
 *   只是给客户端判断「要不要提前续期」的提示，泄露它没有任何后果
 *
 * secure 按实际协议给：本地 http 开发时写 secure 会让 cookie 根本存不下来。
 */
export async function writeSession(result: LoginResult, secure: boolean): Promise<void> {
  const cfg = authConfig();
  const jar = await cookies();
  const path = cookiePath();
  const base = { httpOnly: true, sameSite: 'lax' as const, secure, path };

  if (result.accessToken) {
    jar.set(cfg.sessionCookie, result.accessToken, {
      ...base,
      // 不给 maxAge：做成会话 cookie，关掉浏览器就没了。
      // 真正的有效期由上游的 token 决定，这里再叠一层过期只会让两边不同步。
    });
  }
  if (result.refreshCookie) {
    jar.set(cfg.refreshCookie, result.refreshCookie, { ...base });
  }
}

/** 清掉本地会话 cookie。上游那边由调用方另外通知。 */
export async function clearSession(): Promise<void> {
  const cfg = authConfig();
  const jar = await cookies();
  const path = cookiePath();
  for (const name of [cfg.sessionCookie, cfg.refreshCookie]) {
    // 删的时候 path 必须和写的时候一致，否则浏览器认为是另一个 cookie，删不掉
    jar.set(name, '', { httpOnly: true, sameSite: 'lax', path, maxAge: 0 });
  }
}

/** 当前请求的会话令牌（可能已过期，校验在 identityFromToken）。 */
export async function sessionToken(): Promise<string | null> {
  const cfg = authConfig();
  const jar = await cookies();
  const v = jar.get(cfg.sessionCookie)?.value;
  return v && v.trim() ? v.trim() : null;
}

async function refreshCookieValue(): Promise<string | null> {
  const cfg = authConfig();
  const jar = await cookies();
  const v = jar.get(cfg.refreshCookie)?.value;
  return v && v.trim() ? v.trim() : null;
}

/**
 * 当前请求的身份，null = 没登录。
 *
 * 只读不写 —— Server Component 里不能改 cookie，所以这里**不做续期**。
 * 续期由 /api/auth/refresh 这条路由负责（见那边的注释）。
 */
export async function currentIdentity(): Promise<Identity | null> {
  const cfg = authConfig();
  if (!cfg.enabled) return null;
  return identityFromToken(await sessionToken());
}

/**
 * 当前请求是不是管理员。
 *
 * 鉴权没开就一律算是 —— 那是单人模式，跑在自己机器上，
 * 这时候要求"管理员"只会把唯一的使用者锁在模型设置外面。
 * 开了鉴权就必须在 AUTH_ADMIN_USERS（缺省退回 AUTH_ALLOW_USERS）里。
 */
export async function isAdmin(): Promise<boolean> {
  const cfg = authConfig();
  if (!cfg.enabled) return true;
  const identity = await currentIdentity();
  return Boolean(identity && isAdminUser(identity, cfg.adminUsers));
}

/**
 * 用 refresh cookie 换新令牌并落盘。
 *
 * 只能在 Route Handler 里调 —— 要写 cookie。
 * 上游会轮换 refresh token，所以拿到的新 cookie 必须存回去，
 * 否则下一次续期会因为「refresh_token_hash_mismatch」失败。
 *
 * @returns 新身份，或 null（没 refresh cookie / 上游拒绝）
 */
export async function renewSession(secure: boolean): Promise<Identity | null> {
  const cfg = authConfig();
  if (!cfg.enabled) return null;
  const rc = await refreshCookieValue();
  if (!rc) return null;

  const old = await sessionToken();
  let result: LoginResult;
  try {
    result = await refreshUpstream(rc);
  } catch {
    return null;
  }
  if (!result.accessToken || !result.user) return null;
  if (result.user.status && result.user.status !== 'active') return null;
  if (!isAllowed(result.user, cfg.allowUsers)) return null;

  forgetSession(old);
  await writeSession(result, secure);
  return result.user;
}

/** 令牌是不是快到期了 —— 供客户端决定要不要主动打续期接口。 */
export { expiresSoon };

/**
 * 当前请求是不是 https —— 决定 cookie 要不要带 secure。
 *
 * 生产是 nginx 反代到 127.0.0.1，进程自己看到的永远是 http，
 * 所以只能信 X-Forwarded-Proto。本地开发没有这个头，走 http，
 * 于是 cookie 不带 secure —— 否则浏览器会直接丢掉它，
 * 表现成「登录接口返回成功但下一个请求还是没登录」，非常难查。
 */
export function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get('x-forwarded-proto');
  if (proto) return proto.split(',')[0].trim() === 'https';
  try {
    return new URL(req.url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 上游身份服务（xiaoai-chat）的客户端。
 *
 * 只包这五个端点，全部是 `{errorMsg, errorCode, data}` 信封：
 *
 *   POST /api/v1/auth/login       {username, password} → LoginResponse
 *   POST /api/v1/auth/2fa/verify  {challengeToken, code} → LoginResponse
 *   POST /api/v1/auth/refresh     （无 body，靠 refresh cookie）→ LoginResponse
 *   GET  /api/v1/me               Bearer → {user}
 *   POST /api/v1/auth/logout      Bearer → ok
 *
 * ── 实测约束（2026-08-25 探测上游二进制里的 swagger + 活体探测）──
 *
 * 1. 字段名是 `username`，但**用户名和邮箱都走这一个字段**（上游 login-options
 *    同时开着 usernameEnabled 和 emailEnabled）。别自作聪明加 email 字段，会被
 *    校验成「username is required」。
 * 2. 上游校验规则：username ≥ 3，password ≥ 6。前端先挡一遍，省一次往返。
 * 3. 登录成功**不发 Set-Cookie 给我们要的 accessToken** —— token 在响应体里。
 *    但 refresh token 是上游自己的 httpOnly cookie（deeix_chat_refresh_token），
 *    发在 Set-Cookie 上。xSpeak 和上游不同域，浏览器拿不到那个 cookie，
 *    所以代理登录时要把它从上游响应里抠出来自己存，续期时再原样带回去。
 * 4. `POST /api/v1/auth/2fa/verify` 在 swagger 里**没有**（漏了 swag 注解），
 *    但路由真实存在。challengeToken ≥ 20，code ≥ 6。
 * 5. accessToken 的有效期是上游的数据库设置（token_ttl_hours），不是固定值，
 *    所以别写死 —— 登录响应里的 `expiresAt` 才是真的，照它算续期时机。
 * 6. 登录返回 `twoFactorRequired: true` 时 accessToken 是空的，必须先过 2FA。
 *    漏了这个分支，哪天有人开了 2FA 就会拿到一个空 token 然后白屏。
 */

import { authConfig } from './config.mjs';

/** 上游 API 前缀。 */
const API = '/api/v1';

/** 网络层超时：上游挂了不能把 xSpeak 一起拖死。 */
const TIMEOUT_MS = 10_000;

export class AuthUpstreamError extends Error {
  /**
   * @param {string} message 给用户看的中文文案
   * @param {number} status HTTP 状态码，0 = 根本没连上
   * @param {string} [code] 上游的 errorCode，用于区分「密码错」和「被封禁」
   */
  constructor(message, status, code) {
    super(message);
    this.name = 'AuthUpstreamError';
    this.status = status;
    this.code = code;
  }
}

/** 上游 errorCode → 中文。不认的就原样透传 errorMsg。 */
const MESSAGES = {
  'auth.invalid_credentials': '账号或密码不对。',
  'auth.invalid_token': '登录已过期，请重新登录。',
  'auth.account_disabled': '这个账号已被停用。',
  'auth.account_locked': '账号已被锁定，请稍后再试或联系管理员。',
  'auth.too_many_attempts': '尝试次数过多，请等几分钟再试。',
  'auth.invalid_2fa_code': '两步验证码不对。',
  'request.invalid_body': '提交的内容不完整。',
};

function baseUrl() {
  const cfg = authConfig();
  if (!cfg.upstreamUrl) {
    throw new AuthUpstreamError('服务端没配 AUTH_UPSTREAM_URL。', 0);
  }
  return cfg.upstreamUrl;
}

/**
 * 打一次上游，解开信封。
 *
 * @param {string} path API 路径（不含 /api/v1）
 * @param {{method?: string, body?: unknown, token?: string, cookie?: string}} [opts]
 * @returns {Promise<{data: any, setCookie: string[]}>}
 */
async function call(path, opts = {}) {
  const url = `${baseUrl()}${API}${path}`;
  const headers = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.cookie = opts.cookie;

  let res;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // 上游是自己机器上的服务，不要走任何缓存
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch (err) {
    // DNS / 连接被拒 / 超时都到这里。status = 0 让调用方能区分「上游挂了」。
    throw new AuthUpstreamError(
      '登录服务连不上（超时或拒绝连接）。',
      0,
      err instanceof Error ? err.name : undefined,
    );
  }

  const text = await res.text();
  /** @type {any} */
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // 上游返回 HTML 说明打到了它的前端兜底路由，不是 API —— 地址配错了
    throw new AuthUpstreamError(
      `登录服务返回了非 JSON 响应（HTTP ${res.status}），检查 AUTH_UPSTREAM_URL 是否指向 API 根。`,
      res.status,
    );
  }

  if (!res.ok) {
    const code = typeof json?.errorCode === 'string' ? json.errorCode : undefined;
    const msg =
      (code && MESSAGES[code]) ||
      (typeof json?.errorMsg === 'string' && json.errorMsg) ||
      `登录服务返回 HTTP ${res.status}`;
    throw new AuthUpstreamError(msg, res.status, code);
  }

  // getSetCookie() 是 undici 的标准方法；老运行时没有就退回单值
  const setCookie =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);

  return { data: json?.data ?? null, setCookie };
}

/**
 * 上游的 AuthUserResponse 压成 xSpeak 只关心的几个字段。
 *
 * 上游那个结构有三十多个字段（订阅、余额、外观偏好……），全存下来只会在
 * 它改字段时把 xSpeak 一起拖坏。这里只留身份必需的：
 * - id: 稳定数字主键，用来关联本地档案
 * - publicID: 对外的不透明 id，写日志用（别把数字 id 打到日志里）
 * - username/email/displayName: 显示和白名单匹配
 * - status: 上游封禁了要挡掉
 *
 * @param {any} user
 * @returns {{
 *   externalId: string, publicId: string, username: string,
 *   email: string, displayName: string, status: string,
 * } | null}
 */
export function normalizeUser(user) {
  if (!user || typeof user !== 'object') return null;
  const id = user.id;
  // 0 和空串都不是有效身份 —— 宁可当没登录，也不能落到一条错档案上
  if (id === undefined || id === null || String(id).trim() === '' || Number(id) === 0) return null;
  const username = String(user.username ?? '').trim();
  return {
    externalId: String(id),
    publicId: String(user.publicID ?? user.publicId ?? '').trim(),
    username,
    email: String(user.email ?? '').trim(),
    displayName: String(user.displayName ?? '').trim() || username || '学习者',
    status: String(user.status ?? '').trim().toLowerCase(),
  };
}

/**
 * LoginResponse 归一化。登录和 2FA 校验和续期都返回同一个结构。
 *
 * @param {any} data
 * @param {string[]} setCookie
 */
function normalizeLogin(data, setCookie) {
  const twoFactorRequired = Boolean(data?.twoFactorRequired);
  return {
    twoFactorRequired,
    challengeToken: String(data?.twoFactorChallengeToken ?? '') || null,
    verificationMethods: Array.isArray(data?.verificationMethods) ? data.verificationMethods : [],
    accessToken: String(data?.accessToken ?? '') || null,
    expiresAt: String(data?.expiresAt ?? '') || null,
    sessionId: String(data?.sessionID ?? data?.sessionId ?? '') || null,
    // 上游的 refresh cookie 原样留着，续期时要带回去
    refreshCookie: pickRefreshCookie(setCookie),
    user: normalizeUser(data?.user),
  };
}

/**
 * 从上游的 Set-Cookie 里挑出 refresh token，拼成能直接当 Cookie 头发回去的
 * `name=value` 形式。
 *
 * 名字不写死成 deeix_chat_refresh_token：上游改前缀的话按 `refresh` 关键字也能认出来。
 *
 * @param {string[]} setCookie
 * @returns {string | null}
 */
function pickRefreshCookie(setCookie) {
  for (const raw of setCookie) {
    if (typeof raw !== 'string') continue;
    const pair = raw.split(';', 1)[0].trim();
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (!value || value === 'deleted') continue;
    if (/refresh/i.test(name)) return pair;
  }
  return null;
}

/**
 * 账号密码登录。username 字段同时接受用户名和邮箱。
 *
 * 返回 `twoFactorRequired: true` 时 accessToken 是 null，调用方必须接着走 verify2fa。
 */
export async function login(username, password) {
  const { data, setCookie } = await call('/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  return normalizeLogin(data, setCookie);
}

/** 两步验证。challengeToken 来自 login() 的返回。 */
export async function verify2fa(challengeToken, code) {
  const { data, setCookie } = await call('/auth/2fa/verify', {
    method: 'POST',
    body: { challengeToken, code },
  });
  return normalizeLogin(data, setCookie);
}

/**
 * 用 refresh cookie 换一对新令牌。
 *
 * 上游会轮换 refresh token（存了 previous_refresh_token_hash 做宽限），
 * 所以每次续期都要把返回的新 cookie 存回去，否则下一次续期就失效了。
 *
 * @param {string} refreshCookie `name=value` 形式
 */
export async function refresh(refreshCookie) {
  const { data, setCookie } = await call('/auth/refresh', {
    method: 'POST',
    cookie: refreshCookie,
  });
  return normalizeLogin(data, setCookie);
}

/**
 * 拿 token 换身份。这是**唯一**的令牌校验方式：token 假的、过期的、
 * 或者用户已被上游封禁/登出，这里都会 401。
 */
export async function me(token) {
  const { data } = await call('/me', { token });
  return normalizeUser(data?.user);
}

/** 通知上游注销这条会话。失败不影响本地登出，调用方吞掉异常即可。 */
export async function logout(token) {
  await call('/auth/logout', { method: 'POST', token });
}

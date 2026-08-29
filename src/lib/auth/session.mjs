/**
 * 会话解析：cookie → 上游身份。
 *
 * 放在 .mjs 里是因为 WebSocket 中转层要用 —— 浏览器发 WS 握手时**不能自定义
 * 请求头**，所以畅聊那条连接没法带 Authorization，只能靠 cookie。中转层跑在
 * server.mjs 里（Next 编译流程之外），拿不到 next/headers，只能自己从
 * `req.headers.cookie` 里抠。两边共用这一份解析和校验逻辑。
 *
 * 缓存：每次请求都打一次上游 /me 太浪费（内网 0.6ms，走域名 350ms），
 * 但也不能长缓存 —— 上游封禁/登出后本地还认就成了安全洞。折中是 60 秒，
 * 可用 AUTH_SESSION_TTL_MS 调。缓存键是 token 的 SHA-256，不是 token 本身：
 * 进程内存里不留明文令牌。
 */

import { createHash } from 'node:crypto';
import { authConfig, isAllowed } from './config.mjs';
import { me } from './upstream.mjs';

/** @type {Map<string, {identity: any, at: number}>} */
const cache = new Map();

/** 缓存条数上限。到顶就整体清掉 —— 单人到几十人的量级，不值得引 LRU。 */
const CACHE_MAX = 500;

function hash(token) {
  return createHash('sha256').update(token).digest('hex');
}

/** 令牌变了（重新登录、续期）就该失效旧的缓存条目。 */
export function forgetSession(token) {
  if (token) cache.delete(hash(token));
}

export function clearSessionCache() {
  cache.clear();
}

/**
 * 解析 Cookie 头。
 *
 * 不用第三方库：格式就是 `a=b; c=d`，值里可能有 URL 编码（Next 的 cookies()
 * 会自动解，手写这条路得自己解）。
 *
 * @param {string | undefined | null} header
 * @returns {Record<string, string>}
 */
export function parseCookies(header) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue; // 同名取第一个，和浏览器行为一致
    const raw = part.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw; // 不是合法编码就原样用
    }
  }
  return out;
}

/**
 * 从 Cookie 头里取出 xSpeak 的会话令牌。
 *
 * @param {string | undefined | null} cookieHeader
 * @returns {string | null}
 */
export function tokenFromCookieHeader(cookieHeader) {
  const cfg = authConfig();
  const token = parseCookies(cookieHeader)[cfg.sessionCookie];
  return token && token.trim() ? token.trim() : null;
}

/**
 * 校验令牌，拿到上游身份。
 *
 * 三种返回：
 * - 身份对象：令牌有效、账号正常、在白名单里
 * - null：令牌无效/过期，或账号被上游停用，或不在白名单 —— 一律当没登录
 *
 * 校验失败**不缓存**：否则上游刚恢复的账号还要等一个 TTL 才能进来。
 *
 * @param {string | null} token
 */
export async function identityFromToken(token) {
  if (!token) return null;
  const cfg = authConfig();
  if (!cfg.enabled) return null;

  const key = hash(token);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < cfg.sessionTtlMs) return hit.identity;

  let identity;
  try {
    identity = await me(token);
  } catch {
    // 令牌无效是 401；上游挂了是 status 0。两种都当没登录 ——
    // 上游挂了的时候放行才是真问题（等于鉴权被一次网络故障绕过）。
    cache.delete(key);
    return null;
  }

  if (!identity) return null;
  // 上游把账号停用/封禁了就别放进来。'active' 之外一概挡掉。
  if (identity.status && identity.status !== 'active') return null;
  if (!isAllowed(identity, cfg.allowUsers)) return null;

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, { identity, at: Date.now() });
  return identity;
}

/**
 * 中转层用：从 WS 握手请求上认人。
 *
 * @param {{headers: Record<string, any>}} req
 */
export async function identityFromRequest(req) {
  return identityFromToken(tokenFromCookieHeader(req?.headers?.cookie));
}

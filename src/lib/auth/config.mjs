/**
 * 鉴权配置。
 *
 * 身份不自己做 —— 复用同一台机器上已有的 xiaoai-chat（ai.xlingo.fun）。
 * 那边有完整的账号体系（用户名/邮箱登录、2FA、会话管理），但它**不是** OAuth/OIDC
 * 提供方（`/.well-known/openid-configuration` 是前端 SPA 的兜底 HTML，不是真端点），
 * 所以只能走「代理登录 + 令牌校验」这条路：
 *
 *   1. 用户在 xSpeak 的登录页填账号密码
 *   2. xSpeak 服务端转发给上游 POST /api/v1/auth/login
 *   3. 拿到 accessToken，装进 xSpeak 自己的 httpOnly cookie
 *   4. 之后每次请求拿这个 token 去问上游 GET /api/v1/me 换身份
 *
 * 关键取舍：**校验走 /me，不在本地验 JWT**。本地验签要拿上游的 JWT_SECRET，
 * 那是别人服务的密钥，xSpeak 不该持有；而且用户被上游封禁/登出后本地验签照样通过。
 * 代价是每次请求多一跳，用 60 秒的进程内缓存摊掉（见 session.mjs）。
 *
 * 这个文件是 .mjs：server.mjs 和 WebSocket 中转层跑在 Next 编译流程之外，
 * 用不了 TS 和 `@/` 别名，但它们也要校验连接身份，所以运行时逻辑放这里两边共享，
 * TS 侧的类型门面在同目录 config.ts。和 voice/config.mjs 是同一个理由。
 *
 * 环境变量：
 *
 *   AUTH_UPSTREAM_URL     上游地址。**不配就等于关掉鉴权**，退回单人模式（固定 id=1）
 *   AUTH_COOKIE_PREFIX    cookie 名前缀，默认 xspeak（小写 —— cookie 名区分大小写）
 *   AUTH_ALLOW_USERS      白名单，逗号分隔，匹配用户名或邮箱，不分大小写。
 *                         留空 = 谁都能进 —— 上游开着邮箱自助注册，留空就意味着
 *                         任何人注册完都能在这里领一份档案
 *   AUTH_ADOPT_USER_ID    首个登录者接管哪条历史档案，默认 1；填 0 或 off 关掉
 *   AUTH_SESSION_TTL_MS   /me 校验结果的缓存时长，默认 60000
 *   AUTH_ADMIN_USERS      管理员，逗号分隔，匹配用户名或邮箱，不分大小写。
 *                         只有管理员能看和改「用哪个模型」——那是全站设置。
 *                         留空则退回 AUTH_ALLOW_USERS（白名单本身就是"自己人"名单）；
 *                         两个都留空 = 没有管理员，谁都改不了，只能改 .env.local
 */

/** 读环境变量，空串当没配。 */
function env(name) {
  const v = process.env[name];
  const t = typeof v === 'string' ? v.trim() : '';
  return t || undefined;
}

/** 上游地址：去掉结尾斜杠，避免拼出 `//api/v1/...`。 */
function upstream() {
  const raw = env('AUTH_UPSTREAM_URL');
  return raw ? raw.replace(/\/+$/, '') : undefined;
}

/** 逗号分隔的名单，统一小写去空。 */
function nameList(varName) {
  const raw = env(varName);
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function allowList() {
  return nameList('AUTH_ALLOW_USERS');
}

/**
 * 管理员名单。
 *
 * 没单独配就退回白名单 —— 现有部署里 AUTH_ALLOW_USERS 写的就是自己人，
 * 加这个变量不该让人先被锁在模型设置外面。
 *
 * 但白名单也空的时候**不能**跟着"空=全放行"：上游开着邮箱自助注册，
 * 那等于把全站模型设置交给任何注册用户。所以这种情况返回空名单，
 * 语义是"没有管理员"，界面上会说清楚要配 AUTH_ADMIN_USERS。
 */
function adminList() {
  const own = nameList('AUTH_ADMIN_USERS');
  return own.length ? own : allowList();
}

function adoptUserId() {
  const raw = env('AUTH_ADOPT_USER_ID');
  if (raw === undefined) return 1;
  if (/^(0|off|no|false)$/i.test(raw)) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function ttlMs() {
  const n = Number.parseInt(env('AUTH_SESSION_TTL_MS') ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 60_000;
}

/**
 * 当前鉴权配置。每次调用重读环境变量，不缓存 —— 和 voiceConfig() 同理，
 * 读几个字符串的开销远小于一次网络往返，换来的是改完 .env.local 重启即生效。
 *
 * @returns {{
 *   enabled: boolean,
 *   upstreamUrl: string | undefined,
 *   cookiePrefix: string,
 *   sessionCookie: string,
 *   refreshCookie: string,
 *   allowUsers: string[],
 *   adminUsers: string[],
 *   adoptUserId: number,
 *   sessionTtlMs: number,
 * }}
 */
export function authConfig() {
  const prefix = env('AUTH_COOKIE_PREFIX') ?? 'xspeak';
  const url = upstream();
  return {
    enabled: Boolean(url),
    upstreamUrl: url,
    cookiePrefix: prefix,
    sessionCookie: `${prefix}_session`,
    refreshCookie: `${prefix}_refresh`,
    allowUsers: allowList(),
    adminUsers: adminList(),
    adoptUserId: adoptUserId(),
    sessionTtlMs: ttlMs(),
  };
}

/**
 * 这个上游账号能不能用 xSpeak。
 *
 * 白名单为空就全放行。注意上游开着邮箱自助注册，所以「全放行」是真的全放行。
 *
 * @param {{username?: string, email?: string}} identity
 * @param {string[]} allow
 */
export function isAllowed(identity, allow) {
  if (!allow.length) return true;
  return onList(identity, allow);
}

/** 名单命中判断，用户名或邮箱任一匹配即可。 */
function onList(identity, list) {
  const u = (identity.username ?? '').toLowerCase();
  const e = (identity.email ?? '').toLowerCase();
  return Boolean((u && list.includes(u)) || (e && list.includes(e)));
}

/**
 * 这个账号是不是管理员。
 *
 * 和 isAllowed 的关键区别：**空名单一律不放行**。
 * 「没配名单」在白名单那边是"先能用起来"，在这里必须是"先别给权限" ——
 * 全站模型设置改错了所有人都受影响，宁可让人去改 .env.local。
 *
 * 鉴权本身没开（单人模式）的情况不走这里，见 config.ts 侧的 isAdmin。
 *
 * @param {{username?: string, email?: string}} identity
 * @param {string[]} admins
 */
export function isAdminUser(identity, admins) {
  if (!admins.length) return false;
  return onList(identity, admins);
}

/** 没配上游地址时的统一提示。 */
export const AUTH_DISABLED_MESSAGE =
  '服务端没配 AUTH_UPSTREAM_URL，当前是单人模式，不需要登录。';

/** 上游连不上时的统一提示：区别于「密码错」，避免用户反复试密码。 */
export const UPSTREAM_DOWN_MESSAGE = '登录服务暂时连不上，请稍后再试。';

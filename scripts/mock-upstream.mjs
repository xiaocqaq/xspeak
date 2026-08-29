/**
 * 假的账号服务，只为跑测试用。
 *
 * 为什么要它：鉴权链路的另一半在 ai.xlingo.fun 上，那是别人的生产服务 ——
 * 为了测自己的代码去那边注册账号是不该有的副作用。所以照着它的契约
 * （信封格式、字段名、Set-Cookie 行为、2FA 的两段式）搓一个本地替身，
 * 把 AUTH_UPSTREAM_URL 指过来就能把完整流程跑通：登录 → 拿档案 → 续期 → 登出。
 *
 * 契约来自真实服务：`{errorMsg, errorCode, details, requestId, data}` 信封、
 * `POST /api/v1/auth/login {username,password}`、`GET /api/v1/me` 带 Bearer、
 * refresh token 走 httpOnly cookie 且每次续期都轮换。
 *
 * 用法：
 *   node scripts/mock-upstream.mjs                 # 听 127.0.0.1:19999
 *   PORT=19999 MOCK_2FA=1 node scripts/mock-upstream.mjs   # 让登录走两步验证
 *
 * 只在测试里用。它不校验密码强度、不限流、令牌就是明文串 —— 别拿去当真东西。
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number.parseInt(process.env.PORT ?? '19999', 10);
const HOST = process.env.HOST ?? '127.0.0.1';
const WANT_2FA = process.env.MOCK_2FA === '1';

/** 预置账号。密码就是用户名 + 「-pass」。 */
const USERS = [
  { id: 7001, publicID: 'pub_alice', username: 'alice', email: 'alice@example.com', displayName: '爱丽丝', status: 'active' },
  { id: 7002, publicID: 'pub_bob', username: 'bob', email: 'bob@example.com', displayName: '鲍勃', status: 'active' },
  { id: 7003, publicID: 'pub_carol', username: 'carol', email: 'carol@example.com', displayName: '卡罗尔', status: 'suspended' },
];

/** accessToken → user.id */
const access = new Map();
/** refreshToken → user.id */
const refreshes = new Map();
/** challengeToken → user.id */
const challenges = new Map();

const find = (login) => {
  const key = String(login ?? '').toLowerCase();
  return USERS.find((u) => u.username.toLowerCase() === key || u.email.toLowerCase() === key) ?? null;
};

const ok = (res, data) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ errorMsg: '', errorCode: '', details: null, requestId: randomUUID(), data }));
};

const err = (res, status, errorCode, errorMsg) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ errorMsg, errorCode, details: null, requestId: randomUUID(), data: null }));
};

/** 发一对新令牌，并把 refresh 塞进 httpOnly cookie（真服务就是这么做的）。 */
function issue(res, user, extra = {}) {
  const accessToken = `at_${user.id}_${randomUUID()}`;
  const refreshToken = `rt_${user.id}_${randomUUID()}`;
  access.set(accessToken, user.id);
  refreshes.set(refreshToken, user.id);
  res.setHeader('set-cookie', [
    `deeix_chat_refresh_token=${refreshToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
    // 掺一条无关 cookie：验证 pickRefreshCookie 真的在按名字挑，不是取第一条
    `deeix_chat_theme=dark; Path=/; Max-Age=2592000`,
  ]);
  ok(res, {
    accessToken,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    sessionID: `sess_${randomUUID()}`,
    twoFactorRequired: false,
    twoFactorChallengeToken: '',
    verificationMethods: [],
    user,
    ...extra,
  });
}

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve(null);
      }
    });
  });

const bearer = (req) => {
  const h = req.headers.authorization ?? '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
};

const cookieOf = (req, name) => {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return '';
};

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', `http://${req.headers.host}`).pathname;
  const method = req.method ?? 'GET';

  if (path === '/api/v1/auth/login' && method === 'POST') {
    const body = await readBody(req);
    if (!body) return err(res, 400, 'request.invalid_body', 'invalid body');
    if (String(body.username ?? '').length < 3 || String(body.password ?? '').length < 6) {
      return err(res, 422, 'request.invalid_body', 'validation failed');
    }
    const user = find(body.username);
    if (!user || body.password !== `${user.username}-pass`) {
      return err(res, 401, 'auth.invalid_credentials', 'invalid credentials');
    }
    if (user.status !== 'active') {
      // 真服务这里就是登录成功但 status 非 active，由调用方自己挡 —— 照抄这个行为
      return issue(res, user);
    }
    if (WANT_2FA) {
      const challengeToken = `ch_${randomUUID()}${randomUUID()}`;
      challenges.set(challengeToken, user.id);
      return ok(res, {
        accessToken: '',
        expiresAt: '',
        twoFactorRequired: true,
        twoFactorChallengeToken: challengeToken,
        verificationMethods: ['totp'],
        user: null,
      });
    }
    return issue(res, user);
  }

  if (path === '/api/v1/auth/2fa/verify' && method === 'POST') {
    const body = await readBody(req);
    const id = challenges.get(String(body?.challengeToken ?? ''));
    if (!id) return err(res, 401, 'auth.invalid_token', 'bad challenge');
    if (String(body?.code ?? '') !== '123456') {
      return err(res, 401, 'auth.invalid_2fa_code', 'bad code');
    }
    challenges.delete(body.challengeToken);
    return issue(res, USERS.find((u) => u.id === id));
  }

  if (path === '/api/v1/auth/refresh' && method === 'POST') {
    const token = cookieOf(req, 'deeix_chat_refresh_token');
    const id = refreshes.get(token);
    if (!id) return err(res, 401, 'auth.invalid_token', 'bad refresh token');
    // 轮换：旧的立刻作废，逼着调用方必须把新 cookie 存回去
    refreshes.delete(token);
    return issue(res, USERS.find((u) => u.id === id));
  }

  if (path === '/api/v1/me' && method === 'GET') {
    const id = access.get(bearer(req));
    if (!id) return err(res, 401, 'auth.invalid_token', 'bad token');
    return ok(res, { user: USERS.find((u) => u.id === id) });
  }

  if (path === '/api/v1/auth/logout' && method === 'POST') {
    const token = bearer(req);
    if (!access.delete(token)) return err(res, 401, 'auth.invalid_token', 'bad token');
    res.setHeader('set-cookie', 'deeix_chat_refresh_token=deleted; Path=/; Max-Age=0');
    return ok(res, { success: true });
  }

  err(res, 404, 'not_found', `no route for ${method} ${path}`);
});

server.listen(PORT, HOST, () => {
  console.log(`假账号服务  http://${HOST}:${PORT}${WANT_2FA ? '  （开了 2FA，验证码 123456）' : ''}`);
  console.log(`账号        ${USERS.map((u) => `${u.username}/${u.username}-pass${u.status === 'active' ? '' : `(${u.status})`}`).join('  ')}`);
});

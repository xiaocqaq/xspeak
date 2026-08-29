import { z } from 'zod';
import { HttpError, body, fail, handle } from '@/lib/api';
import {
  AuthUpstreamError,
  authConfig,
  isAllowed,
  isSecureRequest,
  login,
  verify2fa,
  writeSession,
  type LoginResult,
} from '@/lib/auth';
import { getOrCreateExternalUser } from '@/lib/db';

/**
 * 代理登录。
 *
 * 账号密码不落地 —— 转发给上游（ai.xlingo.fun）之后就丢掉，xSpeak 只留它换回来的令牌。
 * 上游要求 username ≥ 3、password ≥ 6，这里照抄，省一次白跑的往返。
 * username 字段同时接受用户名和邮箱，这是上游的行为，不是这里做的兼容。
 *
 * 两步验证是同一条路由的第二步：上游返回 twoFactorRequired 时 accessToken 是空的，
 * 客户端要带着 challengeToken + 验证码再打一次（走 verify2fa 分支）。
 * 漏掉这个分支的话，哪天有人开了 2FA 就会拿到空令牌然后白屏。
 */
export const dynamic = 'force-dynamic';

const Login = z.object({
  username: z.string().trim().min(3, '至少 3 个字符'),
  password: z.string().min(6, '至少 6 位'),
  /** 二次提交时带上，走 2FA 校验分支 */
  challengeToken: z.string().trim().min(20).optional(),
  code: z.string().trim().min(6, '验证码至少 6 位').optional(),
});

export async function POST(req: Request) {
  const cfg = authConfig();
  if (!cfg.enabled) {
    return fail('服务端没开鉴权（未配 AUTH_UPSTREAM_URL），不需要登录。', 400);
  }

  return handle(async () => {
    const input = await body(req, Login);

    let result: LoginResult;
    try {
      result =
        input.challengeToken && input.code
          ? await verify2fa(input.challengeToken, input.code)
          : await login(input.username, input.password);
    } catch (err) {
      if (err instanceof AuthUpstreamError) {
        // status 0 = 根本没连上上游，那是 502（我们这边的依赖挂了），不是 401
        throw new HttpError(err.message, err.status === 0 ? 502 : err.status);
      }
      throw err;
    }

    if (result.twoFactorRequired && !result.accessToken) {
      /* 不是错误，是流程的第二步。
       *
       * 白名单在这一步之前故意不查：上游这一步不返回 user，手里只有用户填的那个字符串，
       * 而 isAllowed 是按用户名「或」邮箱匹配的。拿填进来的字符串去比，会把「名单里记的是
       * 邮箱、人填的是用户名」这种情况判成没权限 —— 用误拦真人换一个状态码不值得。
       * 代价是名单外的账号会先拿到 challengeToken、验完码才在下面被 403 挡住。
       * 拦得住（第二步 result.user 有值），只是拦晚了，且会让填对密码的人知道
       * 「这号存在且开了 2FA」—— 这条上游登录接口本来就会说，不是这里新开的口子。 */
      return {
        twoFactorRequired: true as const,
        challengeToken: result.challengeToken,
        methods: result.verificationMethods,
      };
    }

    if (!result.accessToken || !result.user) {
      throw new HttpError('登录服务没有返回有效令牌。', 502);
    }
    if (result.user.status && result.user.status !== 'active') {
      throw new HttpError('这个账号当前不可用。', 403);
    }
    if (!isAllowed(result.user, cfg.allowUsers)) {
      throw new HttpError('这个账号没有使用 xSpeak 的权限。', 403);
    }

    // 先建/取本地档案再写 cookie：建档失败就不该让人看起来已经登录了
    const profile = await getOrCreateExternalUser(result.user, cfg.adoptUserId);
    await writeSession(result, isSecureRequest(req));

    return {
      twoFactorRequired: false as const,
      user: {
        name: profile.name,
        onboarded: Boolean(profile.onboarded),
        username: result.user.username,
        displayName: result.user.displayName,
      },
    };
  });
}

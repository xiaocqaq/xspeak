import { HttpError, handle } from '@/lib/api';
import { authConfig, isSecureRequest, renewSession } from '@/lib/auth';

/**
 * 续期。
 *
 * 为什么要单独一条路由，而不是在 currentUser() 里顺手续：
 * 续期必须写 cookie，而 Server Component 和普通 GET 路由里写不了（Next 只允许在
 * Route Handler 和 Server Action 里改 cookie）。更要紧的是上游会**轮换** refresh
 * token —— 换到的新值必须存回去，存不下来的话这次续期就把旧 token 也作废了，
 * 用户直接被踢下线。所以只在能确保写得下 cookie 的地方续。
 *
 * 调用时机由客户端决定：拿到带 code: 'unauthenticated' 的 401 时打一次这里，
 * 成功就重试原请求，失败就跳登录页。见 src/lib/fetcher.ts。
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle(async () => {
    const cfg = authConfig();
    if (!cfg.enabled) return { signedIn: true, user: null };

    const identity = await renewSession(isSecureRequest(req));
    if (!identity) {
      // 没 refresh cookie，或上游拒绝（token 轮换过、会话被注销、账号被停用）
      throw new HttpError('登录已过期，请重新登录。', 401, 'unauthenticated');
    }
    return {
      signedIn: true,
      user: { username: identity.username, displayName: identity.displayName },
    };
  });
}

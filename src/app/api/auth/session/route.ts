import { handle } from '@/lib/api';
import { authConfig, currentIdentity, isAdminUser } from '@/lib/auth';

/**
 * 当前登录状态。给顶栏显示用户名、以及登录页判断「已经登过了就别再登」用。
 *
 * 这条路由**不能**用 currentUser()：那个没登录会抛 401，而这里「没登录」
 * 本身就是一个正常答案。所以直接问 currentIdentity()。
 *
 * 也回 admin —— 设置页要靠它决定「用哪个模型」那张卡渲不渲染。
 * 前端拿这个只是为了不画一张点了就 403 的卡；真正拦住的是 /api/models
 * 自己那道 requireAdmin()，前端藏起来不算权限控制。
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const cfg = authConfig();
    if (!cfg.enabled) {
      // 单人模式：永远算已登录，前端就不会去显示登录/登出入口
      return { authEnabled: false, signedIn: true, admin: true, user: null };
    }
    const identity = await currentIdentity();
    return {
      authEnabled: true,
      signedIn: Boolean(identity),
      admin: Boolean(identity && isAdminUser(identity, cfg.adminUsers)),
      user: identity
        ? {
            username: identity.username,
            displayName: identity.displayName,
            email: identity.email,
          }
        : null,
    };
  });
}

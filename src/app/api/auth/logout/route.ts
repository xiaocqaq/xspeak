import { handle } from '@/lib/api';
import { clearSession, forgetSession, logoutUpstream, sessionToken } from '@/lib/auth';

/**
 * 登出。
 *
 * 顺序是「先通知上游，再清本地」，但上游失败**不阻止**本地登出 ——
 * 上游临时挂掉时如果连登出都做不到，用户会被困在一个自己都退不出的会话里。
 * 本地 cookie 清掉之后这台机器上就再也认不出这个令牌了。
 */
export const dynamic = 'force-dynamic';

export async function POST() {
  return handle(async () => {
    const token = await sessionToken();
    if (token) {
      try {
        await logoutUpstream(token);
      } catch {
        // 上游注销失败：本地照样退，令牌到期自然失效
      }
      // 缓存里那条校验结果也要扔掉，否则 TTL 内还认这个令牌
      forgetSession(token);
    }
    await clearSession();
    return { ok: true };
  });
}

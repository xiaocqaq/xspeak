import { z } from 'zod';
import { body, currentUser, handle, HttpError } from '@/lib/api';
import { AI_ROLES, modelCatalog, type AiRole } from '@/lib/ai/config';
import { modelSettings, setRoleModel } from '@/lib/ai/selection';
import { voiceConfig } from '@/lib/voice/config';
import { authConfig, isAdmin } from '@/lib/auth';

/**
 * 模型设置：可选清单 + 每个角色现在用哪个 + 语音那条线的现状。
 *
 * **仅管理员**。改的是全站设置，不是个人档案 —— 一个人换了 content 模型，
 * 所有人明天的内容都跟着变。读也一样限住：清单里有服务商和地址（origin，
 * 不含 key），普通用户没有必要知道这台机器接了谁。
 *
 * 谁是管理员看 AUTH_ADMIN_USERS，没配就退回 AUTH_ALLOW_USERS；
 * 鉴权整个没开（单人模式）时所有人都是。判定在 lib/auth 的 isAdmin()。
 *
 * 403 而不是 404：前端要靠这个把整张卡藏掉并说清原因（见 settings-page）。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * GET 和 PATCH 必须回同一个形状。
 *
 * 前端是 `setData(await apiPatch(...))` —— 整个状态换成响应体，
 * 所以少一个字段不是「这次少给一点」，是把已经渲染着的那部分抽走：
 * PATCH 以前只回 modelSettings()（catalog + roles，没有 voice），
 * 于是点一下换模型，语音那一块读 data.voice.ready 就炸，整张卡片消失，
 * 而库其实已经写成功了 —— 看起来像"点了没反应还把页面弄坏了"。
 */
async function payload() {
  const { catalog, roles } = await modelSettings();
  const voice = voiceConfig();
  return {
    catalog,
    roles,
    // 语音只读：realtime 那条线在一次通话里要连着上游，中途换模型没有意义，
    // 所以它只跟 .env.local。列出来是为了在页面上能确认配的是什么。
    voice: {
      provider: voice.provider,
      realtimeModel: voice.realtimeModel,
      ttsModel: voice.ttsModel,
      asrModel: voice.asrModel,
      ready: Boolean(voice.apiKey),
    },
  };
}

/**
 * 拦住非管理员。
 *
 * 先 currentUser() 是为了把「没登录」和「登了但不是管理员」分开：
 * 前者抛 401，前端会去续期或跳登录页；后者是 403，前端只是把卡藏掉。
 * 顺序反了的话未登录访客会拿到 403，然后既不跳登录页也不重试。
 *
 * 名单空着时（AUTH_ADMIN_USERS 和 AUTH_ALLOW_USERS 都没配）谁都不是管理员，
 * 提示里直接说该配哪个变量 —— 否则运维只看到一句"没有权限"，无从下手。
 */
async function requireAdmin(): Promise<void> {
  await currentUser();
  if (await isAdmin()) return;
  const cfg = authConfig();
  throw new HttpError(
    cfg.adminUsers.length
      ? '只有管理员能改模型设置。'
      : '还没指定管理员。在服务器的 .env.local 里配 AUTH_ADMIN_USERS，填你的用户名。',
    403,
    'forbidden',
  );
}

export async function GET() {
  return handle(async () => {
    await requireAdmin();
    return payload();
  });
}

const PatchBody = z.object({
  role: z.enum(AI_ROLES as [AiRole, ...AiRole[]]),
  /** null = 跟着配置文件走 */
  modelId: z.string().min(1).max(120).nullable(),
});

export async function PATCH(req: Request) {
  return handle(async () => {
    await requireAdmin();
    const input = await body(req, PatchBody);
    /*
     * 挑错模型是「请求不对」，不是「服务器坏了」：在这儿翻译成 400，
     * 免得每次点到一个没配 key 的选项都在日志里留一条 500 的堆栈。
     * setRoleModel 里那层校验保留着，它防的是别的调用方。
     */
    if (input.modelId !== null) {
      const hit = modelCatalog().find((m) => m.id === input.modelId);
      if (!hit) throw new HttpError(`没有这个模型：${input.modelId}`, 400);
      if (!hit.ready) throw new HttpError(`模型 ${input.modelId} 还没配密钥，选了也用不了`, 400);
    }
    await setRoleModel(input.role, input.modelId);
    return payload();
  });
}

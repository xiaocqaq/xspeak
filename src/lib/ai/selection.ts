import { getSetting, getSettings, setSetting } from '@/lib/repo/settings';
import {
  AI_ROLES,
  defaultModelId,
  modelCatalog,
  resolveModel,
  ROLE_LABELS,
  type AiRole,
  type ModelChoice,
  type ResolvedModel,
} from './config';

/**
 * 「哪个角色用哪个模型」这一层。
 *
 * 三个角色的分工没变（出题 / 对话 / 纠错），变的是每个角色用哪个模型可以在
 * 设置页里挑 —— 挑的范围就是 .env.local 里 AI_MODELS 列出来的那几项。
 *
 * 分成两层：
 * - config.mjs 只认环境变量，同步，server.mjs 启动时要用；
 * - 这里加一层库里的覆盖值，异步，应用代码走这一层。
 *
 * 选择存在 app_settings 表里，**全站一份**：它跟着的是 .env.local 里配的
 * 那份清单和密钥，换模型影响所有人的账单和出题质量，不是个人口味。
 */

/** app_settings 里的键名。 */
function keyFor(role: AiRole): string {
  return `model.${role}`;
}

/** 某个角色当前选的清单项 id；没选过返回 undefined（那就走配置文件）。 */
export async function selectedModelId(role: AiRole): Promise<string | undefined> {
  return getSetting(keyFor(role));
}

/**
 * 某个角色最终用哪个模型：先看库里的选择，再回落到配置文件。
 *
 * 库读不出来（比如库刚好挂了）不该让 AI 功能整体不可用 —— 那时按配置文件
 * 走一遍仍然是个正确的配置，所以这里吞掉读库的错误。
 */
export async function modelForRole(role: AiRole): Promise<ResolvedModel> {
  let picked: string | undefined;
  try {
    picked = await selectedModelId(role);
  } catch (err) {
    console.warn(`[linxi ai] 读 ${role} 的模型选择失败，按配置文件走：`, (err as Error).message);
  }
  return resolveModel(role, picked);
}

export type RoleSetting = {
  role: AiRole;
  zh: string;
  hint: string;
  /** 设置页里存的选择，没选过是 null */
  selected: string | null;
  /** 配置文件里给这个角色指定的清单项（AI_{角色}_MODEL_ID） */
  fromEnv: string | null;
  /** 现在实际生效的那一个，供显示。解析不出来（缺 key）时给 null + error */
  effective: { id: string | null; label: string; provider: string; model: string } | null;
  error: string | null;
};

/** 设置页要的全部信息：可选清单 + 三个角色现在各用什么。 */
export async function modelSettings(): Promise<{ catalog: ModelChoice[]; roles: RoleSetting[] }> {
  const catalog = modelCatalog();
  const stored = await getSettings(AI_ROLES.map(keyFor));

  const roles = AI_ROLES.map((role): RoleSetting => {
    const selected = stored[keyFor(role)] ?? null;
    let effective: RoleSetting['effective'] = null;
    let error: string | null = null;
    try {
      const m = resolveModel(role, selected ?? undefined);
      effective = { id: m.id ?? null, label: m.label, provider: m.provider, model: m.model };
    } catch (err) {
      // 缺 key 这类问题要能在页面上看见，不能只在服务端日志里
      error = (err as Error).message;
    }
    return {
      role,
      ...ROLE_LABELS[role],
      selected,
      fromEnv: defaultModelId(role) ?? null,
      effective,
      error,
    };
  });

  return { catalog, roles };
}

/**
 * 改某个角色用哪个模型。传 null 表示「跟着配置文件」。
 *
 * 只接受清单里的 id：这个值来自浏览器，而清单是这台机器上有地址有 key 的
 * 白名单。不校验的话，前端递个别的字符串进来就等于让浏览器决定往哪发请求。
 */
export async function setRoleModel(role: AiRole, modelId: string | null): Promise<void> {
  if (modelId !== null) {
    const hit = modelCatalog().find((m) => m.id === modelId);
    if (!hit) throw new Error(`没有这个模型：${modelId}`);
    if (!hit.ready) throw new Error(`模型 ${modelId} 还没配密钥，选了也用不了`);
  }
  await setSetting(keyFor(role), modelId);
}

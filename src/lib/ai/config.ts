/**
 * 模型配置的类型门面。
 *
 * 实现在同目录的 config.mjs —— server.mjs 启动时要打印每个角色实际用的模型，
 * 它跑在 Next 编译流程之外用不了 TS，所以解析逻辑放 .mjs 让两边共享一份。
 * 环境变量清单、回落顺序、配置示例都写在 config.mjs 的头注释里。
 */

import {
  resolveModel as rawResolveModel,
  describeModels as rawDescribeModels,
  modelCatalog as rawModelCatalog,
  defaultModelId as rawDefaultModelId,
  AI_ROLES as RAW_AI_ROLES,
} from './config.mjs';

/** 调用角色。新增角色时同步补 config.mjs 里的 DEFAULT_MODELS。 */
export type AiRole = 'content' | 'chat' | 'fast';

export type AiProviderName = 'anthropic' | 'openai' | 'openai-completion';

/** openai 协议下拿结构化输出的方式。 */
export type StructuredMode = 'tool' | 'json';

export type ResolvedModel = {
  role: AiRole;
  /** 命中 AI_MODELS 清单时是那一项的 id；走老的角色变量时为 undefined */
  id?: string;
  label: string;
  provider: AiProviderName;
  model: string;
  baseURL?: string;
  apiKey: string;
  structured: StructuredMode;
};

/** 清单里的一项。**不含 key**，这个结构会出到浏览器。 */
export type ModelChoice = {
  id: string;
  label: string;
  provider: AiProviderName;
  model: string;
  /** 只有 origin，见 config.mjs 的 safeUrl */
  baseURL?: string;
  /** 有没有拿到密钥。false 表示列出来了但不能选 */
  ready: boolean;
  /** 这一项自己配错了（比如 provider 写了别的名字） */
  error?: string;
};

export const AI_ROLES = RAW_AI_ROLES as AiRole[];

/** 每个角色是干什么的，设置页直接用这份文案。 */
export const ROLE_LABELS: Record<AiRole, { zh: string; hint: string }> = {
  content: { zh: '出题', hint: '新词、语法、听力、阅读、口语场景。质量优先，慢一点没关系' },
  chat: { zh: '对话', hint: '通话场景生成和对话回复。要自然、别太慢' },
  fast: { zh: '纠错和查词', hint: '口语纠错、查词、素材抽词。快优先，输出短' },
};

/**
 * 解析某个角色最终用哪个模型。缺 key 会抛错。
 *
 * `modelId` 是设置页存的选择，命中不了 AI_MODELS 清单就当没选。
 * 应用代码一般用 @/lib/ai/selection 里的 modelForRole()，它会先去库里取这个值。
 */
export const resolveModel = rawResolveModel as (role: AiRole, modelId?: string) => ResolvedModel;

/** 可选模型清单（AI_MODELS）。空数组 = 没配清单，只能用配置文件里的角色变量。 */
export const modelCatalog = rawModelCatalog as () => ModelChoice[];

/** 某个角色在配置文件里指定的默认清单项（AI_{角色}_MODEL_ID）。 */
export const defaultModelId = rawDefaultModelId as (role: AiRole) => string | undefined;

/** 给启动日志用：能看出每一步走哪个模型，但不泄露 key。 */
export const describeModels = rawDescribeModels as () => string[];

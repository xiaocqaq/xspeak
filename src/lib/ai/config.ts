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
  AI_ROLES as RAW_AI_ROLES,
} from './config.mjs';

/** 调用角色。新增角色时同步补 config.mjs 里的 DEFAULT_MODELS。 */
export type AiRole = 'content' | 'chat' | 'fast';

export type AiProviderName = 'anthropic' | 'openai';

/** openai 协议下拿结构化输出的方式。 */
export type StructuredMode = 'tool' | 'json';

export type ResolvedModel = {
  role: AiRole;
  provider: AiProviderName;
  model: string;
  baseURL?: string;
  apiKey: string;
  structured: StructuredMode;
};

export const AI_ROLES = RAW_AI_ROLES as AiRole[];

/** 解析某个角色最终用哪个模型。缺 key 会抛错。 */
export const resolveModel = rawResolveModel as (role: AiRole) => ResolvedModel;

/** 给启动日志用：能看出每一步走哪个模型，但不泄露 key。 */
export const describeModels = rawDescribeModels as () => string[];

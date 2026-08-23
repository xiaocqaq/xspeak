import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

/**
 * AI 调用封装。所有生成内容的接口都走 generateJson：
 * 用 tool-forcing（tool_choice 指定工具）强制模型输出结构化数据，
 * 再用 zod 校验一遍。这样前端拿到的永远是可用的结构，不需要解析自然语言。
 */
const g = globalThis as unknown as { __linxiAnthropic?: Anthropic };

export function getClient(): Anthropic {
  if (!g.__linxiAnthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('缺少 ANTHROPIC_API_KEY，请在 .env.local 里配置');
    g.__linxiAnthropic = new Anthropic({
      apiKey,
      baseURL: process.env.ANTHROPIC_BASE_URL?.trim() || undefined,
      maxRetries: 2,
      timeout: 120_000,
    });
  }
  return g.__linxiAnthropic;
}

export const MODEL = process.env.LINXI_MODEL?.trim() || 'claude-opus-5';

export class AiError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

type JsonOpts = {
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  toolName?: string;
  toolDescription?: string;
};

/** 让模型按 schema 产出结构化数据；失败会带上原始信息抛 AiError。 */
export async function generateJson<T extends z.ZodType>(
  schema: T,
  opts: JsonOpts,
): Promise<z.infer<T>> {
  const name = opts.toolName ?? 'emit_result';
  const jsonSchema = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  delete jsonSchema.$schema;

  let lastErr: unknown;
  // 两次机会：偶发的 schema 不匹配重试一次通常就好了
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await getClient().messages.create({
        model: MODEL,
        max_tokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature ?? 0.7,
        system: opts.system,
        tools: [
          {
            name,
            description: opts.toolDescription ?? '按给定结构返回结果',
            input_schema: jsonSchema as never,
          },
        ],
        tool_choice: { type: 'tool', name },
        messages: [{ role: 'user', content: opts.prompt }],
      });

      const block = res.content.find((c) => c.type === 'tool_use');
      if (!block || block.type !== 'tool_use') {
        throw new Error('模型没有按工具格式返回内容');
      }
      return schema.parse(block.input);
    } catch (err) {
      lastErr = err;
      if (attempt === 0) continue;
    }
  }
  throw new AiError(describeError(lastErr), lastErr);
}

/** 普通文本对话（口语练习用，需要自然的流式感受时也走它）。 */
export async function generateText(opts: {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  try {
    const res = await getClient().messages.create({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.8,
      system: opts.system,
      messages: opts.messages,
    });
    return res.content
      .filter((c) => c.type === 'text')
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join('')
      .trim();
  } catch (err) {
    throw new AiError(describeError(err), err);
  }
}

function describeError(err: unknown): string {
  if (err instanceof z.ZodError) {
    return `AI 返回的结构不符合要求：${err.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`;
  }
  if (err instanceof Anthropic.APIError) {
    return `AI 服务返回 ${err.status ?? '错误'}：${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

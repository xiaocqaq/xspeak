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
      // SDK 只负责重试网络层和 429/5xx。schema 不匹配的重试在 generateJson 里做，
      // 两层各留一次，最坏 4 次请求 —— 单次生成要 40 秒以上，再多会撞客户端超时。
      maxRetries: 1,
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
  // 两次机会，只用来救 schema 不匹配。
  // 网络和 429/5xx 由 SDK 自己重试过了，这里再转一圈只会拖长总耗时。
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

      const direct = schema.safeParse(block.input);
      if (direct.success) return direct.data;
      // 模型偶尔把嵌套的数组/对象序列化成 JSON 字符串塞进字段里。
      // 内容本身是对的，只是多包了一层引号，解开再校验一次，省掉一次重试。
      const healed = schema.safeParse(unwrapJsonStrings(block.input));
      if (healed.success) return healed.data;
      throw direct.error;
    } catch (err) {
      lastErr = err;
      // 服务端已经明确拒绝（模型不存在、鉴权失败、余额不够…），换个 attempt 结果一样。
      // 直接抛出去，让调用方快速看到真正的原因。
      if (err instanceof Anthropic.APIError) break;
    }
  }
  throw new AiError(describeError(lastErr), lastErr);
}

/**
 * 递归把"看起来是 JSON 的字符串"解开成数组/对象。
 * 只处理以 [ 或 { 开头的字符串，普通文本原样保留。
 */
function unwrapJsonStrings(value: unknown, depth = 0): unknown {
  if (depth > 6) return value;
  if (typeof value === 'string') {
    const s = value.trim();
    if (!(s.startsWith('[') || s.startsWith('{'))) return value;
    const parsed = parseLoose(s);
    return parsed === undefined ? value : unwrapJsonStrings(parsed, depth + 1);
  }
  if (Array.isArray(value)) return value.map((v) => unwrapJsonStrings(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        unwrapJsonStrings(v, depth + 1),
      ]),
    );
  }
  return value;
}

/**
 * 尽量把一段 JSON 文本解析出来；实在不行返回 undefined。
 *
 * 模型把数组序列化成字符串时，讲解文字里的引号经常忘了转义，比如
 * `{"explain_zh":"现在完成时表示"到现在为止的变化""}`。标准 JSON.parse 直接失败，
 * 但内容本身是好的，补上转义就能救回来。
 */
function parseLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // 继续试修复版本
  }
  try {
    return JSON.parse(escapeInnerQuotes(text));
  } catch {
    return undefined;
  }
}

/**
 * 给字符串值内部那些"不该结束字符串"的引号补上反斜杠。
 * 判断依据：真正的收尾引号后面（跳过空白）只可能是 , : } ] 或文本结束。
 */
function escapeInnerQuotes(text: string): string {
  let out = '';
  let inStr = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (!inStr) {
      out += ch;
      if (ch === '"') inStr = true;
      continue;
    }

    if (ch === '\\') {
      // 已经转义的两个字符原样搬过去
      out += ch + (text[i + 1] ?? '');
      i++;
      continue;
    }

    if (ch !== '"') {
      out += ch;
      continue;
    }

    let j = i + 1;
    while (j < text.length && /\s/.test(text[j])) j++;
    const next = text[j];
    if (next === undefined || next === ',' || next === ':' || next === '}' || next === ']') {
      out += ch;
      inStr = false;
    } else {
      out += '\\"';
    }
  }
  return out;
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

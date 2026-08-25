import { z } from 'zod';
import { resolveModel, type AiRole } from './config';
import { getProvider, type ChatMessage } from './providers';

/**
 * AI 调用封装。所有生成内容的接口都走 generateJson：
 * 让模型输出结构化数据（Anthropic 走 tool_choice，OpenAI 协议走 function calling
 * 或 json_object），再用 zod 校验一遍。这样前端拿到的永远是可用的结构，
 * 不需要解析自然语言。
 *
 * 具体用哪个模型由 `role` 决定（见 config.ts）：
 *   content 出题 / chat 对话 / fast 纠错和查词
 * 不传 role 就按 content 走 —— 出题是最早写的那一路，保持原行为。
 */

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
  /** 这一步归哪个角色，决定用哪个模型。默认 content。 */
  role?: AiRole;
};

/** 让模型按 schema 产出结构化数据；失败会带上原始信息抛 AiError。 */
export async function generateJson<T extends z.ZodType>(
  schema: T,
  opts: JsonOpts,
): Promise<z.infer<T>> {
  const name = opts.toolName ?? 'emit_result';
  const jsonSchema = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  delete jsonSchema.$schema;

  const cfg = resolveModel(opts.role ?? 'content');
  const provider = getProvider(cfg);
  const messages: ChatMessage[] = [{ role: 'user', content: opts.prompt }];

  let lastErr: unknown;
  // 两次机会，只用来救 schema 不匹配。
  // 网络和 429/5xx 由下层重试过了，这里再转一圈只会拖长总耗时。
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await provider.json({
        system: opts.system,
        messages,
        schema: jsonSchema,
        toolName: name,
        toolDescription: opts.toolDescription ?? '按给定结构返回结果',
        maxTokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature ?? 0.7,
      });

      const direct = schema.safeParse(raw);
      if (direct.success) return direct.data;
      // 模型偶尔把嵌套的数组/对象序列化成 JSON 字符串塞进字段里。
      // 内容本身是对的，只是多包了一层引号，解开再校验一次，省掉一次重试。
      const healed = schema.safeParse(unwrapJsonStrings(raw));
      if (healed.success) return healed.data;
      throw direct.error;
    } catch (err) {
      lastErr = err;
      // 服务端已经明确拒绝（模型不存在、鉴权失败、余额不够…），换个 attempt 结果一样。
      // 直接抛出去，让调用方快速看到真正的原因。
      if (provider.isTerminal(err)) break;
    }
  }
  throw new AiError(describeError(lastErr, provider.describe), lastErr);
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

/** 普通文本对话。需要自然的一段话、不需要结构化时用它。 */
export async function generateText(opts: {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  role?: AiRole;
}): Promise<string> {
  const cfg = resolveModel(opts.role ?? 'chat');
  const provider = getProvider(cfg);
  try {
    return await provider.text({
      system: opts.system,
      messages: opts.messages,
      maxTokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.8,
    });
  } catch (err) {
    throw new AiError(describeError(err, provider.describe), err);
  }
}

function describeError(err: unknown, fromProvider: (e: unknown) => string | undefined): string {
  if (err instanceof z.ZodError) {
    return `AI 返回的结构不符合要求：${err.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`;
  }
  const byProvider = fromProvider(err);
  if (byProvider) return byProvider;
  if (err instanceof Error) return err.message;
  return String(err);
}

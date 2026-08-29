import { z } from 'zod';
import { type AiRole } from './config';
import { modelForRole } from './selection';
import {
  getProvider,
  OutputTruncatedError,
  UpstreamTimeoutError,
  type ChatMessage,
  type Usage,
} from './providers';

/**
 * AI 调用封装。所有生成内容的接口都走 generateJson：
 * 让模型输出结构化数据（Anthropic 走 tool_choice，OpenAI 协议走 function calling
 * 或 json_object），再用 zod 校验一遍。这样前端拿到的永远是可用的结构，
 * 不需要解析自然语言。
 *
 * 具体用哪个模型由 `role` 决定：
 *   content 出题 / chat 对话 / fast 纠错和查词
 * 不传 role 就按 content 走 —— 出题是最早写的那一路，保持原行为。
 *
 * 每个角色具体落到哪个模型走 selection.ts：先看设置页存的选择，
 * 再回落到 .env.local（见 config.mjs 头注释）。
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
  /**
   * 单次请求最多等多久，默认 120 秒。
   *
   * 用户在等结果的那种调用要自己压一个更短的值：上游延迟波动很大，
   * 拿默认值等于把一次抽风放大成两分钟白屏。注意这是**单次**的上限，
   * 下面 schema 不匹配还会重试一次，最坏是两倍。
   */
  timeoutMs?: number;
};

/**
 * 每次调用记一行：哪一步、走哪个模型、花了多久、烧了多少 token。
 *
 * 加这行是因为"哪里慢、哪里烧 token"以前只能靠猜 —— 一个环节可能连着发
 * 好几次请求，不记下来根本看不出是次数多还是单次贵。
 * 上游不回 usage 时就只有耗时，也比没有强。
 */
function logCall(
  step: string,
  role: string,
  model: string,
  t0: number,
  u: Usage,
  err?: unknown,
): void {
  const ms = Date.now() - t0;
  // reasoning 单独跟在 out 后面：推理模型把思考也算进 out，
  // 只看 out=2500 会以为写了 2500 token 的正文，其实可能一个字都没吐出来。
  const think = u.reasoning ? ` reasoning=${u.reasoning}` : '';
  const tok =
    u.input || u.output
      ? ` in=${u.input ?? '?'} out=${u.output ?? '?'}${think}`
      : ' usage=上游没回';
  // 失败原因跟着这一行走。分开打的话，中间夹一条别的请求日志就对不上号了，
  // 而"花了 33 秒、烧了 840 token、然后失败"最想知道的恰恰是为什么失败。
  const why = err ? ` — ${(err as Error).message?.split('\n')[0] ?? String(err)}` : '';
  console.log(`[linxi ai] ${step} role=${role} ${model} ${ms}ms${tok}${why}`);
}

/** 让模型按 schema 产出结构化数据；失败会带上原始信息抛 AiError。 */
export async function generateJson<T extends z.ZodType>(
  schema: T,
  opts: JsonOpts,
): Promise<z.infer<T>> {
  const name = opts.toolName ?? 'emit_result';
  const jsonSchema = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  delete jsonSchema.$schema;

  const cfg = await modelForRole(opts.role ?? 'content');
  const provider = getProvider(cfg);
  const messages: ChatMessage[] = [{ role: 'user', content: opts.prompt }];

  let lastErr: unknown;
  /*
   * 预算会随重试往上走。
   *
   * 推理模型把思考算进 max_tokens，额度不够时思考先把配额吃光、结构化输出
   * 一个 token 都轮不到，上游回 finish_reason=length。这种失败拿同样的额度
   * 再发一次必然再撞一次 —— 实测 scenarios 这一步在 2500 上连撞两次白等 64 秒，
   * 翻到 8000 一次就过。所以只在"被截断"时翻倍，其他失败保持原样，
   * 免得把一次真实的 schema 不匹配变成两倍的账单。
   */
  let budget = opts.maxTokens ?? 4096;
  // 两次机会：救 schema 不匹配，也救预算不够。
  // 网络和 429/5xx 由下层重试过了，这里再转一圈只会拖长总耗时。
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now();
    let usage: Usage = {};
    try {
      const raw = await provider.json({
        system: opts.system,
        messages,
        schema: jsonSchema,
        toolName: name,
        toolDescription: opts.toolDescription ?? '按给定结构返回结果',
        maxTokens: budget,
        temperature: opts.temperature ?? 0.7,
        timeoutMs: opts.timeoutMs,
        onUsage: (u) => { usage = u; },
      });
      logCall(name, cfg.role, provider.name, t0, usage);

      const direct = schema.safeParse(raw);
      if (direct.success) return direct.data;
      // 模型偶尔把嵌套的数组/对象序列化成 JSON 字符串塞进字段里。
      // 内容本身是对的，只是多包了一层引号，解开再校验一次，省掉一次重试。
      const healed = schema.safeParse(unwrapJsonStrings(raw));
      if (healed.success) return healed.data;
      throw direct.error;
    } catch (err) {
      lastErr = err;
      // 失败的也要记：一次白等 30 秒的调用不记下来，看日志会以为这一步没发生过
      logCall(`${name}✗`, cfg.role, provider.name, t0, usage, err);
      // 服务端已经明确拒绝（模型不存在、鉴权失败、余额不够…），换个 attempt 结果一样。
      // 直接抛出去，让调用方快速看到真正的原因。
      if (provider.isTerminal(err)) break;
      // 已经白等满一整个超时窗口，同样的参数再发一次基本还是等满，
      // 只会把用户的等待翻倍。直接把这次的原因抛出去。
      if (err instanceof UpstreamTimeoutError) break;
      // 上限 16384：再往上单次等待比重试本身还久，不如让调用方看到错误。
      if (err instanceof OutputTruncatedError) budget = Math.min(budget * 2, 16384);
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
  const cfg = await modelForRole(opts.role ?? 'chat');
  const provider = getProvider(cfg);
  const t0 = Date.now();
  let usage: Usage = {};
  try {
    const out = await provider.text({
      system: opts.system,
      messages: opts.messages,
      maxTokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.8,
      onUsage: (u) => { usage = u; },
    });
    logCall('text', cfg.role, provider.name, t0, usage);
    return out;
  } catch (err) {
    logCall('text✗', cfg.role, provider.name, t0, usage, err);
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

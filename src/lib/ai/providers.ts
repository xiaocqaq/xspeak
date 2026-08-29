/**
 * 模型协议适配层。
 *
 * 上层（client.ts）只认这里的 `AiProvider` 接口，不知道底下是 Anthropic 还是
 * OpenAI 协议。要接新的服务商，加一个实现挂进 getProvider 即可，
 * 出题/对话/纠错那些业务代码一行都不用改。
 *
 * 两个协议的差别都吞在这里：
 * - 系统提示：Anthropic 是顶层 `system` 字段，OpenAI 是 messages 里的一条 role=system。
 * - 结构化输出：Anthropic 用 tool_choice 强制走工具；OpenAI 协议这边两种都支持
 *   （function calling 或 json_object），因为兼容实现对工具的支持参差不齐。
 * - 参数名：「OpenAI 协议」不是一个固定的东西 —— 连 OpenAI 自己的新模型都把
 *   max_tokens 改成了 max_completion_tokens、只收默认温度，轻量兼容实现又常常
 *   没实现 json_object。这些都靠 openaiCall 里那套「挨一个 400 就记住、之后
 *   按改过的形状发」兜住（见 quirks），配置里不用为每个模型写一堆开关。
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ResolvedModel } from './config';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

/**
 * 一次调用花了多少 token。上游没回 usage 时字段可能缺。
 *
 * `reasoning` 单列出来是因为推理模型把思考也算进 output：一次
 * out=2500 reasoning=2500 的调用看着"写了 2500 字"，其实一个字都没吐给用户。
 * 不分开记，日志里的 out 数字会让人以为预算够用。
 */
export type Usage = { input?: number; output?: number; reasoning?: number };

/**
 * 输出被 max_tokens 截断。
 *
 * 单独一个类型是为了让上层能区分「模型不行」和「预算不够」——这两件事的
 * 处置完全相反：前者换个 attempt 碰运气，后者必须加预算，拿同样的额度
 * 再发一次只是把一次白等变成两次。推理模型上尤其明显，思考先把额度吃光，
 * 结构化输出一个 token 都没轮到。
 */
export class OutputTruncatedError extends Error {
  constructor(readonly usedTokens: number | undefined) {
    super(
      `输出被截断：max_tokens 用光了${usedTokens ? `（${usedTokens} tokens）` : ''}，没能拿到完整结果`,
    );
    this.name = 'OutputTruncatedError';
  }
}

/**
 * 整个调用把超时预算等光了。
 *
 * 也单列一个类型，理由和截断相反：截断值得加预算重试，超时不值得重试。
 * 已经白等满一个超时窗口的请求，同样的参数再发一次通常还是等满 ——
 * 只是把用户的 120 秒变成 240 秒。慢就是慢，得换模型或者砍活儿，不是再试一次。
 */
export class UpstreamTimeoutError extends Error {
  constructor(
    readonly model: string,
    readonly timeoutMs: number,
  ) {
    super(`调用 ${model} 超时（${Math.round(timeoutMs / 1000)} 秒）`);
    this.name = 'UpstreamTimeoutError';
  }
}

/**
 * 用回调而不是改 json()/text() 的返回类型报告 usage：
 * 上游不一定回 usage（兼容端点经常省），调用方也不一定关心，
 * 做成可选回调就不用让每个调用点都去解一层包装对象。
 */
type UsageSink = { onUsage?: (u: Usage) => void };

/**
 * 单次调用最多等多久。不传按 DEFAULT_TIMEOUT_MS。
 *
 * 上游网关的延迟波动很大 —— 同一个模型、同一段输入，实测 15 秒到 80 秒都有。
 * 生成听力材料本来就慢，等两分钟不算离谱；但用户盯着屏幕等的那种调用，
 * 拿同一个上限就等于把一次抽风变成两分钟白屏，所以让调用方自己定。
 */
type Deadline = { timeoutMs?: number };

const DEFAULT_TIMEOUT_MS = 120_000;

export type JsonRequest = UsageSink & Deadline & {
  system: string;
  messages: ChatMessage[];
  /** JSON Schema，描述期望的返回结构 */
  schema: Record<string, unknown>;
  /** 工具名，也用于提示模型这次要产出什么 */
  toolName: string;
  toolDescription: string;
  maxTokens: number;
  temperature: number;
};

export type TextRequest = UsageSink & Deadline & {
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
};

export type AiProvider = {
  readonly name: string;
  /** 拿一段结构化输出，返回未校验的原始对象（校验在 client.ts 做）。 */
  json(req: JsonRequest): Promise<unknown>;
  /** 拿一段纯文本。 */
  text(req: TextRequest): Promise<string>;
  /**
   * 这个错误是不是「再试也一样」。
   * 鉴权失败、模型不存在、余额不足这类，重试只是白等，上层据此提前跳出。
   */
  isTerminal(err: unknown): boolean;
  /** 把错误翻成人能看懂的一句话。 */
  describe(err: unknown): string | undefined;
};

/* ------------------------------- Anthropic ------------------------------- */

/**
 * 客户端按「地址 + key」缓存。
 * 三个角色可能指向同一个端点，共用一个客户端就能共用连接池；
 * 指向不同端点时 key 不同，自然分开。
 */
const anthropicCache = new Map<string, Anthropic>();

function anthropicClient(cfg: ResolvedModel): Anthropic {
  const cacheKey = `${cfg.baseURL ?? 'default'}::${cfg.apiKey.slice(-8)}`;
  let client = anthropicCache.get(cacheKey);
  if (!client) {
    client = new Anthropic({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
      // SDK 只重试网络层和 429/5xx。schema 不匹配的重试在 client.ts 里做，
      // 两层各留一次，最坏 4 次请求 —— 单次生成要 40 秒以上，再多会撞客户端超时。
      maxRetries: 1,
      timeout: 120_000,
    });
    anthropicCache.set(cacheKey, client);
  }
  return client;
}

function anthropicProvider(cfg: ResolvedModel): AiProvider {
  return {
    name: `anthropic/${cfg.model}`,

    async json(req) {
      const res = await anthropicClient(cfg).messages.create({
        model: cfg.model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        system: req.system,
        tools: [
          {
            name: req.toolName,
            description: req.toolDescription,
            input_schema: req.schema as never,
          },
        ],
        tool_choice: { type: 'tool', name: req.toolName },
        messages: req.messages,
      }, { timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS });
      req.onUsage?.({ input: res.usage?.input_tokens, output: res.usage?.output_tokens });

      const block = res.content.find((c) => c.type === 'tool_use');
      if (!block || block.type !== 'tool_use') {
        // max_tokens 是 Anthropic 这边的截断信号，对应 OpenAI 协议的 finish_reason=length
        if (res.stop_reason === 'max_tokens') {
          throw new OutputTruncatedError(res.usage?.output_tokens);
        }
        throw new Error('模型没有按工具格式返回内容');
      }
      return block.input;
    },

    async text(req) {
      const res = await anthropicClient(cfg).messages.create({
        model: cfg.model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        system: req.system,
        messages: req.messages,
      }, { timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS });
      req.onUsage?.({ input: res.usage?.input_tokens, output: res.usage?.output_tokens });
      return res.content
        .filter((c) => c.type === 'text')
        .map((c) => (c.type === 'text' ? c.text : ''))
        .join('')
        .trim();
    },

    isTerminal(err) {
      return err instanceof Anthropic.APIError;
    },

    describe(err) {
      if (err instanceof Anthropic.APIError) {
        return `AI 服务返回 ${err.status ?? '错误'}：${err.message}`;
      }
      return undefined;
    },
  };
}

/* -------------------------- OpenAI 协议（自己发请求） -------------------------- */

/**
 * 为什么不引 openai 这个包：这里只用到 /chat/completions 一个接口，
 * 手写 fetch 三十行就够，省一个依赖，也不用跟着 SDK 的大版本迁移。
 * 兼容端点（vLLM、Ollama、StepFun、各种中转）只要认这个接口就能接上。
 */

export class OpenAiHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'OpenAiHttpError';
  }
}

type OpenAiChoice = {
  message?: {
    content?: string | null;
    tool_calls?: { function?: { name?: string; arguments?: string } }[];
  };
  finish_reason?: string;
};

function openaiUrl(baseURL: string | undefined): string {
  // 默认官方地址；自定义地址允许写到 /v1 或直接写到 /chat/completions
  const base = (baseURL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  /*
   * 这里就把地址解一遍。不解的话 fetch 会抛 ERR_INVALID_URL，
   * 被下面按网络错误报成「连不上 xxx」—— 而地址少了 http:// 是配置问题，
   * 说成连不上会把人送去查网络和防火墙。
   */
  try {
    new URL(url);
  } catch {
    throw new Error(`地址不像个网址：${base}（BASE_URL 要带上 http:// 或 https://，写到 /v1 为止）`);
  }
  return url;
}

/**
 * 认得的几种「这个端点不吃这个参数」。加新的要同时改 applyQuirks 和 sniffQuirk。
 * openaiCall 的重发上限从这个长度算，别写死数字。
 */
const QUIRKS = ['max_completion_tokens', 'no_temperature', 'no_response_format'] as const;

/**
 * 已知这个端点不认哪些参数。键是「地址 + 模型」。
 *
 * 试出来一次就记住，后面同一个模型直接按改过的形状发 ——
 * 否则每次生成都要先白挨一个 400，一天下来是几十次多余往返。
 * 进程级缓存，重启就忘，够了：端点认不认某个字段不会一天变一次。
 */
const quirks = new Map<string, Set<string>>();

function quirkKey(cfg: ResolvedModel): string {
  return `${cfg.baseURL ?? 'default'}::${cfg.model}`;
}

/**
 * 按已知毛病改一版请求体。
 *
 * `known` 里的每一项都是一种「这个端点不吃这个参数」：
 * - `max_completion_tokens`：OpenAI 自己的新模型（o 系列、gpt-5 往后）
 *   把 max_tokens 改名了，老名字直接 400。
 * - `no_temperature`：同一批模型只收默认温度，给 0.7 就报错。
 * - `no_response_format`：很多轻量兼容实现（llama.cpp、部分中转）
 *   没实现 json_object。丢掉它照样能出 JSON —— schema 本来也写在提示里了。
 */
function applyQuirks(payload: Record<string, unknown>, known: Set<string>): Record<string, unknown> {
  const out = { ...payload };
  if (known.has('max_completion_tokens') && 'max_tokens' in out) {
    out.max_completion_tokens = out.max_tokens;
    delete out.max_tokens;
  }
  if (known.has('no_temperature')) delete out.temperature;
  if (known.has('no_response_format')) delete out.response_format;
  return out;
}

/**
 * 从 400 的抱怨里认出是哪个参数不行；认不出来返回 undefined。
 *
 * 只按错误里**明确点名**的字段改。宽泛地"删几个参数再试试"会把
 * 「模型不存在」「余额不足」这类真问题掩盖成一串莫名其妙的重试，
 * 用户看到的最后一条错误也就跟真正的原因没关系了。
 */
function sniffQuirk(payload: Record<string, unknown>, message: string): string | undefined {
  const m = message.toLowerCase();
  const rejected = /unsupported|not support|unrecognized|unknown|invalid|无效|不支持/.test(m);
  if (!rejected) return undefined;

  if ('max_tokens' in payload && m.includes('max_completion_tokens')) {
    return 'max_completion_tokens';
  }
  if ('temperature' in payload && m.includes('temperature')) return 'no_temperature';
  if ('response_format' in payload && m.includes('response_format')) return 'no_response_format';
  return undefined;
}

type CallOpts = { onUsage?: (u: Usage) => void; timeoutMs?: number };

async function openaiCall(
  cfg: ResolvedModel,
  payload: Record<string, unknown>,
  opts: CallOpts = {},
): Promise<OpenAiChoice> {
  const key = quirkKey(cfg);
  const known = quirks.get(key) ?? new Set<string>();
  let body = applyQuirks(payload, known);
  // 超时是「整个调用」的预算，不是每一圈各给一份 —— 否则学三个毛病就能等四倍
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  /*
   * 循环次数不用猜：每转一圈要么学到一个**新**毛病（known 只增不减，
   * 撞见学过的就直接抛），要么直接抛出去。所以最多学 QUIRKS.length 个，
   * 再加最后那次成功的请求。一个端点三样全犯是有的（新模型既要改
   * max_tokens、又不收 temperature，还没实现 json_object）。
   */
  for (let attempt = 0; attempt <= QUIRKS.length; attempt++) {
    try {
      return await openaiFetch(cfg, body, opts.onUsage, Math.max(1, deadline - Date.now()));
    } catch (err) {
      if (!(err instanceof OpenAiHttpError) || err.status !== 400) throw err;
      const quirk = sniffQuirk(body, err.message);
      if (!quirk || known.has(quirk)) throw err;
      known.add(quirk);
      quirks.set(key, known);
      console.warn(`[linxi ai] ${cfg.model} 不认这个参数（${quirk}），换个写法重发：${err.message}`);
      body = applyQuirks(payload, known);
    }
  }
  // 走不到：上面每一圈不是 return 就是 throw。真到了这儿说明 QUIRKS
  // 和 sniffQuirk 不同步了（认出了不在清单里的毛病），说出来别默默转下去
  throw new Error(`适配 ${cfg.model} 的参数试了 ${QUIRKS.length + 1} 轮还没成，检查 QUIRKS 清单`);
}

async function openaiFetch(
  cfg: ResolvedModel,
  payload: Record<string, unknown>,
  onUsage?: (u: Usage) => void,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<OpenAiChoice> {
  const url = openaiUrl(cfg.baseURL);
  // 生成一段听力材料能跑到一两分钟，默认 fetch 不超时反而更糟：
  // 连接卡死会一直挂着，所以自己带一个 AbortController。
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ model: cfg.model, ...payload }),
      signal: ac.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new UpstreamTimeoutError(cfg.model, timeoutMs);
    }
    /*
     * fetch 连不上时只给一句 "fetch failed"，那句话到了页面上等于没说。
     * 连不上几乎总是地址配错或者服务没起，所以把地址带上（只留 origin，
     * 有的网关把凭证编在路径里）——看见地址人就知道该去查什么。
     */
    throw new Error(`连不上 ${origin(url)}：${causeOf(err)}`, { cause: err });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw new OpenAiHttpError(res.status, extractOpenAiError(raw) || `HTTP ${res.status}`);
  }

  const data = (await res.json().catch(() => undefined)) as
    | {
        choices?: OpenAiChoice[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          completion_tokens_details?: { reasoning_tokens?: number };
        };
      }
    | undefined;
  onUsage?.({
    input: data?.usage?.prompt_tokens,
    output: data?.usage?.completion_tokens,
    reasoning: data?.usage?.completion_tokens_details?.reasoning_tokens,
  });
  const choice = data?.choices?.[0];
  if (!choice) {
    // 兼容实现回一坨别的结构时，说清是"这个端点不像 OpenAI 协议"，
    // 而不是含糊地说模型没返回内容 —— 前者能指向配置，后者会让人去怀疑模型
    throw new Error(`${origin(url)} 的回复里没有 choices，可能不是 OpenAI 协议的端点`);
  }
  return choice;
}

/** 只取 origin，别把可能编在路径里的凭证带进错误信息。 */
function origin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** 网络错误真正的原因往往在 cause 上（ECONNREFUSED / ENOTFOUND / 证书）。 */
function causeOf(err: unknown): string {
  const c = (err as { cause?: unknown }).cause;
  const code = (c as { code?: string } | undefined)?.code;
  if (code) return code;
  if (c instanceof Error && c.message) return c.message;
  return err instanceof Error ? err.message : String(err);
}

/**
 * 解析模型给的 JSON。
 *
 * 解不动的时候要说清"是模型的输出不对"，别把 JS 原生那句
 * `Expected ',' or ']' after array element in JSON at position 11` 直接送到页面上 ——
 * 那句话对着一段用户看不到的文本报位置，等于没有信息。
 */
function parseModelJson(text: string, where: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      `模型${where}返回的不是合法 JSON（${(err as Error).message}）：${text.slice(0, 160)}`,
      { cause: err },
    );
  }
}

/** 从错误响应里挖出真正的原因；挖不到就返回原文的前 200 字。 */
function extractOpenAiError(raw: string): string {
  try {
    const j = JSON.parse(raw) as { error?: { message?: string }; message?: string };
    return j.error?.message ?? j.message ?? raw.slice(0, 200);
  } catch {
    return raw.slice(0, 200);
  }
}

/**
 * 把 usage 回调分出一路留在本地。
 *
 * 报截断时想把"到底烧了多少"写进错误信息，但 usage 是回调给上层的、
 * provider 自己没留一份。这里顺手抄一份，不改回调的行为。
 */
function teeUsage(onUsage?: (u: Usage) => void): {
  sink: (u: Usage) => void;
  seen: () => Usage;
} {
  let last: Usage = {};
  return {
    sink: (u) => {
      last = u;
      onUsage?.(u);
    },
    seen: () => last,
  };
}

function openaiProvider(cfg: ResolvedModel): AiProvider {
  return {
    name: `openai/${cfg.model}`,

    async json(req) {
      const usage = teeUsage(req.onUsage);
      const truncated = () => new OutputTruncatedError(usage.seen().output);
      const messages = [
        { role: 'system' as const, content: req.system },
        ...req.messages,
      ];

      if (cfg.structured === 'tool') {
        const choice = await openaiCall(cfg, {
          messages,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          tools: [
            {
              type: 'function',
              function: {
                name: req.toolName,
                description: req.toolDescription,
                parameters: req.schema,
              },
            },
          ],
          // 指定函数名而不是 "auto"：这一路的返回值必须是结构化的，
          // 让模型自己决定要不要调用工具，就会时不时回一段自然语言。
          tool_choice: { type: 'function', function: { name: req.toolName } },
        }, { onUsage: usage.sink, timeoutMs: req.timeoutMs });

        const args = choice.message?.tool_calls?.[0]?.function?.arguments;
        // 有些兼容端点声称支持 tools，实际把结果当普通文本回。
        // 与其直接报错，不如按 json 模式再解一次 —— 内容往往是对的。
        const content = choice.message?.content?.trim();
        const text = args ?? (content ? stripCodeFence(content) : undefined);
        /*
         * 先解析再判断截断，顺序不能倒。finish_reason=length 只说明"写到额度用光了"，
         * 不代表这次没东西可用 —— 额度刚好卡在结尾的情况下 JSON 是完整的，
         * 这时候按截断报错等于把一次能用的结果扔掉再重发一遍。
         */
        if (text) {
          try {
            return parseModelJson(text, args ? '在工具参数里' : '');
          } catch (err) {
            if (choice.finish_reason === 'length') throw truncated();
            throw err;
          }
        }
        if (choice.finish_reason === 'length') throw truncated();
        throw new Error('模型没有返回工具调用，也没有返回文本');
      }

      // json 模式：把 schema 塞进提示里，靠 response_format 逼出纯 JSON。
      // 兼容端点对 tools 支持不好时用这条路（AI_{R}_STRUCTURED=json）。
      const choice = await openaiCall(cfg, {
        messages: [
          ...messages,
          {
            role: 'system' as const,
            content: [
              `只返回一个 JSON 对象，不要任何解释、不要 markdown 代码块。`,
              `它必须满足这个 JSON Schema：`,
              JSON.stringify(req.schema),
            ].join('\n'),
          },
        ],
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        response_format: { type: 'json_object' },
      }, { onUsage: usage.sink, timeoutMs: req.timeoutMs });

      const content = choice.message?.content?.trim();
      if (!content) {
        if (choice.finish_reason === 'length') throw truncated();
        throw new Error('模型返回了空内容');
      }
      try {
        return parseModelJson(stripCodeFence(content), '');
      } catch (err) {
        if (choice.finish_reason === 'length') throw truncated();
        throw err;
      }
    },

    async text(req) {
      const choice = await openaiCall(cfg, {
        messages: [{ role: 'system' as const, content: req.system }, ...req.messages],
        max_tokens: req.maxTokens,
        temperature: req.temperature,
      }, { onUsage: req.onUsage, timeoutMs: req.timeoutMs });
      return (choice.message?.content ?? '').trim();
    },

    isTerminal(err) {
      // 4xx 里只有 408/429 值得再试，其它（401 鉴权、404 模型不存在、400 参数错）
      // 换一次 attempt 结果一样。5xx 交给上层重试。
      if (!(err instanceof OpenAiHttpError)) return false;
      if (err.status === 408 || err.status === 429) return false;
      return err.status >= 400 && err.status < 500;
    },

    describe(err) {
      if (err instanceof OpenAiHttpError) return `AI 服务返回 ${err.status}：${err.message}`;
      return undefined;
    },
  };
}

/** 模型有时会把 JSON 包在 ```json 里，剥掉再解析。 */
function stripCodeFence(text: string): string {
  const m = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(text.trim());
  return m ? m[1] : text;
}

/* ---------------------- OpenAI Responses 协议（/responses） ---------------------- */

/**
 * GPT 系新模型的原生协议。和 chat/completions 的差别：
 * - 端点是 /responses，不是 /chat/completions；
 * - 系统提示叫 instructions，messages 叫 input；
 * - max_tokens 改名 max_output_tokens，且思考模型把 reasoning 也算在里面；
 * - 返回不是 choices[].message，而是 output[] 数组 —— 里面混着 reasoning、
 *   message（output_text）、function_call 三种条目，要按类型各取各的。
 *
 * 探测过 xiao.xlingo.fun 网关：/responses 通，tool_choice、usage、
 * reasoning tokens 全都正常回。但网关会给模型注入一段自己的系统前缀
 * （Codex 人设），和我们的 instructions 是拼接关系 —— 模型行为可能
 * 带一点「coding agent」味，结构化输出不受影响。
 */

type ResponsesOutputItem =
  | { type: 'reasoning'; summary?: { text?: string }[] }
  | {
      type: 'message';
      content?: { type: string; text?: string }[];
    }
  | {
      type: 'function_call';
      name?: string;
      arguments?: string;
    };

type ResponsesUsage = {
  input_tokens?: number;
  output_tokens?: number;
  output_tokens_details?: { reasoning_tokens?: number };
};

/** Responses 的截断信号：status=incomplete 且 reason 是 max_output_tokens。 */
function responsesIncompleteReason(d: {
  status?: string;
  incomplete_details?: { reason?: string } | null;
}): string | undefined {
  if (d.status !== 'incomplete') return undefined;
  return d.incomplete_details?.reason;
}

async function responsesCall(
  cfg: ResolvedModel,
  payload: Record<string, unknown>,
  opts: CallOpts = {},
): Promise<{ output: ResponsesOutputItem[]; status: string; incompleteReason?: string }> {
  const url = responsesUrl(cfg.baseURL);
  const ac = new AbortController();
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const timer = setTimeout(() => ac.abort(), deadline - Date.now());
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ model: cfg.model, ...payload }),
      signal: ac.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new UpstreamTimeoutError(cfg.model, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    }
    throw new Error(`连不上 ${origin(url)}：${causeOf(err)}`, { cause: err });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw new OpenAiHttpError(res.status, extractOpenAiError(raw) || `HTTP ${res.status}`);
  }

  const data = (await res.json().catch(() => undefined)) as
    | {
        output?: ResponsesOutputItem[];
        status?: string;
        incomplete_details?: { reason?: string } | null;
        usage?: ResponsesUsage;
      }
    | undefined;
  opts.onUsage?.({
    input: data?.usage?.input_tokens,
    output: data?.usage?.output_tokens,
    reasoning: data?.usage?.output_tokens_details?.reasoning_tokens,
  });
  if (!data?.output) {
    throw new Error(`${origin(url)} 的回复里没有 output，可能不是 Responses 协议的端点`);
  }
  return {
    output: data.output,
    status: data.status ?? 'completed',
    incompleteReason: responsesIncompleteReason(data as never),
  };
}

function responsesUrl(baseURL: string | undefined): string {
  const base = (baseURL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const url = base.endsWith('/responses') ? base : `${base}/responses`;
  try {
    new URL(url);
  } catch {
    throw new Error(`地址不像个网址：${base}（BASE_URL 要带上 http:// 或 https://，写到 /v1 为止）`);
  }
  return url;
}

function responsesText(output: ResponsesOutputItem[]): string | undefined {
  for (const item of output) {
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (c.type === 'output_text' && c.text?.trim()) return c.text;
    }
  }
  return undefined;
}

function responsesToolArgs(output: ResponsesOutputItem[]): string | undefined {
  for (const item of output) {
    if (item.type === 'function_call' && item.arguments?.trim()) return item.arguments;
  }
  return undefined;
}

function responsesProvider(cfg: ResolvedModel): AiProvider {
  return {
    name: `openai-responses/${cfg.model}`,

    async json(req) {
      const usage = teeUsage(req.onUsage);
      const truncated = () => new OutputTruncatedError(usage.seen().output);

      if (cfg.structured === 'tool') {
        const { output, incompleteReason } = await responsesCall(cfg, {
          instructions: req.system,
          input: req.messages,
          max_output_tokens: req.maxTokens,
          temperature: req.temperature,
          tools: [
            {
              type: 'function',
              name: req.toolName,
              description: req.toolDescription,
              parameters: req.schema,
            },
          ],
          // 指定函数名而不是 "auto"：结构化输出这一路必须走工具，
          // 让模型自己决定会时不时回一段自然语言
          tool_choice: { type: 'function', name: req.toolName },
        }, { onUsage: usage.sink, timeoutMs: req.timeoutMs });

        const args = responsesToolArgs(output);
        // 有的兼容实现把工具结果当普通文本回 —— 按文本再解一次，内容往往是对的
        const text = args ?? responsesText(output);
        if (text) {
          try {
            return parseModelJson(text, args ? '在工具参数里' : '');
          } catch (err) {
            if (incompleteReason === 'max_output_tokens') throw truncated();
            throw err;
          }
        }
        if (incompleteReason === 'max_output_tokens') throw truncated();
        throw new Error('模型没有返回工具调用，也没有返回文本');
      }

      // json 模式：schema 塞进提示，靠纯文本约定逼出 JSON
      // （Responses 没有 json_object 的 response_format）
      const { output, incompleteReason } = await responsesCall(cfg, {
        instructions: [
          req.system,
          '',
          '只返回一个 JSON 对象，不要任何解释、不要 markdown 代码块。',
          '它必须满足这个 JSON Schema：',
          JSON.stringify(req.schema),
        ].join('\n'),
        input: req.messages,
        max_output_tokens: req.maxTokens,
        temperature: req.temperature,
      }, { onUsage: usage.sink, timeoutMs: req.timeoutMs });

      const text = responsesText(output);
      if (!text) {
        if (incompleteReason === 'max_output_tokens') throw truncated();
        throw new Error('模型返回了空内容');
      }
      try {
        return parseModelJson(stripCodeFence(text), '');
      } catch (err) {
        if (incompleteReason === 'max_output_tokens') throw truncated();
        throw err;
      }
    },

    async text(req) {
      const { output } = await responsesCall(cfg, {
        instructions: req.system,
        input: req.messages,
        max_output_tokens: req.maxTokens,
        temperature: req.temperature,
      }, { onUsage: req.onUsage, timeoutMs: req.timeoutMs });
      return (responsesText(output) ?? '').trim();
    },

    isTerminal(err) {
      if (!(err instanceof OpenAiHttpError)) return false;
      if (err.status === 408 || err.status === 429) return false;
      return err.status >= 400 && err.status < 500;
    },

    describe(err) {
      if (err instanceof OpenAiHttpError) return `AI 服务返回 ${err.status}：${err.message}`;
      return undefined;
    },
  };
}

/* --------------------------------- 出口 --------------------------------- */

export function getProvider(cfg: ResolvedModel): AiProvider {
  switch (cfg.provider) {
    case 'anthropic':
      return anthropicProvider(cfg);
    case 'openai':
      return responsesProvider(cfg);
    case 'openai-completion':
      return openaiProvider(cfg);
  }
}

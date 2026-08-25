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
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ResolvedModel } from './config';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export type JsonRequest = {
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

export type TextRequest = {
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
      });

      const block = res.content.find((c) => c.type === 'tool_use');
      if (!block || block.type !== 'tool_use') throw new Error('模型没有按工具格式返回内容');
      return block.input;
    },

    async text(req) {
      const res = await anthropicClient(cfg).messages.create({
        model: cfg.model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        system: req.system,
        messages: req.messages,
      });
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
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

async function openaiCall(
  cfg: ResolvedModel,
  payload: Record<string, unknown>,
): Promise<OpenAiChoice> {
  // 生成一段听力材料能跑到一两分钟，默认 fetch 不超时反而更糟：
  // 连接卡死会一直挂着，所以自己带一个 AbortController。
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 120_000);
  let res: Response;
  try {
    res = await fetch(openaiUrl(cfg.baseURL), {
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
      throw new Error(`调用 ${cfg.model} 超时（120 秒）`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw new OpenAiHttpError(res.status, extractOpenAiError(raw) || `HTTP ${res.status}`);
  }

  const data = (await res.json()) as { choices?: OpenAiChoice[] };
  const choice = data.choices?.[0];
  if (!choice) throw new Error('模型没有返回任何内容');
  return choice;
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

function openaiProvider(cfg: ResolvedModel): AiProvider {
  return {
    name: `openai/${cfg.model}`,

    async json(req) {
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
        });

        const args = choice.message?.tool_calls?.[0]?.function?.arguments;
        if (args) return JSON.parse(args);
        // 有些兼容端点声称支持 tools，实际把结果当普通文本回。
        // 与其直接报错，不如按 json 模式再解一次 —— 内容往往是对的。
        const content = choice.message?.content?.trim();
        if (content) return JSON.parse(stripCodeFence(content));
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
      });

      const content = choice.message?.content?.trim();
      if (!content) throw new Error('模型返回了空内容');
      return JSON.parse(stripCodeFence(content));
    },

    async text(req) {
      const choice = await openaiCall(cfg, {
        messages: [{ role: 'system' as const, content: req.system }, ...req.messages],
        max_tokens: req.maxTokens,
        temperature: req.temperature,
      });
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

/* --------------------------------- 出口 --------------------------------- */

export function getProvider(cfg: ResolvedModel): AiProvider {
  switch (cfg.provider) {
    case 'anthropic':
      return anthropicProvider(cfg);
    case 'openai':
      return openaiProvider(cfg);
  }
}

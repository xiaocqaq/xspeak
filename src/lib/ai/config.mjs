/**
 * 模型配置。
 *
 * 一句话：**哪一步用哪个模型、走哪个协议，全部由环境变量决定，代码里不写死。**
 *
 * 放 .mjs 而不是 .ts：server.mjs 启动时要打印「每个角色实际用哪个模型」，
 * 它跑在 Next 编译流程之外，用不了 TS 也用不了 @/ 别名。同目录 config.ts
 * 是类型门面，应用代码从那边引。
 *
 * 分三个「角色」（role），因为这三件事对模型的要求差别很大：
 *
 * | role      | 用在哪                                   | 要什么              |
 * |-----------|------------------------------------------|---------------------|
 * | `content` | 出题：新词、语法、听力、阅读、口语场景   | 质量优先，慢一点没关系 |
 * | `chat`    | 对话回复（文本聊天 / 畅聊的文本旁路）    | 自然、别太慢         |
 * | `fast`    | 口语纠错、查词、素材抽词                 | 快优先，短输出        |
 *
 * 每个角色可以各自指定 provider / 模型 / 地址 / key，也可以什么都不写，
 * 那就落到全局默认（`AI_PROVIDER` / `AI_MODEL` / …），再落到内置默认值。
 *
 * 环境变量（`R` = CONTENT / CHAT / FAST）：
 *
 *   AI_PROVIDER            anthropic | openai      默认 anthropic
 *   AI_BASE_URL            接口地址（openai 协议填到 /v1 为止）
 *   AI_API_KEY             密钥
 *   AI_MODEL               模型名
 *   AI_{R}_PROVIDER        这一角色单独换协议
 *   AI_{R}_BASE_URL        这一角色单独换地址
 *   AI_{R}_API_KEY         这一角色单独换 key
 *   AI_{R}_MODEL           这一角色单独换模型
 *   AI_{R}_STRUCTURED      tool | json  仅 openai 协议：结构化输出怎么拿，默认 tool
 *
 * 兼容旧配置：没有上面这些时，仍然读 ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / LINXI_MODEL。
 * 所以老的 .env.local 不用改也能跑。
 *
 * 例：内容用 Claude、对话和纠错走 StepFun（OpenAI 协议）
 *   ANTHROPIC_API_KEY=sk-...
 *   AI_CHAT_PROVIDER=openai
 *   AI_CHAT_BASE_URL=https://api.stepfun.com/v1
 *   AI_CHAT_MODEL=step-3.5-flash
 *   AI_FAST_PROVIDER=openai
 *   AI_FAST_BASE_URL=https://api.stepfun.com/v1
 *   AI_FAST_MODEL=step-3.5-flash
 */

/** 调用角色到环境变量中缀的映射。新增角色时同步补 DEFAULT_MODELS。 */
const ROLE_ENV = {
  content: 'CONTENT',
  chat: 'CHAT',
  fast: 'FAST',
};

/** 所有角色，给 describeModels 和类型门面用。 */
export const AI_ROLES = ['content', 'chat', 'fast'];

/**
 * 内置默认模型。只在环境变量什么都没给的时候用到。
 * fast 角色故意选小模型：纠错要的是「立刻出结果」，不是文采。
 */
const DEFAULT_MODELS = {
  anthropic: {
    content: 'claude-opus-5',
    chat: 'claude-sonnet-5',
    fast: 'claude-haiku-4-5-20251001',
  },
  openai: {
    content: 'gpt-4.1',
    chat: 'gpt-4.1-mini',
    fast: 'gpt-4.1-mini',
  },
};

function env(name) {
  const v = process.env[name];
  const t = v?.trim();
  return t ? t : undefined;
}

/** 依次取第一个有值的环境变量。 */
function pick(...names) {
  for (const n of names) {
    const v = env(n);
    if (v) return v;
  }
  return undefined;
}

function parseProvider(raw, where) {
  if (!raw) return undefined;
  const v = raw.toLowerCase();
  if (v === 'anthropic' || v === 'claude') return 'anthropic';
  // openai 协议的兼容实现太多了，都归到 openai 这一支
  if (v === 'openai' || v === 'openai-compatible' || v === 'oai' || v === 'compatible') {
    return 'openai';
  }
  throw new Error(`${where} 只支持 anthropic 或 openai，收到 "${raw}"`);
}

/**
 * 解析某个角色最终用哪个模型。
 *
 * 每次调用都重新读 process.env，不缓存 —— 配置只在启动时定，
 * 读一次环境变量的开销远小于一次模型调用，换来的是改完 .env.local
 * 重启即生效，不用管有没有残留的模块级缓存。
 */
export function resolveModel(role) {
  const R = ROLE_ENV[role];

  const provider =
    parseProvider(env(`AI_${R}_PROVIDER`), `AI_${R}_PROVIDER`) ??
    parseProvider(env('AI_PROVIDER'), 'AI_PROVIDER') ??
    'anthropic';

  const baseURL =
    pick(`AI_${R}_BASE_URL`, 'AI_BASE_URL') ??
    (provider === 'anthropic' ? env('ANTHROPIC_BASE_URL') : undefined);

  const model =
    pick(`AI_${R}_MODEL`, 'AI_MODEL') ??
    // LINXI_MODEL 是旧变量，只对 anthropic 生效，避免把 claude 的名字带到 openai 端点上
    (provider === 'anthropic' ? env('LINXI_MODEL') : undefined) ??
    DEFAULT_MODELS[provider][role];

  const apiKey =
    pick(`AI_${R}_API_KEY`, 'AI_API_KEY') ??
    (provider === 'anthropic' ? env('ANTHROPIC_API_KEY') : env('OPENAI_API_KEY')) ??
    // 地址指向 StepFun 时顺手认 STEP_API_KEY：语音那边已经配过同一把 key，
    // 不逼着用户为同一个服务再填一遍。
    (provider === 'openai' && /stepfun\.com/i.test(baseURL ?? '') ? env('STEP_API_KEY') : undefined);

  if (!apiKey) {
    const hint =
      provider === 'anthropic'
        ? `AI_${R}_API_KEY 或 AI_API_KEY 或 ANTHROPIC_API_KEY`
        : `AI_${R}_API_KEY 或 AI_API_KEY 或 OPENAI_API_KEY`;
    throw new Error(`${role} 角色（${provider}）缺少密钥：请在 .env.local 里配 ${hint}`);
  }

  const rawStructured = pick(`AI_${R}_STRUCTURED`, 'AI_STRUCTURED')?.toLowerCase();
  if (rawStructured && rawStructured !== 'tool' && rawStructured !== 'json') {
    throw new Error(`AI_${R}_STRUCTURED 只支持 tool 或 json，收到 "${rawStructured}"`);
  }

  return {
    role,
    provider,
    model,
    baseURL,
    apiKey,
    structured: rawStructured ?? 'tool',
  };
}

/**
 * 打日志用的地址：只保留 origin。
 *
 * 不能整条打出来 —— 有的网关把凭证编在路径里（.../proxy/<base64 token>），
 * 那种地址进了日志就等于把 key 写进了日志。有路径时用 /… 表示"还有一截"，
 * 这样"配的到底是哪个网关"仍然看得出来。
 */
function safeUrl(raw) {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const rest = u.pathname && u.pathname !== '/' ? '/…' : '';
    return `${u.origin}${rest}`;
  } catch {
    // 连 URL 都解析不了，说明配错了。这时候原样回显反而帮人定位
    return raw;
  }
}

/** 给启动日志用：能看出每一步走哪个模型，但不泄露 key。 */
export function describeModels() {
  const out = [];
  for (const role of AI_ROLES) {
    try {
      const m = resolveModel(role);
      const at = m.baseURL ? ` @ ${safeUrl(m.baseURL)}` : '';
      out.push(`${role}: ${m.provider}/${m.model}${at}`);
    } catch (err) {
      out.push(`${role}: 未配置（${err.message}）`);
    }
  }
  return out;
}

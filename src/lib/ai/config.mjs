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
 *
 * ── 模型清单（可选，但设置页里能换模型靠的就是它）─────────────
 *
 * 上面那套是「一个角色一份配置」，改模型只能改文件。想在设置页里换，
 * 就先在这里列出这台机器上有哪些模型可用，每个模型给一份地址 + key：
 *
 *   AI_MODELS                        逗号分隔的模型 id 清单，顺序就是设置页里的顺序
 *   AI_MODEL_{ID}_LABEL              显示名，默认用 id
 *   AI_MODEL_{ID}_PROVIDER           anthropic | openai，默认回落全局 AI_PROVIDER
 *   AI_MODEL_{ID}_BASE_URL
 *   AI_MODEL_{ID}_API_KEY
 *   AI_MODEL_{ID}_MODEL              真正发给上游的模型名，默认就是 id 本身
 *   AI_MODEL_{ID}_STRUCTURED         tool | json
 *   AI_{角色}_MODEL_ID               这个角色默认挑清单里的哪一个
 *
 * `{ID}` 是 id 里的非字母数字换成下划线再转大写：`gpt-5.6-sol` → `GPT_5_6_SOL`。
 *
 * 例：三个模型任选，角色各给一个默认值
 *   AI_MODELS=gpt-5.6-sol,claude-opus-5,deepseek-v4-flash
 *   AI_MODEL_GPT_5_6_SOL_PROVIDER=openai
 *   AI_MODEL_GPT_5_6_SOL_BASE_URL=https://api.example.com/v1
 *   AI_MODEL_GPT_5_6_SOL_API_KEY=sk-...
 *   AI_MODEL_CLAUDE_OPUS_5_PROVIDER=anthropic
 *   AI_MODEL_CLAUDE_OPUS_5_API_KEY=sk-ant-...
 *   AI_MODEL_DEEPSEEK_V4_FLASH_PROVIDER=openai
 *   AI_MODEL_DEEPSEEK_V4_FLASH_BASE_URL=https://api.deepseek.com/v1
 *   AI_MODEL_DEEPSEEK_V4_FLASH_API_KEY=sk-...
 *   AI_CONTENT_MODEL_ID=claude-opus-5
 *   AI_CHAT_MODEL_ID=gpt-5.6-sol
 *   AI_FAST_MODEL_ID=deepseek-v4-flash
 *
 * 优先级：设置页存的选择 > AI_{角色}_MODEL_ID > 上面那套角色变量 > 内置默认。
 * 设置页只能在这份清单里挑 —— 地址和 key 始终留在服务端，前端换不了。
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
  // chat/completions 那一路：默认模型和 Responses 同款 —— 走这条路的
  // 多半是兼容端点，模型名由 AI_*_MODEL 指定，这里只是最后的兜底
  'openai-completion': {
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
  /*
   * openai 现在指 GPT 系原生的 Responses 协议（/responses）；
   * chat/completions 那套保留为显式的 openai-completion —— 兼容端点
   * （vLLM、Ollama、StepFun、老中转）只有这一条路，得能明确选它。
   * 历史别名（openai-compatible/oai/compatible）沿用旧语义归 completion。
   */
  if (v === 'openai' || v === 'responses') return 'openai';
  if (
    v === 'openai-completion' ||
    v === 'openai-compatible' ||
    v === 'oai' ||
    v === 'compatible'
  ) {
    return 'openai-completion';
  }
  throw new Error(`${where} 只支持 anthropic、openai 或 openai-completion，收到 "${raw}"`);
}

/**
 * 模型 id → 环境变量中缀。`gpt-5.6-sol` → `GPT_5_6_SOL`。
 *
 * 非字母数字一律换下划线：id 是给人看和存库的，得允许点和横线，
 * 但环境变量名里这些字符不合法。
 */
function envKeyFor(id) {
  return id.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
}

/** AI_MODELS 里列出的 id，去空去重，保留书写顺序（设置页照这个顺序显示）。 */
function catalogIds() {
  const raw = env('AI_MODELS');
  if (!raw) return [];
  const out = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * 清单里某一项的完整配置。
 *
 * 每一项都能只写一行（`AI_MODELS=claude-opus-5` + 全局 key），缺的往全局回落：
 * provider / baseURL / key / structured 都能继承 AI_* 那一套，
 * 模型名默认就是 id 本身 —— 清单里写的多半正是上游认的模型名。
 */
function catalogEntry(id) {
  const K = envKeyFor(id);

  const provider =
    parseProvider(env(`AI_MODEL_${K}_PROVIDER`), `AI_MODEL_${K}_PROVIDER`) ??
    parseProvider(env('AI_PROVIDER'), 'AI_PROVIDER') ??
    'anthropic';

  const baseURL =
    pick(`AI_MODEL_${K}_BASE_URL`, 'AI_BASE_URL') ??
    (provider === 'anthropic' ? env('ANTHROPIC_BASE_URL') : undefined);

  const apiKey =
    pick(`AI_MODEL_${K}_API_KEY`, 'AI_API_KEY') ??
    (provider === 'anthropic' ? env('ANTHROPIC_API_KEY') : env('OPENAI_API_KEY')) ??
    // openai 两种协议都可能是 StepFun 的地址，key 回退不该只认其中一种
    (/stepfun\.com/i.test(baseURL ?? '') ? env('STEP_API_KEY') : undefined);

  const rawStructured = pick(`AI_MODEL_${K}_STRUCTURED`, 'AI_STRUCTURED')?.toLowerCase();
  if (rawStructured && rawStructured !== 'tool' && rawStructured !== 'json') {
    throw new Error(`AI_MODEL_${K}_STRUCTURED 只支持 tool 或 json，收到 "${rawStructured}"`);
  }

  return {
    id,
    label: env(`AI_MODEL_${K}_LABEL`) ?? id,
    provider,
    model: env(`AI_MODEL_${K}_MODEL`) ?? id,
    baseURL,
    apiKey,
    structured: rawStructured ?? 'tool',
  };
}

/**
 * 可选模型清单，给设置页和启动日志用。
 *
 * **不含 key** —— 这份结构会经 /api/models 出到浏览器。`ready` 表示这一项
 * 有没有拿到密钥：没配 key 的项照样列出来但标成不可用，比直接藏起来好排查
 * （用户会问「我明明写了怎么不见」）。
 */
export function modelCatalog() {
  const out = [];
  for (const id of catalogIds()) {
    try {
      const e = catalogEntry(id);
      out.push({
        id: e.id,
        label: e.label,
        provider: e.provider,
        model: e.model,
        baseURL: e.baseURL ? safeUrl(e.baseURL) : undefined,
        ready: Boolean(e.apiKey),
      });
    } catch (err) {
      // 单项配错（比如 provider 写了别的）不该让整份清单出不来
      out.push({ id, label: id, provider: 'openai', model: id, ready: false, error: err.message });
    }
  }
  return out;
}

/** 某个角色默认挑清单里的哪一项；没配返回 undefined。 */
export function defaultModelId(role) {
  return env(`AI_${ROLE_ENV[role]}_MODEL_ID`);
}

/** 已经提示过的 id，避免每次调用都重复刷同一行日志。 */
const warnedMissing = new Set();

/**
 * 解析某个角色最终用哪个模型。
 *
 * `modelId` 是设置页存下来的选择，只在它命中 AI_MODELS 清单时才生效 ——
 * 清单是这台机器上「有地址有 key 的模型」的白名单，前端递上来的字符串
 * 不能直接当模型名用，否则等于让浏览器决定往哪个端点发请求。
 * 命中不了就当没选（清单被改小、或者那一项的 key 被撤了），回落到下面的角色变量。
 *
 * 每次调用都重新读 process.env，不缓存 —— 配置只在启动时定，
 * 读一次环境变量的开销远小于一次模型调用，换来的是改完 .env.local
 * 重启即生效，不用管有没有残留的模块级缓存。
 */
export function resolveModel(role, modelId) {
  const R = ROLE_ENV[role];

  const wanted = modelId?.trim() || defaultModelId(role);
  if (wanted) {
    const ids = catalogIds();
    if (ids.includes(wanted)) {
      const e = catalogEntry(wanted);
      if (e.apiKey) return { role, ...e };
      throw new Error(
        `${role} 角色选的模型 "${wanted}" 缺少密钥：请在 .env.local 里配 AI_MODEL_${envKeyFor(wanted)}_API_KEY`,
      );
    }
    // 选的不在清单里：往下走老路径，但说一声，否则用户以为设置页生效了
    if (!warnedMissing.has(wanted)) {
      warnedMissing.add(wanted);
      console.warn(
        `[linxi ai] ${role} 角色指定的模型 "${wanted}" 不在 AI_MODELS 清单里，改用角色变量`,
      );
    }
  }

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
    // 不逼着用户为同一个服务再填一遍。openai 两种协议都可能指 StepFun。
    (/stepfun\.com/i.test(baseURL ?? '') ? env('STEP_API_KEY') : undefined);

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
    // 没走清单，没有 id 可言。设置页据此显示「按配置文件」而不是硬挑一个选项
    id: undefined,
    label: model,
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

/**
 * 给启动日志用：能看出每一步走哪个模型，但不泄露 key。
 *
 * 只反映配置文件。设置页里改过的选择存在库里，启动时不查库 ——
 * 这行日志的用途是「.env.local 写对了吗」，掺进库里的值反而看不清是哪一层生效。
 */
export function describeModels() {
  const out = [];

  const catalog = modelCatalog();
  if (catalog.length) {
    out.push(
      `可选模型（AI_MODELS）：${catalog
        .map((m) => `${m.id}${m.ready ? '' : '（缺 key）'}`)
        .join('、')}`,
    );
  }

  for (const role of AI_ROLES) {
    try {
      const m = resolveModel(role);
      const at = m.baseURL ? ` @ ${safeUrl(m.baseURL)}` : '';
      const from = m.id ? ` ←${m.id}` : '';
      out.push(`${role}: ${m.provider}/${m.model}${at}${from}`);
    } catch (err) {
      out.push(`${role}: 未配置（${err.message}）`);
    }
  }
  return out;
}

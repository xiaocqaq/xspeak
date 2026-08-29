/**
 * 假的 OpenAI 协议端点，只为跑测试用。
 *
 * 为什么要它：「兼容 OpenAI 协议」这件事的正确性不在我们这边 ——
 * 请求发得对不对、结构化输出两条路（function calling / json_object）
 * 拿不拿得到东西，都得有个端点照着协议回话才看得出来。拿真的服务商去试
 * 要花钱、要 key、还受网络影响，而且它对了我也不知道是不是碰巧对了。
 *
 * 所以这里按协议搓一个替身，它做三件真端点会做的事：
 *   1. 校验请求形状（Bearer、model、messages、tools/response_format）；
 *   2. 照着请求里给的 JSON Schema 生成一份合规的假数据回去；
 *   3. 按 MOCK_MODE 模拟几种「兼容实现的怪毛病」，看我们的代码兜不兜得住。
 *
 * MOCK_MODE：
 *   tool          （默认）规规矩矩回 tool_calls
 *   text-instead  声称支持 tools，却把 JSON 当普通文本回 —— 常见于中转
 *   fenced        JSON 裹在 ```json 代码块里
 *   stringified   把嵌套数组序列化成字符串塞进字段（模型的老毛病）
 *   bad-json      回一段解不动的东西，用来看重试和报错
 *   http-401 / http-429 / http-500   直接回错误码，用来验重试策略
 *   newmodel      学 OpenAI 新模型：不认 max_tokens、只收默认温度
 *   no-json-mode  不认 response_format（llama.cpp、部分中转就是这样）
 *   not-openai    回一坨别的结构，没有 choices
 *   picky         上面三种毛病一起犯，验多轮适配
 *
 * 用法：
 *   node scripts/mock-openai.mjs                    # 听 127.0.0.1:19998
 *   PORT=19998 MOCK_MODE=fenced node scripts/mock-openai.mjs
 *
 * 每次请求都会往 stderr 打一行摘要，测试脚本靠它断言「发过来的是什么」。
 * 只在测试里用：不限流、不校验 key 内容、生成的英文是占位文本。
 */

import { createServer } from 'node:http';

const PORT = Number.parseInt(process.env.PORT ?? '19998', 10);
const HOST = process.env.HOST ?? '127.0.0.1';
const MODE = process.env.MOCK_MODE ?? 'tool';

/** 收到过的请求，GET /_calls 能取回来，测试脚本据此断言。 */
const calls = [];

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/_calls') {
    return json(res, 200, { calls });
  }
  if (req.method === 'POST' && req.url === '/_reset') {
    calls.length = 0;
    return json(res, 200, { ok: true });
  }

  let raw = '';
  req.on('data', (c) => {
    raw += c;
  });
  req.on('end', () => {
    // 路径必须是 /chat/completions 结尾 —— baseURL 拼错是最常见的配置错误，
    // 这里回 404 而不是宽容匹配，才能在测试里暴露出来
    if (!req.url.endsWith('/chat/completions')) {
      return json(res, 404, { error: { message: `没有这个接口：${req.url}` } });
    }

    const auth = req.headers.authorization ?? '';
    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return json(res, 400, { error: { message: '请求体不是 JSON' } });
    }

    const tool = body.tools?.[0]?.function;
    calls.push({
      url: req.url,
      bearer: auth.startsWith('Bearer ') ? auth.slice(7).length : 0,
      model: body.model,
      // 只记形状，不记内容：内容里有提示词，长且没用
      roles: (body.messages ?? []).map((m) => m.role),
      systemCount: (body.messages ?? []).filter((m) => m.role === 'system').length,
      toolName: tool?.name,
      toolChoice: body.tool_choice?.function?.name ?? body.tool_choice?.type ?? body.tool_choice,
      responseFormat: body.response_format?.type,
      maxTokens: body.max_tokens,
      maxCompletionTokens: body.max_completion_tokens,
      temperature: body.temperature,
      schemaKeys: tool?.parameters ? Object.keys(tool.parameters.properties ?? {}) : undefined,
    });
    process.stderr.write(
      `[mock-openai] ${MODE} model=${body.model} tools=${tool?.name ?? '-'} rf=${body.response_format?.type ?? '-'} sys=${calls.at(-1).systemCount}\n`,
    );

    if (!auth.startsWith('Bearer ') || auth.length < 10) {
      return json(res, 401, { error: { message: '缺少或格式不对的 Authorization' } });
    }
    if (!body.model) return json(res, 400, { error: { message: '缺少 model' } });
    if (!Array.isArray(body.messages) || !body.messages.length) {
      return json(res, 400, { error: { message: '缺少 messages' } });
    }

    const m = /^http-(\d+)$/.exec(MODE);
    if (m) {
      return json(res, Number(m[1]), { error: { message: `模拟 ${m[1]}` } });
    }

    // 参数上的挑剔。照真实端点的措辞回 400，验对面能不能自己改形状再来
    const picky = MODE === 'picky';
    if ((picky || MODE === 'newmodel') && 'max_tokens' in body) {
      return json(res, 400, {
        error: {
          message:
            "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
          type: 'invalid_request_error',
          param: 'max_tokens',
        },
      });
    }
    if ((picky || MODE === 'newmodel') && body.temperature !== undefined && body.temperature !== 1) {
      return json(res, 400, {
        error: {
          message: "Unsupported value: 'temperature' does not support 0.7 with this model. Only the default (1) value is supported.",
          type: 'invalid_request_error',
          param: 'temperature',
        },
      });
    }
    if ((picky || MODE === 'no-json-mode') && body.response_format) {
      return json(res, 400, {
        error: { message: "Invalid parameter: 'response_format' is not supported.", param: 'response_format' },
      });
    }
    if (MODE === 'not-openai') {
      return json(res, 200, { output: '我不是 OpenAI 协议', usage: {} });
    }

    // schema 从哪来：tools 那一路在 function.parameters 里，
    // json 那一路是我们自己把 schema 当一条 system 消息塞进去的
    const schema = tool?.parameters ?? schemaFromMessages(body.messages);
    if (!schema) {
      return reply(res, '这是一段普通回复。Nice to meet you!', false);
    }

    const sample = generate(schema);

    if (MODE === 'bad-json') return reply(res, '{"a": [1, 2', false);
    if (MODE === 'stringified') return finish(res, stringifyNested(sample), body, false);
    if (MODE === 'fenced') return finish(res, sample, body, false, true);
    if (MODE === 'text-instead') return finish(res, sample, body, false);
    return finish(res, sample, body, Boolean(tool));
  });
});

/** 有 tools 就回 tool_calls，否则当文本回。 */
function finish(res, sample, body, asTool, fenced = false) {
  const text = JSON.stringify(sample);
  if (asTool) {
    return json(res, 200, {
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      model: body.model,
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_mock',
                type: 'function',
                function: { name: body.tools[0].function.name, arguments: text },
              },
            ],
          },
        },
      ],
    });
  }
  return reply(res, fenced ? '```json\n' + text + '\n```' : text, false);
}

function reply(res, content) {
  return json(res, 200, {
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
  });
}

/** json 模式下 schema 是拼在 system 消息里的，挖出来。 */
function schemaFromMessages(messages) {
  for (const msg of messages) {
    if (msg.role !== 'system' || typeof msg.content !== 'string') continue;
    const i = msg.content.indexOf('{"');
    if (i < 0) continue;
    try {
      return JSON.parse(msg.content.slice(i));
    } catch {
      // 不是这条
    }
  }
  return undefined;
}

/**
 * 照 JSON Schema 造一份最小合规数据。
 *
 * 只认这套代码实际会生成的子集（object / array / string / number / boolean / enum），
 * 不认 $ref —— schemas.ts 生成出来是平的，真出现了应该让测试挂掉而不是猜。
 */
function generate(schema, path = '') {
  if (!schema || typeof schema !== 'object') return null;
  if (schema.$ref) throw new Error(`不支持 $ref（${path}）`);
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;

  switch (schema.type) {
    case 'object': {
      const out = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) {
        out[k] = generate(v, `${path}.${k}`);
      }
      return out;
    }
    case 'array': {
      const n = Math.max(schema.minItems ?? 1, 1);
      const take = schema.maxItems ? Math.min(n, schema.maxItems) : n;
      return Array.from({ length: take }, (_, i) => generate(schema.items, `${path}[${i}]`));
    }
    case 'integer':
      return schema.minimum ?? 1;
    case 'number':
      return schema.minimum ?? 1;
    case 'boolean':
      return true;
    case 'string':
    default:
      // 内容无所谓，但不能是空串：好几个字段在 zod 那边是非空的
      return `mock ${path.replace(/^\./, '') || 'value'}`;
  }
}

/**
 * 把嵌套的数组/对象序列化成字符串。
 * 模拟模型「把数组写成一段 JSON 文本」那个毛病，验 client.ts 的 unwrapJsonStrings。
 */
function stringifyNested(value) {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        v && typeof v === 'object' ? JSON.stringify(v) : v,
      ]),
    );
  }
  return value;
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

server.listen(PORT, HOST, () => {
  process.stderr.write(`[mock-openai] ${MODE} 听 http://${HOST}:${PORT}/v1/chat/completions\n`);
});

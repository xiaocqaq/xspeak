/**
 * 离线回归：node --test scripts/test-ai-requests.mjs
 * 内存转译两个 AI 模块，替换模型选择；真实 Anthropic SDK + 假 fetch，不访问 AI/数据库。
 * 响应使用本地 ReadableStream，计时使用 node:test mock timers，不需要实际等待。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Script, createContext } from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const Anthropic = require('@anthropic-ai/sdk').default;
const compiled = new Map(['providers', 'client'].map((name) => {
  const file = fileURLToPath(new URL(`../src/lib/ai/${name}.ts`, import.meta.url));
  const result = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    reportDiagnostics: true,
  });
  const errors = result.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error) ?? [];
  assert.equal(errors.length, 0, errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
  return [name, new Script(`(function(require, module, exports) {\n${result.outputText}\n})`, { filename: file })];
}));

const protocols = ['openai-completion', 'openai', 'anthropic'];
const options = { concurrency: false, timeout: 2000 };
const schema = z.object({ value: z.string() });
const jsonOpts = { system: 'test', prompt: 'test', timeoutMs: 100, maxTokens: 100 };

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function clock(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 });
}

function runtime(protocol, fetch, select) {
  const cfg = {
    provider: protocol, model: 'offline-test-model', apiKey: 'offline-test-key',
    baseURL: 'https://ai.invalid/v1', structured: 'tool', role: 'content',
  };
  const logs = [];
  const sdkOptions = [];
  class OfflineAnthropic extends Anthropic {
    constructor(opts) {
      sdkOptions.push(opts);
      super({ ...opts, fetch, logLevel: 'off' });
    }
  }
  const context = createContext({
    fetch, AbortController, URL, Error, Date, setTimeout, clearTimeout,
    console: { log: (...args) => logs.push(args.join(' ')), warn: (...args) => logs.push(args.join(' ')) },
  });
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const module = { exports: {} };
    cache.set(name, module.exports);
    const localRequire = (id) => {
      if (id === 'zod') return { z };
      if (id === '@anthropic-ai/sdk') return { __esModule: true, default: OfflineAnthropic };
      if (id === './providers') return load('providers');
      if (id === './selection') return { modelForRole: async () => select ? select(cfg) : cfg };
      throw new Error(`测试禁止加载外部模块：${id}`);
    };
    compiled.get(name).runInContext(context)(localRequire, module, module.exports);
    return module.exports;
  }
  return { cfg, logs, sdkOptions, providers: load('providers'), client: load('client') };
}

/** fetch 已返回响应头，正文由测试显式送达，abort 会真正中断正文读取。 */
function responseBody(signal, status) {
  let controller;
  let settled = false;
  const reading = deferred();
  const stream = new ReadableStream({ start(c) { controller = c; } });
  const finish = () => {
    assert.equal(settled, false, '正文只能结束一次');
    settled = true;
    signal.removeEventListener('abort', abort);
  };
  const abort = () => {
    if (settled) return;
    finish();
    controller.error(signal.reason);
  };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const response = new Response(stream, { status, headers: { 'content-type': 'application/json' } });
  for (const method of ['json', 'text']) {
    const read = response[method].bind(response);
    response[method] = () => { reading.resolve(); return read(); };
  }
  return {
    response, reading: reading.promise,
    send(value) {
      finish();
      controller.enqueue(new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)));
      controller.close();
    },
    fail(error) { finish(); controller.error(error); },
  };
}

function transport({ status = 200, onRequest } = {}) {
  const calls = [];
  const arrivals = new Map();
  return {
    calls,
    async fetch(url, init) {
      assert.equal(new URL(url).hostname, 'ai.invalid');
      const index = calls.length;
      const call = {
        url, init, payload: JSON.parse(init.body),
        ...responseBody(init.signal, typeof status === 'function' ? status(index) : status),
      };
      calls.push(call);
      arrivals.get(index)?.resolve(call);
      onRequest?.(call, index);
      return call.response;
    },
    async at(index) {
      if (!calls[index] && !arrivals.has(index)) arrivals.set(index, deferred());
      const call = calls[index] ?? await arrivals.get(index).promise;
      await call.reading;
      return call;
    },
  };
}

function reply(protocol, value, { text = false, truncated = false } = {}) {
  const args = JSON.stringify(value);
  if (protocol === 'openai-completion') {
    const message = value === undefined ? {} : text ? { content: value } : {
      tool_calls: [{ type: 'function', function: { name: 'emit_result', arguments: args } }],
    };
    return {
      choices: [{ message, finish_reason: truncated ? 'length' : 'stop' }],
      usage: { prompt_tokens: 7, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 2 } },
    };
  }
  if (protocol === 'openai') {
    const output = value === undefined ? [] : text
      ? [{ type: 'message', content: [{ type: 'output_text', text: value }] }]
      : [{ type: 'function_call', name: 'emit_result', arguments: args }];
    return {
      output, status: truncated ? 'incomplete' : 'completed',
      incomplete_details: truncated ? { reason: 'max_output_tokens' } : null,
      usage: { input_tokens: 7, output_tokens: 5, output_tokens_details: { reasoning_tokens: 2 } },
    };
  }
  return {
    id: 'msg_test', type: 'message', role: 'assistant', model: 'offline-test-model',
    content: value === undefined ? [] : text
      ? [{ type: 'text', text: value }]
      : [{ type: 'tool_use', id: 'tool_test', name: 'emit_result', input: value }],
    stop_reason: truncated ? 'max_tokens' : 'end_turn',
    usage: { input_tokens: 7, output_tokens: 5 },
  };
}

function timeoutError(h) {
  return (error) => {
    assert.ok(error instanceof h.client.AiError);
    assert.ok(error.cause instanceof h.providers.UpstreamTimeoutError, error.message);
    assert.equal(error.cause.model, h.cfg.model);
    assert.match(error.message, /超时/);
    assert.doesNotMatch(error.message, /没有 choices|没有 output|AI 服务返回/);
    return true;
  };
}

function tokenBudget(protocol, call) {
  return protocol === 'openai' ? call.payload.max_output_tokens : call.payload.max_tokens;
}

for (const protocol of protocols) {
  for (const status of [200, 400, 503]) {
    test(`${protocol}: headers 到达后 ${status} 正文卡住，只发一次且报告超时`, options, async (t) => {
      clock(t);
      const wire = transport({ status });
      const h = runtime(protocol, wire.fetch);
      const rejected = assert.rejects(h.client.generateJson(schema, jsonOpts), timeoutError(h));
      const call = await wire.at(0);
      t.mock.timers.tick(99);
      assert.equal(call.init.signal.aborted, false);
      t.mock.timers.tick(1);
      await rejected;
      assert.equal(call.init.signal.aborted, true);
      t.mock.timers.tick(1_000);
      assert.equal(wire.calls.length, 1, '超时不得触发第二次付费请求');
    });
  }

  test(`${protocol}: headers 前超时不重发`, options, async (t) => {
    clock(t);
    const started = deferred();
    let calls = 0;
    const h = runtime(protocol, async (_url, { signal }) => {
      calls++;
      started.resolve(signal);
      return new Promise((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const rejected = assert.rejects(h.client.generateJson(schema, jsonOpts), timeoutError(h));
    const signal = await started.promise;
    t.mock.timers.tick(100);
    await rejected;
    assert.equal(signal.aborted, true);
    assert.equal(calls, 1);
  });

  test(`${protocol}: JSON/text 成功、usage 保留，成功后清理计时器`, options, async (t) => {
    clock(t);
    const wire = transport({
      onRequest(call, i) { call.send(reply(protocol, i === 0 ? { value: 'ok' } : '  hello  ', { text: i === 1 })); },
    });
    const h = runtime(protocol, wire.fetch);
    assert.deepEqual(await h.client.generateJson(schema, jsonOpts), { value: 'ok' });
    assert.equal(await h.client.generateText({ system: 'test', messages: [], timeoutMs: 100 }), 'hello');
    assert.equal(wire.calls.length, 2);
    assert.ok(h.logs.some((line) => line.includes('in=7 out=5')));
    if (protocol !== 'anthropic') assert.ok(h.logs.some((line) => line.includes('reasoning=2')));
    t.mock.timers.tick(1_000);
    assert.ok(wire.calls.every((call) => !call.init.signal.aborted), '完成后不应再 abort');
  });

  test(`${protocol}: 普通 HTTP 401 保留原错误且不重试`, options, async (t) => {
    clock(t);
    const wire = transport({ status: 401, onRequest(call) { call.send({ error: { message: 'bad key' } }); } });
    const h = runtime(protocol, wire.fetch);
    await assert.rejects(h.client.generateJson(schema, jsonOpts), (err) => {
      assert.match(err.message, /AI 服务返回 401/);
      assert.match(err.message, /bad key/);
      assert.equal(err.cause.status, 401);
      return true;
    });
    t.mock.timers.tick(1_000);
    assert.equal(wire.calls.length, 1);
    assert.equal(wire.calls[0].init.signal.aborted, false);
  });

  test(`${protocol}: schema 重试只剩 60ms，不重新获得 100ms`, options, async (t) => {
    clock(t);
    const wire = transport();
    const h = runtime(protocol, wire.fetch);
    const rejected = assert.rejects(h.client.generateJson(schema, jsonOpts), timeoutError(h));
    const first = await wire.at(0);
    t.mock.timers.tick(40);
    first.send(reply(protocol, { value: 42 }));
    const second = await wire.at(1);
    assert.equal(tokenBudget(protocol, second), 100, 'schema 错误不放大 token 预算');
    t.mock.timers.tick(59);
    assert.equal(second.init.signal.aborted, false);
    t.mock.timers.tick(1);
    await rejected;
    assert.equal(second.init.signal.aborted, true);
    assert.equal(first.init.signal.aborted, false);
    assert.equal(wire.calls.length, 2);
  });

  test(`${protocol}: 截断后放大 maxTokens，剩余预算内可成功`, options, async (t) => {
    clock(t);
    const wire = transport();
    const h = runtime(protocol, wire.fetch);
    const pending = h.client.generateJson(schema, jsonOpts);
    const first = await wire.at(0);
    t.mock.timers.tick(40);
    first.send(reply(protocol, undefined, { truncated: true }));
    const second = await wire.at(1);
    assert.equal(tokenBudget(protocol, second), 200);
    t.mock.timers.tick(59);
    second.send(reply(protocol, { value: 'recovered' }));
    assert.deepEqual(await pending, { value: 'recovered' });
    t.mock.timers.tick(1_000);
    assert.equal(wire.calls.length, 2);
    assert.ok(wire.calls.every((call) => !call.init.signal.aborted));
  });

  test(`${protocol}: schema 一直失败最多尝试两次`, options, async (t) => {
    clock(t);
    const wire = transport({ onRequest(call) { call.send(reply(protocol, { value: 42 })); } });
    const h = runtime(protocol, wire.fetch);
    await assert.rejects(h.client.generateJson(schema, jsonOpts), (err) => err.cause instanceof z.ZodError);
    assert.equal(wire.calls.length, 2);
  });

  test(`${protocol}: generateText 也受正文超时约束`, options, async (t) => {
    clock(t);
    const wire = transport();
    const h = runtime(protocol, wire.fetch);
    const rejected = assert.rejects(h.client.generateText({ system: 'test', messages: [], timeoutMs: 100 }), timeoutError(h));
    await wire.at(0);
    t.mock.timers.tick(100);
    await rejected;
    assert.equal(wire.calls.length, 1);
  });

  test(`${protocol}: 预算已经耗尽则不发请求`, options, async (t) => {
    clock(t);
    const wire = transport();
    const h = runtime(protocol, wire.fetch, (cfg) => {
      t.mock.timers.setTime(Date.now() + 100);
      return cfg;
    });
    await assert.rejects(h.client.generateJson(schema, jsonOpts), timeoutError(h));
    assert.equal(wire.calls.length, 0);
  });
}

for (const protocol of ['openai-completion', 'openai']) {
  for (const status of [200, 400]) {
    test(`${protocol}: 正文自身的 AbortError 不伪装成协议/HTTP 错误 (${status})`, options, async (t) => {
      clock(t);
      const wire = transport({ status });
      const h = runtime(protocol, wire.fetch);
      const rejected = assert.rejects(h.client.generateJson(schema, jsonOpts), timeoutError(h));
      const call = await wire.at(0);
      call.fail(new DOMException('body aborted', 'AbortError'));
      await rejected;
      assert.equal(wire.calls.length, 1);
    });
  }

  test(`${protocol}: 非 JSON 正文仍报告协议不匹配`, options, async (t) => {
    clock(t);
    const wire = transport({ onRequest(call) { call.send('not json'); } });
    const h = runtime(protocol, wire.fetch);
    await assert.rejects(h.providers.getProvider(h.cfg).text({
      system: 'test', messages: [], maxTokens: 100, temperature: 0.7, timeoutMs: 100,
    }), /可能不是.*协议的端点/);
    assert.equal(wire.calls.length, 1);
    t.mock.timers.tick(100);
    assert.equal(wire.calls[0].init.signal.aborted, false);
  });
}

test('schema 校验耗尽总预算后，不发送第二次请求', options, async (t) => {
  clock(t);
  const wire = transport({ onRequest(call) { call.send(reply('openai', { value: 'ok' })); } });
  const h = runtime('openai', wire.fetch);
  const slowSchema = schema.superRefine((_value, ctx) => {
    t.mock.timers.setTime(1_000_100);
    ctx.addIssue({ code: 'custom', message: 'schema rejected' });
  });
  await assert.rejects(h.client.generateJson(slowSchema, jsonOpts), timeoutError(h));
  assert.equal(wire.calls.length, 1);
});

test('Completion 参数兼容重发也只使用剩余预算', options, async (t) => {
  clock(t);
  const wire = transport({ status: (i) => i === 0 ? 400 : 200 });
  const h = runtime('openai-completion', wire.fetch);
  const rejected = assert.rejects(h.client.generateJson(schema, jsonOpts), timeoutError(h));
  const first = await wire.at(0);
  t.mock.timers.tick(40);
  first.send({ error: { message: 'Unsupported max_tokens, use max_completion_tokens' } });
  const second = await wire.at(1);
  assert.equal(second.payload.max_completion_tokens, 100);
  assert.equal(second.payload.max_tokens, undefined);
  t.mock.timers.tick(60);
  await rejected;
  assert.equal(wire.calls.length, 2);
});

test('Completion 参数兼容循环到截止时间，不再挤出 1ms 发请求', options, async (t) => {
  clock(t);
  const wire = transport({
    status: 400,
    onRequest(call) {
      const read = call.response.text.bind(call.response);
      call.response.text = async () => {
        const text = await read();
        t.mock.timers.setTime(1_000_100);
        return text;
      };
      call.send({ error: { message: 'Unsupported max_tokens, use max_completion_tokens' } });
    },
  });
  const h = runtime('openai-completion', wire.fetch);
  await assert.rejects(h.client.generateJson(schema, jsonOpts), timeoutError(h));
  assert.equal(wire.calls.length, 1);
});

test('Anthropic SDK 不隐式重试 429，不增加付费请求数', options, async (t) => {
  clock(t);
  const wire = transport({ status: 429, onRequest(call) { call.send({ error: { message: 'rate limited' } }); } });
  const h = runtime('anthropic', wire.fetch);
  await assert.rejects(h.client.generateJson(schema, jsonOpts), (err) => err.cause.status === 429);
  assert.equal(h.sdkOptions[0].maxRetries, 0);
  t.mock.timers.tick(10_000);
  assert.equal(wire.calls.length, 1);
});

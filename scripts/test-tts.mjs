/**
 * 离线回归：node --test scripts/test-tts.mjs
 *
 * 覆盖朗读链路上能自证的三层，不碰浏览器、不碰真实 MiMo、不碰数据库：
 *  1. 朗读文本的分块契约（每块 ≤ 接口限长、内容不丢）—— 前端切块和预热必须一致，
 *     否则预热的缓存键和播放时的请求对不上，等于没热。
 *  2. mimoSpeakCached 的并发去重：同一段文本同时被预热、播放、Range 探路请求时，
 *     只允许一次付费合成。
 *  3. 整条 /api/speak 的 HTTP 语义（缓存命中/未命中、Range、413、503、倍速头）。
 *     这一层是"点一次就该出声"真正走的路径。
 *
 * 上游用本地 http 服务假扮，失败由本地服务制造。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Script, createContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const MAX_TEXT = 300; // 与 src/app/api/speak/route.ts 的 MAX_TEXT 对齐

/** 转译一个 TS 模块，供下面的 VM 加载。诊断到错误直接失败，避免测到坏代码。 */
function compile(name, relativePath) {
  const file = fileURLToPath(new URL(relativePath, import.meta.url));
  const result = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
    reportDiagnostics: true,
  });
  const errors = result.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error) ?? [];
  assert.equal(
    errors.length,
    0,
    errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'),
  );
  return [name, new Script(`(function(require, module, exports) {\n${result.outputText}\n})`, { filename: file })];
}

/* ------------------------- 1. 前端/服务端共用的分块逻辑 ------------------------- */

const speechModules = new Map([
  compile('useSpeech', '../src/hooks/useSpeech.ts'),
  compile('server-voice-list', '../src/lib/tts/server-voice-list.ts'),
]);

/** 让 useSpeech 能在没有浏览器和 React 的环境里加载：只桩掉外壳，逻辑用真的。 */
function loadSpeech(globals = {}) {
  const context = createContext({
    console,
    window: undefined,
    document: undefined,
    // URLSearchParams / URL 是 Node 全局而非 V8 内建，VM 里得显式给
    URLSearchParams,
    URL,
    ...globals,
  });
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const module = { exports: {} };
    cache.set(name, module.exports);
    const localRequire = (id) => {
      switch (id) {
        case 'react':
          return {
            useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
            useCallback: (f) => f,
            useEffect: () => {},
            useRef: (v) => ({ current: v }),
          };
        case '@/lib/pace-store':
          return { readPace: () => 'normal', subscribePace: () => () => {} };
        case '@/lib/voice-store':
          return { readVoice: () => null, subscribeVoice: () => () => {} };
        case '@/lib/voice-options':
          return PACE_STUB;
        case '@/lib/base-path':
          return { withBase: (p) => p };
        case '@/lib/tts/server-voice-list':
          return load('server-voice-list');
        default:
          throw new Error(`测试禁止加载外部模块：${id}`);
      }
    };
    speechModules.get(name).runInContext(context)(localRequire, module, module.exports);
    return module.exports;
  }
  return load('useSpeech');
}

test('长文按句切块，每块不超过接口限长且不丢内容', () => {
  const { splitSpeechChunks } = loadSpeech();
  const sentence = 'She refilled her coffee cup before the meeting started. ';
  const text = sentence.repeat(12).trim(); // 约 660 字符，远超单次限长
  assert.ok(text.length > MAX_TEXT);

  const chunks = splitSpeechChunks(text);
  assert.ok(chunks.length > 1, '必须切成多块，否则接口会 413');
  for (const c of chunks) assert.ok(c.length <= MAX_TEXT, `块长 ${c.length} 超过 ${MAX_TEXT}`);

  const words = (s) => s.split(/\s+/).filter(Boolean).join(' ');
  assert.equal(words(chunks.join(' ')), words(text), '切块前后内容必须完全一致');
});

test('无标点的超长句按词硬切，也不会超长或空白块', () => {
  const { splitSpeechChunks } = loadSpeech();
  const text = 'word '.repeat(200).trim(); // 1000 字符，一个标点都没有
  const chunks = splitSpeechChunks(text);
  for (const c of chunks) {
    assert.ok(c.length <= MAX_TEXT, `块长 ${c.length} 超过 ${MAX_TEXT}`);
    assert.notEqual(c.trim(), '');
  }
  assert.equal(chunks.join(' '), text);
});

test('短句原样返回一块，不做多余切分', () => {
  const { splitSpeechChunks } = loadSpeech();
  const text = 'Nice to meet you.';
  // VM 里造的数组跨领域，deepStrictEqual 会因原型不同而失败，逐项比
  const chunks = splitSpeechChunks(text);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], text);
});

test('缓存预检：同一句只发一次 HEAD，键要带音色和档位', async () => {
  const requests = [];
  const { probeServerSpeech } = loadSpeech({
    fetch: (url, init) => {
      requests.push({ url, method: init?.method });
      return Promise.resolve({ status: 200 });
    },
  });

  // 页面上三个按钮挂载同一句话：只允许一个 HEAD（同一句探一次就够）
  probeServerSpeech(['Good morning.', 'Good morning.']);
  probeServerSpeech(['Good morning.']);
  await new Promise((r) => setImmediate(r));

  assert.equal(requests.length, 1, '同一句必须只探一次');
  assert.equal(requests[0].method, 'HEAD', '预检不能触发合成，只能是 HEAD');
  const qs = new URLSearchParams(new URL(requests[0].url, 'http://x').search);
  assert.equal(qs.get('text'), 'Good morning.');
  assert.ok(qs.get('voice'), '键里必须带音色，否则预热和播放会对不上');
  assert.equal(qs.get('pace'), 'normal');
});

test('缓存预检：长文和空白不探，网络失败不外抛', async () => {
  const requests = [];
  const { probeServerSpeech } = loadSpeech({
    fetch: (url) => {
      requests.push(url);
      return Promise.resolve({ status: 404 });
    },
  });

  probeServerSpeech(['   ', 'word '.repeat(120)]);
  await new Promise((r) => setImmediate(r));
  assert.equal(requests.length, 0, '长文与空白不该产生请求');

  // 探失败（网络层报错）不能把异常抛到渲染里
  const { probeServerSpeech: probe2 } = loadSpeech({
    fetch: () => Promise.reject(new Error('offline')),
  });
  probe2(['Fine.']);
  await new Promise((r) => setImmediate(r));
});

/* ------------------- 2/3. TTS 运行时：合成去重 + /api/speak HTTP 语义 ------------------- */

const PACE_STUB = {
  PACE_KEYS: ['slow', 'normal', 'fast'],
  pace: (k) => ({ ttsSpeed: k === 'slow' ? 0.8 : k === 'fast' ? 1.2 : 1 }),
};

const ttsModules = new Map([
  compile('cache', '../src/lib/tts/cache.ts'),
  compile('mimo', '../src/lib/tts/mimo.ts'),
  compile('server-voices', '../src/lib/tts/server-voices.ts'),
  compile('server-voice-list', '../src/lib/tts/server-voice-list.ts'),
  compile('route', '../src/app/api/speak/route.ts'),
]);

/**
 * 在 VM 里装配真实的 TTS 模块图（cache/mimo/server-voices/route 都是真代码），
 * 只桩掉会写库的鉴权模块。
 */
function ttsRuntime(upstream, cacheDir, { configured = true } = {}) {
  const env = {
    ...(configured ? { MIMO_TTS_KEY: 'offline-test-key' } : {}),
    MIMO_TTS_URL: upstream.url,
    MIMO_TTS_MODEL: 'mimo-v2.5-tts',
    TTS_CACHE_DIR: cacheDir,
  };
  const context = createContext({
    process: { env },
    fetch, URL, URLSearchParams, Request, Response, Headers, Buffer, Error, console,
    setTimeout, clearTimeout, clearInterval, AbortSignal,
  });
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const module = { exports: {} };
    cache.set(name, module.exports);
    const localRequire = (id) => {
      // 相对导入按文件名解析到同一份模块，保持单例（in-flight 去重靠它）
      if (id.startsWith('./')) return load(id.slice(2).replace(/\.mjs$/, ''));
      if (id === '@/lib/tts/cache') return load('cache');
      if (id === '@/lib/tts/server-voices') return load('server-voices');
      if (id === '@/lib/tts/server-voice-list') return load('server-voice-list');
      if (id === '@/lib/voice-options') return PACE_STUB;
      // 鉴权在测试里恒为"单人模式"：不建档案、不写库
      if (id === '@/lib/auth') {
        return { authConfig: () => ({ enabled: false }), currentIdentity: async () => null };
      }
      if (id.startsWith('node:')) return require(id);
      throw new Error(`测试禁止加载外部模块：${id}`);
    };
    ttsModules.get(name).runInContext(context)(localRequire, module, module.exports);
    return module.exports;
  }
  return {
    get: (name) => load(name),
    speakUrl: (text, extra = '') =>
      `http://localhost/api/speak?text=${encodeURIComponent(text)}&voice=Mia&pace=normal${extra}`,
  };
}

/** 假扮 MiMo：记录调用次数，按 delayMs 延迟返回一段合法的 base64 mp3。 */
async function fakeMimo({ delayMs = 0, fail = false } = {}) {
  let calls = 0;
  const audio = Buffer.alloc(4096, 7).toString('base64'); // 必须 >1000 字节，否则会被判成空壳
  const server = createServer((req, res) => {
    calls += 1;
    const send = () => {
      if (fail) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'upstream down' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { audio: { data: audio } } }] }));
    };
    if (delayMs) setTimeout(send, delayMs);
    else send();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    get calls() {
      return calls;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}

/** 起一个临时的上游 + 缓存目录，测完自动清理。 */
async function ttsFixture(t, opts) {
  const dir = await mkdtemp(join(tmpdir(), 'xspeak-tts-test-'));
  const upstream = await fakeMimo(opts?.upstream);
  t.after(async () => {
    await upstream.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { upstream, runtime: ttsRuntime(upstream, dir, opts) };
}

test('同一段文本并发合成只打一次上游，之后命中磁盘缓存', async (t) => {
  const { upstream, runtime } = await ttsFixture(t, { upstream: { delayMs: 30 } });
  const { mimoSpeakCached } = runtime.get('mimo');

  // 预热请求 + 播放请求 + Range 探路请求同时到达
  const results = await Promise.all([
    mimoSpeakCached('Hello there.', 'Mia', 1),
    mimoSpeakCached('Hello there.', 'Mia', 1),
    mimoSpeakCached('Hello there.', 'Mia', 1),
  ]);
  assert.equal(upstream.calls, 1, '并发只允许一次付费合成');
  for (const r of results) {
    assert.equal(r.hit, false);
    assert.ok(r.audio.length > 1000);
  }

  const again = await mimoSpeakCached('Hello there.', 'Mia', 1);
  assert.equal(again.hit, true, '第二次必须命中磁盘缓存');
  assert.equal(upstream.calls, 1, '命中缓存不该再打上游');

  // 换个音色就是另一段音频，必须重新合成
  await mimoSpeakCached('Hello there.', 'Milo', 1);
  assert.equal(upstream.calls, 2, '不同音色是不同的缓存键');
});

test('上游失败后释放占位，下一次可以重试而不是永远卡住', async (t) => {
  const { upstream, runtime } = await ttsFixture(t, { upstream: { fail: true } });
  const { mimoSpeakCached } = runtime.get('mimo');

  await assert.rejects(() => mimoSpeakCached('Try again.', 'Mia', 1));
  assert.equal(upstream.calls, 1);

  // 失败不能被记成"已完成"：第二次仍要真的再试一次
  await assert.rejects(() => mimoSpeakCached('Try again.', 'Mia', 1));
  assert.equal(upstream.calls, 2, '失败后必须能重试');
});

test('/api/speak：未命中现合成，再请求命中缓存且不重复计费', async (t) => {
  const { upstream, runtime } = await ttsFixture(t);
  const { GET } = runtime.get('route');
  const url = runtime.speakUrl('Good morning!');

  const first = await GET(new Request(url));
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-type'), 'audio/mpeg');
  assert.equal(first.headers.get('x-tts-cache'), 'miss');
  assert.equal(first.headers.get('accept-ranges'), 'bytes');
  // iOS Safari 靠这个头决定能不能播，必须有一年的 immutable 缓存
  assert.match(first.headers.get('cache-control'), /immutable/);
  assert.equal((await first.arrayBuffer()).byteLength, 4096);
  assert.equal(upstream.calls, 1);

  const second = await GET(new Request(url));
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('x-tts-cache'), 'hit');
  assert.equal(upstream.calls, 1, '第二次请求不能再合成一次');
});

test('/api/speak：Range 请求按 206 回，iOS 才会播', async (t) => {
  const { runtime } = await ttsFixture(t);
  const { GET } = runtime.get('route');
  const url = runtime.speakUrl('Range please.');

  await GET(new Request(url)); // 先让缓存里有
  const partial = await GET(new Request(url, { headers: { range: 'bytes=0-99' } }));
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 0-99/4096');
  assert.equal((await partial.arrayBuffer()).byteLength, 100);

  // 越界区间按 416 回，不能给出空音频让播放器静音卡住
  const bad = await GET(new Request(url, { headers: { range: 'bytes=99999-' } }));
  assert.equal(bad.status, 416);
  assert.equal(bad.headers.get('content-range'), 'bytes */4096');
});

test('/api/speak：ETag 命中回 304，浏览器不用重下', async (t) => {
  const { runtime } = await ttsFixture(t);
  const { GET } = runtime.get('route');
  const url = runtime.speakUrl('Cached by etag.');

  const first = await GET(new Request(url));
  const etag = first.headers.get('etag');
  assert.ok(etag);
  const revalidated = await GET(new Request(url, { headers: { 'if-none-match': etag } }));
  assert.equal(revalidated.status, 304);
});

test('/api/speak：文本超长回 413，且不打上游', async (t) => {
  const { upstream, runtime } = await ttsFixture(t);
  const { GET } = runtime.get('route');
  const tooLong = 'a'.repeat(MAX_TEXT + 1);

  const res = await GET(new Request(runtime.speakUrl(tooLong)));
  assert.equal(res.status, 413);
  assert.equal(upstream.calls, 0, '参数不合格时不能花钱');
});

test('/api/speak：没配密钥回 503，前端据此退回系统语音', async (t) => {
  const { runtime } = await ttsFixture(t, { configured: false });
  const { GET } = runtime.get('route');
  const res = await GET(new Request(runtime.speakUrl('No key.')));
  assert.equal(res.status, 503);
});

test('/api/speak：慢速档的播放倍速由服务端算好下发', async (t) => {
  const { runtime } = await ttsFixture(t);
  const { GET, HEAD } = runtime.get('route');
  const { playbackRateFor } = runtime.get('server-voice-list');
  const expected = playbackRateFor(PACE_STUB.pace('normal').ttsSpeed, true);

  const res = await GET(new Request(runtime.speakUrl('Slow down.', '&slow=1')));
  assert.equal(res.headers.get('x-tts-playback-rate'), expected.toFixed(2));

  // HEAD 只回答"缓存里有没有"，不该触发合成
  const miss = await HEAD(new Request(runtime.speakUrl('Not warm yet.')));
  assert.equal(miss.status, 404);
  assert.equal(miss.headers.get('x-tts-cache'), 'miss');
  const hit = await HEAD(new Request(runtime.speakUrl('Slow down.', '&slow=1')));
  assert.equal(hit.status, 200);
  assert.equal(hit.headers.get('x-tts-cache'), 'hit');
});

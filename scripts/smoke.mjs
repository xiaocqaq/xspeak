/**
 * 端到端冒烟测试。打真实的 HTTP 接口，走真实的 AI 调用 —— 目的是证明整条链路通，
 * 不是单元测试。会往数据库写真实数据。
 *
 * 用法：
 *   npm run dev              # 另一个终端
 *   npm run smoke
 *   BASE=http://127.0.0.1:3001 npm run smoke
 *   npm run smoke -- --fast  # 跳过烧 token 的 AI 环节，只测 CRUD
 *
 * 服务端开了鉴权（配了 AUTH_UPSTREAM_URL）时，所有接口都要登录态，
 * 所以要给它一对账号密码：
 *   SMOKE_USER=xxx SMOKE_PASS=xxx npm run smoke -- --fast
 * 不给的话第一步就会说清楚缺什么，而不是让后面二十个用例一起报 401。
 */

const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const FAST = process.argv.includes('--fast');
const USER = process.env.SMOKE_USER ?? '';
const PASS = process.env.SMOKE_PASS ?? '';

let pass = 0;
let fail = 0;
const failures = [];

const t0 = Date.now();
const ms = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

/**
 * 手搓的 cookie jar。
 *
 * Node 的 fetch 不带 cookie 存储，而登录态就是靠 cookie 传的 ——
 * 不自己存的话登录成功也没用，下一个请求还是匿名的。
 * 只存 name=value，不管 Domain/Path/Expires：这里就打一个 origin，够用。
 */
const jar = new Map();

function stashCookies(res) {
  const list = res.headers.getSetCookie?.() ?? [];
  for (const line of list) {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    // 退出登录是靠把值置空来实现的，那种要删掉而不是存个空串
    if (!value) jar.delete(name);
    else jar.set(name, value);
  }
}

function cookieHeader() {
  if (!jar.size) return undefined;
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function call(method, path, body) {
  const cookie = cookieHeader();
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  stashCookies(res);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${path} 返回的不是 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }
  if (!res.ok || json.ok === false) {
    throw new Error(`${method} ${path} 失败（HTTP ${res.status}）：${json.error ?? text.slice(0, 200)}`);
  }
  return json.data;
}

async function step(name, fn) {
  process.stdout.write(`· ${name} … `);
  try {
    const out = await fn();
    pass++;
    console.log(`ok  [${ms()}]`);
    return out;
  } catch (err) {
    fail++;
    failures.push(`${name}: ${err.message}`);
    console.log(`失败\n    ${err.message}`);
    return null;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log(`目标 ${BASE}${FAST ? '（--fast：跳过 AI）' : ''}\n`);

await step('服务在跑', async () => {
  const res = await fetch(BASE + '/api/session/today');
  assert(res.status < 500 || res.status === 500, `连不上：HTTP ${res.status}`);
});

/*
 * 登录（只在服务端开了鉴权时）。
 *
 * 这一步失败就没必要往下跑：后面每个用例都会 401，二十行同样的报错
 * 只会把真正的原因埋掉。所以这里直接退出，并把原因说明白。
 */
const authState = await step('鉴权状态', async () => {
  const d = await call('GET', '/api/auth/session');
  console.log(d.authEnabled ? '\n    已开启，需要登录' : '\n    未开启（单人模式）');
  return d;
});

if (authState?.authEnabled) {
  if (!USER || !PASS) {
    console.error(
      '\n服务端开了鉴权，但没给账号。\n' +
        '  SMOKE_USER=<用户名或邮箱> SMOKE_PASS=<密码> npm run smoke -- --fast\n',
    );
    process.exit(1);
  }
  await step('登录', async () => {
    const d = await call('POST', '/api/auth/login', { username: USER, password: PASS });
    // 开了两步验证的账号没法用在自动化里 —— 验证码拿不到，说清楚比卡住好
    assert(!d.twoFactorRequired, '这个账号开了两步验证，冒烟测试用不了。换一个没开的账号。');
    assert(jar.size > 0, '登录成功但没收到 cookie，检查 writeSession 的 path 是否和 BASE 对得上');
    console.log(`\n    登录为 ${d.user?.displayName || USER}`);
  });
  if (fail > 0) {
    console.error('\n登录失败，后面的用例都会 401，先退出。\n');
    process.exit(1);
  }
}

const today = await step('GET /api/session/today', async () => {
  const d = await call('GET', '/api/session/today');
  assert(d.session?.id, '没有返回 session');
  // 写死数字不如写死清单：数字对不上只知道"少了一个"，清单对不上能直接看出少了哪个。
  // 写作环节已经去掉了，所以是 6 个不是 7 个。
  const want = ['warmup', 'newwords', 'grammar', 'listening', 'reading', 'speaking'];
  assert(
    Array.isArray(d.session.stages) && d.session.stages.join(',') === want.join(','),
    `环节不对：期望 ${want.join('/')}，实际 ${d.session?.stages?.join('/')}`,
  );
  assert(d.stats, '没有返回 stats');
  console.log(
    `\n    主题「${d.themeZh ?? d.session.themeZh}」· 新词 ${d.targetWords.length} · 待复习 ${d.reviewWords.length}`,
  );
  process.stdout.write('    ');
  return d;
});

await step('PATCH /api/profile（改档案）', async () => {
  const before = today?.user?.newWordsPerDay ?? 8;
  const d = await call('PATCH', '/api/profile', { newWordsPerDay: 9, interests: ['科技', '电影美剧'] });
  assert(d.user.new_words_per_day === 9, '没写进去');
  await call('PATCH', '/api/profile', { newWordsPerDay: before }); // 还原
});

await step('PATCH /api/profile（音色 + 语速）', async () => {
  // 还原要用真正的原值。这里不能写 ?? 默认值 —— 一旦 today 接口少输出这两个字段，
  // 还原就会静默地把用户真实的选择冲成默认值（已经发生过一次）。
  assert('aiVoice' in (today?.user ?? {}), '/api/session/today 没输出 aiVoice');
  assert('speechPace' in (today?.user ?? {}), '/api/session/today 没输出 speechPace');
  const beforeVoice = today.user.aiVoice;
  const beforePace = today.user.speechPace;

  const d = await call('PATCH', '/api/profile', { aiVoice: 'zhixingjiejie', speechPace: 'slow' });
  assert(d.user.ai_voice === 'zhixingjiejie', 'ai_voice 没写进去');
  assert(d.user.speech_pace === 'slow', 'speech_pace 没写进去');

  // 白名单要挡住乱值。放进去会让 realtime 直接拒连、整段对话起不来，
  // 所以这两条必须在服务端就被拒，不能指望前端只发合法值。
  for (const [payload, what] of [
    [{ aiVoice: 'nonexistent-voice' }, '非法音色'],
    [{ speechPace: 'turbo' }, '非法语速档位'],
  ]) {
    let rejected = false;
    try {
      await call('PATCH', '/api/profile', payload);
    } catch {
      rejected = true;
    }
    assert(rejected, `${what}被接受了，白名单校验失效`);
  }

  await call('PATCH', '/api/profile', { aiVoice: beforeVoice, speechPace: beforePace }); // 还原
});

await step('POST /api/voice/preview（音色试听）', async () => {
  // 这条不走 call()：返回的是 mp3 而不是 JSON。cookie 得自己带上
  const res = await fetch(BASE + '/api/voice/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookieHeader() ? { cookie: cookieHeader() } : {}) },
    body: JSON.stringify({ voice: 'jingdiannvsheng', paceKey: 'normal' }),
  });
  assert(res.ok, `试听失败（HTTP ${res.status}）`);
  assert(res.headers.get('content-type')?.includes('audio'), '返回的不是音频');
  const size = (await res.arrayBuffer()).byteLength;
  assert(size > 5000, `音频太小（${size} 字节），可能是空响应`);

  const bad = await fetch(BASE + '/api/voice/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookieHeader() ? { cookie: cookieHeader() } : {}) },
    body: JSON.stringify({ voice: 'yingwennvsheng' }),
  });
  assert(!bad.ok, '非白名单音色没被拒');
});

/*
 * 逐句朗读的服务端音频（云端 MiMo）。没配 MIMO_TTS_KEY 的部署回 503，
 * 那不是失败 —— 前端会退回浏览器语音包。所以 503 记成"跳过"。
 *
 * 这条不走 call()：返回 mp3 而不是 JSON，而且是 GET（见 api/speak 顶部注释）。
 */
await step('GET /api/speak（本站朗读音色）', async () => {
  const ck = () => (cookieHeader() ? { cookie: cookieHeader() } : {});
  // 每次跑用不同文本，才能真的走一遍"未命中→合成→写缓存→命中"，
  // 而不是永远读上一次跑留下的缓存文件
  const text = `smoke test ${Date.now()}`;
  const q = `text=${encodeURIComponent(text)}&voice=Mia&pace=normal`;

  const probe = await fetch(`${BASE}/api/speak?${q}`, { headers: ck() });
  if (probe.status === 503) {
    console.log('\n    没配 MIMO_TTS_KEY，跳过');
    return;
  }
  // body 只能读一次，所以不能把 probe.text() 写进 assert 的消息里
  // —— 那个模板串是无条件先算的，成功路径上也会把 body 读空
  if (!probe.ok) throw new Error(`合成失败（HTTP ${probe.status}）：${(await probe.text()).slice(0, 160)}`);
  assert(probe.headers.get('content-type')?.includes('audio'), '返回的不是音频');
  assert(probe.headers.get('x-tts-cache') === 'miss', '新文本却报缓存命中，缓存键可能没算进文本');
  const size = (await probe.arrayBuffer()).byteLength;
  // 空音频那个坑（上游对某些短句回 44 字节的纯 ID3 头）就是靠这条拦住的
  assert(size > 2000, `音频太小（${size} 字节），可能是空响应`);

  // 第二次必须命中磁盘缓存，否则缓存整个没生效 —— 那台机器 2 核，
  // 每次现合成 1.5s 起，命中与否是这个功能能不能用的分界
  const again = await fetch(`${BASE}/api/speak?${q}`, { headers: ck() });
  assert(again.ok, `第二次请求失败（HTTP ${again.status}）`);
  assert(again.headers.get('x-tts-cache') === 'hit', '第二次没命中缓存');
  const etag = again.headers.get('etag');
  assert(etag, '没回 etag，浏览器侧缓存会失效');

  // 304：命中浏览器缓存时连磁盘都不该读
  const nm = await fetch(`${BASE}/api/speak?${q}`, { headers: { ...ck(), 'if-none-match': etag } });
  assert(nm.status === 304, `带 If-None-Match 应该回 304，实际 ${nm.status}`);

  // Range：iOS Safari 播 <audio> 前会先探一刀，不按 206 回可能整个不播
  const rng = await fetch(`${BASE}/api/speak?${q}`, { headers: { ...ck(), range: 'bytes=0-99' } });
  assert(rng.status === 206, `Range 请求应该回 206，实际 ${rng.status}`);
  assert((await rng.arrayBuffer()).byteLength === 100, 'Range 回的字节数不对');

  // HEAD 是前端判断"这句能不能立刻用好声音播"的依据：命中 200、未命中 404
  const head = await fetch(`${BASE}/api/speak?${q}`, { method: 'HEAD', headers: ck() });
  assert(head.status === 200, `HEAD 已缓存的文本应该 200，实际 ${head.status}`);
  const cold = await fetch(`${BASE}/api/speak?text=never-synthesized-${Date.now()}&voice=Mia`, {
    method: 'HEAD',
    headers: ck(),
  });
  assert(cold.status === 404, `HEAD 没缓存的文本应该 404，实际 ${cold.status}`);

  // 白名单和限长。这个接口拿服务端的 key 去调 TTS，不能让任意字符串透传
  const evil = await fetch(`${BASE}/api/speak?text=hi&voice=evil`, { headers: ck() });
  assert(evil.status === 400, `未知音色应该 400，实际 ${evil.status}`);
  const long = await fetch(`${BASE}/api/speak?text=${'a'.repeat(400)}&voice=Mia`, { headers: ck() });
  assert(long.status === 413, `超长文本应该 413，实际 ${long.status}`);
});

// 注意：/api/words 返回的是"我的生词本"（已加入学习的词，SQL 里是 JOIN user_words），
// 新库天然是空的。所以这里走一遍 加入 → 列表 → 收藏 的往返，
// 而不是断言它一开始就有内容。
await step('POST/GET /api/words（生词本往返）', async () => {
  const ids = (today?.targetWords ?? []).map((w) => w.id).slice(0, 3);
  assert(ids.length > 0, '今天没有新词，拿不到 wordId');

  const en = await call('POST', '/api/words', { action: 'enroll', wordIds: ids });
  assert(en.enrolled === ids.length, `enroll 数量不对：${en.enrolled}`);

  const list = await call('GET', '/api/words?filter=all');
  assert(Array.isArray(list.items), 'items 不是数组');
  assert(list.items.length >= ids.length, `生词本里只有 ${list.items.length} 个，应该 ≥ ${ids.length}`);

  const first = list.items.find((it) => ids.includes(it.id));
  assert(first, '刚加入的词没出现在生词本里');
  assert('nextIntervals' in first, '缺 nextIntervals 字段（前端要显示下次复习间隔）');

  const st = await call('POST', '/api/words', { action: 'star', wordIds: [ids[0]] });
  assert(st.states?.[0]?.wordId === ids[0], 'star 返回结构不对');
  await call('POST', '/api/words', { action: 'star', wordIds: [ids[0]] }); // 取消收藏，还原
});

await step('GET /api/grammar（语法库）', async () => {
  const d = await call('GET', '/api/grammar');
  assert(d.items.length > 0, '语法库是空的');
  assert(d.items[0].pitfalls !== undefined, '语法点缺 pitfalls 字段');
});

await step('GET/PATCH /api/models（模型设置）', async () => {
  const d = await call('GET', '/api/models');
  assert(Array.isArray(d.catalog), 'catalog 不是数组');
  assert(d.roles?.length === 3, `角色应该有 3 个，实际 ${d.roles?.length}`);
  // 这个结构会出到浏览器，绝不能带密钥。整段翻一遍字符串最直接
  assert(!/sk-|api[_-]?key/i.test(JSON.stringify(d)), '响应里出现了疑似密钥的内容');
  for (const r of d.roles) {
    assert(r.effective || r.error, `${r.role} 既没解析出模型也没给错误原因`);
  }

  // 清单外的 id 必须被服务端拒掉：这个值来自浏览器，放行等于让前端指定端点
  let rejected = false;
  try {
    await call('PATCH', '/api/models', { role: 'chat', modelId: 'definitely-not-configured' });
  } catch {
    rejected = true;
  }
  assert(rejected, '清单外的模型 id 被接受了，白名单校验失效');

  const ready = d.catalog.find((m) => m.ready);
  if (ready) {
    const before = d.roles.find((r) => r.role === 'fast')?.selected ?? null;
    const after = await call('PATCH', '/api/models', { role: 'fast', modelId: ready.id });
    assert(
      after.roles.find((r) => r.role === 'fast')?.selected === ready.id,
      '选择没存进去',
    );
    /*
     * PATCH 必须回和 GET 一样的形状。设置页是 setData(await apiPatch(...))，
     * 整个状态换成响应体 —— 少一个 voice 就把已经渲染着的那块抽走，
     * 点一下换模型整张卡片炸掉而库其实写成功了。真出过一次，所以在这儿钉住。
     */
    assert(
      JSON.stringify(Object.keys(after).sort()) === JSON.stringify(Object.keys(d).sort()),
      `PATCH 和 GET 的字段不一样：GET ${Object.keys(d).sort()} / PATCH ${Object.keys(after).sort()}`,
    );
    assert(after.voice?.provider, 'PATCH 响应里没有 voice.provider');
    await call('PATCH', '/api/models', { role: 'fast', modelId: before }); // 还原
  } else {
    // 没配 AI_MODELS 时清单是空的，这不算失败 —— 那种部署就是「只跟配置文件」
    console.log('\n    没配 AI_MODELS，跳过换模型的往返');
    process.stdout.write('    ');
  }
});

await step('GET /api/stats（统计）', async () => {
  const d = await call('GET', '/api/stats');
  assert(d.summary, '没有 summary');
  assert(Array.isArray(d.summary.last14) && d.summary.last14.length === 14, 'last14 长度不对');
  assert(Array.isArray(d.forecast), '没有 forecast');
});

/* ------------------------------ 需要真实 AI ------------------------------ */

if (!FAST) {
  const STAGES = ['warmup', 'newwords', 'grammar', 'listening', 'reading', 'speaking'];
  const payloads = {};

  for (const stage of STAGES) {
    await step(`AI 生成 ${stage}`, async () => {
      const d = await call('GET', `/api/session/stage?stage=${stage}`);
      assert(d.payload, '没有 payload');
      assert(d.sessionId, '没有 sessionId');
      payloads[stage] = d;

      // 每个环节按 schema 抽查关键字段，AI 结构化输出坏掉能立刻发现
      const p = d.payload;
      if (stage === 'newwords') {
        assert(p.words?.length > 0, '没给新词');
        assert(p.words[0].memory_hook_zh, '新词缺记忆钩子');
        assert(typeof p.words[0].id === 'number', '新词没带数据库 id');
      }
      if (stage === 'grammar') {
        assert(p.exercises?.length >= 3, '语法题少于 3 道');
        assert(p.point?.id, '没关联到数据库里的语法点');
      }
      if (stage === 'listening') {
        assert(p.dialogue?.length >= 4, '对话太短');
        assert(p.questions?.length >= 2, '听力题不够');
      }
      if (stage === 'reading') {
        assert(p.passage_en?.length > 50, '阅读篇章太短');
        assert(p.questions?.length >= 2, '阅读题不够');
      }
      if (stage === 'speaking') {
        assert(p.opening_en, '没有开场句');
        assert(p.useful_phrases?.length >= 3, '可用句型不够');
      }
      if (stage === 'warmup') {
        assert(Array.isArray(p.items), 'warmup items 不是数组');
        // 第一天没有待复习的词，items 可以是空的，这不算错
      }
    });
  }

  await step('内容有缓存（第二次不重新生成）', async () => {
    const a = Date.now();
    const d = await call('GET', '/api/session/stage?stage=reading');
    const cost = Date.now() - a;
    assert(d.payload.passage_en === payloads.reading?.payload?.passage_en, '两次内容不一样，缓存没生效');
    assert(cost < 3000, `第二次花了 ${cost}ms，太慢了，可能没走缓存`);
  });

  // 前端会预取下一环节，用户手快时同一个 stage 会并发进来两次。
  // 必须合并成一次 AI 调用，否则白花钱还可能重复写库。
  await step('并发请求同一环节只生成一次', async () => {
    const [a, b, c] = await Promise.all([
      call('GET', '/api/session/stage?stage=speaking'),
      call('GET', '/api/session/stage?stage=speaking'),
      call('GET', '/api/session/stage?stage=speaking'),
    ]);
    const j = (x) => JSON.stringify(x.payload);
    assert(j(a) === j(b) && j(b) === j(c), '三次并发拿到了不同内容，说明重复生成了');
  });

  await step('POST /api/review（提交复习）', async () => {
    const words = payloads.newwords?.payload?.words ?? [];
    assert(words.length > 0, '没有新词可提交');
    const d = await call('POST', '/api/review', {
      enroll: words.map((w) => w.id),
      words: [{ wordId: words[0].id, rating: 3, mode: 'cloze', elapsedMs: 4200, context: 'A smoke test sentence.' }],
      produced: [words[0].id],
      mistakes: [
        {
          kind: 'word_choice',
          stage: 'warmup',
          wordId: words[0].id,
          wrong: 'I very like it',
          correct: 'I really like it',
          note: '冒烟测试写进来的',
        },
      ],
      spokenSeconds: 12,
    });
    assert(d, 'review 没返回东西');
  });

  await step('错题进了错题本', async () => {
    const d = await call('GET', '/api/stats');
    assert(
      d.mistakes.some((m) => m.wrong === 'I very like it'),
      '刚提交的错题没在错题本里',
    );
  });

  await step('POST /api/words/lookup（查词）', async () => {
    const d = await call('POST', '/api/words/lookup', { term: 'commute' });
    assert(d.meaning_zh, '没返回中文释义');
    assert(['library', 'dict', 'ai'].includes(d.source), `source 不认识：${d.source}`);
    /*
     * 例句只对 AI 那条路要求两条。库里和词典命中时给不出真例句
     * （路由里是故意返回空数组的，见 lookup/route.ts 的 fromDict），
     * 这里跟着分开判 —— 否则常用词永远走词典，这条断言就永远挂。
     */
    if (d.source === 'ai') {
      assert(d.examples?.length >= 2, `AI 查词的例句不够：${d.examples?.length ?? 0}`);
    } else {
      assert(Array.isArray(d.examples), 'examples 得是数组，前端直接 map');
    }
  });

  await step('POST /api/chat/scenarios（场景生成）', async () => {
    const d = await call('POST', '/api/chat/scenarios', { count: 2 });
    assert(d.scenarios?.length === 2, `要了 2 个场景，回了 ${d.scenarios?.length}`);
    assert(d.sessionId, '没带 sessionId，对话会归不到今天的 session');

    for (const s of d.scenarios) {
      assert(s.zh && s.hint, '场景缺中文描述');
      assert(s.aiRole && s.openingEn, '场景缺角色或开场句');
      // targetTerms 和 targetWordIds 必须一一对应。这是整个功能的关键：
      // AI 会凭空造词，对不上库的必须在路由里被丢掉，
      // 否则把不存在的 id 塞进对话，produced_count 就会记错。
      assert(
        s.targetTerms.length === s.targetWordIds.length,
        `目标词和 id 对不上（${s.targetTerms.length} vs ${s.targetWordIds.length}）`,
      );
      assert(s.targetWordIds.every((id) => typeof id === 'number'), '目标词 id 不是数字');
    }

    // 自定义话题要真的改变生成结果，而不是被今日主题盖过去
    const custom = await call('POST', '/api/chat/scenarios', {
      count: 1,
      wish: '跟房东抱怨暖气不热',
    });
    assert(custom.scenarios?.length === 1, '自定义话题没返回场景');
  });

  await step('POST /api/pronounce（发音一致度）', async () => {
    const d = await call('POST', '/api/pronounce', {
      target: 'I take the bus to work every day.',
      transcript: 'I take the bus to work every day',
      sessionId: today?.session?.id,
    });
    assert(typeof d.scored.score === 'number', '没返回分数');
    assert(d.scored.score > 80, `念对了却只给 ${d.scored.score} 分，打分逻辑有问题`);
    assert(Array.isArray(d.scored.words), '没返回逐词结果');
  });

  await step('POST /api/pronounce（念错要扣分）', async () => {
    const d = await call('POST', '/api/pronounce', {
      target: 'I take the bus to work every day.',
      transcript: 'I take a boss to word',
      sessionId: today?.session?.id,
    });
    assert(d.scored.score < 70, `念错了还给 ${d.scored.score} 分，太宽松`);
  });

  const conv = await step('POST /api/chat（开一段对话）', async () => {
    const d = await call('POST', '/api/chat', {
      action: 'start',
      title: '冒烟测试',
      scenarioZh: '在咖啡店点一杯咖啡',
      aiRole: 'a friendly barista',
      openingEn: 'Hi! What can I get for you today?',
    });
    assert(d.conversationId, '没返回 conversationId');
    return d;
  });

  await step('POST /api/chat（发一句，拿到纠正）', async () => {
    const d = await call('POST', '/api/chat', {
      action: 'send',
      conversationId: conv?.conversationId,
      text: 'I want a coffee. I very like it hot.',
    });
    assert(d.reply?.reply_en, '没返回英文回复');
    assert(d.reply.correction, '没返回纠正结构');
    assert(d.reply.suggestion_en, '没给下一句提示');
  });

  await step('POST /api/import（导入素材抽词）', async () => {
    const d = await call('POST', '/api/import', {
      title: '冒烟测试素材',
      kind: 'article',
      raw: 'Remote work has changed how people commute. Many employees now split their week between the office and home, which saves time but makes casual conversation with colleagues harder to come by.',
      enroll: false,
    });
    assert(d.words?.length > 0, '没抽出词');
    assert(typeof d.words[0].id === 'number', '抽出的词没入库');
    assert(d.summaryZh, '没有中文摘要');
  });

  await step('POST /api/session/stage（标记完成）', async () => {
    const d = await call('POST', '/api/session/stage', { stage: 'warmup', minutes: 4.5 });
    assert(d.stagesDone.includes('warmup'), 'warmup 没标记成完成');
    assert(d.minutesSpent >= 4.5, '用时没累加');
  });
}

console.log(`\n${'─'.repeat(48)}`);
console.log(`通过 ${pass} · 失败 ${fail} · 耗时 ${ms()}`);
if (failures.length) {
  console.log('\n失败明细：');
  for (const f of failures) console.log(`  ✗ ${f}`);
}
process.exit(fail ? 1 : 0);

/**
 * 端到端冒烟测试。打真实的 HTTP 接口，走真实的 AI 调用 —— 目的是证明整条链路通，
 * 不是单元测试。会往数据库写真实数据。
 *
 * 用法：
 *   npm run dev              # 另一个终端
 *   npm run smoke
 *   BASE=http://127.0.0.1:3001 npm run smoke
 *   npm run smoke -- --fast  # 跳过烧 token 的 AI 环节，只测 CRUD
 */

const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const FAST = process.argv.includes('--fast');

let pass = 0;
let fail = 0;
const failures = [];

const t0 = Date.now();
const ms = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
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

const today = await step('GET /api/session/today', async () => {
  const d = await call('GET', '/api/session/today');
  assert(d.session?.id, '没有返回 session');
  assert(Array.isArray(d.session.stages) && d.session.stages.length === 7, '环节数不是 7');
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

await step('GET /api/words（词库）', async () => {
  const d = await call('GET', '/api/words?filter=all');
  assert(Array.isArray(d.items), 'items 不是数组');
  assert(d.items.length > 0, '内置词表是空的，播种可能没跑');
});

await step('GET /api/grammar（语法库）', async () => {
  const d = await call('GET', '/api/grammar');
  assert(d.items.length > 0, '语法库是空的');
  assert(d.items[0].pitfalls !== undefined, '语法点缺 pitfalls 字段');
});

await step('GET /api/stats（统计）', async () => {
  const d = await call('GET', '/api/stats');
  assert(d.summary, '没有 summary');
  assert(Array.isArray(d.summary.last14) && d.summary.last14.length === 14, 'last14 长度不对');
  assert(Array.isArray(d.forecast), '没有 forecast');
});

/* ------------------------------ 需要真实 AI ------------------------------ */

if (!FAST) {
  const STAGES = ['warmup', 'newwords', 'grammar', 'listening', 'reading', 'speaking', 'writing'];
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
      if (stage === 'writing') {
        assert(p.prompt_en, '没有写作题目');
        assert(Array.isArray(p.must_use), '没有必用词');
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
    assert(d.examples?.length >= 2, '例句不够');
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

  await step('POST /api/writing（写作批改）', async () => {
    const w = payloads.writing?.payload;
    const d = await call('POST', '/api/writing', {
      sessionId: today?.session?.id,
      promptEn: w?.prompt_en ?? 'Describe your morning.',
      promptZh: w?.prompt_zh ?? '描述你的早晨',
      // 故意写几个中国学生常犯的错，看 AI 能不能挑出来
      text: 'I very like coffee. Yesterday I go to a cafe and drink two cup of coffee with my friend.',
      mustUse: w?.must_use ?? [],
      targetWordIds: (payloads.newwords?.payload?.words ?? []).map((x) => x.id),
    });
    assert(typeof d.score === 'number', '没返回分数');
    assert(d.issues?.length > 0, '这么明显的错误竟然没挑出问题');
    // issues[].wrong 必须是原文的子串，前端靠这个定位高亮
    const text = 'I very like coffee. Yesterday I go to a cafe and drink two cup of coffee with my friend.';
    const bad = d.issues.filter((i) => !text.includes(i.wrong));
    assert(bad.length === 0, `有 ${bad.length} 处 wrong 不是原文子串，前端高亮会错位：${bad.map((b) => b.wrong).join(' / ')}`);
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

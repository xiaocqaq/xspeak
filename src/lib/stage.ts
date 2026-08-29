import { generateJson } from '@/lib/ai/client';
import * as P from '@/lib/ai/prompts';
import * as S from '@/lib/ai/schemas';
import { getGrammarById } from '@/lib/repo/grammar';
import { recentMistakes } from '@/lib/repo/mistakes';
import { getSessionById, getStageContent, saveStageContent } from '@/lib/repo/session';
import { getWordsByIds, saveEnrichment } from '@/lib/repo/words';
import { all } from '@/lib/db';
import type { SessionRow, Stage, UserProfile, WordRow } from '@/lib/types';

function learnerOf(u: UserProfile): P.Learner {
  return {
    name: u.name,
    level: u.level,
    goal: u.goal,
    interests: u.interests,
    newWordsPerDay: u.new_words_per_day,
  };
}

async function ctxOf(u: UserProfile, s: SessionRow): Promise<P.Ctx> {
  return {
    themeZh: s.theme_zh,
    themeEn: s.theme_en,
    learner: learnerOf(u),
    mistakes: await recentMistakes(u.id, 8),
  };
}

/** 目标词的展示信息（供前端渲染卡片）。 */
export function targetWordsOf(s: SessionRow): Promise<WordRow[]> {
  return getWordsByIds(s.target_word_ids);
}

async function termsOf(s: SessionRow): Promise<string[]> {
  const words = await targetWordsOf(s);
  return words.map((w) => w.term);
}

/**
 * 生成（或取缓存）某个环节的内容。
 * 缓存键是 session + stage，所以同一天刷新页面不会重复调 AI。
 * regenerate=true 时强制重新生成（前端"换一批"按钮用）。
 */
export async function buildStage(
  user: UserProfile,
  session: SessionRow,
  stage: Stage,
  regenerate = false,
): Promise<{ payload: unknown; meta: Record<string, unknown> }> {
  if (!regenerate) {
    const cached = await getStageContent<unknown>(session.id, stage);
    if (cached) {
      /*
       * 新词的缓存可能是「写早了」的 —— 上游当时没给例句/抓手。
       * 这里读一次库把后台补上的内容接上（没有 AI、没有等待），
       * 还缺的就再踢一次后台补充，用户下次进来就有了。
       */
      if (stage === 'newwords') {
        const { payload, pendingTerms } = await refreshNewwords(session, cached);
        if (pendingTerms.length) {
          // 不 await：用户看的是库里现有的卡片，补上了下次自动完整
          void prewarmNewWords(user, session).catch(() => {});
          console.log(`[newwords] 缓存命中但 ${pendingTerms.length} 个词仍缺内容，后台继续补：${pendingTerms.join(', ')}`);
        }
        return { payload, meta: await metaFor(session, stage) };
      }
      return { payload: cached, meta: await metaFor(session, stage) };
    }

    // 前端会预取下一个环节，用户手快时可能同时来两个请求。
    // 没有这层去重就会重复调一次 AI（白花钱，还可能重复写库）。
    const key = `${session.id}:${stage}`;
    const running = inFlight.get(key);
    if (running) return running;
    const p = generateStage(user, session, stage).finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  }
  // "换一批"总是重新生成，不参与去重
  return generateStage(user, session, stage);
}

/** 同一个 session+stage 正在生成中的请求，用于合并并发请求 */
const inFlight = new Map<string, Promise<{ payload: unknown; meta: Record<string, unknown> }>>();

async function generateStage(
  user: UserProfile,
  session: SessionRow,
  stage: Stage,
): Promise<{ payload: unknown; meta: Record<string, unknown> }> {

  const ctx = await ctxOf(user, session);
  const learner = learnerOf(user);
  let payload: unknown;

  switch (stage) {
    case 'warmup': {
      const words = await getWordsByIds(session.review_word_ids);
      if (!words.length) {
        // 第一天没有可复习的内容，给一个明确的空态而不是硬造题
        payload = { intro_zh: '今天还没有到期的复习内容，直接从新词开始吧。', items: [] };
        break;
      }
      const seenRows = await all<{ word_id: number; seen_contexts: string[] | null }>(
        'SELECT word_id, seen_contexts FROM user_words WHERE user_id = ? AND word_id = ANY(?::int[])',
        [user.id, words.map((w) => w.id)],
      );
      const seenMap = new Map(seenRows.map((r) => [r.word_id, r.seen_contexts ?? []]));
      const withSeen = words.map((w) => ({
        term: w.term,
        meaning_zh: w.meaning_zh,
        seen: seenMap.get(w.id) ?? [],
      }));
      /*
       * 2026-08-28 混合题型：AI 只给前 WARMUP_AI_CLOZE_CAP 个词出完形（选题面
       * 最值得细讲的），剩余的词前端用释义单选补 —— 不调 AI、零 token 零等待。
       * 复习容量也放宽到 20：到期多就多练，不再截到 8 个。
       */
      const aiWords = withSeen.slice(0, P.WARMUP_AI_CLOZE_CAP);
      payload = await generateJson(S.WarmupPayload, {
        system: P.systemPrompt(learner),
        prompt: P.warmupPrompt(ctx, aiWords),
        maxTokens: 6000,
        toolName: 'emit_warmup',
      });
      break;
    }

    case 'newwords': {
      /*
       * 选词不问 AI。
       *
       * 以前这个分支两条路都要调一次 AI：缺词就让 AI 造词，不缺就让 AI 把这批词
       * "重讲一遍"。结果是每次进新词环节都等十几秒、烧几千 token，而且 AI 造的词
       * 分级不可控。现在词从 words 表 + 词典分级词表来（pickNewWords 已经处理），
       * AI 只补词典给不了的三样东西：例句、记忆抓手、搭配 —— 而且只补缺的那几个词，
       * 补完存回库，同一个词第二次出现就完全不花钱。
       */
      const words = await targetWordsOf(session);
      if (!words.length) {
        payload = { intro_zh: '今天的新词还没准备好，稍后再试。', words: [] };
        break;
      }
      const { cards } = await enrichedCards(words, learner, ctx);
      payload = newwordsPayload(session, cards);
      /*
       * 2026-08-29：这里原来是「补充内容没补齐就不写缓存」（直接 return，跳过
       * saveStageContent）。想法是别把上游抽风的半成品存一整天，但代价是
       * 灾难性的：上游只要持续不给内容，complete 就永远是 false，于是
       * 缓存永远不写 —— 每次切到新词环节都要重跑整条链，等满 ENRICH_WAIT_MS
       * 再白发一次 AI 请求。生产实锤：session 15/16/17 都缓存了另外 5 个环节，
       * 唯独 newwords 是空的，6/10 个词缺 memory_hook_zh，用户报「为什么每次
       * 切换都要重新生成一次」。
       *
       * 现在改成「一定写缓存 + 记下还缺谁」。新词的 payload 完全由 words 表
       * 派生（AI 只往 words 表里写，不进 payload），所以缓存过期不需要重跑
       * AI —— buildStage 命中缓存后会用 refreshNewwords 拿库里最新的行重建，
       * 那是一次 getWordsByIds，没有等待也没有 token。补上了就自动变完整卡片。
       */
      break;
    }

    case 'grammar': {
      const gid = session.grammar_ids[0];
      const point = gid ? await getGrammarById(gid) : null;
      if (!point) {
        payload = { focus_zh: '语法点已经全部学过一轮了，换个日子会重新考。', mini_lesson_zh: '', examples: [], exercises: [] };
        break;
      }
      payload = {
        point: {
          id: point.id,
          title_zh: point.title_zh,
          title_en: point.title_en,
          pattern: point.pattern,
          pitfalls: point.pitfalls,
        },
        ...(await generateJson(S.GrammarPayload, {
          system: P.systemPrompt(learner),
          prompt: P.grammarPrompt(ctx, point, await termsOf(session)),
          maxTokens: 6000,
          toolName: 'emit_grammar',
        })),
      };
      break;
    }

    case 'listening':
      payload = await generateJson(S.ListeningPayload, {
        system: P.systemPrompt(learner),
        prompt: P.listeningPrompt(ctx, await termsOf(session)),
        maxTokens: 6000,
        toolName: 'emit_listening',
      });
      break;

    case 'reading':
      payload = await generateJson(S.ReadingPayload, {
        system: P.systemPrompt(learner),
        prompt: P.readingPrompt(ctx, await termsOf(session)),
        maxTokens: 6000,
        toolName: 'emit_reading',
      });
      break;

    case 'speaking':
      payload = await generateJson(S.SpeakingPayload, {
        system: P.systemPrompt(learner),
        prompt: P.speakingPrompt(ctx, await termsOf(session)),
        maxTokens: 4000,
        toolName: 'emit_speaking',
      });
      break;
  }

  await saveStageContent(session.id, stage, payload);
  return { payload, meta: await metaFor((await getSessionById(session.id)) ?? session, stage) };
}

/**
 * 新词环节的 payload 长什么样。只有这一个地方拼，缓存重建也走它，
 * 免得两条路的 intro_zh 文案不一致。
 */
function newwordsPayload(session: SessionRow, cards: EnrichedWord[]): NewwordsPayload {
  return {
    intro_zh: `今天围绕「${session.theme_zh}」学 ${cards.length} 个词。`,
    words: cards,
  };
}

type NewwordsPayload = { intro_zh: string; words: EnrichedWord[] };

/** 卡片是否已经拿到了 AI 才能给的两样东西。判据和 enrichedCards 保持一致。 */
function cardComplete(c: EnrichedWord): boolean {
  return Boolean(c.example_en && c.memory_hook_zh);
}

/**
 * 缓存里的新词卡是不是还缺内容 —— 缺就用库里最新的行重建一份。
 *
 * 为什么值得做：新词的 payload 是 words 表的投影，AI 补充只写 words 表。
 * 所以「缓存写早了」不需要靠重跑 AI 来纠正，读一次库就能把后台补上的例句/
 * 抓手接上。这是一次 getWordsByIds（主键 IN 查询），比重跑整条链便宜几个数量级。
 *
 * 补齐了就顺手把缓存刷新，下次连这次读库都省掉。仍然缺的话不写库 ——
 * 写了也是同样的内容，白占一次 UPDATE。
 */
async function refreshNewwords(
  session: SessionRow,
  cached: unknown,
): Promise<{ payload: unknown; pendingTerms: string[] }> {
  const p = cached as NewwordsPayload | null;
  const cards = Array.isArray(p?.words) ? p.words : [];
  // 空态（今天没词）或者已经全齐，直接用缓存，别多读一次库
  if (!cards.length || cards.every(cardComplete)) {
    return { payload: cached, pendingTerms: [] };
  }

  const fresh = await targetWordsOf(session);
  // 目标词被改过（换主题/换一批）时缓存已经对不上了，交给调用方重新生成
  if (fresh.length !== cards.length) return { payload: cached, pendingTerms: [] };

  const rebuilt = newwordsPayload(session, fresh.map(rowToCard));
  const pendingTerms = rebuilt.words.filter((c) => !cardComplete(c)).map((c) => c.term);
  if (!pendingTerms.length) {
    await saveStageContent(session.id, 'newwords', rebuilt);
  }
  return { payload: rebuilt, pendingTerms };
}

/** 新词卡片要的字段。库里有就用库里的，不够才问 AI。 */
type EnrichedWord = {
  id: number;
  term: string;
  phonetic: string;
  pos: string;
  meaning_zh: string;
  meaning_en: string;
  example_en: string;
  example_zh: string;
  memory_hook_zh: string;
  collocations: string[];
};

function rowToCard(w: WordRow): EnrichedWord {
  return {
    id: w.id,
    term: w.term,
    phonetic: w.phonetic ?? '',
    pos: w.pos ?? '',
    meaning_zh: w.meaning_zh,
    meaning_en: w.meaning_en ?? '',
    example_en: w.example_en ?? '',
    example_zh: w.example_zh ?? '',
    memory_hook_zh: w.memory_hook_zh ?? '',
    collocations: w.collocations ?? [],
  };
}

/**
 * 给缺教学内容的词补例句、记忆抓手、搭配，补完存回库。
 *
 * 只有"缺"的词才进 AI 请求 —— 判据是没例句或没记忆抓手。内置词表自带例句但
 * 没抓手，词典来的词两样都没有，被查过的词可能有一半。所以第一天要补的多，
 * 越往后越少，稳定之后基本不再产生 AI 调用。
 *
 * AI 挂了不算致命：补不上就用库里现有的字段渲染，卡片照样能看（前端对空字段
 * 是折叠处理的）。选词已经和 AI 解耦，这里没有"AI 不通就没内容"的问题了。
 */
/**
 * 后台这一次调用最多等上游多久。
 *
 * 这个数曾经是 40 秒，因为那会儿用户在等这次调用 —— 现在不等了（见
 * ENRICH_WAIT_MS），所以给得宽一点：上游 fast 角色慢的时候光说一句 "OK"
 * 都要 25 秒，40 秒对 8 个词的工具调用根本不够，卡这里只会让补充内容一直补不上。
 * 反正没人在等，慢就慢。注意 generateJson 遇到 schema 不匹配会重试一次，最坏两倍。
 */
const ENRICH_TIMEOUT_MS = 90_000;

/**
 * 用户最多为这批补充内容等多久。
 *
 * 补充内容是在首页打开时就后台起跑的（prewarmNewWords），走到新词环节时
 * 通常已经补完 —— 那时这里直接命中库里的字段，一秒都不等。真要等，也只等
 * 这么久：等到就是完整卡片，等不到就先用词典字段渲染，后台继续补，下次进来
 * 就有了。宁可卡片先少两行，也不让人对着白屏等一分钟。
 */
const ENRICH_WAIT_MS = 8_000;

/**
 * 正在补的批次，key 是这批词的 id。
 *
 * 首页会起跑一次，用户走到新词环节又会来一次，前端预取还可能再来一次 ——
 * 不去重就是同一批词付三份 token。同一批词在跑就复用同一个 promise。
 */
const enriching = new Map<string, Promise<void>>();

/**
 * 上一次补失败的时间，key 同 enriching。
 *
 * enriching 只合并「同时在跑」的请求，管不了「一次次进来」的请求。
 * 上游持续不给内容时（中转站回一段自我介绍就是这种），每次打开新词环节
 * 都会在后台白发一轮请求 —— 现在带降级链，一轮是两次调用，白烧两份 token。
 * 所以失败后压一个冷却窗：这段时间内不再重试，等窗口过了或者定时任务再说。
 *
 * 只压「刚刚失败过」的批次，不影响补齐过程本身：成功一次就把记录清掉。
 */
const enrichFailedAt = new Map<string, number>();
const ENRICH_RETRY_COOLDOWN_MS = 10 * 60_000;

function coolingDown(key: string): boolean {
  const at = enrichFailedAt.get(key);
  return at !== undefined && Date.now() - at < ENRICH_RETRY_COOLDOWN_MS;
}

/** 起一个补充任务，带上失败记账。同一批词在跑就复用，刚失败过就不跑。 */
function startEnrich(
  missing: WordRow[],
  learner: P.Learner,
  ctx: P.Ctx,
  label: string,
): Promise<void> | null {
  const key = missing.map((w) => w.id).join(',');
  const running = enriching.get(key);
  if (running) return running;
  if (coolingDown(key)) return null;

  const job = enrichMissing(missing, learner, ctx)
    .then(() => {
      enrichFailedAt.delete(key);
    })
    .catch((err) => {
      enrichFailedAt.set(key, Date.now());
      console.warn(`[newwords] ${label}：`, (err as Error).message);
    })
    .finally(() => {
      enriching.delete(key);
    });
  enriching.set(key, job);
  return job;
}

/**
 * 后台把今天的新词补齐，不阻塞调用方。
 *
 * 首页 /api/session/today 打开时调一次：那时离用户点到新词环节还有热身、
 * 语法几个环节的时间，足够上游慢慢来。返回的 promise 不会 reject，
 * 也可以不接 —— 补失败了新词环节自己会再试一次。
 */
export async function prewarmNewWords(user: UserProfile, session: SessionRow): Promise<void> {
  const words = await targetWordsOf(session);
  const missing = words.filter((w) => !w.example_en || !w.memory_hook_zh);
  if (!missing.length) return;
  const job = startEnrich(missing, learnerOf(user), await ctxOf(user, session), '预补充失败，留给新词环节重试');
  if (job) await job;
}

/**
 * 新词卡片：库里有什么就先摆出来，缺的等后台补一小会儿。
 *
 * 以前这里是直接 await 一次 AI 调用，上游抽风就是 73 秒白屏。现在补充动作
 * 交给 prewarmNewWords 在后台跑，这里只等 ENRICH_WAIT_MS，然后重新读库 ——
 * 补上了就是完整卡片，没补上就先用词典字段。
 */
async function enrichedCards(
  words: WordRow[],
  learner: P.Learner,
  ctx: P.Ctx,
): Promise<{ cards: EnrichedWord[]; complete: boolean }> {
  const missing = words.filter((w) => !w.example_en || !w.memory_hook_zh);
  if (!missing.length) return { cards: words.map(rowToCard), complete: true };

  const job = startEnrich(missing, learner, ctx, '补充例句/抓手失败，用库里现有内容渲染');
  // 刚失败过（冷却中）就不再等，直接用库里现有字段渲染 —— 等也等不到新东西
  if (!job) return { cards: words.map(rowToCard), complete: false };

  // 等不到就先走，后台那份 promise 还在跑，补完会自己写进 words 表
  let done = false;
  await Promise.race([
    job.then(() => {
      done = true;
    }),
    new Promise((r) => setTimeout(r, ENRICH_WAIT_MS)),
  ]);

  // 补充内容只落在库里，所以要重新读一遍才能拿到（后台那份也是写同一张表）
  const fresh = done ? await getWordsByIds(words.map((w) => w.id)) : words;
  const cards = (fresh.length === words.length ? fresh : words).map(rowToCard);
  return { cards, complete: cards.every((c) => c.example_en && c.memory_hook_zh) };
}

/**
 * 补充内容用哪个角色。
 *
 * 首选 fast（便宜、本来也没人等），但中转站的 fast 角色会间歇性地无视工具调用，
 * 直接回一段自我介绍 —— 生产日志里 66 条「补充例句/抓手失败」全是这个形状：
 * 「I am GPT-5.6 Luna, an official OpenAI model release running in Codex...」。
 * 这种回复解析必然失败，同一批词就永远补不上，卡片永远缺例句和抓手。
 *
 * 所以失败后降级到 content 角色再试一次：站里另外 5 个环节都走 content，
 * 它的工具调用是稳定的（对照证据：同一个 session 里那 5 个环节的缓存都写成功了）。
 * 一批词最多两次调用，只在 fast 抽风时才付第二次的钱。
 */
const ENRICH_ROLES = ['fast', 'content'] as const;

/** 真正发那一次 AI 调用，补完写回 words 表。只被上面两个入口调用。 */
async function enrichMissing(missing: WordRow[], learner: P.Learner, ctx: P.Ctx): Promise<void> {
  let lastErr: unknown;
  for (const role of ENRICH_ROLES) {
    try {
      await enrichOnce(missing, learner, ctx, role);
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`[newwords] ${role} 角色补充失败：${(err as Error).message}`);
    }
  }
  throw lastErr;
}

/** 一次补充尝试。role 决定用哪个模型。 */
async function enrichOnce(
  missing: WordRow[],
  learner: P.Learner,
  ctx: P.Ctx,
  role: 'fast' | 'content',
): Promise<void> {
  {
    const gen = await generateJson(S.EnrichWordsPayload, {
      system: P.systemPrompt(learner),
      prompt: P.enrichWordsPrompt(
        ctx,
        missing.map((m) => ({ term: m.term, meaning_zh: m.meaning_zh })),
      ),
      /*
       * 一个词大约 60 token 的产出，但 fast 角色可能是推理模型 —— 实测 8 个词
       * 的一次调用里有 450~1000 token 花在不出现在结果里的推理上。给窄了模型
       * 会在吐出工具调用之前就把额度用完，返回一个截断的 JSON。
       */
      maxTokens: Math.min(8000, 1500 + missing.length * 260),
      toolName: 'emit_word_details',
      // 首选 fast，它不给工具调用时由 enrichMissing 换 content 再来一次（见 ENRICH_ROLES）
      role,
      timeoutMs: ENRICH_TIMEOUT_MS,
    });
    const byTerm = new Map(gen.words.map((w) => [w.term.trim().toLowerCase(), w]));

    await Promise.all(
      missing.map(async (w) => {
        const ai = byTerm.get(w.term.toLowerCase());
        if (!ai) return;
        // 只填空位，不覆盖库里已有的（内置词表的例句是人工写的，比 AI 的可靠）
        await saveEnrichment(w.id, {
          example_en: w.example_en || ai.example_en,
          example_zh: w.example_zh || ai.example_zh,
          memory_hook_zh: w.memory_hook_zh || ai.memory_hook_zh,
          collocations: w.collocations?.length ? w.collocations : ai.collocations,
          pos: w.pos || ai.pos,
          meaning_en: w.meaning_en || ai.meaning_en,
        });
      }),
    );
  }
}

async function metaFor(session: SessionRow, stage: Stage): Promise<Record<string, unknown>> {
  const words = await targetWordsOf(session);
  // 2026-08-28：复习词也进 meta —— 热身以前只拿新词的 id 映射，到期词答完
  // termToId 查不到 → 整个热身的 FSRS 记账静默丢失（生产实锤：user3 的
  // review_logs 里 warmup 全部 wordId null，到期词 reps=0 永远排不上队）。
  const review = stage === 'warmup' ? await getWordsByIds(session.review_word_ids) : [];
  return {
    stage,
    sessionId: session.id,
    themeZh: session.theme_zh,
    themeEn: session.theme_en,
    stagesDone: session.stages_done,
    reviewWords: review.map((w) => ({
      id: w.id,
      term: w.term,
      meaning_zh: w.meaning_zh,
      phonetic: w.phonetic,
      // 词性给释义单选题干用（显示在词旁边，不进选项）
      pos: w.pos,
    })),
    targetWords: words.map((w) => ({
      id: w.id,
      term: w.term,
      meaning_zh: w.meaning_zh,
      phonetic: w.phonetic,
    })),
  };
}

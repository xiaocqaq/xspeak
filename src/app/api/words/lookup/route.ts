import { z } from 'zod';
import { body, currentUser, handle } from '@/lib/api';
import { generateJson } from '@/lib/ai/client';
import { LookupPayload, type LookupData } from '@/lib/ai/schemas';
import { lookupPrompt, systemPrompt, type Learner } from '@/lib/ai/prompts';
import { enrollWords, findWordByTerm, upsertWordFromAi } from '@/lib/repo/words';
import { formatSenses, lookupDict, type DictEntry } from '@/lib/repo/dictionary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * context 最多带多少字符进 prompt。
 *
 * 只影响第 3 条路径（AI 兜底）的 prompt 长度 —— 词典/库命中根本不读它。
 * 一句话的上下文绰绰有余，前端也已经只发所在句（见 sentenceWindow）。
 */
const CONTEXT_MAX = 600;

/** 超过这个长度当成恶意请求拒掉。留足余量，只防 POST 一个 10MB 字符串。 */
const CONTEXT_HARD_MAX = 8000;

const Body = z.object({
  term: z.string().min(1).max(80),
  /*
   * 超长不再报错，直接截断（2026-08-29 修）。
   *
   * 原来是 z.string().max(600) —— 超一个字符就整个请求 422。
   * 前端把整篇阅读原文当 context 发过来，而阅读篇目实测 500-683 字符，
   * 16 篇里 9 篇超过 600：**超过一半的阅读环节，点任何词查词都必然失败**。
   * 用户报的那条 683 字符查 "should" 就是这样，而 "should" 走的是词典命中，
   * 那段 context 压根不会被读到，却把整个请求挡在了门外。
   *
   * context 是建议性的：有它 AI 兜底能判断词义，没它也能查。
   * 用建议性字段的长度否决整个请求是不对的取舍 —— 截断才是。
   * 仍留一个 HARD_MAX 防滥用，那种量级明显不是正常调用。
   */
  context: z
    .string()
    .max(CONTEXT_HARD_MAX)
    .nullish()
    .transform((s) => (s ? s.slice(0, CONTEXT_MAX) : s)),
  /** 查完顺手加入学习队列 */
  enroll: z.boolean().default(false),
});

/** ECDICT 的考纲标签映射到 CEFR。粗略够用：只是给 FSRS 一个初始难度参考。 */
function cefrFromDict(d: DictEntry): LookupData['cefr'] {
  const tag = d.tag ?? '';
  if (tag.includes('zk')) return 'A1';
  if (tag.includes('gk')) return 'A2';
  if (tag.includes('cet4')) return 'B1';
  if (tag.includes('cet6') || tag.includes('ky')) return 'B2';
  if (tag.includes('toefl') || tag.includes('ielts') || tag.includes('gre')) return 'C1';
  // 没有考纲标签就按词频估：越常用越简单
  if (d.frq > 0 && d.frq <= 2000) return 'A1';
  if (d.frq > 0 && d.frq <= 6000) return 'A2';
  if (d.frq > 0 && d.frq <= 15000) return 'B1';
  return 'B2';
}

/**
 * 把词典条目整理成前端要的结构。
 *
 * 词典没有的两样东西是记忆钩子和例句 —— 那是教学内容而不是词条信息。
 * 这里不硬凑：memory_hook_zh 留空，前端按需再单独问 AI；
 * 例句用词典的英文释义顶一下，比编一句假例句诚实。
 */
function fromDict(d: DictEntry): LookupData & { source: 'dict' } {
  // 和每日新词共用一套整理逻辑：去掉 [计] [法] 这类学科标注行，
  // 并从释义行开头把词性抽出来（dictionary.pos 这一列在这份数据里是空的）
  const { pos, meaning_zh } = formatSenses(d.translation);
  return {
    term: d.word,
    phonetic: d.phonetic ?? '',
    pos: d.pos || pos,
    meaning_zh,
    meaning_en: d.definition?.split('\n')[0]?.trim() ?? '',
    cefr: cefrFromDict(d),
    // schema 要求至少 2 条例句，词典给不了真例句，就返回空数组让前端自己判断。
    // 这里不套 LookupPayload 校验，所以不会因为 min(2) 报错。
    examples: [],
    memory_hook_zh: '',
    confusable: [],
    source: 'dict',
  };
}

/**
 * 查词。阅读/听力里遇到不认识的词，选中即查。
 *
 * 顺序是「本地库 → 离线词典 → AI」：
 * 1. words 表命中说明这词已经在学，直接用库里的（也保证前后展示一致）；
 * 2. dictionary（ECDICT，77 万词）命中就毫秒返回，零 token；
 * 3. 都查不到才问 AI —— 通常是专名、俚语或拼错。
 *
 * 改这个顺序之前先想清楚：以前的实现查了 words 表却只拿结果判断"见过没"，
 * 然后照样调一次 AI，等于每次查词都白烧 token 白等几秒。
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await currentUser();
    const input = await body(req, Body);

    // 1) 已经在学的词
    const known = await findWordByTerm(input.term);
    if (known && known.meaning_zh) {
      if (input.enroll) await enrollWords(user.id, [known.id]);
      return {
        term: known.term,
        phonetic: known.phonetic ?? '',
        pos: known.pos ?? '',
        meaning_zh: known.meaning_zh,
        meaning_en: known.meaning_en ?? '',
        cefr: known.cefr,
        examples:
          known.example_en && known.example_zh
            ? [{ en: known.example_en, zh: known.example_zh }]
            : [],
        memory_hook_zh: '',
        confusable: [],
        wordId: known.id,
        enrolled: input.enroll,
        known: true,
        source: 'library' as const,
      };
    }

    // 2) 离线词典
    const dict = await lookupDict(input.term);
    if (dict) {
      const payload = fromDict(dict);
      const wordId = await upsertWordFromAi(
        {
          term: payload.term,
          phonetic: payload.phonetic,
          pos: payload.pos,
          meaning_zh: payload.meaning_zh,
          meaning_en: payload.meaning_en,
          example_en: '',
          example_zh: '',
          memory_hook_zh: '',
          collocations: [],
          frq: dict.frq,
        },
        // theme 记 'dict' 是为了在词表里能看出"这词是查出来的"；
        // source 才是真正的来源字段，以前两个都塞进 theme 了
        'dict',
        payload.cefr,
        'dict',
      );
      if (input.enroll) await enrollWords(user.id, [wordId]);
      return { ...payload, wordId, enrolled: input.enroll, known: false };
    }

    // 3) 词典也没有，才问 AI
    const learner: Learner = {
      name: user.name,
      level: user.level,
      goal: user.goal,
      interests: user.interests,
      newWordsPerDay: user.new_words_per_day,
    };
    /*
     * fast 抽风就换 content 再试一次（2026-08-29 补）。
     *
     * 中转站的 fast 角色会间歇性无视工具调用、直接回一段自我介绍
     * （「I am GPT-5.6 Luna.」），解析必然失败 → 502。用户实锤：点
     * tonight’s 一直没反应，就是这条路挂了。
     *
     * 今早给新词补义项加过同样的降级链（stage.ts 的 ENRICH_ROLES），
     * 查词这条漏了 —— 同一个上游缺陷要在所有依赖它的路径上都兜住。
     * 只在 fast 真失败时才付第二次的钱。
     */
    let result: Awaited<ReturnType<typeof generateJson<typeof LookupPayload>>> | null = null;
    let lastErr: unknown;
    for (const role of ['fast', 'content'] as const) {
      try {
        result = await generateJson(LookupPayload, {
          system: systemPrompt(learner),
          prompt: lookupPrompt(learner, input.term, input.context ?? null),
          maxTokens: 2000,
          temperature: 0.5,
          toolName: 'emit_lookup',
          role,
        });
        break;
      } catch (err) {
        lastErr = err;
        console.warn(`[lookup] ${role} 角色查「${input.term}」失败：${(err as Error).message}`);
      }
    }
    if (!result) throw lastErr;

    const wordId = await upsertWordFromAi(
      {
        term: result.term,
        phonetic: result.phonetic,
        pos: result.pos,
        meaning_zh: result.meaning_zh,
        meaning_en: result.meaning_en,
        example_en: result.examples[0]?.en ?? '',
        example_zh: result.examples[0]?.zh ?? '',
        memory_hook_zh: result.memory_hook_zh,
        collocations: [],
      },
      'lookup',
      result.cefr,
      'lookup',
    );
    if (input.enroll) await enrollWords(user.id, [wordId]);

    return { ...result, wordId, enrolled: input.enroll, known: false, source: 'ai' as const };
  });
}

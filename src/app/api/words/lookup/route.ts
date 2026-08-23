import { z } from 'zod';
import { body, currentUser, handle } from '@/lib/api';
import { generateJson } from '@/lib/ai/client';
import { LookupPayload } from '@/lib/ai/schemas';
import { lookupPrompt, systemPrompt, type Learner } from '@/lib/ai/prompts';
import { enrollWords, findWordByTerm, upsertWordFromAi } from '@/lib/repo/words';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  term: z.string().min(1).max(80),
  context: z.string().max(600).nullish(),
  /** 查完顺手加入学习队列 */
  enroll: z.boolean().default(false),
});

/**
 * 查词。阅读/听力里遇到不认识的词，选中即查，
 * 查完可以直接加入生词本进入 FSRS 调度。
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await currentUser();
    const input = await body(req, Body);
    const learner: Learner = {
      name: user.name,
      level: user.level,
      goal: user.goal,
      interests: user.interests,
      newWordsPerDay: user.new_words_per_day,
    };

    // 入库前先看一眼，用来告诉前端这个词是不是早就见过
    const before = await findWordByTerm(input.term);

    const result = await generateJson(LookupPayload, {
      system: systemPrompt(learner),
      prompt: lookupPrompt(learner, input.term, input.context ?? null),
      maxTokens: 2000,
      temperature: 0.5,
      toolName: 'emit_lookup',
    });

    // 入库，这样它能进生词本和后续复习
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
    );
    if (input.enroll) await enrollWords(user.id, [wordId]);

    return { ...result, wordId, enrolled: input.enroll, known: Boolean(before) };
  });
}

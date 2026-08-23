import { z } from 'zod';
import { body, currentUser, handle } from '@/lib/api';
import { generateJson } from '@/lib/ai/client';
import { ExtractPayload } from '@/lib/ai/schemas';
import { extractPrompt, systemPrompt, type Learner } from '@/lib/ai/prompts';
import { all, one } from '@/lib/db';
import { enrollWords, upsertWordFromAi } from '@/lib/repo/words';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  title: z.string().min(1).max(120).default('我的素材'),
  kind: z.enum(['article', 'subtitle', 'doc', 'lyrics']).default('article'),
  raw: z.string().min(20).max(40_000),
  /** 抽完直接把词加入学习队列 */
  enroll: z.boolean().default(true),
});

/**
 * 把你自己感兴趣的素材（文章 / 美剧字幕 / 技术文档）扔进来，
 * AI 按你的水平挑词、讲句式，词直接进 FSRS 队列。
 * 这是内置词表之外的第二个内容来源。
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

    const result = await generateJson(ExtractPayload, {
      system: systemPrompt(learner),
      prompt: extractPrompt(learner, input.title, input.raw),
      maxTokens: 8000,
      temperature: 0.5,
      toolName: 'emit_extract',
    });

    const material = await one<{ id: number }>(
      `INSERT INTO materials (user_id, title, kind, raw, summary_zh, word_count, extracted)
       VALUES (?, ?, ?, ?, ?, ?, 1) RETURNING id`,
      [
        user.id,
        result.title || input.title,
        input.kind,
        input.raw,
        result.summary_zh,
        input.raw.split(/\s+/).filter(Boolean).length,
      ],
    );
    const materialId = material!.id;

    const wordIds: number[] = [];
    for (const w of result.words) {
      wordIds.push(await upsertWordFromAi(w, `material:${materialId}`, user.level));
    }
    if (input.enroll) await enrollWords(user.id, wordIds);

    return {
      materialId,
      title: result.title,
      summaryZh: result.summary_zh,
      words: result.words.map((w, i) => ({ ...w, id: wordIds[i] })),
      grammarNotes: result.grammar_notes,
      enrolled: input.enroll,
    };
  });
}

export async function GET() {
  return handle(async () => {
    const user = await currentUser();
    const rows = await all(
      `SELECT id, title, kind, summary_zh, word_count, created_at FROM materials
       WHERE user_id = ? ORDER BY id DESC LIMIT 50`,
      [user.id],
    );
    return { materials: rows };
  });
}

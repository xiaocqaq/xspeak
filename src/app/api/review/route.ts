import { z } from 'zod';
import { body, currentUser, handle } from '@/lib/api';
import { enrollWords, markProduced, pushSeenContext, rateWord } from '@/lib/repo/words';
import { rateGrammar } from '@/lib/repo/grammar';
import { recordMistakes } from '@/lib/repo/mistakes';
import { bumpDaily } from '@/lib/repo/stats';
import { json, run } from '@/lib/db';
import { scorePronunciation } from '@/lib/pronounce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Rating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

const ReviewBody = z.object({
  /** 单词评分：一次可以提交多个 */
  words: z
    .array(
      z.object({
        wordId: z.number().int().positive(),
        rating: Rating,
        mode: z.string().default('recall'),
        elapsedMs: z.number().min(0).max(600_000).default(0),
        /** 本次用过的语境句，写入 seen_contexts 以便下次换新 */
        context: z.string().max(400).optional(),
      }),
    )
    .default([]),
  /** 语法点评分 */
  grammar: z
    .array(z.object({ grammarId: z.number().int().positive(), rating: Rating, wrongCount: z.number().min(0).max(20).default(0) }))
    .default([]),
  /** 今天主动说/写出来的词 */
  produced: z.array(z.number().int().positive()).default([]),
  /** 新学的词入队 */
  enroll: z.array(z.number().int().positive()).default([]),
  /** 错误记录 */
  mistakes: z
    .array(
      z.object({
        // reading 是后加的：阅读题从开放问答改成四选一之后，也能判对错了
        kind: z.enum(['grammar', 'word_choice', 'spelling', 'style', 'pronunciation', 'listening', 'reading']),
        stage: z.string().optional(),
        wordId: z.number().int().positive().nullish(),
        grammarId: z.number().int().positive().nullish(),
        wrong: z.string().min(1).max(300),
        correct: z.string().max(300).nullish(),
        note: z.string().max(500).nullish(),
      }),
    )
    .default([]),
  /** 发音练习记录 */
  speech: z
    .array(
      z.object({
        target: z.string().min(1),
        transcript: z.string(),
        sessionId: z.number().int().positive().nullish(),
      }),
    )
    .default([]),
  spokenSeconds: z.number().min(0).max(7200).default(0),
});

/**
 * 学习行为统一提交口。前端一个环节做完调一次，
 * 里面同时完成：FSRS 推进、产出计数、错误归档、当天统计。
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await currentUser();
    const input = await body(req, ReviewBody);

    if (input.enroll.length) await enrollWords(user.id, input.enroll);

    const results: { wordId: number; due: string; state: number }[] = [];
    let correct = 0;
    for (const w of input.words) {
      const r = await rateWord(user.id, w.wordId, w.rating, w.mode, w.elapsedMs);
      if (w.context) await pushSeenContext(user.id, w.wordId, w.context);
      if (w.rating >= 3) correct++;
      results.push({ wordId: w.wordId, ...r });
    }

    for (const g of input.grammar) await rateGrammar(user.id, g.grammarId, g.rating, g.wrongCount);
    if (input.produced.length) await markProduced(user.id, input.produced);
    if (input.mistakes.length) await recordMistakes(user.id, input.mistakes);

    const speechScores: { target: string; score: number }[] = [];
    for (const s of input.speech) {
      const res = scorePronunciation(s.target, s.transcript);
      await run(
        `INSERT INTO speech_attempts (user_id, session_id, target, transcript, score, detail)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [user.id, s.sessionId ?? null, s.target, s.transcript, res.score, json(res.words)],
      );
      speechScores.push({ target: s.target, score: res.score });
    }

    await bumpDaily(user.id, {
      reviews: input.words.length,
      correct,
      new_words: input.enroll.length,
      produced: input.produced.length,
      spoken_seconds: Math.round(input.spokenSeconds),
    });

    return { results, speechScores };
  });
}

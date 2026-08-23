import { z } from 'zod';
import { body, currentUser, handle } from '@/lib/api';
import { getDb } from '@/lib/db';
import { scorePronunciation } from '@/lib/pronounce';
import { bumpDaily } from '@/lib/repo/stats';
import { recordMistake } from '@/lib/repo/mistakes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  target: z.string().min(1).max(600),
  transcript: z.string().max(600),
  sessionId: z.number().int().positive().nullish(),
  spokenSeconds: z.number().min(0).max(600).default(0),
});

/**
 * 单句跟读打分。和 /api/review 里的 speech 字段用的是同一个打分器，
 * 区别是这里立刻把逐词结果返回给前端做高亮。
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = currentUser();
    const input = await body(req, Body);
    const scored = scorePronunciation(input.target, input.transcript);

    getDb()
      .prepare(
        `INSERT INTO speech_attempts (user_id, session_id, target, transcript, score, detail)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user.id,
        input.sessionId ?? null,
        input.target,
        input.transcript,
        scored.score,
        JSON.stringify(scored.words),
      );

    // 念得明显不准才记进错误本，免得错误本被日常波动灌满
    if (scored.score < 60) {
      recordMistake(user.id, {
        kind: 'pronunciation',
        stage: 'speaking',
        wrong: input.transcript || '(没识别到)',
        correct: input.target,
        note: scored.summaryZh,
      });
    }

    bumpDaily(user.id, { spoken_seconds: Math.round(input.spokenSeconds) });
    return { scored };
  });
}

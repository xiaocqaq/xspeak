import { z } from 'zod';
import { body, currentUser, handle } from '@/lib/api';
import { generateJson } from '@/lib/ai/client';
import { CorrectionPayload } from '@/lib/ai/schemas';
import { correctionPrompt, systemPrompt, type Learner } from '@/lib/ai/prompts';
import { getDb } from '@/lib/db';
import { getWordsByIds, markProduced } from '@/lib/repo/words';
import { recordMistakes } from '@/lib/repo/mistakes';
import { bumpDaily } from '@/lib/repo/stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  sessionId: z.number().int().positive().nullish(),
  promptEn: z.string().min(1).max(1000),
  promptZh: z.string().max(1000).nullish(),
  text: z.string().min(1).max(4000),
  mustUse: z.array(z.string()).default([]),
  targetWordIds: z.array(z.number().int().positive()).default([]),
});

/** 写作批改：出分、给改后版本、逐条问题，并把错误归档。 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = currentUser();
    const input = await body(req, Body);
    const learner: Learner = {
      name: user.name,
      level: user.level,
      goal: user.goal,
      interests: user.interests,
      newWordsPerDay: user.new_words_per_day,
    };

    const result = await generateJson(CorrectionPayload, {
      system: systemPrompt(learner),
      prompt: correctionPrompt(learner, input.promptEn, input.text, input.mustUse),
      maxTokens: 4000,
      temperature: 0.4,
      toolName: 'emit_correction',
    });

    getDb()
      .prepare(
        `INSERT INTO writings (user_id, session_id, prompt_en, prompt_zh, text, corrected, score, feedback)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user.id,
        input.sessionId ?? null,
        input.promptEn,
        input.promptZh ?? null,
        input.text,
        result.corrected_en,
        result.score,
        JSON.stringify({ summary_zh: result.summary_zh, issues: result.issues }),
      );

    if (result.issues.length) {
      recordMistakes(
        user.id,
        result.issues.map((i) => ({
          kind: i.kind,
          stage: 'writing',
          wrong: i.wrong,
          correct: i.correct,
          note: i.note_zh,
        })),
      );
    }

    // 真的用上了目标词才算产出
    const used = matchIds(result.used_target_words, input.targetWordIds);
    if (used.length) markProduced(user.id, used);
    bumpDaily(user.id, { produced: used.length });

    return { ...result, usedWordIds: used };
  });
}

/** 历史写作记录 */
export async function GET() {
  return handle(async () => {
    const user = currentUser();
    const rows = getDb()
      .prepare(
        `SELECT id, prompt_en, prompt_zh, text, corrected, score, feedback, created_at
         FROM writings WHERE user_id = ? ORDER BY id DESC LIMIT 50`,
      )
      .all(user.id);
    return { writings: rows };
  });
}

function matchIds(terms: string[], candidateIds: number[]): number[] {
  if (!terms.length || !candidateIds.length) return [];
  const words = getWordsByIds(candidateIds);
  const set = new Set(terms.map((t) => t.toLowerCase().trim()));
  return words.filter((w) => set.has(w.term.toLowerCase())).map((w) => w.id);
}

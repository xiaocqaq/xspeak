import { all, one, run } from '@/lib/db';
import { applyRating, emptyCardRow, type CardRow } from '@/lib/scheduler';
import type { GrammarRow } from '@/lib/types';

const COLS = `id, slug, title_zh, title_en, cefr, explain_zh, pattern, examples, pitfalls, ord`;
const G_COLS = `g.id, g.slug, g.title_zh, g.title_en, g.cefr, g.explain_zh, g.pattern, g.examples, g.pitfalls, g.ord`;

/** FSRS 卡片的 10 个可写列，enroll / rate 共用。 */
const CARD_COLS = `state, due, stability, difficulty, elapsed_days, scheduled_days,
        learning_steps, reps, lapses, last_review`;

function toGrammar(r: Record<string, unknown>): GrammarRow {
  return {
    id: Number(r.id),
    slug: String(r.slug),
    title_zh: String(r.title_zh),
    title_en: String(r.title_en),
    cefr: String(r.cefr),
    explain_zh: String(r.explain_zh),
    pattern: (r.pattern as string | null) ?? null,
    // examples / pitfalls 是 jsonb，驱动已经解析好了
    examples: Array.isArray(r.examples) ? (r.examples as { en: string; zh: string }[]) : [],
    pitfalls: Array.isArray(r.pitfalls) ? (r.pitfalls as string[]) : [],
    ord: Number(r.ord),
  };
}

export async function getGrammarById(id: number): Promise<GrammarRow | null> {
  const r = await one<Record<string, unknown>>(
    `SELECT ${COLS} FROM grammar_points WHERE id = ?`,
    [id],
  );
  return r ? toGrammar(r) : null;
}

/**
 * 挑今天的语法点：优先到期复习的，其次按顺序上新的。
 * 这样语法也在 FSRS 调度里，不会学完就忘。
 */
export async function pickGrammarForToday(
  userId: number,
  level: string,
): Promise<GrammarRow | null> {
  const due = await one<Record<string, unknown>>(
    `SELECT ${G_COLS}
     FROM user_grammar ug JOIN grammar_points g ON g.id = ug.grammar_id
     WHERE ug.user_id = ? AND ug.due <= now()
     ORDER BY ug.due ASC LIMIT 1`,
    [userId],
  );
  if (due) return toGrammar(due);

  const levels = level === 'A1' ? ['A1'] : level === 'A2' ? ['A1', 'A2'] : ['A1', 'A2', 'B1'];
  const fresh = await one<Record<string, unknown>>(
    `SELECT ${COLS} FROM grammar_points
     WHERE id NOT IN (SELECT grammar_id FROM user_grammar WHERE user_id = ?)
       AND cefr = ANY(?::text[])
     ORDER BY ord ASC LIMIT 1`,
    [userId, levels],
  );
  if (fresh) return toGrammar(fresh);

  // 都学过且都没到期：拿最快到期的那个
  const soon = await one<Record<string, unknown>>(
    `SELECT ${G_COLS}
     FROM user_grammar ug JOIN grammar_points g ON g.id = ug.grammar_id
     WHERE ug.user_id = ? ORDER BY ug.due ASC LIMIT 1`,
    [userId],
  );
  return soon ? toGrammar(soon) : null;
}

export async function enrollGrammar(userId: number, grammarId: number): Promise<void> {
  const c = emptyCardRow();
  await run(
    `INSERT INTO user_grammar (user_id, grammar_id, ${CARD_COLS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, grammar_id) DO NOTHING`,
    [
      userId, grammarId,
      c.state, c.due, c.stability, c.difficulty, c.elapsed_days, c.scheduled_days,
      c.learning_steps, c.reps, c.lapses, c.last_review,
    ],
  );
}

export async function rateGrammar(
  userId: number,
  grammarId: number,
  rating: 1 | 2 | 3 | 4,
  wrongCount = 0,
): Promise<void> {
  await enrollGrammar(userId, grammarId);
  const row = (await one<CardRow>(
    `SELECT ${CARD_COLS} FROM user_grammar WHERE user_id = ? AND grammar_id = ?`,
    [userId, grammarId],
  ))!;
  const next = applyRating(row, rating);
  await run(
    `UPDATE user_grammar SET state=@state, due=@due, stability=@stability, difficulty=@difficulty,
       elapsed_days=@elapsed_days, scheduled_days=@scheduled_days, learning_steps=@learning_steps,
       reps=@reps, lapses=@lapses, last_review=@last_review, error_count = error_count + @wrong
     WHERE user_id=@user_id AND grammar_id=@grammar_id`,
    { ...next, wrong: wrongCount, user_id: userId, grammar_id: grammarId },
  );
  await run(
    `INSERT INTO review_logs (user_id, kind, item_id, rating, mode) VALUES (?, 'grammar', ?, ?, 'exercise')`,
    [userId, grammarId, rating],
  );
}

export type GrammarWithProgress = GrammarRow & {
  state: number | null;
  due: string | null;
  reps: number;
  error_count: number;
};

export async function listGrammar(userId: number): Promise<GrammarWithProgress[]> {
  const rows = await all<Record<string, unknown>>(
    `SELECT ${G_COLS}, ug.state, ug.due, ug.reps, ug.error_count
     FROM grammar_points g
     LEFT JOIN user_grammar ug ON ug.grammar_id = g.id AND ug.user_id = ?
     ORDER BY g.ord ASC`,
    [userId],
  );
  return rows.map((r) => ({
    ...toGrammar(r),
    state: r.state == null ? null : Number(r.state),
    due: (r.due as string | null) ?? null,
    reps: Number(r.reps ?? 0),
    error_count: Number(r.error_count ?? 0),
  }));
}

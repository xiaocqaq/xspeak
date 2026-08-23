import { getDb, safeJson } from '@/lib/db';
import { applyRating, emptyCardRow, type CardRow } from '@/lib/scheduler';
import type { GrammarRow } from '@/lib/types';

const COLS = `id, slug, title_zh, title_en, cefr, explain_zh, pattern, examples, pitfalls, ord`;
const G_COLS = `g.id, g.slug, g.title_zh, g.title_en, g.cefr, g.explain_zh, g.pattern, g.examples, g.pitfalls, g.ord`;

function toGrammar(r: Record<string, unknown>): GrammarRow {
  return {
    id: Number(r.id),
    slug: String(r.slug),
    title_zh: String(r.title_zh),
    title_en: String(r.title_en),
    cefr: String(r.cefr),
    explain_zh: String(r.explain_zh),
    pattern: (r.pattern as string | null) ?? null,
    examples: safeJson<{ en: string; zh: string }[]>(r.examples, []),
    pitfalls: safeJson<string[]>(r.pitfalls, []),
    ord: Number(r.ord),
  };
}

export function getGrammarById(id: number): GrammarRow | null {
  const r = getDb().prepare(`SELECT ${COLS} FROM grammar_points WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return r ? toGrammar(r) : null;
}

/**
 * 挑今天的语法点：优先到期复习的，其次按顺序上新的。
 * 这样语法也在 FSRS 调度里，不会学完就忘。
 */
export function pickGrammarForToday(userId: number, level: string): GrammarRow | null {
  const db = getDb();
  const due = db
    .prepare(
      `SELECT ${G_COLS}
       FROM user_grammar ug JOIN grammar_points g ON g.id = ug.grammar_id
       WHERE ug.user_id = ? AND ug.due <= datetime('now')
       ORDER BY ug.due ASC LIMIT 1`,
    )
    .get(userId) as Record<string, unknown> | undefined;
  if (due) return toGrammar(due);

  const levels = level === 'A1' ? ['A1'] : level === 'A2' ? ['A1', 'A2'] : ['A1', 'A2', 'B1'];
  const ph = levels.map(() => '?').join(',');
  const fresh = db
    .prepare(
      `SELECT ${COLS} FROM grammar_points
       WHERE id NOT IN (SELECT grammar_id FROM user_grammar WHERE user_id = ?)
         AND cefr IN (${ph})
       ORDER BY ord ASC LIMIT 1`,
    )
    .get(userId, ...levels) as Record<string, unknown> | undefined;
  if (fresh) return toGrammar(fresh);

  // 都学过且都没到期：拿最快到期的那个
  const soon = db
    .prepare(
      `SELECT ${G_COLS}
       FROM user_grammar ug JOIN grammar_points g ON g.id = ug.grammar_id
       WHERE ug.user_id = ? ORDER BY ug.due ASC LIMIT 1`,
    )
    .get(userId) as Record<string, unknown> | undefined;
  return soon ? toGrammar(soon) : null;
}

export function enrollGrammar(userId: number, grammarId: number): void {
  const card = emptyCardRow();
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO user_grammar
         (user_id, grammar_id, state, due, stability, difficulty, elapsed_days, scheduled_days,
          learning_steps, reps, lapses, last_review)
       VALUES (?, ?, @state, @due, @stability, @difficulty, @elapsed_days, @scheduled_days,
          @learning_steps, @reps, @lapses, @last_review)`,
    )
    .run(userId, grammarId, card);
}

export function rateGrammar(
  userId: number,
  grammarId: number,
  rating: 1 | 2 | 3 | 4,
  wrongCount = 0,
): void {
  const db = getDb();
  enrollGrammar(userId, grammarId);
  const row = db
    .prepare(
      `SELECT state, due, stability, difficulty, elapsed_days, scheduled_days,
              learning_steps, reps, lapses, last_review
       FROM user_grammar WHERE user_id = ? AND grammar_id = ?`,
    )
    .get(userId, grammarId) as CardRow;
  const next = applyRating(row, rating);
  db.prepare(
    `UPDATE user_grammar SET state=@state, due=@due, stability=@stability, difficulty=@difficulty,
       elapsed_days=@elapsed_days, scheduled_days=@scheduled_days, learning_steps=@learning_steps,
       reps=@reps, lapses=@lapses, last_review=@last_review, error_count = error_count + @wrong
     WHERE user_id=@user_id AND grammar_id=@grammar_id`,
  ).run({ ...next, wrong: wrongCount, user_id: userId, grammar_id: grammarId });
  db.prepare(
    `INSERT INTO review_logs (user_id, kind, item_id, rating, mode) VALUES (?, 'grammar', ?, ?, 'exercise')`,
  ).run(userId, grammarId, rating);
}

export type GrammarWithProgress = GrammarRow & {
  state: number | null;
  due: string | null;
  reps: number;
  error_count: number;
};

export function listGrammar(userId: number): GrammarWithProgress[] {
  const rows = getDb()
    .prepare(
      `SELECT g.id, g.slug, g.title_zh, g.title_en, g.cefr, g.explain_zh, g.pattern,
              g.examples, g.pitfalls, g.ord,
              ug.state, ug.due, ug.reps, ug.error_count
       FROM grammar_points g
       LEFT JOIN user_grammar ug ON ug.grammar_id = g.id AND ug.user_id = ?
       ORDER BY g.ord ASC`,
    )
    .all(userId) as Record<string, unknown>[];
  return rows.map((r) => ({
    ...toGrammar(r),
    state: r.state == null ? null : Number(r.state),
    due: (r.due as string | null) ?? null,
    reps: Number(r.reps ?? 0),
    error_count: Number(r.error_count ?? 0),
  }));
}

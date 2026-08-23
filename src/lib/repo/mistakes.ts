import { getDb } from '@/lib/db';
import type { MistakeBrief } from '@/lib/ai/prompts';
import type { MistakeRow } from '@/lib/types';

export type MistakeInput = {
  kind: 'grammar' | 'word_choice' | 'spelling' | 'style' | 'pronunciation' | 'listening';
  stage?: string;
  wordId?: number | null;
  grammarId?: number | null;
  wrong: string;
  correct?: string | null;
  note?: string | null;
};

/**
 * 记录一个错误。同一个错误重复出现只累加 times，
 * 这样"反复踩的坑"会自然浮到前面，明天的内容优先针对它。
 */
export function recordMistake(userId: number, m: MistakeInput): void {
  const db = getDb();
  const wrong = m.wrong.trim().slice(0, 300);
  if (!wrong) return;
  const existing = db
    .prepare(
      `SELECT id FROM mistakes WHERE user_id = ? AND kind = ? AND wrong = ? AND resolved = 0`,
    )
    .get(userId, m.kind, wrong) as { id: number } | undefined;
  if (existing) {
    db.prepare('UPDATE mistakes SET times = times + 1, created_at = datetime(\'now\') WHERE id = ?').run(
      existing.id,
    );
    return;
  }
  db.prepare(
    `INSERT INTO mistakes (user_id, kind, stage, word_id, grammar_id, wrong, correct, note_zh)
     VALUES (@user_id, @kind, @stage, @word_id, @grammar_id, @wrong, @correct, @note)`,
  ).run({
    user_id: userId,
    kind: m.kind,
    stage: m.stage ?? null,
    word_id: m.wordId ?? null,
    grammar_id: m.grammarId ?? null,
    wrong,
    correct: m.correct?.slice(0, 300) ?? null,
    note: m.note?.slice(0, 500) ?? null,
  });
}

export function recordMistakes(userId: number, list: MistakeInput[]): void {
  const db = getDb();
  db.transaction(() => {
    for (const m of list) recordMistake(userId, m);
  })();
}

/** 取最近未解决的错误，注入到 prompt 里做针对性复现。重复次数多的优先。 */
export function recentMistakes(userId: number, limit = 8): MistakeBrief[] {
  const rows = getDb()
    .prepare(
      `SELECT kind, wrong, correct, note_zh FROM mistakes
       WHERE user_id = ? AND resolved = 0
       ORDER BY times DESC, created_at DESC LIMIT ?`,
    )
    .all(userId, limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    kind: String(r.kind),
    wrong: String(r.wrong),
    correct: (r.correct as string | null) ?? null,
    note: (r.note_zh as string | null) ?? null,
  }));
}

export function listMistakes(userId: number, includeResolved = false): MistakeRow[] {
  const rows = getDb()
    .prepare(
      `SELECT id, kind, stage, wrong, correct, note_zh, times, resolved, created_at
       FROM mistakes WHERE user_id = ? ${includeResolved ? '' : 'AND resolved = 0'}
       ORDER BY times DESC, created_at DESC LIMIT 200`,
    )
    .all(userId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    kind: String(r.kind),
    stage: (r.stage as string | null) ?? null,
    wrong: String(r.wrong),
    correct: (r.correct as string | null) ?? null,
    note_zh: (r.note_zh as string | null) ?? null,
    times: Number(r.times),
    resolved: Number(r.resolved),
    created_at: String(r.created_at),
  }));
}

export function resolveMistake(userId: number, id: number): void {
  getDb().prepare('UPDATE mistakes SET resolved = 1 WHERE user_id = ? AND id = ?').run(userId, id);
}

export function countOpenMistakes(userId: number): number {
  return (
    getDb()
      .prepare('SELECT COUNT(*) AS c FROM mistakes WHERE user_id = ? AND resolved = 0')
      .get(userId) as { c: number }
  ).c;
}

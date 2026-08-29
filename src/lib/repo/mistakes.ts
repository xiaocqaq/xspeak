import { all, one, run } from '@/lib/db';
import type { MistakeBrief } from '@/lib/ai/prompts';
import type { MistakeRow } from '@/lib/types';

export type MistakeInput = {
  kind: 'grammar' | 'word_choice' | 'spelling' | 'style' | 'pronunciation' | 'listening' | 'reading';
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
export async function recordMistake(userId: number, m: MistakeInput): Promise<void> {
  const wrong = m.wrong.trim().slice(0, 300);
  if (!wrong) return;
  const existing = await one<{ id: number }>(
    `SELECT id FROM mistakes WHERE user_id = ? AND kind = ? AND wrong = ? AND resolved = 0`,
    [userId, m.kind, wrong],
  );
  if (existing) {
    await run('UPDATE mistakes SET times = times + 1, created_at = now() WHERE id = ?', [
      existing.id,
    ]);
    return;
  }
  await run(
    `INSERT INTO mistakes (user_id, kind, stage, word_id, grammar_id, wrong, correct, note_zh)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      m.kind,
      m.stage ?? null,
      m.wordId ?? null,
      m.grammarId ?? null,
      wrong,
      m.correct?.slice(0, 300) ?? null,
      m.note?.slice(0, 500) ?? null,
    ],
  );
}

export async function recordMistakes(userId: number, list: MistakeInput[]): Promise<void> {
  // 逐条写：recordMistake 里是"查了再决定 update 还是 insert"，
  // 顺序执行才能让同一批里重复的错误正确累加到一行上。
  for (const m of list) await recordMistake(userId, m);
}

/** 取最近未解决的错误，注入到 prompt 里做针对性复现。重复次数多的优先。 */
export async function recentMistakes(userId: number, limit = 8): Promise<MistakeBrief[]> {
  const rows = await all<Record<string, unknown>>(
    `SELECT kind, wrong, correct, note_zh FROM mistakes
     WHERE user_id = ? AND resolved = 0
     ORDER BY times DESC, created_at DESC LIMIT ?`,
    [userId, limit],
  );
  return rows.map((r) => ({
    kind: String(r.kind),
    wrong: String(r.wrong),
    correct: (r.correct as string | null) ?? null,
    note: (r.note_zh as string | null) ?? null,
  }));
}

export async function listMistakes(
  userId: number,
  includeResolved = false,
): Promise<MistakeRow[]> {
  const rows = await all<Record<string, unknown>>(
    `SELECT id, kind, stage, wrong, correct, note_zh, times, resolved, created_at
     FROM mistakes WHERE user_id = ? ${includeResolved ? '' : 'AND resolved = 0'}
     ORDER BY times DESC, created_at DESC LIMIT 200`,
    [userId],
  );
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

export async function resolveMistake(userId: number, id: number): Promise<void> {
  await run('UPDATE mistakes SET resolved = 1 WHERE user_id = ? AND id = ?', [userId, id]);
}

export async function countOpenMistakes(userId: number): Promise<number> {
  const row = await one<{ c: number }>(
    'SELECT COUNT(*) AS c FROM mistakes WHERE user_id = ? AND resolved = 0',
    [userId],
  );
  return row?.c ?? 0;
}

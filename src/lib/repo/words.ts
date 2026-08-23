import { getDb, safeJson } from '@/lib/db';
import { applyRating, cardToRow, emptyCardRow, nowSql, type CardRow } from '@/lib/scheduler';
import type { UserWordRow, VocabEntry, WordRow } from '@/lib/types';
import type { NewWordData } from '@/lib/ai/schemas';

const WORD_COLS = `id, term, phonetic, pos, meaning_zh, meaning_en, cefr, theme, example_en, example_zh, source`;

export function getWordsByIds(ids: number[]): WordRow[] {
  if (!ids.length) return [];
  const db = getDb();
  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT ${WORD_COLS} FROM words WHERE id IN (${ph})`).all(...ids) as WordRow[];
  // 保持传入顺序
  const map = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => map.get(id)).filter((r): r is WordRow => Boolean(r));
}

/** 到期需要复习的词，按到期时间升序。 */
export function getDueWords(userId: number, limit: number): (WordRow & { progress: UserWordRow })[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT w.id, w.term, w.phonetic, w.pos, w.meaning_zh, w.meaning_en, w.cefr, w.theme,
              w.example_en, w.example_zh, w.source,
              uw.word_id, uw.state, uw.due, uw.stability, uw.difficulty, uw.elapsed_days,
              uw.scheduled_days, uw.learning_steps, uw.reps, uw.lapses, uw.last_review,
              uw.produced_count, uw.seen_contexts, uw.starred
       FROM user_words uw
       JOIN words w ON w.id = uw.word_id
       WHERE uw.user_id = ? AND uw.due <= datetime('now')
       ORDER BY uw.due ASC
       LIMIT ?`,
    )
    .all(userId, limit) as Record<string, unknown>[];
  return rows.map((r) => ({ ...(toWord(r) as WordRow), progress: toProgress(r) }));
}

export function countDueWords(userId: number): number {
  const db = getDb();
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM user_words WHERE user_id = ? AND due <= datetime('now')`,
      )
      .get(userId) as { c: number }
  ).c;
}

/** 还没学过的候选新词，优先当天主题、其次匹配水平。 */
export function pickNewWords(userId: number, theme: string, level: string, limit: number): WordRow[] {
  const db = getDb();
  const levels = level === 'A1' ? ['A1'] : level === 'A2' ? ['A1', 'A2'] : ['A1', 'A2', 'B1'];
  const ph = levels.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT ${WORD_COLS} FROM words w
       WHERE w.id NOT IN (SELECT word_id FROM user_words WHERE user_id = ?)
         AND w.cefr IN (${ph})
       ORDER BY (w.theme = ?) DESC, RANDOM()
       LIMIT ?`,
    )
    .all(userId, ...levels, theme, limit) as WordRow[];
}

/** AI 生成的新词入库（已存在就补全空字段），返回 word id。 */
export function upsertWordFromAi(w: NewWordData, theme: string, cefr = 'A2'): number {
  const db = getDb();
  const term = w.term.trim();
  const existing = db.prepare('SELECT id FROM words WHERE term = ?').get(term) as
    | { id: number }
    | undefined;
  if (existing) {
    db.prepare(
      `UPDATE words SET
         phonetic = COALESCE(NULLIF(phonetic,''), @phonetic),
         pos = COALESCE(NULLIF(pos,''), @pos),
         meaning_en = COALESCE(NULLIF(meaning_en,''), @meaning_en),
         example_en = COALESCE(NULLIF(example_en,''), @example_en),
         example_zh = COALESCE(NULLIF(example_zh,''), @example_zh)
       WHERE id = @id`,
    ).run({
      id: existing.id,
      phonetic: w.phonetic,
      pos: w.pos,
      meaning_en: w.meaning_en,
      example_en: w.example_en,
      example_zh: w.example_zh,
    });
    return existing.id;
  }
  const info = db
    .prepare(
      `INSERT INTO words (term, phonetic, pos, meaning_zh, meaning_en, cefr, theme, example_en, example_zh, source)
       VALUES (@term, @phonetic, @pos, @meaning_zh, @meaning_en, @cefr, @theme, @example_en, @example_zh, 'ai')`,
    )
    .run({
      term,
      phonetic: w.phonetic,
      pos: w.pos,
      meaning_zh: w.meaning_zh,
      meaning_en: w.meaning_en,
      cefr,
      theme,
      example_en: w.example_en,
      example_zh: w.example_zh,
    });
  return Number(info.lastInsertRowid);
}

/** 把词加入学习队列（幂等）。 */
export function enrollWords(userId: number, wordIds: number[]): void {
  if (!wordIds.length) return;
  const db = getDb();
  const card = emptyCardRow();
  const ins = db.prepare(
    `INSERT OR IGNORE INTO user_words
       (user_id, word_id, state, due, stability, difficulty, elapsed_days, scheduled_days,
        learning_steps, reps, lapses, last_review)
     VALUES (?, ?, @state, @due, @stability, @difficulty, @elapsed_days, @scheduled_days,
        @learning_steps, @reps, @lapses, @last_review)`,
  );
  db.transaction(() => {
    for (const id of wordIds) ins.run(userId, id, card);
  })();
}

/** 评分并推进调度，同时写复习日志。返回新的到期时间。 */
export function rateWord(
  userId: number,
  wordId: number,
  rating: 1 | 2 | 3 | 4,
  mode = 'recall',
  elapsedMs = 0,
): { due: string; state: number } {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT state, due, stability, difficulty, elapsed_days, scheduled_days,
              learning_steps, reps, lapses, last_review
       FROM user_words WHERE user_id = ? AND word_id = ?`,
    )
    .get(userId, wordId) as CardRow | undefined;
  if (!row) {
    enrollWords(userId, [wordId]);
    return rateWord(userId, wordId, rating, mode, elapsedMs);
  }
  const next = applyRating(row, rating);
  db.prepare(
    `UPDATE user_words SET state=@state, due=@due, stability=@stability, difficulty=@difficulty,
       elapsed_days=@elapsed_days, scheduled_days=@scheduled_days, learning_steps=@learning_steps,
       reps=@reps, lapses=@lapses, last_review=@last_review
     WHERE user_id=@user_id AND word_id=@word_id`,
  ).run({ ...next, user_id: userId, word_id: wordId });
  db.prepare(
    `INSERT INTO review_logs (user_id, kind, item_id, rating, mode, elapsed_ms)
     VALUES (?, 'word', ?, ?, ?, ?)`,
  ).run(userId, wordId, rating, mode, elapsedMs);
  return { due: next.due, state: next.state };
}

/**
 * 记录"这个词今天被你主动用出来了"。
 * produced_count 是本站的核心指标：只认得不算掌握，说过/写过才算。
 */
export function markProduced(userId: number, wordIds: number[]): void {
  if (!wordIds.length) return;
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE user_words SET produced_count = produced_count + 1
     WHERE user_id = ? AND word_id = ?`,
  );
  db.transaction(() => {
    for (const id of wordIds) stmt.run(userId, id);
  })();
}

/** 记录这个词已经用过哪些语境，下次生成时避开（只保留最近 6 条）。 */
export function pushSeenContext(userId: number, wordId: number, sentence: string): void {
  const db = getDb();
  const row = db
    .prepare('SELECT seen_contexts FROM user_words WHERE user_id = ? AND word_id = ?')
    .get(userId, wordId) as { seen_contexts: string } | undefined;
  if (!row) return;
  const list = safeJson<string[]>(row.seen_contexts, []);
  list.push(sentence.slice(0, 160));
  db.prepare('UPDATE user_words SET seen_contexts = ? WHERE user_id = ? AND word_id = ?').run(
    JSON.stringify(list.slice(-6)),
    userId,
    wordId,
  );
}

export function toggleStar(userId: number, wordId: number): number {
  const db = getDb();
  enrollWords(userId, [wordId]);
  db.prepare(
    'UPDATE user_words SET starred = 1 - starred WHERE user_id = ? AND word_id = ?',
  ).run(userId, wordId);
  const row = db
    .prepare('SELECT starred FROM user_words WHERE user_id = ? AND word_id = ?')
    .get(userId, wordId) as { starred: number };
  return row.starred;
}

export type VocabFilter = 'all' | 'due' | 'learning' | 'mature' | 'starred' | 'new';

/** 生词本列表，支持筛选和搜索。 */
export function listVocab(
  userId: number,
  filter: VocabFilter,
  q: string,
  limit = 200,
): VocabEntry[] {
  const db = getDb();
  const where: string[] = [];
  const args: unknown[] = [userId];
  if (q.trim()) {
    where.push('(w.term LIKE ? OR w.meaning_zh LIKE ?)');
    args.push(`%${q.trim()}%`, `%${q.trim()}%`);
  }
  switch (filter) {
    case 'due':
      where.push(`uw.due <= datetime('now')`);
      break;
    case 'learning':
      where.push('uw.state IN (1,3)');
      break;
    case 'mature':
      where.push('uw.state = 2 AND uw.stability >= 21');
      break;
    case 'starred':
      where.push('uw.starred = 1');
      break;
    case 'new':
      where.push('uw.word_id IS NULL');
      break;
  }
  const join = filter === 'new' ? 'LEFT JOIN' : 'JOIN';
  const sql = `SELECT w.id, w.term, w.phonetic, w.pos, w.meaning_zh, w.meaning_en, w.cefr, w.theme,
       w.example_en, w.example_zh, w.source,
       uw.word_id, uw.state, uw.due, uw.stability, uw.difficulty, uw.elapsed_days,
       uw.scheduled_days, uw.learning_steps, uw.reps, uw.lapses, uw.last_review,
       uw.produced_count, uw.seen_contexts, uw.starred
     FROM words w ${join} user_words uw ON uw.word_id = w.id AND uw.user_id = ?
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY ${filter === 'new' ? 'w.id' : 'uw.due'} ASC
     LIMIT ?`;
  const rows = db.prepare(sql).all(...args, limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    ...(toWord(r) as WordRow),
    progress: r.word_id == null ? null : toProgress(r),
  }));
}

export function resetWordProgress(userId: number, wordId: number): void {
  const db = getDb();
  const card = emptyCardRow();
  db.prepare(
    `UPDATE user_words SET state=@state, due=@due, stability=@stability, difficulty=@difficulty,
       elapsed_days=@elapsed_days, scheduled_days=@scheduled_days, learning_steps=@learning_steps,
       reps=0, lapses=0, last_review=NULL
     WHERE user_id=@user_id AND word_id=@word_id`,
  ).run({ ...card, user_id: userId, word_id: wordId });
}

export function removeWord(userId: number, wordId: number): void {
  getDb().prepare('DELETE FROM user_words WHERE user_id = ? AND word_id = ?').run(userId, wordId);
}

/** 按 term 找词；找不到返回 null。 */
export function findWordByTerm(term: string): WordRow | null {
  const db = getDb();
  return (
    (db
      .prepare(`SELECT ${WORD_COLS} FROM words WHERE term = ? COLLATE NOCASE`)
      .get(term.trim()) as WordRow | undefined) ?? null
  );
}

function toWord(r: Record<string, unknown>): WordRow {
  return {
    id: Number(r.id),
    term: String(r.term),
    phonetic: (r.phonetic as string | null) ?? null,
    pos: (r.pos as string | null) ?? null,
    meaning_zh: String(r.meaning_zh),
    meaning_en: (r.meaning_en as string | null) ?? null,
    cefr: String(r.cefr),
    theme: (r.theme as string | null) ?? null,
    example_en: (r.example_en as string | null) ?? null,
    example_zh: (r.example_zh as string | null) ?? null,
    source: String(r.source ?? 'seed'),
  };
}

function toProgress(r: Record<string, unknown>): UserWordRow {
  return {
    word_id: Number(r.word_id),
    state: Number(r.state),
    due: String(r.due),
    stability: Number(r.stability),
    difficulty: Number(r.difficulty),
    elapsed_days: Number(r.elapsed_days),
    scheduled_days: Number(r.scheduled_days),
    learning_steps: Number(r.learning_steps),
    reps: Number(r.reps),
    lapses: Number(r.lapses),
    last_review: (r.last_review as string | null) ?? null,
    produced_count: Number(r.produced_count),
    seen_contexts: safeJson<string[]>(r.seen_contexts, []),
    starred: Number(r.starred),
  };
}

export { nowSql, cardToRow };

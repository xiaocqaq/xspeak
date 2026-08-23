import { all, one, run } from '@/lib/db';
import { applyRating, cardToRow, emptyCardRow, nowSql, type CardRow } from '@/lib/scheduler';
import type { UserWordRow, VocabEntry, WordRow } from '@/lib/types';
import type { NewWordData } from '@/lib/ai/schemas';

const WORD_COLS = `id, term, phonetic, pos, meaning_zh, meaning_en, cefr, theme, example_en, example_zh, source`;

/** user_words 里属于 FSRS 卡片的 10 个列，enroll / rate / reset 共用。 */
const CARD_COLS = `state, due, stability, difficulty, elapsed_days, scheduled_days,
        learning_steps, reps, lapses, last_review`;

export async function getWordsByIds(ids: number[]): Promise<WordRow[]> {
  if (!ids.length) return [];
  const rows = await all<WordRow>(
    `SELECT ${WORD_COLS} FROM words WHERE id = ANY(?::int[])`,
    [ids],
  );
  // 保持传入顺序
  const map = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => map.get(id)).filter((r): r is WordRow => Boolean(r));
}

/** 到期需要复习的词，按到期时间升序。 */
export async function getDueWords(
  userId: number,
  limit: number,
): Promise<(WordRow & { progress: UserWordRow })[]> {
  const rows = await all<Record<string, unknown>>(
    `SELECT w.id, w.term, w.phonetic, w.pos, w.meaning_zh, w.meaning_en, w.cefr, w.theme,
            w.example_en, w.example_zh, w.source,
            uw.word_id, uw.state, uw.due, uw.stability, uw.difficulty, uw.elapsed_days,
            uw.scheduled_days, uw.learning_steps, uw.reps, uw.lapses, uw.last_review,
            uw.produced_count, uw.seen_contexts, uw.starred
     FROM user_words uw
     JOIN words w ON w.id = uw.word_id
     WHERE uw.user_id = ? AND uw.due <= now()
     ORDER BY uw.due ASC
     LIMIT ?`,
    [userId, limit],
  );
  return rows.map((r) => ({ ...toWord(r), progress: toProgress(r) }));
}

export async function countDueWords(userId: number): Promise<number> {
  const row = await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM user_words WHERE user_id = ? AND due <= now()`,
    [userId],
  );
  return row?.c ?? 0;
}

/** 还没学过的候选新词，优先当天主题、其次匹配水平。 */
export async function pickNewWords(
  userId: number,
  theme: string,
  level: string,
  limit: number,
): Promise<WordRow[]> {
  const levels = level === 'A1' ? ['A1'] : level === 'A2' ? ['A1', 'A2'] : ['A1', 'A2', 'B1'];
  // theme 可能是 NULL，`NULL = 'x'` 得到 NULL；PG 的 DESC 默认把 NULL 排在最前面，
  // 所以要显式 NULLS LAST，否则没标主题的词会插到队首。
  return all<WordRow>(
    `SELECT ${WORD_COLS} FROM words w
     WHERE w.id NOT IN (SELECT word_id FROM user_words WHERE user_id = ?)
       AND w.cefr = ANY(?::text[])
     ORDER BY (w.theme = ?) DESC NULLS LAST, random()
     LIMIT ?`,
    [userId, levels, theme, limit],
  );
}

/** AI 生成的新词入库（已存在就补全空字段），返回 word id。 */
export async function upsertWordFromAi(
  w: NewWordData,
  theme: string,
  cefr = 'A2',
): Promise<number> {
  const term = w.term.trim();
  // term 上有唯一约束，一条 upsert 就够：撞了就只补空字段，不覆盖已有内容。
  const row = await one<{ id: number }>(
    `INSERT INTO words
       (term, phonetic, pos, meaning_zh, meaning_en, cefr, theme, example_en, example_zh, source)
     VALUES (@term, @phonetic, @pos, @meaning_zh, @meaning_en, @cefr, @theme, @example_en, @example_zh, 'ai')
     ON CONFLICT (term) DO UPDATE SET
       phonetic   = COALESCE(NULLIF(words.phonetic, ''),   @phonetic),
       pos        = COALESCE(NULLIF(words.pos, ''),        @pos),
       meaning_en = COALESCE(NULLIF(words.meaning_en, ''), @meaning_en),
       example_en = COALESCE(NULLIF(words.example_en, ''), @example_en),
       example_zh = COALESCE(NULLIF(words.example_zh, ''), @example_zh)
     RETURNING id`,
    {
      term,
      phonetic: w.phonetic,
      pos: w.pos,
      meaning_zh: w.meaning_zh,
      meaning_en: w.meaning_en,
      cefr,
      theme,
      example_en: w.example_en,
      example_zh: w.example_zh,
    },
  );
  return row!.id;
}

/** 把词加入学习队列（幂等）。 */
export async function enrollWords(userId: number, wordIds: number[]): Promise<void> {
  if (!wordIds.length) return;
  const c = emptyCardRow();
  const group = `(${Array.from({ length: 12 }, () => '?').join(', ')})`;
  const values: unknown[] = [];
  for (const id of wordIds) {
    values.push(
      userId, id,
      c.state, c.due, c.stability, c.difficulty, c.elapsed_days, c.scheduled_days,
      c.learning_steps, c.reps, c.lapses, c.last_review,
    );
  }
  await run(
    `INSERT INTO user_words (user_id, word_id, ${CARD_COLS})
     VALUES ${wordIds.map(() => group).join(', ')}
     ON CONFLICT (user_id, word_id) DO NOTHING`,
    values,
  );
}

/** 评分并推进调度，同时写复习日志。返回新的到期时间。 */
export async function rateWord(
  userId: number,
  wordId: number,
  rating: 1 | 2 | 3 | 4,
  mode = 'recall',
  elapsedMs = 0,
): Promise<{ due: string; state: number }> {
  const row = await one<CardRow>(
    `SELECT ${CARD_COLS} FROM user_words WHERE user_id = ? AND word_id = ?`,
    [userId, wordId],
  );
  if (!row) {
    await enrollWords(userId, [wordId]);
    return rateWord(userId, wordId, rating, mode, elapsedMs);
  }
  const next = applyRating(row, rating);
  await run(
    `UPDATE user_words SET state=@state, due=@due, stability=@stability, difficulty=@difficulty,
       elapsed_days=@elapsed_days, scheduled_days=@scheduled_days, learning_steps=@learning_steps,
       reps=@reps, lapses=@lapses, last_review=@last_review
     WHERE user_id=@user_id AND word_id=@word_id`,
    { ...next, user_id: userId, word_id: wordId },
  );
  await run(
    `INSERT INTO review_logs (user_id, kind, item_id, rating, mode, elapsed_ms)
     VALUES (?, 'word', ?, ?, ?, ?)`,
    [userId, wordId, rating, mode, elapsedMs],
  );
  return { due: next.due, state: next.state };
}

/**
 * 记录"这个词今天被你主动用出来了"。
 * produced_count 是本站的核心指标：只认得不算掌握，说过/写过才算。
 */
export async function markProduced(userId: number, wordIds: number[]): Promise<void> {
  if (!wordIds.length) return;
  await run(
    `UPDATE user_words SET produced_count = produced_count + 1
     WHERE user_id = ? AND word_id = ANY(?::int[])`,
    [userId, wordIds],
  );
}

/** 记录这个词已经用过哪些语境，下次生成时避开（只保留最近 6 条）。 */
export async function pushSeenContext(
  userId: number,
  wordId: number,
  sentence: string,
): Promise<void> {
  const row = await one<{ seen_contexts: unknown }>(
    'SELECT seen_contexts FROM user_words WHERE user_id = ? AND word_id = ?',
    [userId, wordId],
  );
  if (!row) return;
  // seen_contexts 是 jsonb，驱动读出来已经是数组
  const list = Array.isArray(row.seen_contexts) ? (row.seen_contexts as string[]) : [];
  list.push(sentence.slice(0, 160));
  await run('UPDATE user_words SET seen_contexts = ? WHERE user_id = ? AND word_id = ?', [
    JSON.stringify(list.slice(-6)),
    userId,
    wordId,
  ]);
}

export async function toggleStar(userId: number, wordId: number): Promise<number> {
  await enrollWords(userId, [wordId]);
  const row = await one<{ starred: number }>(
    `UPDATE user_words SET starred = 1 - starred
     WHERE user_id = ? AND word_id = ?
     RETURNING starred`,
    [userId, wordId],
  );
  return row?.starred ?? 0;
}

export type VocabFilter = 'all' | 'due' | 'learning' | 'mature' | 'starred' | 'new';

/** 生词本列表，支持筛选和搜索。 */
export async function listVocab(
  userId: number,
  filter: VocabFilter,
  q: string,
  limit = 200,
): Promise<VocabEntry[]> {
  const where: string[] = [];
  const args: unknown[] = [userId];
  if (q.trim()) {
    // PG 的 LIKE 区分大小写，用 ILIKE 才和原来的行为一致
    where.push('(w.term ILIKE ? OR w.meaning_zh ILIKE ?)');
    args.push(`%${q.trim()}%`, `%${q.trim()}%`);
  }
  switch (filter) {
    case 'due':
      where.push('uw.due <= now()');
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
  const rows = await all<Record<string, unknown>>(sql, [...args, limit]);
  return rows.map((r) => ({
    ...toWord(r),
    progress: r.word_id == null ? null : toProgress(r),
  }));
}

export async function resetWordProgress(userId: number, wordId: number): Promise<void> {
  const card = emptyCardRow();
  await run(
    `UPDATE user_words SET state=@state, due=@due, stability=@stability, difficulty=@difficulty,
       elapsed_days=@elapsed_days, scheduled_days=@scheduled_days, learning_steps=@learning_steps,
       reps=0, lapses=0, last_review=NULL
     WHERE user_id=@user_id AND word_id=@word_id`,
    { ...card, user_id: userId, word_id: wordId },
  );
}

export async function removeWord(userId: number, wordId: number): Promise<void> {
  await run('DELETE FROM user_words WHERE user_id = ? AND word_id = ?', [userId, wordId]);
}

/** 按 term 找词（大小写不敏感）；找不到返回 null。 */
export async function findWordByTerm(term: string): Promise<WordRow | null> {
  const row = await one<WordRow>(
    `SELECT ${WORD_COLS} FROM words WHERE lower(term) = lower(?)`,
    [term.trim()],
  );
  return row ?? null;
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
    seen_contexts: Array.isArray(r.seen_contexts) ? (r.seen_contexts as string[]) : [],
    produced_count: Number(r.produced_count),
    starred: Number(r.starred),
  };
}

export { nowSql, cardToRow };

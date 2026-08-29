import { all, json, one, run } from '@/lib/db';
import { applyRating, cardToRow, emptyCardRow, nowSql, type CardRow } from '@/lib/scheduler';
import type { UserWordRow, VocabEntry, WordRow } from '@/lib/types';
import type { NewWordData } from '@/lib/ai/schemas';
import {
  enrichSenses,
  formatSenses,
  pickGradedWords,
  rawTranslation,
  type GradedWord,
} from './dictionary';

const WORD_COLS = `id, term, phonetic, pos, meaning_zh, meaning_en, cefr, theme, example_en, example_zh,
        source, memory_hook_zh, collocations, frq`;

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
            w.example_en, w.example_zh, w.source, w.memory_hook_zh, w.collocations, w.frq,
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

/**
 * 这个等级能接受哪些难度的词：自己这一级，加上低一级兜底。
 *
 * 以前写成"B1 及以上都取 A1+A2+B1"，有两个毛病：B2/C1 的用户永远匹配不到
 * 自己等级的词，而 promoteDictWords 是按用户等级写 cefr 的 ——
 * 于是 B2 用户从词典提升进来的词再也不会被 fromLib 选中（组过卷没学完就丢了）。
 * 只放宽一级而不是全放开：A1 的词对 B2 用户没有学习价值，占着每日额度。
 */
function levelsFor(level: string): string[] {
  const order = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const i = order.indexOf(level);
  if (i < 0) return ['A1', 'A2'];
  return i === 0 ? ['A1'] : [order[i - 1], order[i]];
}

/** 还没学过的候选新词，优先当天主题、其次匹配水平。 */
export async function pickNewWords(
  userId: number,
  theme: string,
  level: string,
  limit: number,
): Promise<WordRow[]> {
  const levels = levelsFor(level);
  /*
   * theme 可能是 NULL，`NULL = 'x'` 得到 NULL；PG 的 DESC 默认把 NULL 排在最前面，
   * 所以要显式 NULLS LAST，否则没标主题的词会插到队首。
   *
   * 排序里带上 frq（词频排名，越小越常用）：词典提升进来的词都带词频，
   * 上一天组过卷但没学完的词第二天要按同样的顺序回来，不能被 random() 打乱。
   * frq = 0 是"没有词频信息"（手写种子词和 AI 造的词），排在有词频的后面 ——
   * 不是因为它们差，而是让常用词先出场；同一批 frq 相同的再随机。
   */
  const fromLib = await all<WordRow>(
    `SELECT ${WORD_COLS} FROM words w
     WHERE w.id NOT IN (SELECT word_id FROM user_words WHERE user_id = ?)
       AND w.cefr = ANY(?::text[])
     ORDER BY (w.theme = ?) DESC NULLS LAST,
              CASE WHEN w.frq > 0 THEN 0 ELSE 1 END,
              w.frq,
              random()
     LIMIT ?`,
    [userId, levels, theme, limit],
  );
  if (fromLib.length >= limit) return fromLib;

  /*
   * words 表凑不够就去词典里按 CEFR 等级 + 词频取。
   *
   * 这一步以前是空的：内置的 86 个词学完之后，缺口全丢给 AI 现场造词 ——
   * 每天几千 token、要等十几秒，造出来的词还未必分级准确。
   * word_level 里有 8493 个人工标好等级的词，取出来零成本零延迟。
   *
   * 注意这里传的是 level 而不是上面的 levels：词典路径只取用户自己那一级，
   * 不像 words 表那样放宽一级。等级是人工标的，够准，没必要再掺一级；
   * 而且最小的一级过质量门后还有 675 个词，按每天 8 个能撑 80 多天，
   * 放宽只会让 B2 的人吃到 B1 的词。
   */
  const need = limit - fromLib.length;
  const graded = await pickGradedWords(userId, level, need, fromLib.map((w) => w.term));
  if (!graded.length) return fromLib;

  const ids = await promoteDictWords(graded, theme, level);
  return [...fromLib, ...(await getWordsByIds(ids))];
}

/** AI 生成的新词入库（已存在就补全空字段），返回 word id。 */
export async function upsertWordFromAi(
  w: NewWordData & { frq?: number },
  theme: string,
  cefr = 'A2',
  /**
   * 词是哪来的。以前写死成 'ai'，导致词典查出来的词也记成 AI 生成，
   * 统计"AI 烧了多少词"会虚高。调用方现在必须说清楚。
   */
  source: 'ai' | 'dict' | 'lookup' = 'ai',
): Promise<number> {
  const term = w.term.trim();
  /*
   * 2026-08-28：所有入库路径统一过一遍 formatSenses。
   *
   * 以前只有词典查询路径清洗，AI 造的词原样写库 —— 于是 words 表里躺着
   * "interj. 喂, 嘿"、"n. 抓握, 掠夺\nvi. 抓取, 抢去"（带换行）这种
   * ECDICT 原始格式。它们混进热身释义单选的选项里，就出现了「只有一个
   * 选项带词性前缀」的怪相（用户报的问题）。
   *
   * formatSenses 会：剥词性前缀并归一（a.→adj. / int.→interj.）、
   * 丢掉 [医] [计] 学科标注行、多词性时每段标注词性、按 MEANING_MAX 截断、
   * 剥 ECDICT 的 "+" 前缀。已经干净的释义（没有词性头、单行）过它是幂等的。
   */
  const raw = (w.meaning_zh ?? '').trim();
  /*
   * 只清洗「还是 ECDICT 原始格式」的释义，别碰已经整理过的。
   *
   * formatSenses 不是幂等的：它按 [,，;；] 切义项，而它自己的输出用「；」
   * 分隔多词性段（"n. 指控，费用；vt. 控诉"）。再过一遍会把段分隔符也
   * 当义项分隔符，切成 "指控，费用，vt. 控诉" —— 语义就错位了。
   * 判定原始格式的三个特征：行首词性前缀 / 多行 / ECDICT 的 "+" 前缀。
   */
  // 多行 / "+" 前缀一定是原始格式。单行带词性头的还要看有没有「；」：
  // 有就是 formatSenses 自己的多词性输出（已整理，再洗会被切碎）；
  // 单词性时它会把前缀去掉，所以"单行 + 词性头 + 无；"才是真没洗过的。
  const looksRaw =
    raw.includes('\n') || raw.startsWith('+') || (/^[a-zA-Z]+\.\s/.test(raw) && !raw.includes('；'));
  const cleaned = looksRaw ? formatSenses(raw) : { pos: '', meaning_zh: '' };
  const cleanZh = cleaned.meaning_zh || raw;
  const posFixed = (w.pos ?? '').trim() || cleaned.pos;
  /*
   * 补义项（2026-08-28 用户报「单词还是单个意思」）：
   *
   * 清洗解决的是"脏"，这里解决的是"少"。AI 和 seed 词往往只给一个义项
   * （introduce → 只有「介绍」），而本地 ECDICT 里有「介绍, 引入, 采用,
   * 输入」。查一次本地词典就能补上，不用花 AI。
   *
   * 只对单义项的词做（enrichSenses 内部判断有「；」就原样返回，幂等），
   * 而且人工/AI 给的首义永远打头 —— 那是挑过的核心义项。
   * 查库失败不影响入库：补义项是增强，不是前提。
   */
  let meaningZh = cleanZh;
  if (cleanZh && !cleanZh.includes('；')) {
    try {
      const translation = await rawTranslation(term);
      if (translation) meaningZh = enrichSenses(cleanZh, translation, posFixed);
    } catch {
      /* 词典查不到/查出错就用原释义，不因为"没补上"而挡住入库 */
    }
  }
  // term 上有唯一约束，一条 upsert 就够：撞了就只补空字段，不覆盖已有内容。
  const row = await one<{ id: number }>(
    `INSERT INTO words
       (term, phonetic, pos, meaning_zh, meaning_en, cefr, theme, example_en, example_zh,
        source, memory_hook_zh, collocations, frq)
     VALUES (@term, @phonetic, @pos, @meaning_zh, @meaning_en, @cefr, @theme, @example_en, @example_zh,
        @source, @memory_hook_zh, @collocations::jsonb, @frq)
     ON CONFLICT (term) DO UPDATE SET
       phonetic       = COALESCE(NULLIF(words.phonetic, ''),   @phonetic),
       pos            = COALESCE(NULLIF(words.pos, ''),        @pos),
       meaning_en     = COALESCE(NULLIF(words.meaning_en, ''), @meaning_en),
       example_en     = COALESCE(NULLIF(words.example_en, ''), @example_en),
       example_zh     = COALESCE(NULLIF(words.example_zh, ''), @example_zh),
       memory_hook_zh = COALESCE(NULLIF(words.memory_hook_zh, ''), @memory_hook_zh),
       -- jsonb 的空数组不是 NULL 也不是 ''，NULLIF 比不出来，要显式判长度
       collocations   = CASE WHEN jsonb_array_length(words.collocations) > 0
                            THEN words.collocations ELSE @collocations::jsonb END,
       frq            = CASE WHEN words.frq > 0 THEN words.frq ELSE @frq END
     RETURNING id`,
    {
      term,
      phonetic: w.phonetic,
      pos: posFixed,
      meaning_zh: meaningZh,
      meaning_en: w.meaning_en,
      cefr,
      theme,
      example_en: w.example_en,
      example_zh: w.example_zh,
      source,
      memory_hook_zh: w.memory_hook_zh,
      collocations: json(w.collocations ?? []),
      frq: w.frq ?? 0,
    },
  );
  return row!.id;
}

/**
 * 把词典条目提升成 words 表里的词（幂等），返回 id 列表，顺序和入参一致。
 *
 * 例句/记忆抓手/搭配留空 —— 词典给不了这些，它们是教学内容不是词条信息。
 * 由 enrichWords 在第一次出现在新词环节时补齐并存回库，之后就不用再问 AI。
 */
export async function promoteDictWords(
  words: GradedWord[],
  theme: string,
  cefr: string,
): Promise<number[]> {
  const ids: number[] = [];
  for (const g of words) {
    ids.push(
      await upsertWordFromAi(
        {
          term: g.term,
          phonetic: g.phonetic,
          pos: g.pos,
          meaning_zh: g.meaning_zh,
          meaning_en: g.meaning_en,
          example_en: '',
          example_zh: '',
          memory_hook_zh: '',
          collocations: [],
          frq: g.frq,
        },
        theme,
        cefr,
        'dict',
      ),
    );
  }
  return ids;
}

/**
 * 把 AI 补出来的例句/记忆抓手/搭配写回库。
 * 只填空字段（走 upsert 里的 COALESCE），已有内容不覆盖。
 */
export async function saveEnrichment(
  wordId: number,
  e: {
    example_en: string;
    example_zh: string;
    memory_hook_zh: string;
    collocations: string[];
    /**
     * 词性和英文释义也一起存。
     *
     * 这两样以前只贴在返回给前端的卡片上、不写库，因为那会儿补充内容是在请求里
     * 现补的。现在补充动作挪到后台了，卡片一律从库里读 —— 不存就等于每次都白补。
     */
    pos?: string;
    meaning_en?: string;
  },
): Promise<void> {
  await run(
    `UPDATE words SET
       example_en     = COALESCE(NULLIF(example_en, ''), @example_en),
       example_zh     = COALESCE(NULLIF(example_zh, ''), @example_zh),
       memory_hook_zh = COALESCE(NULLIF(memory_hook_zh, ''), @memory_hook_zh),
       pos            = COALESCE(NULLIF(pos, ''), @pos),
       meaning_en     = COALESCE(NULLIF(meaning_en, ''), @meaning_en),
       collocations   = CASE WHEN jsonb_array_length(collocations) > 0
                            THEN collocations ELSE @collocations::jsonb END
     WHERE id = @id`,
    {
      id: wordId,
      example_en: e.example_en,
      example_zh: e.example_zh,
      memory_hook_zh: e.memory_hook_zh,
      pos: e.pos ?? '',
      meaning_en: e.meaning_en ?? '',
      collocations: json(e.collocations ?? []),
    },
  );
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
       w.example_en, w.example_zh, w.source, w.memory_hook_zh, w.collocations, w.frq,
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
    memory_hook_zh: (r.memory_hook_zh as string | null) ?? null,
    collocations: Array.isArray(r.collocations) ? (r.collocations as string[]) : [],
    frq: Number(r.frq ?? 0),
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

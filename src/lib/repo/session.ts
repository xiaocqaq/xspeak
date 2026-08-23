import { all, json, one, run } from '@/lib/db';
import { localDay } from '@/lib/scheduler';
import { STAGES, type SessionRow, type Stage } from '@/lib/types';
import { enrollWords, getDueWords, pickNewWords, upsertWordFromAi } from './words';
import { enrollGrammar, pickGrammarForToday } from './grammar';
import type { UserProfile } from '@/lib/types';

function toSession(r: Record<string, unknown>): SessionRow {
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    id: Number(r.id),
    user_id: Number(r.user_id),
    day: String(r.day),
    theme_slug: String(r.theme_slug),
    theme_zh: String(r.theme_zh),
    theme_en: String(r.theme_en),
    // 这几个都是 jsonb，驱动已经解析好了
    target_word_ids: arr<number>(r.target_word_ids),
    review_word_ids: arr<number>(r.review_word_ids),
    grammar_ids: arr<number>(r.grammar_ids),
    stage_index: Number(r.stage_index),
    stages_done: arr<Stage>(r.stages_done),
    minutes_spent: Number(r.minutes_spent),
    completed_at: (r.completed_at as string | null) ?? null,
  };
}

export async function getSessionById(id: number): Promise<SessionRow | null> {
  const r = await one<Record<string, unknown>>('SELECT * FROM sessions WHERE id = ?', [id]);
  return r ? toSession(r) : null;
}

/** 挑一个最久没用过的主题，保证不会天天重复同一个场景。 */
async function pickTheme(): Promise<{ slug: string; zh: string; en: string }> {
  const row = await one<{ slug: string; zh: string; en: string }>(
    `SELECT slug, zh, en FROM themes
     ORDER BY (last_used_on IS NOT NULL), last_used_on ASC, random() LIMIT 1`,
  );
  return row ?? { slug: 'small-talk', zh: '日常闲聊', en: 'Everyday small talk' };
}

/**
 * 取今天的 session；没有就现场组装一个：
 * 到期复习词 + 今天的新词 + 一个语法点，全部围绕同一个主题。
 */
export async function getOrCreateToday(user: UserProfile): Promise<SessionRow> {
  const day = localDay();
  const existing = await one<Record<string, unknown>>(
    'SELECT * FROM sessions WHERE user_id = ? AND day = ?',
    [user.id, day],
  );
  if (existing) return toSession(existing);

  const theme = await pickTheme();
  // 30 分钟的量：复习上限 12 个，避免堆积时一天做不完
  const reviewCap = Math.max(6, Math.round((user.daily_minutes / 30) * 12));
  const due = await getDueWords(user.id, reviewCap);
  const fresh = await pickNewWords(user.id, theme.slug, user.level, user.new_words_per_day);
  const grammar = await pickGrammarForToday(user.id, user.level);

  // (user_id, day) 上有唯一约束：并发请求撞上了就 DO NOTHING，下面回读那条已有的。
  const inserted = await one<{ id: number }>(
    `INSERT INTO sessions (user_id, day, theme_slug, theme_zh, theme_en,
       target_word_ids, review_word_ids, grammar_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, day) DO NOTHING
     RETURNING id`,
    [
      user.id,
      day,
      theme.slug,
      theme.zh,
      theme.en,
      json(fresh.map((w) => w.id)),
      json(due.map((w) => w.id)),
      json(grammar ? [grammar.id] : []),
    ],
  );
  if (!inserted) {
    const raced = await one<Record<string, unknown>>(
      'SELECT * FROM sessions WHERE user_id = ? AND day = ?',
      [user.id, day],
    );
    return toSession(raced!);
  }

  await run('UPDATE themes SET last_used_on = ? WHERE slug = ?', [day, theme.slug]);
  if (grammar) await enrollGrammar(user.id, grammar.id);

  return (await getSessionById(inserted.id))!;
}

/**
 * 内置词表不够时，让 AI 补齐今天的新词并写回 session。
 * 由 stage 接口在生成 newwords 内容时调用。
 */
export async function addAiWordsToSession(
  sessionId: number,
  themeSlug: string,
  words: Parameters<typeof upsertWordFromAi>[0][],
  cefr: string,
): Promise<number[]> {
  const ids: number[] = [];
  for (const w of words) ids.push(await upsertWordFromAi(w, themeSlug, cefr));
  const s = await getSessionById(sessionId);
  if (!s) return ids;
  const merged = Array.from(new Set([...s.target_word_ids, ...ids]));
  await run('UPDATE sessions SET target_word_ids = ? WHERE id = ?', [json(merged), sessionId]);
  return ids;
}

/** 环节内容缓存：同一天同一环节只生成一次。 */
export async function getStageContent<T>(sessionId: number, stage: Stage): Promise<T | null> {
  const r = await one<{ payload: unknown }>(
    'SELECT payload FROM stage_content WHERE session_id = ? AND stage = ?',
    [sessionId, stage],
  );
  // payload 是 jsonb，读出来就是对象
  return r ? ((r.payload as T | null) ?? null) : null;
}

export async function saveStageContent(
  sessionId: number,
  stage: Stage,
  payload: unknown,
): Promise<void> {
  await run(
    `INSERT INTO stage_content (session_id, stage, payload) VALUES (?, ?, ?)
     ON CONFLICT (session_id, stage) DO UPDATE SET payload = excluded.payload`,
    [sessionId, stage, json(payload)],
  );
}

export async function clearStageContent(sessionId: number, stage: Stage): Promise<void> {
  await run('DELETE FROM stage_content WHERE session_id = ? AND stage = ?', [sessionId, stage]);
}

/** 标记环节完成并推进进度。全部完成时写 completed_at。 */
export async function completeStage(
  sessionId: number,
  stage: Stage,
  minutes = 0,
): Promise<SessionRow | null> {
  const s = await getSessionById(sessionId);
  if (!s) return null;
  const done = Array.from(new Set([...s.stages_done, stage]));
  const nextIndex = Math.min(STAGES.length, Math.max(s.stage_index, STAGES.indexOf(stage) + 1));
  const allDone = STAGES.every((st) => done.includes(st));
  await run(
    `UPDATE sessions SET stages_done = ?, stage_index = ?, minutes_spent = minutes_spent + ?,
       completed_at = CASE WHEN ?::boolean AND completed_at IS NULL THEN now() ELSE completed_at END
     WHERE id = ?`,
    [json(done), nextIndex, minutes, allDone, sessionId],
  );
  return getSessionById(sessionId);
}

export async function setStageIndex(sessionId: number, index: number): Promise<void> {
  await run('UPDATE sessions SET stage_index = ? WHERE id = ?', [
    Math.max(0, Math.min(STAGES.length - 1, index)),
    sessionId,
  ]);
}

/** 新词进入学习队列（在新词环节点"学会了"时调用）。 */
export async function enrollSessionTargets(userId: number, wordIds: number[]): Promise<void> {
  await enrollWords(userId, wordIds);
}

export async function recentSessions(userId: number, limit = 30): Promise<SessionRow[]> {
  const rows = await all<Record<string, unknown>>(
    'SELECT * FROM sessions WHERE user_id = ? ORDER BY day DESC LIMIT ?',
    [userId, limit],
  );
  return rows.map(toSession);
}

import { getDb, safeJson } from '@/lib/db';
import { localDay } from '@/lib/scheduler';
import { STAGES, type SessionRow, type Stage } from '@/lib/types';
import { enrollWords, getDueWords, pickNewWords, upsertWordFromAi } from './words';
import { enrollGrammar, pickGrammarForToday } from './grammar';
import type { UserProfile } from '@/lib/types';

function toSession(r: Record<string, unknown>): SessionRow {
  return {
    id: Number(r.id),
    user_id: Number(r.user_id),
    day: String(r.day),
    theme_slug: String(r.theme_slug),
    theme_zh: String(r.theme_zh),
    theme_en: String(r.theme_en),
    target_word_ids: safeJson<number[]>(r.target_word_ids, []),
    review_word_ids: safeJson<number[]>(r.review_word_ids, []),
    grammar_ids: safeJson<number[]>(r.grammar_ids, []),
    stage_index: Number(r.stage_index),
    stages_done: safeJson<Stage[]>(r.stages_done, []),
    minutes_spent: Number(r.minutes_spent),
    completed_at: (r.completed_at as string | null) ?? null,
  };
}

export function getSessionById(id: number): SessionRow | null {
  const r = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return r ? toSession(r) : null;
}

/** 挑一个最久没用过的主题，保证不会天天重复同一个场景。 */
function pickTheme(): { slug: string; zh: string; en: string } {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT slug, zh, en FROM themes
       ORDER BY (last_used_on IS NOT NULL), last_used_on ASC, RANDOM() LIMIT 1`,
    )
    .get() as { slug: string; zh: string; en: string } | undefined;
  return row ?? { slug: 'small-talk', zh: '日常闲聊', en: 'Everyday small talk' };
}

/**
 * 取今天的 session；没有就现场组装一个：
 * 到期复习词 + 今天的新词 + 一个语法点，全部围绕同一个主题。
 */
export function getOrCreateToday(user: UserProfile): SessionRow {
  const db = getDb();
  const day = localDay();
  const existing = db
    .prepare('SELECT * FROM sessions WHERE user_id = ? AND day = ?')
    .get(user.id, day) as Record<string, unknown> | undefined;
  if (existing) return toSession(existing);

  const theme = pickTheme();
  // 30 分钟的量：复习上限 12 个，避免堆积时一天做不完
  const reviewCap = Math.max(6, Math.round((user.daily_minutes / 30) * 12));
  const due = getDueWords(user.id, reviewCap);
  const newCount = user.new_words_per_day;
  const fresh = pickNewWords(user.id, theme.slug, user.level, newCount);
  const grammar = pickGrammarForToday(user.id, user.level);

  const info = db
    .prepare(
      `INSERT INTO sessions (user_id, day, theme_slug, theme_zh, theme_en,
         target_word_ids, review_word_ids, grammar_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      user.id,
      day,
      theme.slug,
      theme.zh,
      theme.en,
      JSON.stringify(fresh.map((w) => w.id)),
      JSON.stringify(due.map((w) => w.id)),
      JSON.stringify(grammar ? [grammar.id] : []),
    );
  db.prepare('UPDATE themes SET last_used_on = ? WHERE slug = ?').run(day, theme.slug);
  if (grammar) enrollGrammar(user.id, grammar.id);

  return getSessionById(Number(info.lastInsertRowid))!;
}

/**
 * 内置词表不够时，让 AI 补齐今天的新词并写回 session。
 * 由 stage 接口在生成 newwords 内容时调用。
 */
export function addAiWordsToSession(
  sessionId: number,
  themeSlug: string,
  words: Parameters<typeof upsertWordFromAi>[0][],
  cefr: string,
): number[] {
  const db = getDb();
  const ids = words.map((w) => upsertWordFromAi(w, themeSlug, cefr));
  const s = getSessionById(sessionId);
  if (!s) return ids;
  const merged = Array.from(new Set([...s.target_word_ids, ...ids]));
  db.prepare('UPDATE sessions SET target_word_ids = ? WHERE id = ?').run(
    JSON.stringify(merged),
    sessionId,
  );
  return ids;
}

/** 环节内容缓存：同一天同一环节只生成一次。 */
export function getStageContent<T>(sessionId: number, stage: Stage): T | null {
  const r = getDb()
    .prepare('SELECT payload FROM stage_content WHERE session_id = ? AND stage = ?')
    .get(sessionId, stage) as { payload: string } | undefined;
  return r ? safeJson<T | null>(r.payload, null) : null;
}

export function saveStageContent(sessionId: number, stage: Stage, payload: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO stage_content (session_id, stage, payload) VALUES (?, ?, ?)
       ON CONFLICT(session_id, stage) DO UPDATE SET payload = excluded.payload`,
    )
    .run(sessionId, stage, JSON.stringify(payload));
}

export function clearStageContent(sessionId: number, stage: Stage): void {
  getDb().prepare('DELETE FROM stage_content WHERE session_id = ? AND stage = ?').run(sessionId, stage);
}

/** 标记环节完成并推进进度。全部完成时写 completed_at。 */
export function completeStage(sessionId: number, stage: Stage, minutes = 0): SessionRow | null {
  const db = getDb();
  const s = getSessionById(sessionId);
  if (!s) return null;
  const done = Array.from(new Set([...s.stages_done, stage]));
  const nextIndex = Math.min(STAGES.length, Math.max(s.stage_index, STAGES.indexOf(stage) + 1));
  const allDone = STAGES.every((st) => done.includes(st));
  db.prepare(
    `UPDATE sessions SET stages_done = ?, stage_index = ?, minutes_spent = minutes_spent + ?,
       completed_at = CASE WHEN ? = 1 AND completed_at IS NULL THEN datetime('now') ELSE completed_at END
     WHERE id = ?`,
  ).run(JSON.stringify(done), nextIndex, minutes, allDone ? 1 : 0, sessionId);
  return getSessionById(sessionId);
}

export function setStageIndex(sessionId: number, index: number): void {
  getDb()
    .prepare('UPDATE sessions SET stage_index = ? WHERE id = ?')
    .run(Math.max(0, Math.min(STAGES.length - 1, index)), sessionId);
}

/** 新词进入学习队列（在新词环节点"学会了"时调用）。 */
export function enrollSessionTargets(userId: number, wordIds: number[]): void {
  enrollWords(userId, wordIds);
}

export function recentSessions(userId: number, limit = 30): SessionRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY day DESC LIMIT ?')
    .all(userId, limit) as Record<string, unknown>[];
  return rows.map(toSession);
}

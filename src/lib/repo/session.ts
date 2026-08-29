import { all, json, one, run } from '@/lib/db';
import { localDay } from '@/lib/scheduler';
import { STAGES, type SessionRow, type Stage } from '@/lib/types';
import { enrollWords, getDueWords, pickNewWords } from './words';
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
 *
 * 2026-08-28 多主题/天，查找顺序：
 * ① 当天**未完成**的（点过「进入下一个主题」后，新主题在这里被找到）；
 * ② 都完成了 → 回当天最后一条（首页显示「再练一轮」，而不是每次开门
 *    都偷偷开新主题烧 AI —— 开新主题只由 POST 显式触发）；
 * ③ 今天一条都没有 → 组装。
 */
export async function getOrCreateToday(user: UserProfile): Promise<SessionRow> {
  const day = localDay();
  const open = await openSession(user.id, day);
  if (open) return open;
  const last = await lastSessionToday(user.id, day);
  if (last) return last;
  return assembleSession(user, day);
}

/** 当天未完成的 session（「每天最多一条未完成」由部分唯一索引保证）。 */
async function openSession(userId: number, day: string): Promise<SessionRow | null> {
  const r = await one<Record<string, unknown>>(
    'SELECT * FROM sessions WHERE user_id = ? AND day = ? AND completed_at IS NULL',
    [userId, day],
  );
  return r ? toSession(r) : null;
}

/** 当天最后一条（含已完成的）。 */
async function lastSessionToday(userId: number, day: string): Promise<SessionRow | null> {
  const r = await one<Record<string, unknown>>(
    'SELECT * FROM sessions WHERE user_id = ? AND day = ? ORDER BY id DESC LIMIT 1',
    [userId, day],
  );
  return r ? toSession(r) : null;
}

/** 组装一个新主题 session。并发防护打在部分唯一索引上，撞了就回读未完成那条。 */
async function assembleSession(user: UserProfile, day: string): Promise<SessionRow> {
  const theme = await pickTheme();
  /*
   * 组 session 的复习容量：原 8~12 个封顶，到期堆积时练不完。2026-08-28
   * 放宽到 20 —— 到期多就多练。热身 AI 只出 8 道完形，剩余词前端用零 AI
   * 的释义单选补（见 stage.ts warmup 分支），所以容量上去不增加 AI 成本。
   */
  const reviewCap = Math.max(6, Math.min(30, Math.round((user.daily_minutes / 30) * 12) * 2));
  const due = await getDueWords(user.id, reviewCap);
  const fresh = await pickNewWords(user.id, theme.slug, user.level, user.new_words_per_day);
  const grammar = await pickGrammarForToday(user.id, user.level);

  // 并发防护打在「每天一条未完成」的部分唯一索引上（idx_sessions_open_per_day）：
  // 已完成的当天历史 session 不占坑，所以点过「进入下一个主题」后这里能再插新行。
  const inserted = await one<{ id: number }>(
    `INSERT INTO sessions (user_id, day, theme_slug, theme_zh, theme_en,
       target_word_ids, review_word_ids, grammar_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, day) WHERE completed_at IS NULL DO NOTHING
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
    // 极端并发：别的请求刚插了一条未完成的，拿它的
    const raced = await openSession(user.id, day);
    if (raced) return raced;
    return (await lastSessionToday(user.id, day))!;
  }

  await run('UPDATE themes SET last_used_on = ? WHERE slug = ?', [day, theme.slug]);
  if (grammar) await enrollGrammar(user.id, grammar.id);

  return (await getSessionById(inserted.id))!;
}

/*
 * 这里原来有个 addAiWordsToSession：新词环节发现词不够，就让 AI 现场造词写回 session。
 * 已经删了 —— 选词改成"words 表 + 词典分级词表"，缺口在 pickNewWords 里就补齐了，
 * 组 session 的时候词就是定好的，不需要在环节里回填。
 */

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

/**
 * 「进入下一个主题」（2026-08-28）：当前 session 就算没走完也标记完成 ——
 * 入历史、不再出现在今日主题卡上（学习记录页里会显示已完成的环节数），
 * 然后立刻组装一个新主题的 session 返回。一天可以开多个主题。
 *
 * 选词/选语法沿用 getOrCreateToday 的口径：pickNewWords 天然排除 user_words
 * 里已登记的词（上一个主题学过/没学完的词不会原样再发一遍）；grammar 用
 * 到期优先。最后一个环节都没做的 session 也照样入历史 —— 用户明确说
 * 「不学了/换一个」，别再把它端回来。
 *
 * 并发：先关旧再插新。极端并发下两个请求可能都插成功（部分唯一索引只挡
 * 「同天两条都未完成」，关旧的之后窗口就开了）——插完回读一条**未完成**的
 * 当日 session 保证返回值唯一，先到的那条赢，后到的也拿同一行。
 */
export async function startNextTheme(user: UserProfile): Promise<SessionRow> {
  const day = localDay();
  await run(
    `UPDATE sessions SET completed_at = now()
     WHERE user_id = ? AND day = ? AND completed_at IS NULL`,
    [user.id, day],
  );
  // 不能走 getOrCreateToday：它的「都完成了回最后一条」会把刚关掉的那条
  // 端回来。这里直接组装新主题；极端并发下别的请求可能已经开了新的，
  // 先查一次未完成，有就拿（部分唯一索引兜底，不会开出两条）。
  const open = await openSession(user.id, day);
  if (open) return open;
  return assembleSession(user, day);
}

import { all, one, run } from '@/lib/db';
import { localDay } from '@/lib/scheduler';
import { countDueWords } from './words';
import { countOpenMistakes } from './mistakes';
import type { StatsSummary } from '@/lib/types';

type DailyPatch = {
  reviews?: number;
  correct?: number;
  new_words?: number;
  produced?: number;
  spoken_seconds?: number;
  minutes?: number;
};

/** daily_stats 里允许累加的列。patch 的 key 直接拼进 SQL，必须过一遍白名单。 */
const DAILY_COLS = new Set([
  'reviews',
  'correct',
  'new_words',
  'produced',
  'spoken_seconds',
  'minutes',
]);

/** 累加当天统计（不存在就先建行）。 */
export async function bumpDaily(
  userId: number,
  patch: DailyPatch,
  day = localDay(),
): Promise<void> {
  const sets: string[] = [];
  const args: Record<string, unknown> = { user_id: userId, day };
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) continue;
    if (!DAILY_COLS.has(k)) throw new Error(`daily_stats 没有这一列：${k}`);
    sets.push(`${k} = daily_stats.${k} + @${k}`);
    args[k] = v;
  }
  if (!sets.length) {
    // 没有要累加的字段，也保证当天有行（连续天数按有记录的天算）
    await run(
      'INSERT INTO daily_stats (user_id, day) VALUES (@user_id, @day) ON CONFLICT (user_id, day) DO NOTHING',
      args,
    );
    return;
  }
  // 建行和累加合成一句：撞上已有行就走 DO UPDATE 累加，省掉一次往返。
  const cols = Object.keys(patch).filter((k) => patch[k as keyof DailyPatch] != null);
  await run(
    `INSERT INTO daily_stats (user_id, day, ${cols.join(', ')})
     VALUES (@user_id, @day, ${cols.map((k) => `@${k}`).join(', ')})
     ON CONFLICT (user_id, day) DO UPDATE SET ${sets.join(', ')}`,
    args,
  );
}

/** 连续学习天数：从今天（或昨天）往前数有记录且有复习量的天。 */
export async function computeStreak(userId: number): Promise<number> {
  const rows = await all<{ day: string }>(
    `SELECT day FROM daily_stats
     WHERE user_id = ? AND (reviews > 0 OR new_words > 0 OR produced > 0)
     ORDER BY day DESC LIMIT 400`,
    [userId],
  );
  if (!rows.length) return 0;
  const days = new Set(rows.map((r) => r.day));
  const today = localDay();
  const yesterday = shiftDay(today, -1);
  // 今天还没学不算断，从昨天开始数
  let cursor = days.has(today) ? today : days.has(yesterday) ? yesterday : null;
  if (!cursor) return 0;
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = shiftDay(cursor, -1);
  }
  return streak;
}

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return localDay(d);
}

export async function getSummary(userId: number): Promise<StatsSummary> {
  const today = localDay();

  const counts = await one<{ total: number; learning: number | null; mature: number | null }>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN state IN (1,3) THEN 1 ELSE 0 END) AS learning,
       SUM(CASE WHEN state = 2 AND stability >= 21 THEN 1 ELSE 0 END) AS mature
     FROM user_words WHERE user_id = ?`,
    [userId],
  );

  const todayRow = await one<{
    reviews: number;
    correct: number;
    produced: number;
    minutes: number;
  }>(
    'SELECT reviews, correct, produced, minutes FROM daily_stats WHERE user_id = ? AND day = ?',
    [userId, today],
  );

  const last14Rows = await all<{
    day: string;
    reviews: number;
    correct: number;
    minutes: number;
    new_words: number;
  }>(
    `SELECT day, reviews, correct, minutes, new_words FROM daily_stats
     WHERE user_id = ? ORDER BY day DESC LIMIT 14`,
    [userId],
  );

  // 补齐没有记录的日子，图表才不会断
  const last14: StatsSummary['last14'] = [];
  const map = new Map(last14Rows.map((r) => [r.day, r]));
  for (let i = 13; i >= 0; i--) {
    const d = shiftDay(today, -i);
    const r = map.get(d);
    last14.push({
      day: d,
      reviews: r?.reviews ?? 0,
      correct: r?.correct ?? 0,
      minutes: r?.minutes ?? 0,
      new_words: r?.new_words ?? 0,
    });
  }

  // 近 30 天记得住的比例（rating >= 3 算记住）
  const ret = await one<{ total: number; ok: number | null }>(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN rating >= 3 THEN 1 ELSE 0 END) AS ok
     FROM review_logs
     WHERE user_id = ? AND reviewed_at >= now() - interval '30 days'`,
    [userId],
  );

  const learned = await one<{ c: number }>(
    'SELECT COUNT(*) AS c FROM user_grammar WHERE user_id = ? AND reps > 0',
    [userId],
  );

  const [streak, dueToday, openMistakes] = await Promise.all([
    computeStreak(userId),
    countDueWords(userId),
    countOpenMistakes(userId),
  ]);

  const total = ret?.total ?? 0;
  return {
    streak,
    totalWords: counts?.total ?? 0,
    learningWords: counts?.learning ?? 0,
    matureWords: counts?.mature ?? 0,
    dueToday,
    reviewsToday: todayRow?.reviews ?? 0,
    accuracyToday:
      todayRow && todayRow.reviews > 0
        ? Math.round((todayRow.correct / todayRow.reviews) * 100)
        : null,
    producedToday: todayRow?.produced ?? 0,
    minutesToday: Math.round((todayRow?.minutes ?? 0) * 10) / 10,
    last14,
    retention30: total > 0 ? Math.round(((ret?.ok ?? 0) / total) * 100) : null,
    openMistakes,
    grammarLearned: learned?.c ?? 0,
  };
}

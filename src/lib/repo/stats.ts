import { getDb } from '@/lib/db';
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

/** 累加当天统计（不存在就先建行）。 */
export function bumpDaily(userId: number, patch: DailyPatch, day = localDay()): void {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO daily_stats (user_id, day) VALUES (?, ?)').run(userId, day);
  const sets: string[] = [];
  const args: Record<string, unknown> = { user_id: userId, day };
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) continue;
    sets.push(`${k} = ${k} + @${k}`);
    args[k] = v;
  }
  if (!sets.length) return;
  db.prepare(`UPDATE daily_stats SET ${sets.join(', ')} WHERE user_id = @user_id AND day = @day`).run(
    args,
  );
}

/** 连续学习天数：从今天（或昨天）往前数有记录且有复习量的天。 */
export function computeStreak(userId: number): number {
  const rows = getDb()
    .prepare(
      `SELECT day FROM daily_stats
       WHERE user_id = ? AND (reviews > 0 OR new_words > 0 OR produced > 0)
       ORDER BY day DESC LIMIT 400`,
    )
    .all(userId) as { day: string }[];
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

export function getSummary(userId: number): StatsSummary {
  const db = getDb();
  const today = localDay();

  const counts = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN state IN (1,3) THEN 1 ELSE 0 END) AS learning,
         SUM(CASE WHEN state = 2 AND stability >= 21 THEN 1 ELSE 0 END) AS mature
       FROM user_words WHERE user_id = ?`,
    )
    .get(userId) as { total: number; learning: number | null; mature: number | null };

  const todayRow = db
    .prepare('SELECT reviews, correct, produced, minutes FROM daily_stats WHERE user_id = ? AND day = ?')
    .get(userId, today) as
    | { reviews: number; correct: number; produced: number; minutes: number }
    | undefined;

  const last14Rows = db
    .prepare(
      `SELECT day, reviews, correct, minutes, new_words FROM daily_stats
       WHERE user_id = ? ORDER BY day DESC LIMIT 14`,
    )
    .all(userId) as { day: string; reviews: number; correct: number; minutes: number; new_words: number }[];

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
  const ret = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN rating >= 3 THEN 1 ELSE 0 END) AS ok
       FROM review_logs
       WHERE user_id = ? AND reviewed_at >= datetime('now', '-30 days')`,
    )
    .get(userId) as { total: number; ok: number | null };

  const grammarLearned = (
    db
      .prepare('SELECT COUNT(*) AS c FROM user_grammar WHERE user_id = ? AND reps > 0')
      .get(userId) as { c: number }
  ).c;

  return {
    streak: computeStreak(userId),
    totalWords: counts.total ?? 0,
    learningWords: counts.learning ?? 0,
    matureWords: counts.mature ?? 0,
    dueToday: countDueWords(userId),
    reviewsToday: todayRow?.reviews ?? 0,
    accuracyToday:
      todayRow && todayRow.reviews > 0 ? Math.round((todayRow.correct / todayRow.reviews) * 100) : null,
    producedToday: todayRow?.produced ?? 0,
    minutesToday: Math.round((todayRow?.minutes ?? 0) * 10) / 10,
    last14,
    retention30: ret.total > 0 ? Math.round(((ret.ok ?? 0) / ret.total) * 100) : null,
    openMistakes: countOpenMistakes(userId),
    grammarLearned,
  };
}

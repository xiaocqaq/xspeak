import { currentUser, handle } from '@/lib/api';
import { getSummary } from '@/lib/repo/stats';
import { listMistakes } from '@/lib/repo/mistakes';
import { recentSessions } from '@/lib/repo/session';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const user = currentUser();
    const db = getDb();

    // 未来 14 天的复习负荷，方便你看到"哪天会堆积"
    const forecast = db
      .prepare(
        `SELECT date(due) AS day, COUNT(*) AS c FROM user_words
         WHERE user_id = ? AND due <= datetime('now', '+14 days')
         GROUP BY date(due) ORDER BY day ASC`,
      )
      .all(user.id) as { day: string; c: number }[];

    const speech = db
      .prepare(
        `SELECT AVG(score) AS avg, COUNT(*) AS c FROM speech_attempts
         WHERE user_id = ? AND created_at >= datetime('now','-30 days')`,
      )
      .get(user.id) as { avg: number | null; c: number };

    const writing = db
      .prepare(
        `SELECT AVG(score) AS avg, COUNT(*) AS c FROM writings
         WHERE user_id = ? AND created_at >= datetime('now','-30 days')`,
      )
      .get(user.id) as { avg: number | null; c: number };

    const topMistakeKinds = db
      .prepare(
        `SELECT kind, SUM(times) AS n FROM mistakes WHERE user_id = ? AND resolved = 0
         GROUP BY kind ORDER BY n DESC`,
      )
      .all(user.id) as { kind: string; n: number }[];

    return {
      summary: getSummary(user.id),
      forecast,
      speech: { avg: speech.avg == null ? null : Math.round(speech.avg), count: speech.c },
      writing: { avg: writing.avg == null ? null : Math.round(writing.avg), count: writing.c },
      topMistakeKinds,
      mistakes: listMistakes(user.id).slice(0, 30),
      sessions: recentSessions(user.id, 30).map((s) => ({
        day: s.day,
        themeZh: s.theme_zh,
        stagesDone: s.stages_done.length,
        completed: Boolean(s.completed_at),
        minutes: Math.round(s.minutes_spent * 10) / 10,
      })),
    };
  });
}

import { currentUser, handle } from '@/lib/api';
import { getSummary } from '@/lib/repo/stats';
import { listMistakes } from '@/lib/repo/mistakes';
import { recentSessions } from '@/lib/repo/session';
import { localDay } from '@/lib/scheduler';
import { all, one } from '@/lib/db';

/**
 * 把按日聚合的稀疏结果补成从今天起连续 n 天。
 *
 * 图表是等宽柱状图：少一天就少一个槽位，剩下的柱子会被 flex 拉宽填满，
 * 于是「今天 7 个、三天后 1 个」会画成两个各占半屏的色块，看不出中间的空档。
 */
function fillDays(rows: { day: string; c: number }[], n: number): { day: string; c: number }[] {
  const map = new Map(rows.map((r) => [r.day, Number(r.c)]));
  const today = new Date();
  const out: { day: string; c: number }[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const key = localDay(d);
    out.push({ day: key, c: map.get(key) ?? 0 });
  }
  return out;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const user = await currentUser();

    // 未来 14 天的复习负荷，方便你看到"哪天会堆积"。
    //
    // 两点必须在服务端处理，不能丢给前端：
    // 1. GROUP BY 只会返回"有词到期"的日子。稀疏数据传到前端后，等宽柱状图会把
    //    两三天拉成几个巨大色块，日期缺口完全看不出来 —— 所以这里补齐 14 个槽位。
    // 2. 已经过期的词（due < 今天）要归到今天，它们是今天该还的债，
    //    不该落在图表左边看不见的位置。
    const forecastRows = await all<{ day: string; c: number }>(
      `SELECT to_char(GREATEST(due, now()), 'YYYY-MM-DD') AS day, COUNT(*) AS c
       FROM user_words
       WHERE user_id = ? AND due <= now() + interval '14 days'
       GROUP BY 1 ORDER BY 1 ASC`,
      [user.id],
    );
    const forecast = fillDays(forecastRows, 14);

    const speech = await one<{ avg: number | null; c: number }>(
      `SELECT AVG(score) AS avg, COUNT(*) AS c FROM speech_attempts
       WHERE user_id = ? AND created_at >= now() - interval '30 days'`,
      [user.id],
    );

    /*
     * 开口时长和对话轮数。原来这一格是写作平均分，写作环节删掉之后换成这个。
     * 时长来自 daily_stats.spoken_seconds（跟读和口语环节都会累加），
     * 轮数只数 chat_messages 里 role='user' 的行 —— AI 的回复不算学生开口。
     */
    const talk = await one<{ seconds: number | null; turns: number }>(
      `SELECT
         (SELECT SUM(spoken_seconds) FROM daily_stats
           WHERE user_id = ? AND day >= (now() - interval '30 days')::date) AS seconds,
         (SELECT COUNT(*) FROM chat_messages m
            JOIN conversations c ON c.id = m.conversation_id
           WHERE c.user_id = ? AND m.role = 'user'
             AND m.created_at >= now() - interval '30 days') AS turns`,
      [user.id, user.id],
    );

    const topMistakeKinds = await all<{ kind: string; n: number }>(
      `SELECT kind, SUM(times) AS n FROM mistakes WHERE user_id = ? AND resolved = 0
       GROUP BY kind ORDER BY n DESC`,
      [user.id],
    );

    const [summary, mistakes, sessions] = await Promise.all([
      getSummary(user.id),
      listMistakes(user.id),
      recentSessions(user.id, 30),
    ]);

    return {
      summary,
      forecast,
      speech: { avg: speech?.avg == null ? null : Math.round(speech.avg), count: speech?.c ?? 0 },
      talk: {
        minutes: Math.round((Number(talk?.seconds ?? 0) / 60) * 10) / 10,
        turns: Number(talk?.turns ?? 0),
      },
      topMistakeKinds,
      mistakes: mistakes.slice(0, 30),
      sessions: sessions.map((s) => ({
        day: s.day,
        themeZh: s.theme_zh,
        stagesDone: s.stages_done.length,
        completed: Boolean(s.completed_at),
        minutes: Math.round(s.minutes_spent * 10) / 10,
      })),
    };
  });
}

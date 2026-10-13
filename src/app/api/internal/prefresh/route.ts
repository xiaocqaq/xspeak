import { z } from 'zod';
import { all, one } from '@/lib/db';
import { getOrCreateToday } from '@/lib/repo/session';
import { prewarmNewWords } from '@/lib/stage';
import { prefillUserSpeech } from '@/lib/stage-prefill';
import type { SpeechPace, UserProfile } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ secret: z.string().min(1) });

const PACES: SpeechPace[] = ['slow', 'normal', 'fast'];

/** users 行 → UserProfile（和 db/index.ts 的 toProfile 同构，那边没导出，这里复刻一份） */
function toProfile(row: Record<string, unknown>, id: number): UserProfile {
  return {
    id,
    name: String(row.name),
    level: String(row.level),
    goal: String(row.goal),
    interests: Array.isArray(row.interests) ? (row.interests as string[]) : [],
    daily_minutes: Number(row.daily_minutes),
    new_words_per_day: Number(row.new_words_per_day),
    voice: (row.voice as string | null) ?? null,
    ai_voice: (row.ai_voice as string | null) ?? null,
    speech_pace: PACES.includes(row.speech_pace as SpeechPace) ? (row.speech_pace as SpeechPace) : 'normal',
    onboarded: Number(row.onboarded),
  };
}

/**
 * 凌晨 4 点的预生成任务（由 server.mjs 里的调度器调用，不是浏览器）。
 *
 * 以前今天的学习计划是"用户打开首页时才组装"（getOrCreateToday）：
 * 选词、选语法、挑主题全在请求路径上。cron 提前把 48 小时内活跃用户的
 * 今日 session 建好，用户进门直接命中已存在的行，首页零组装延迟；
 * prewarmNewWords 也一并起跑，新词卡片的补充内容（例句/记忆抓手/搭配）
 * 在用户醒来之前就补完 —— 打开就是完整卡片，一次 AI 调用都不用现场等。
 *
 * getOrCreateToday 幂等：session 已存在就直接返回，cron 和用户请求
 * 并发撞上也不会重复建。所以"提前建"和"用户进门兜底"两条路共用同一份代码。
 *
 * 鉴权：本地回环调用 + CRON_SECRET 双保险。secret 在 .env.local 里配，
 * server.mjs 的调度器带上它。没有配 secret 时这个端点直接拒绝 ——
 * 它会触发真实的 AI 调用（补充内容），不能裸奔。
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ ok: false, error: '未配置 CRON_SECRET，端点禁用' }, { status: 403 });
  }
  let input: z.infer<typeof Body>;
  try {
    input = Body.parse(await req.json());
  } catch {
    return Response.json({ ok: false, error: '参数不对' }, { status: 400 });
  }
  if (input.secret !== secret) {
    return Response.json({ ok: false, error: 'secret 不对' }, { status: 403 });
  }

  /*
   * 48 小时内有学习动作的用户。
   *
   * ── 为什么不能只判「sessions 里有行」──
   *
   * 这个任务的循环体第一步就是 getOrCreateToday()，它会往 sessions 插一行
   * （day = 今天）。插出来的行次日又满足 `s.day >= CURRENT_DATE - 1`，
   * 于是任务永远命中自己写的行 —— 反馈环，给早就不用的人天天预生成。
   * 实测 2026-09-28 ~ 10-13：3 个用户连续 16 天零动作，每轮照跑，
   * 一轮 24 次调用 / 14.6 万 token / 14 次失败重试，全部白花。
   *
   * 只认四种「真的发生过的动作」（cron 自己都不写这些字段）：
   * - stage_index > 0   —— 进过某个环节
   * - minutes_spent > 0 —— 环节落了计时（completeStage 写的）
   * - completed_at 非空 —— 走完整轮
   * - stages_done 非空  —— 完成过至少一个环节
   *
   * daily_stats 那支保留：它是纯学习动作的痕迹（bumpDaily 只被答题/复习/
   * 通话/聊天调用，cron 不写它），能兜住「进程被重启打断、session 没落库」
   * 的情况。
   *
   * 窗口口径：CURRENT_DATE 是数据库会话时区的日期（pool.ts 把连接钉成
   * UTC），凌晨 4 点跑时它正好等于「北京的今天」（UTC 20:00，日期没跨）。
   * 所以这个条件实际覆盖最近 24~48 小时的活跃 —— 昨晚学过的用户仍然命中。
   */
  const rows = await all<{ id: number }>(
    `SELECT DISTINCT u.id FROM users u
     WHERE u.onboarded = 1
       AND (
         EXISTS (
           SELECT 1 FROM sessions s
           WHERE s.user_id = u.id
             AND s.day >= CURRENT_DATE - 1
             AND (
               s.stage_index > 0
               OR COALESCE(s.minutes_spent, 0) > 0
               OR s.completed_at IS NOT NULL
               OR (s.stages_done IS NOT NULL AND s.stages_done::text NOT IN ('null', '[]'))
             )
         )
         OR EXISTS (SELECT 1 FROM daily_stats d WHERE d.user_id = u.id AND d.day >= CURRENT_DATE - 1)
       )`,
  );

  const results: { userId: number; ok: boolean; detail?: string; tts?: Record<string, unknown> }[] = [];
  for (const row of rows) {
    try {
      const user = await loadUser(row.id);
      if (!user) {
        results.push({ userId: row.id, ok: false, detail: '档案读不到' });
        continue;
      }
      const s = await getOrCreateToday(user);
      // 补充内容也提前跑 —— 用户醒来时新词卡片已是完整的
      await prewarmNewWords(user, s);
      /*
       * 全量预跑（用户明确要求，不在乎 token）：六个环节的内容全部生成
       * 进当日缓存（buildStage 幂等，已有缓存的环节直接命中），朗读音频
       * 预合成进 TTS 磁盘缓存（stage-prefill，缓存键与播放链路一致）。
       * 单用户失败不挡后面的用户。
       */
      let tts: Record<string, unknown> | undefined;
      try {
        // 2026-09-09 起自建 Kokoro 下线，预合成只有 MiMo 一条路（见 stage-prefill）
        tts = await prefillUserSpeech(user, s);
      } catch (err) {
        tts = { error: (err as Error).message };
      }
      results.push({ userId: row.id, ok: true, day: s.day, tts } as {
        userId: number;
        ok: boolean;
        day?: string;
      });
    } catch (err) {
      // 单个用户失败不挡后面的
      results.push({ userId: row.id, ok: false, detail: (err as Error).message });
    }
  }
  return Response.json({
    ok: true,
    data: { users: rows.length, results, ranAt: new Date().toISOString() },
  });
}

async function loadUser(id: number): Promise<UserProfile | null> {
  const row = await one<Record<string, unknown>>('SELECT * FROM users WHERE id = ?', [id]);
  return row ? toProfile(row, id) : null;
}

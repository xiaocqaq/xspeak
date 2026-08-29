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
    voice_offline: (row.voice_offline as string | null) ?? null,
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
   * 48 小时内有学习记录的用户：sessions 的 day 是本地日期，最近两天内
   * 建过/学过 session 的人就是要提前服务的对象。再顺带补上 daily_stats
   * 里近两天有量的（学了但 session 没落库的边缘情况，正常不会发生，
   * 查一下不亏）。
   */
  const rows = await all<{ id: number }>(
    `SELECT DISTINCT u.id FROM users u
     WHERE u.onboarded = 1
       AND (
         EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.day >= CURRENT_DATE - 1)
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
        /*
         * 这里、而且只有这里传 'kokoro'（2026-08-28 二次调整）：凌晨没人等，
         * 自建 Kokoro 一句慢到 13 秒也无所谓，换来的是全站免费。
         * 所有请求路径上的预合成（进门兜底、开新主题）一律用默认的 'mimo'
         * 快路 —— 那些场景有用户盯着屏幕，慢就是体验差。见 stage-prefill 头注释。
         */
        tts = await prefillUserSpeech(user, s, undefined, 'kokoro');
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

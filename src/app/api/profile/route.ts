import { z } from 'zod';
import { body, currentUser, handle } from '@/lib/api';
import { json, run } from '@/lib/db';
import { listMistakes, resolveMistake } from '@/lib/repo/mistakes';
import { AI_VOICE_IDS, PACE_KEYS } from '@/lib/voice-options';
import { preferredVoiceId } from '@/lib/tts/server-voice-list';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const user = await currentUser();
    return { user, mistakes: await listMistakes(user.id) };
  });
}

const PatchBody = z.object({
  name: z.string().min(1).max(30).optional(),
  level: z.enum(['A1', 'A2', 'B1', 'B2']).optional(),
  goal: z.enum(['daily_talk', 'reading', 'work', 'exam', 'travel']).optional(),
  interests: z.array(z.string().max(30)).max(12).optional(),
  dailyMinutes: z.number().int().min(5).max(180).optional(),
  newWordsPerDay: z.number().int().min(2).max(100).optional(),
  /*
   * voice 只接受 MiMo 音色，voiceOffline 只接受 Kokoro 音色（2026-08-29 加）。
   *
   * 两列各管一家：voice = 点朗读真正出声的音色（走 MiMo 快路），
   * voiceOffline = 凌晨 4 点免费预生成用哪个嗓音（走自建 Kokoro）。
   *
   * 原来两列都只校验长度，于是分梯队之前的老数据把 Kokoro 音色写进了 voice
   * （生产实锤 user4 = 'kokoro:af_bella'）。那个值在播放链路上解析为 null，
   * 静默回落到默认 Mia —— 用户以为选了「贝拉」，其实一直听「米娅」，且毫无提示。
   * 存量已由 scripts/fix-voice-columns.mjs 迁移，这里堵住源头。
   */
  voice: z.string().max(120).nullish().refine(
    // preferredVoiceId 正好做「剥前缀 + 校验归属」，非 MiMo 音色返回 null
    (v) => !v || preferredVoiceId(v, 'mimo') !== null,
    { message: '点朗读的音色必须是在线音色（MiMo）；自建音色请存到 voiceOffline' },
  ),
  /*
   * 自建 Kokoro 音色偏好（'kokoro:xx'）。只影响凌晨 4 点那轮免费预生成。
   * 和 voice 对称校验：这一列只接受 Kokoro 音色，写进 MiMo 音色同样是串列。
   */
  voiceOffline: z.string().max(120).nullish().refine(
    (v) => !v || preferredVoiceId(v, 'kokoro') !== null,
    { message: '预生成的音色必须是自建音色（Kokoro）；在线音色请存到 voice' },
  ),
  // 只收白名单里的音色 id：这个值会被原样发给上游 realtime，
  // 上游对未知音色是明确报错而不是降级，写进库就等于让畅聊直接连不上。
  aiVoice: z
    .union([z.enum(AI_VOICE_IDS as [string, ...string[]]), z.null()])
    .optional(),
  speechPace: z.enum(PACE_KEYS as [string, ...string[]]).optional(),
  resolveMistakeId: z.number().int().positive().optional(),
});

export async function PATCH(req: Request) {
  return handle(async () => {
    const user = await currentUser();
    const input = await body(req, PatchBody);

    if (input.resolveMistakeId) {
      await resolveMistake(user.id, input.resolveMistakeId);
    }

    const sets: string[] = [];
    const args: Record<string, unknown> = { id: user.id };
    const map: [keyof typeof input, string][] = [
      ['name', 'name'],
      ['level', 'level'],
      ['goal', 'goal'],
      ['dailyMinutes', 'daily_minutes'],
      ['newWordsPerDay', 'new_words_per_day'],
      ['voice', 'voice'],
      ['voiceOffline', 'voice_offline'],
      ['aiVoice', 'ai_voice'],
      ['speechPace', 'speech_pace'],
    ];
    for (const [key, col] of map) {
      if (input[key] !== undefined) {
        sets.push(`${col} = @${col}`);
        args[col] = input[key];
      }
    }
    if (input.interests) {
      sets.push('interests = @interests');
      args.interests = json(input.interests);
    }
    if (sets.length) {
      await run(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`, args);
    }
    return { user: await currentUser() };
  });
}

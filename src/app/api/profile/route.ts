import { z } from 'zod';
import { body, currentUser, handle } from '@/lib/api';
import { json, run } from '@/lib/db';
import { listMistakes, resolveMistake } from '@/lib/repo/mistakes';
import { AI_VOICE_IDS, PACE_KEYS } from '@/lib/voice-options';

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
  voice: z.string().max(120).nullish(),
  // 自建 Kokoro 音色偏好（'kokoro:xx'）。预生成第一梯队 + 播放首选。
  voiceOffline: z.string().max(120).nullish(),
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

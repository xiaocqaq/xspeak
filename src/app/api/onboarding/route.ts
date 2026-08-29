import { z } from 'zod';
import { body, currentUser, handle } from '@/lib/api';
import { json, run } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  name: z.string().min(1).max(30).default('学习者'),
  level: z.enum(['A1', 'A2', 'B1', 'B2']),
  goal: z.enum(['daily_talk', 'reading', 'work', 'exam', 'travel']),
  interests: z.array(z.string().min(1).max(30)).max(12).default([]),
  dailyMinutes: z.number().int().min(5).max(180).default(30),
  newWordsPerDay: z.number().int().min(2).max(100).default(10),
});

/** 首次进入时保存画像，之后每天的内容都按它生成。 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await currentUser();
    const input = await body(req, Body);
    await run(
      `UPDATE users SET name=@name, level=@level, goal=@goal, interests=@interests,
         daily_minutes=@dailyMinutes, new_words_per_day=@newWordsPerDay, onboarded=1
       WHERE id=@id`,
      {
        id: user.id,
        name: input.name,
        level: input.level,
        goal: input.goal,
        interests: json(input.interests),
        dailyMinutes: input.dailyMinutes,
        newWordsPerDay: input.newWordsPerDay,
      },
    );
    return { user: await currentUser() };
  });
}

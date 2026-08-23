import { z } from 'zod';
import { body, currentUser, handle } from '@/lib/api';
import { getDb } from '@/lib/db';
import { listMistakes, resolveMistake } from '@/lib/repo/mistakes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const user = currentUser();
    return { user, mistakes: listMistakes(user.id) };
  });
}

const PatchBody = z.object({
  name: z.string().min(1).max(30).optional(),
  level: z.enum(['A1', 'A2', 'B1', 'B2']).optional(),
  goal: z.enum(['daily_talk', 'reading', 'work', 'exam', 'travel']).optional(),
  interests: z.array(z.string().max(30)).max(12).optional(),
  dailyMinutes: z.number().int().min(5).max(180).optional(),
  newWordsPerDay: z.number().int().min(2).max(40).optional(),
  voice: z.string().max(120).nullish(),
  resolveMistakeId: z.number().int().positive().optional(),
});

export async function PATCH(req: Request) {
  return handle(async () => {
    const user = currentUser();
    const input = await body(req, PatchBody);
    const db = getDb();

    if (input.resolveMistakeId) {
      resolveMistake(user.id, input.resolveMistakeId);
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
    ];
    for (const [key, col] of map) {
      if (input[key] !== undefined) {
        sets.push(`${col} = @${col}`);
        args[col] = input[key];
      }
    }
    if (input.interests) {
      sets.push('interests = @interests');
      args.interests = JSON.stringify(input.interests);
    }
    if (sets.length) {
      db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`).run(args);
    }
    return { user: currentUser() };
  });
}

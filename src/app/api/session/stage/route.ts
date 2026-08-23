import { z } from 'zod';
import { body, currentUser, fail, handle } from '@/lib/api';
import { buildStage } from '@/lib/stage';
import { completeStage, getOrCreateToday, getSessionById } from '@/lib/repo/session';
import { bumpDaily } from '@/lib/repo/stats';
import { STAGES, type Stage } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const StageEnum = z.enum(STAGES);

/** 取某个环节的内容（有缓存走缓存）。 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = StageEnum.safeParse(url.searchParams.get('stage'));
  if (!parsed.success) return fail('stage 参数不合法', 422);
  const regenerate = url.searchParams.get('regenerate') === '1';

  return handle(async () => {
    const user = currentUser();
    const session = getOrCreateToday(user);
    const { payload, meta } = await buildStage(user, session, parsed.data as Stage, regenerate);
    return { ...meta, payload };
  });
}

const DoneBody = z.object({
  stage: StageEnum,
  minutes: z.number().min(0).max(180).default(0),
});

/** 标记环节完成，累加当天用时。 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = currentUser();
    const input = await body(req, DoneBody);
    const session = getOrCreateToday(user);
    const updated = completeStage(session.id, input.stage as Stage, input.minutes);
    if (input.minutes > 0) bumpDaily(user.id, { minutes: input.minutes });
    const s = updated ?? getSessionById(session.id)!;
    return {
      stagesDone: s.stages_done,
      stageIndex: s.stage_index,
      completedAt: s.completed_at,
      minutesSpent: s.minutes_spent,
    };
  });
}

import { z } from 'zod';
import { body, currentUser, handle } from '@/lib/api';
import {
  enrollWords,
  listVocab,
  removeWord,
  resetWordProgress,
  toggleStar,
  type VocabFilter,
} from '@/lib/repo/words';
import { previewIntervals } from '@/lib/scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 生词本列表 */
export async function GET(req: Request) {
  return handle(async () => {
    const user = currentUser();
    const url = new URL(req.url);
    const filter = (url.searchParams.get('filter') ?? 'all') as VocabFilter;
    const q = url.searchParams.get('q') ?? '';
    const items = listVocab(user.id, filter, q);
    return {
      items: items.map((it) => ({
        ...it,
        nextIntervals: it.progress ? previewIntervals(it.progress) : null,
      })),
      total: items.length,
    };
  });
}

const ActionBody = z.object({
  action: z.enum(['enroll', 'star', 'reset', 'remove']),
  wordIds: z.array(z.number().int().positive()).min(1),
});

export async function POST(req: Request) {
  return handle(async () => {
    const user = currentUser();
    const input = await body(req, ActionBody);
    switch (input.action) {
      case 'enroll':
        enrollWords(user.id, input.wordIds);
        return { enrolled: input.wordIds.length };
      case 'star': {
        const states = input.wordIds.map((id) => ({ wordId: id, starred: toggleStar(user.id, id) }));
        return { states };
      }
      case 'reset':
        for (const id of input.wordIds) resetWordProgress(user.id, id);
        return { reset: input.wordIds.length };
      case 'remove':
        for (const id of input.wordIds) removeWord(user.id, id);
        return { removed: input.wordIds.length };
    }
  });
}

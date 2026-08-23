import { currentUser, handle } from '@/lib/api';
import { listGrammar } from '@/lib/repo/grammar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 语法库：全部语法点 + 你的掌握状态。 */
export async function GET() {
  return handle(async () => {
    const user = await currentUser();
    return { items: await listGrammar(user.id) };
  });
}

import { z } from 'zod';
import { body, currentUser, handle } from '@/lib/api';
import { processTurn } from '@/lib/realtime/coaching';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  conversationId: z.number().int().positive(),
  /** 学生原话（ASR 转写） */
  userText: z.string().min(1).max(2000),
  /** AI 的语音回复文本 */
  assistantText: z.string().max(2000).default(''),
});

/**
 * 畅聊模式的教学旁路。
 *
 * 调用方是 WebSocket 中转层（server.mjs），不是浏览器 —— 中转层跑在 Next 编译流程之外，
 * 用不了 `@/` 别名，所以数据库和 AI 逻辑仍然只在 TS 侧实现一份，由它 HTTP 回调进来。
 *
 * 语音回合不等这个接口：一句话说完，AI 的语音立刻就回了，纠正随后异步补上。
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await currentUser();
    const input = await body(req, Body);
    const result = await processTurn({
      userId: user.id,
      conversationId: input.conversationId,
      learner: {
        name: user.name,
        level: user.level,
        goal: user.goal,
        interests: user.interests,
        newWordsPerDay: user.new_words_per_day,
      },
      userText: input.userText,
      assistantText: input.assistantText,
    });
    // 分析失败时 processTurn 返回 null，对话记录已经落库了，前端不显示纠正即可
    return result ?? { correction: null, usedTerms: [] };
  });
}

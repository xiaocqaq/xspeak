import { z } from 'zod';
import { body, currentUser, handle } from '@/lib/api';
import { generateJson } from '@/lib/ai/client';
import { TipPayload } from '@/lib/ai/schemas';
import { tipPrompt, systemPrompt, type Learner } from '@/lib/ai/prompts';
import { all, one, safeJson } from '@/lib/db';
import { getWordsByIds } from '@/lib/repo/words';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  conversationId: z.number().int().positive(),
  /** AI 刚说完的话 —— 提示是「听完这句之后可以怎么接」 */
  assistantText: z.string().min(1).max(2000),
});

/**
 * 畅聊模式的「试试这样说」提示：AI 话音刚落就触发，赶在学生开口之前。
 *
 * 和 /api/realtime/coach 的分工：那边是回合后的完整教学分析（落库、错题本、
 * 掌握度），晚一两秒是刻意的取舍；这边只要一句话，不写任何库，
 * 两次小查询加一次 fast 模型调用就返回。两条路并行跑、互不等待。
 * 调用方同样是 WebSocket 中转层（relay.mjs），不是浏览器。
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await currentUser();
    const input = await body(req, Body);
    const learner: Learner = {
      name: user.name,
      level: user.level,
      goal: user.goal,
      interests: user.interests,
      newWordsPerDay: user.new_words_per_day,
    };

    // 场景和目标词跟 coach 一样从会话里读；会话不存在就不给提示，
    // 提示是锦上添花，不值得为一句话报错
    const conv = await one<Record<string, unknown>>(
      'SELECT target_word_ids FROM conversations WHERE id = ? AND user_id = ?',
      [input.conversationId, user.id],
    );
    if (!conv) return { tip: null };
    const targetWordRows = await getWordsByIds((conv.target_word_ids as number[] | null) ?? []);
    const targetWords = targetWordRows.map((w) => w.term);

    const rows = await all<{ role: string; content: string }>(
      'SELECT role, content FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC',
      [input.conversationId],
    );
    const setup = rows.find((r) => r.role === 'system');
    const meta = setup
      ? safeJson<{ scenarioZh: string }>(setup.content, { scenarioZh: '自由聊天' })
      : { scenarioZh: '自由聊天' };
    // 本回合的两条消息此刻多半还没落库（coach 在并行跑），正好 ——
    // AI 刚说的话由请求体直接带来，历史里少这一轮不影响给提示
    const history = rows
      .filter((r) => r.role === 'user' || r.role === 'assistant')
      .slice(-8)
      .map((r) => `${r.role === 'user' ? '学生' : 'AI'}：${r.content}`)
      .join('\n');

    const data = await generateJson(TipPayload, {
      system: systemPrompt(learner),
      prompt: tipPrompt(learner, {
        scenarioZh: meta.scenarioZh,
        targetWords,
        assistantText: input.assistantText,
        history,
      }),
      /*
       * fast 角色是推理模型：思考本身就要 700-1000 tokens，预算给小了思考先把
       * 配额吃光，结构化输出一个 token 都轮不到（实测 160/320 两连截断）。
       * 2000 = 思考 ~1000 + 一句中英文提示还有大富余。
       */
      maxTokens: 2000,
      temperature: 0.6,
      toolName: 'emit_tip',
      role: 'fast',
    });
    const tip =
      data.tip_en?.trim() && data.tip_zh?.trim()
        ? { en: data.tip_en.trim(), zh: data.tip_zh.trim() }
        : null;
    return { tip };
  });
}

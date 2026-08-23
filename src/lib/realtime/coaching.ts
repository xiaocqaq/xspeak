import { generateJson } from '@/lib/ai/client';
import { CoachingPayload } from '@/lib/ai/schemas';
import { coachingPrompt, systemPrompt, type Learner } from '@/lib/ai/prompts';
import { all, json, one, run, safeJson } from '@/lib/db';
import { getWordsByIds, markProduced } from '@/lib/repo/words';
import { recordMistake } from '@/lib/repo/mistakes';
import { bumpDaily } from '@/lib/repo/stats';
import type { Correction } from './protocol';

/**
 * 畅聊模式的教学旁路。
 *
 * 端到端语音模型只给「回复的语音 + 文本」，不给纠正。所以每个回合结束后单独跑一次
 * 文本分析，把结果补回界面并落库。这一路是异步的：语音回合不等它，纠正迟到一两秒。
 * 这是畅聊模式刻意的取舍 —— 不打断说话的节奏。
 *
 * 落库的字段和现有文本对话模式完全一致（chat_messages.feedback / used_words、
 * mistakes、user_words.produced_count、daily_stats），所以错题本、词汇掌握判定、
 * 每日统计都能照原样工作，不需要为语音模式另开一套。
 */

export type CoachingResult = {
  correction: Correction;
  usedTerms: string[];
};

/**
 * 处理一个语音回合：两条消息落库 + 跑纠正分析 + 更新掌握度和错题本。
 *
 * 顺序有讲究 —— 消息先写库，哪怕后面分析失败，对话记录也不会丢。
 * 返回 null 表示分析没成功（对话照常继续，只是这轮没有纠正）。
 */
export async function processTurn(input: {
  userId: number;
  conversationId: number;
  learner: Learner;
  userText: string;
  assistantText: string;
}): Promise<CoachingResult | null> {
  const { conversationId, userText, assistantText } = input;

  // 场景设定和目标词都存在这段对话里，读回来拼 prompt
  const conv = await one<Record<string, unknown>>(
    'SELECT target_word_ids FROM conversations WHERE id = ? AND user_id = ?',
    [conversationId, input.userId],
  );
  if (!conv) return null;
  const targetIds = (conv.target_word_ids as number[] | null) ?? [];
  const targetWordRows = await getWordsByIds(targetIds);
  const targetWords = targetWordRows.map((w) => w.term);

  // 最近几轮做上下文，顺带取出场景设定（存在第一条 system 消息里）
  const rows = await all<{ role: string; content: string }>(
    'SELECT role, content FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC',
    [conversationId],
  );
  const setup = rows.find((r) => r.role === 'system');
  const meta = setup
    ? safeJson<{ scenarioZh: string; aiRole: string }>(setup.content, {
        scenarioZh: '自由聊天',
        aiRole: 'a friendly English tutor',
      })
    : { scenarioZh: '自由聊天', aiRole: 'a friendly English tutor' };
  const history = rows
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .slice(-8)
    .map((r) => `${r.role === 'user' ? '学生' : 'AI'}：${r.content}`)
    .join('\n');

  // 1) 两条消息先落库
  await run(`INSERT INTO chat_messages (conversation_id, role, content) VALUES (?, 'user', ?)`, [
    conversationId,
    userText,
  ]);
  const assistant = await one<{ id: number }>(
    `INSERT INTO chat_messages (conversation_id, role, content) VALUES (?, 'assistant', ?) RETURNING id`,
    [conversationId, assistantText || '(没有回应)'],
  );

  // 2) 跑纠正分析。失败不能影响对话，整段包住。
  let result: CoachingResult;
  try {
    const data = await generateJson(CoachingPayload, {
      system: systemPrompt(input.learner),
      prompt: coachingPrompt(input.learner, {
        scenarioZh: meta.scenarioZh,
        targetWords,
        userText,
        history,
      }),
      maxTokens: 800,
      temperature: 0.3,
      toolName: 'emit_coaching',
    });
    result = { correction: data.correction, usedTerms: data.used_target_words };
  } catch (err) {
    console.error('[linxi realtime] 纠正分析失败：', (err as Error).message);
    return null;
  }

  // 3) 纠正结果补写到刚落库的那条 assistant 消息上
  if (assistant) {
    await run('UPDATE chat_messages SET feedback = ?, used_words = ? WHERE id = ?', [
      json({ correction: result.correction }),
      json(result.usedTerms),
      assistant.id,
    ]);
  }

  // 4) 真说出口的目标词记 produced —— 和文本模式同一套判据
  const lower = new Set(result.usedTerms.map((t) => t.toLowerCase().trim()));
  const usedIds = targetWordRows.filter((w) => lower.has(w.term.toLowerCase())).map((w) => w.id);
  if (usedIds.length) {
    await markProduced(input.userId, usedIds);
    await bumpDaily(input.userId, { produced: usedIds.length });
  }

  // 5) 有问题就进错题本，之后几天的题目会围着它出
  if (result.correction.has_issue) {
    await recordMistake(input.userId, {
      kind: 'grammar',
      stage: 'speaking',
      wrong: userText,
      correct: result.correction.corrected_en,
      note: result.correction.note_zh,
    });
  }

  return result;
}

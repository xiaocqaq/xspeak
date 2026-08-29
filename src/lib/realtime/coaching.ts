import { generateJson } from '@/lib/ai/client';
import { CoachingPayload } from '@/lib/ai/schemas';
import { coachingPrompt, systemPrompt, type Learner } from '@/lib/ai/prompts';
import { all, json, one, run, safeJson } from '@/lib/db';
import { getWordsByIds, markProduced } from '@/lib/repo/words';
import { recordMistake } from '@/lib/repo/mistakes';
import { bumpDaily } from '@/lib/repo/stats';
import { hasChinese, type Correction } from './protocol';

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

  /*
   * 1.5) 转写里有汉字：分析照跑，只是换个提示词，并且这一轮不进错题本。
   *
   * 早先这里是 `if (hasChinese(userText)) return null;` —— 直接跳过分析。那是错的，
   * 前提就不成立：有汉字并不等于学生说了中文，上游那个识别模型是中文为主的，
   * 把带中文口音的英文听成中文才是常见情况（用户实测反馈，见 protocol.mjs 的 hasChinese）。
   * 跳过的代价全落在学生身上 —— 他明明说了英文，纠正却被整条吞掉，界面上还挂着
   * 「纠正稍后补上…」永远等不到。
   *
   * 现在的分法：
   * - 分析要跑，但提示词里说清这句可能是转写错的，让模型自己判是哪一种（见 coachingPrompt）；
   * - 错题本不写，见下面第 5 步 —— 那份数据要驱动之后几天的题，宁可漏一条也不能进脏的。
   */
  const maybeMisheard = hasChinese(userText);

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
        maybeMisheard,
      }),
      maxTokens: 800,
      temperature: 0.3,
      toolName: 'emit_coaching',
      /*
       * 口语纠错走 fast 角色：这一路是语音回合的旁路，学生已经在说下一句了，
       * 纠正每晚到一秒，界面上的红字就越对不上他刚说的那句。
       * 用哪个模型由 AI_FAST_* 决定，配一个响应快的比配一个聪明的划算。
       */
      role: 'fast',
    });
    result = {
      correction: data.correction,
      usedTerms: data.used_target_words,
    };
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

  /*
   * 5) 有问题就进错题本，之后几天的题目会围着它出。
   *
   * 两种情况不写，宁可漏一条：
   * - maybeMisheard：wrong 字段会存下那句汉字转写，而它很可能根本不是学生说的话。
   *   错题本要驱动之后几天出题，进了脏数据就是围着一句不存在的病句练。
   *   界面上该看到的纠正照给（第 3 步已经写进 feedback），只是不留档。
   * - corrected_en 空：提示词里让模型「听不出来就留空、别硬编一条语法错」，
   *   留空的那条没有正确答案可对照，存进去也没用。
   */
  if (result.correction.has_issue && !maybeMisheard && result.correction.corrected_en.trim()) {
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

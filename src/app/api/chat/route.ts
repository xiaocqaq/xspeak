import { z } from 'zod';
import { body, currentUser, handle } from '@/lib/api';
import { generateJson } from '@/lib/ai/client';
import { ChatReplyPayload } from '@/lib/ai/schemas';
import { chatSystemPrompt, type Learner } from '@/lib/ai/prompts';
import { all, json, one, run, safeJson } from '@/lib/db';
import { getWordsByIds, markProduced } from '@/lib/repo/words';
import { recordMistake } from '@/lib/repo/mistakes';
import { bumpDaily } from '@/lib/repo/stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const StartBody = z.object({
  action: z.literal('start'),
  sessionId: z.number().int().positive().nullish(),
  title: z.string().max(80).default('自由对话'),
  themeSlug: z.string().max(60).nullish(),
  scenarioZh: z.string().max(500).default('自由聊天，话题由你决定。'),
  aiRole: z.string().max(120).default('a friendly English tutor'),
  openingEn: z.string().max(500).nullish(),
  openingZh: z.string().max(500).nullish(),
  targetWordIds: z.array(z.number().int().positive()).default([]),
});

const SendBody = z.object({
  action: z.literal('send'),
  conversationId: z.number().int().positive(),
  text: z.string().min(1).max(2000),
});

/** 开一段对话，或在已有对话里发一句。 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await currentUser();
    const raw = await body(req, z.union([StartBody, SendBody]));

    if (raw.action === 'start') {
      const created = await one<{ id: number }>(
        `INSERT INTO conversations (user_id, session_id, title, theme_slug, target_word_ids)
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
        [user.id, raw.sessionId ?? null, raw.title, raw.themeSlug ?? null, json(raw.targetWordIds)],
      );
      const conversationId = created!.id;
      // 场景设定存进第一条 system 消息，后续发言时读回来拼 prompt
      await run(
        `INSERT INTO chat_messages (conversation_id, role, content, translation_zh)
         VALUES (?, 'system', ?, ?)`,
        [conversationId, JSON.stringify({ scenarioZh: raw.scenarioZh, aiRole: raw.aiRole }), null],
      );
      if (raw.openingEn) {
        await run(
          `INSERT INTO chat_messages (conversation_id, role, content, translation_zh)
           VALUES (?, 'assistant', ?, ?)`,
          [conversationId, raw.openingEn, raw.openingZh ?? null],
        );
      }
      return { conversationId, messages: await loadMessages(conversationId) };
    }

    // action === 'send'
    const conv = await one<Record<string, unknown>>(
      'SELECT * FROM conversations WHERE id = ? AND user_id = ?',
      [raw.conversationId, user.id],
    );
    if (!conv) throw new Error('对话不存在');

    // target_word_ids 是 jsonb，读出来已经是数组
    const targetIds = (conv.target_word_ids as number[] | null) ?? [];
    const targetWords = (await getWordsByIds(targetIds)).map((w) => w.term);

    const rows = await all<{ role: string; content: string }>(
      'SELECT role, content, translation_zh FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC',
      [raw.conversationId],
    );
    const setup = rows.find((r) => r.role === 'system');
    const meta = setup
      ? safeJson<{ scenarioZh: string; aiRole: string }>(setup.content, {
          scenarioZh: '自由聊天',
          aiRole: 'a friendly English tutor',
        })
      : { scenarioZh: '自由聊天', aiRole: 'a friendly English tutor' };

    await run(`INSERT INTO chat_messages (conversation_id, role, content) VALUES (?, 'user', ?)`, [
      raw.conversationId,
      raw.text,
    ]);

    const learner: Learner = {
      name: user.name,
      level: user.level,
      goal: user.goal,
      interests: user.interests,
      newWordsPerDay: user.new_words_per_day,
    };
    // 只带最近 12 轮，够维持上下文又不至于每次都塞满
    const history = rows
      .filter((r) => r.role === 'user' || r.role === 'assistant')
      .slice(-12)
      .map((r) => `${r.role === 'user' ? '学生' : '你'}：${r.content}`)
      .join('\n');

    const reply = await generateJson(ChatReplyPayload, {
      system: chatSystemPrompt(learner, meta.aiRole, meta.scenarioZh, targetWords),
      prompt: [
        history ? `之前的对话：\n${history}` : '这是对话的开始。',
        '',
        `学生刚说：${raw.text}`,
        '',
        '请按结构返回你的回应、对他这句话的纠正、他用到的目标词、以及下一句的提示。',
      ].join('\n'),
      maxTokens: 2000,
      temperature: 0.85,
      toolName: 'emit_chat_reply',
    });

    await run(
      `INSERT INTO chat_messages (conversation_id, role, content, translation_zh, feedback, used_words)
       VALUES (?, 'assistant', ?, ?, ?, ?)`,
      [
        raw.conversationId,
        reply.reply_en,
        reply.reply_zh,
        json({ correction: reply.correction, suggestion_en: reply.suggestion_en }),
        json(reply.used_target_words),
      ],
    );

    // 用上了目标词就算一次产出
    const usedIds = await matchWordIds(reply.used_target_words, targetIds);
    if (usedIds.length) {
      await markProduced(user.id, usedIds);
      await bumpDaily(user.id, { produced: usedIds.length });
    }
    if (reply.correction.has_issue) {
      await recordMistake(user.id, {
        kind: 'grammar',
        stage: 'speaking',
        wrong: raw.text,
        correct: reply.correction.corrected_en,
        note: reply.correction.note_zh,
      });
    }

    return { reply, messages: await loadMessages(raw.conversationId) };
  });
}

/** 读一段对话的完整消息（GET ?id=）。 */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await currentUser();
    const url = new URL(req.url);
    const id = Number(url.searchParams.get('id'));
    if (!id) {
      const rows = await all(
        `SELECT c.id, c.title, c.created_at, COUNT(m.id) AS msgs
         FROM conversations c LEFT JOIN chat_messages m
           ON m.conversation_id = c.id AND m.role != 'system'
         WHERE c.user_id = ? GROUP BY c.id ORDER BY c.id DESC LIMIT 30`,
        [user.id],
      );
      return { conversations: rows };
    }
    return { conversationId: id, messages: await loadMessages(id) };
  });
}

async function loadMessages(conversationId: number) {
  const rows = await all<Record<string, unknown>>(
    `SELECT id, role, content, translation_zh, feedback, used_words, created_at
     FROM chat_messages WHERE conversation_id = ? AND role != 'system' ORDER BY id ASC`,
    [conversationId],
  );
  // feedback / used_words 都是 jsonb，驱动已经解析好了
  return rows.map((r) => ({
    id: Number(r.id),
    role: String(r.role) as 'user' | 'assistant',
    content: String(r.content),
    translationZh: (r.translation_zh as string | null) ?? null,
    feedback: (r.feedback as { correction?: unknown; suggestion_en?: string } | null) ?? null,
    usedWords: (r.used_words as string[] | null) ?? [],
  }));
}

async function matchWordIds(terms: string[], candidateIds: number[]): Promise<number[]> {
  if (!terms.length || !candidateIds.length) return [];
  const words = await getWordsByIds(candidateIds);
  const lower = new Set(terms.map((t) => t.toLowerCase().trim()));
  return words.filter((w) => lower.has(w.term.toLowerCase())).map((w) => w.id);
}

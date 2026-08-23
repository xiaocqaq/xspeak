import { z } from 'zod';
import { body, currentUser, handle } from '@/lib/api';
import { generateJson } from '@/lib/ai/client';
import { ChatReplyPayload } from '@/lib/ai/schemas';
import { chatSystemPrompt, type Learner } from '@/lib/ai/prompts';
import { getDb, safeJson } from '@/lib/db';
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
    const user = currentUser();
    const raw = await body(req, z.union([StartBody, SendBody]));
    const db = getDb();

    if (raw.action === 'start') {
      const info = db
        .prepare(
          `INSERT INTO conversations (user_id, session_id, title, theme_slug, target_word_ids)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          user.id,
          raw.sessionId ?? null,
          raw.title,
          raw.themeSlug ?? null,
          JSON.stringify(raw.targetWordIds),
        );
      const conversationId = Number(info.lastInsertRowid);
      // 场景设定存进第一条 system 消息，后续发言时读回来拼 prompt
      db.prepare(
        `INSERT INTO chat_messages (conversation_id, role, content, translation_zh)
         VALUES (?, 'system', ?, ?)`,
      ).run(conversationId, JSON.stringify({ scenarioZh: raw.scenarioZh, aiRole: raw.aiRole }), null);
      if (raw.openingEn) {
        db.prepare(
          `INSERT INTO chat_messages (conversation_id, role, content, translation_zh)
           VALUES (?, 'assistant', ?, ?)`,
        ).run(conversationId, raw.openingEn, raw.openingZh ?? null);
      }
      return { conversationId, messages: loadMessages(conversationId) };
    }

    // action === 'send'
    const conv = db
      .prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
      .get(raw.conversationId, user.id) as Record<string, unknown> | undefined;
    if (!conv) throw new Error('对话不存在');

    const targetIds = safeJson<number[]>(conv.target_word_ids, []);
    const targetWords = getWordsByIds(targetIds).map((w) => w.term);

    const rows = db
      .prepare('SELECT role, content, translation_zh FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC')
      .all(raw.conversationId) as { role: string; content: string }[];
    const setup = rows.find((r) => r.role === 'system');
    const meta = setup
      ? safeJson<{ scenarioZh: string; aiRole: string }>(setup.content, {
          scenarioZh: '自由聊天',
          aiRole: 'a friendly English tutor',
        })
      : { scenarioZh: '自由聊天', aiRole: 'a friendly English tutor' };

    db.prepare(`INSERT INTO chat_messages (conversation_id, role, content) VALUES (?, 'user', ?)`).run(
      raw.conversationId,
      raw.text,
    );

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

    db.prepare(
      `INSERT INTO chat_messages (conversation_id, role, content, translation_zh, feedback, used_words)
       VALUES (?, 'assistant', ?, ?, ?, ?)`,
    ).run(
      raw.conversationId,
      reply.reply_en,
      reply.reply_zh,
      JSON.stringify({ correction: reply.correction, suggestion_en: reply.suggestion_en }),
      JSON.stringify(reply.used_target_words),
    );

    // 用上了目标词就算一次产出
    const usedIds = matchWordIds(reply.used_target_words, targetIds);
    if (usedIds.length) {
      markProduced(user.id, usedIds);
      bumpDaily(user.id, { produced: usedIds.length });
    }
    if (reply.correction.has_issue) {
      recordMistake(user.id, {
        kind: 'grammar',
        stage: 'speaking',
        wrong: raw.text,
        correct: reply.correction.corrected_en,
        note: reply.correction.note_zh,
      });
    }

    return { reply, messages: loadMessages(raw.conversationId) };
  });
}

/** 读一段对话的完整消息（GET ?id=）。 */
export async function GET(req: Request) {
  return handle(async () => {
    const user = currentUser();
    const url = new URL(req.url);
    const id = Number(url.searchParams.get('id'));
    const db = getDb();
    if (!id) {
      const rows = db
        .prepare(
          `SELECT c.id, c.title, c.created_at, COUNT(m.id) AS msgs
           FROM conversations c LEFT JOIN chat_messages m
             ON m.conversation_id = c.id AND m.role != 'system'
           WHERE c.user_id = ? GROUP BY c.id ORDER BY c.id DESC LIMIT 30`,
        )
        .all(user.id);
      return { conversations: rows };
    }
    return { conversationId: id, messages: loadMessages(id) };
  });
}

function loadMessages(conversationId: number) {
  const rows = getDb()
    .prepare(
      `SELECT id, role, content, translation_zh, feedback, used_words, created_at
       FROM chat_messages WHERE conversation_id = ? AND role != 'system' ORDER BY id ASC`,
    )
    .all(conversationId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    role: String(r.role) as 'user' | 'assistant',
    content: String(r.content),
    translationZh: (r.translation_zh as string | null) ?? null,
    feedback: safeJson<{ correction?: unknown; suggestion_en?: string } | null>(r.feedback, null),
    usedWords: safeJson<string[]>(r.used_words, []),
  }));
}

function matchWordIds(terms: string[], candidateIds: number[]): number[] {
  if (!terms.length || !candidateIds.length) return [];
  const words = getWordsByIds(candidateIds);
  const lower = new Set(terms.map((t) => t.toLowerCase().trim()));
  return words.filter((w) => lower.has(w.term.toLowerCase())).map((w) => w.id);
}

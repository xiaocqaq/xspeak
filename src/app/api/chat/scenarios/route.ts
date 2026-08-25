import { z } from 'zod';
import { body, currentUser, handle } from '@/lib/api';
import { generateJson } from '@/lib/ai/client';
import { ScenariosPayload } from '@/lib/ai/schemas';
import { scenariosPrompt, type Learner } from '@/lib/ai/prompts';
import { getOrCreateToday } from '@/lib/repo/session';
import { getWordsByIds } from '@/lib/repo/words';
import { getGrammarById } from '@/lib/repo/grammar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  /** 用户自己写的话题；留空表示「换一批」，由 AI 按今日内容自由发挥 */
  wish: z.string().max(120).default(''),
  /** 已经出现过的场景名，避免换一批换出重复的 */
  avoid: z.array(z.string().max(40)).max(24).default([]),
  count: z.number().int().min(1).max(6).default(4),
});

/**
 * 生成 AI 对话的练习场景。
 *
 * 和写死的预设场景相比，多做了一件关键的事：把今天 session 的目标词绑到场景上，
 * 并把词的 id 一并返回。前端拿着 targetWordIds 去开对话，说出口的词才能计进
 * produced_count —— 之前 AI 对话页传的是空数组，在这里聊多久都不算「用出来了」。
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await currentUser();
    const input = await body(req, Body);
    const session = await getOrCreateToday(user);

    const [targetWords, grammar] = await Promise.all([
      getWordsByIds(session.target_word_ids),
      session.grammar_ids[0] ? getGrammarById(session.grammar_ids[0]) : null,
    ]);

    const learner: Learner = {
      name: user.name,
      level: user.level,
      goal: user.goal,
      interests: user.interests,
      newWordsPerDay: user.new_words_per_day,
    };

    const wish = input.wish.trim();
    const out = await generateJson(ScenariosPayload, {
      system: scenariosPrompt(learner, {
        count: input.count,
        themeZh: session.theme_zh,
        targetWords: targetWords.map((w) => ({ term: w.term, meaning_zh: w.meaning_zh })),
        grammarZh: grammar?.title_zh ?? null,
        wish,
        avoid: input.avoid,
      }),
      prompt: wish
        ? `学生想练的话题：「${wish}」。请按结构返回 ${input.count} 个围绕它展开的场景。`
        : `请按结构返回 ${input.count} 个场景。`,
      maxTokens: 2500,
      // 场景要多样，温度给高一点；换一批换出雷同的东西没意义
      temperature: 0.95,
      toolName: 'emit_scenarios',
    });

    // AI 挑的目标词要映射回 id 才能落库计数。它偶尔会写变形或凭空造词，
    // 对不上的直接丢掉 —— 宁可少算一个，也不要把不存在的 id 塞进对话。
    const byTerm = new Map(targetWords.map((w) => [w.term.toLowerCase(), w]));
    const scenarios = out.scenarios.map((s) => {
      const matched = s.target_terms
        .map((t) => byTerm.get(t.toLowerCase().trim()))
        .filter((w): w is NonNullable<typeof w> => Boolean(w));
      return {
        zh: s.zh,
        hint: s.hint,
        aiRole: s.ai_role,
        openingEn: s.opening_en,
        openingZh: s.opening_zh,
        targetTerms: matched.map((w) => w.term),
        targetWordIds: matched.map((w) => w.id),
      };
    });

    return {
      scenarios,
      themeZh: session.theme_zh,
      sessionId: session.id,
      themeSlug: session.theme_slug,
    };
  });
}

import { generateJson } from '@/lib/ai/client';
import * as P from '@/lib/ai/prompts';
import * as S from '@/lib/ai/schemas';
import { getGrammarById } from '@/lib/repo/grammar';
import { recentMistakes } from '@/lib/repo/mistakes';
import {
  addAiWordsToSession,
  getSessionById,
  getStageContent,
  saveStageContent,
} from '@/lib/repo/session';
import { getWordsByIds } from '@/lib/repo/words';
import { all } from '@/lib/db';
import type { SessionRow, Stage, UserProfile, WordRow } from '@/lib/types';

function learnerOf(u: UserProfile): P.Learner {
  return {
    name: u.name,
    level: u.level,
    goal: u.goal,
    interests: u.interests,
    newWordsPerDay: u.new_words_per_day,
  };
}

async function ctxOf(u: UserProfile, s: SessionRow): Promise<P.Ctx> {
  return {
    themeZh: s.theme_zh,
    themeEn: s.theme_en,
    learner: learnerOf(u),
    mistakes: await recentMistakes(u.id, 8),
  };
}

/** 目标词的展示信息（供前端渲染卡片）。 */
export function targetWordsOf(s: SessionRow): Promise<WordRow[]> {
  return getWordsByIds(s.target_word_ids);
}

async function termsOf(s: SessionRow): Promise<string[]> {
  const words = await targetWordsOf(s);
  return words.map((w) => w.term);
}

/**
 * 生成（或取缓存）某个环节的内容。
 * 缓存键是 session + stage，所以同一天刷新页面不会重复调 AI。
 * regenerate=true 时强制重新生成（前端"换一批"按钮用）。
 */
export async function buildStage(
  user: UserProfile,
  session: SessionRow,
  stage: Stage,
  regenerate = false,
): Promise<{ payload: unknown; meta: Record<string, unknown> }> {
  if (!regenerate) {
    const cached = await getStageContent<unknown>(session.id, stage);
    if (cached) return { payload: cached, meta: await metaFor(session, stage) };

    // 前端会预取下一个环节，用户手快时可能同时来两个请求。
    // 没有这层去重就会重复调一次 AI（白花钱，还可能重复写库）。
    const key = `${session.id}:${stage}`;
    const running = inFlight.get(key);
    if (running) return running;
    const p = generateStage(user, session, stage).finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  }
  // "换一批"总是重新生成，不参与去重
  return generateStage(user, session, stage);
}

/** 同一个 session+stage 正在生成中的请求，用于合并并发请求 */
const inFlight = new Map<string, Promise<{ payload: unknown; meta: Record<string, unknown> }>>();

async function generateStage(
  user: UserProfile,
  session: SessionRow,
  stage: Stage,
): Promise<{ payload: unknown; meta: Record<string, unknown> }> {

  const ctx = await ctxOf(user, session);
  const learner = learnerOf(user);
  let payload: unknown;

  switch (stage) {
    case 'warmup': {
      const words = await getWordsByIds(session.review_word_ids);
      if (!words.length) {
        // 第一天没有可复习的内容，给一个明确的空态而不是硬造题
        payload = { intro_zh: '今天还没有到期的复习内容，直接从新词开始吧。', items: [] };
        break;
      }
      const seenRows = await all<{ word_id: number; seen_contexts: string[] | null }>(
        'SELECT word_id, seen_contexts FROM user_words WHERE user_id = ? AND word_id = ANY(?::int[])',
        [user.id, words.map((w) => w.id)],
      );
      const seenMap = new Map(seenRows.map((r) => [r.word_id, r.seen_contexts ?? []]));
      const withSeen = words.map((w) => ({
        term: w.term,
        meaning_zh: w.meaning_zh,
        seen: seenMap.get(w.id) ?? [],
      }));
      payload = await generateJson(S.WarmupPayload, {
        system: P.systemPrompt(learner),
        prompt: P.warmupPrompt(ctx, withSeen),
        maxTokens: 6000,
        toolName: 'emit_warmup',
      });
      break;
    }

    case 'newwords': {
      const existing = await targetWordsOf(session);
      const need = Math.max(0, user.new_words_per_day - existing.length);
      if (need > 0) {
        // 内置词表在这个主题下不够用，让 AI 按主题和水平补齐
        const known = await all<{ term: string }>(
          `SELECT w.term FROM user_words uw JOIN words w ON w.id = uw.word_id
           WHERE uw.user_id = ? ORDER BY uw.created_at DESC LIMIT 80`,
          [user.id],
        );
        const gen = await generateJson(S.NewWordsPayload, {
          system: P.systemPrompt(learner),
          prompt: P.newWordsPrompt(ctx, known.map((k) => k.term), need),
          maxTokens: 6000,
          toolName: 'emit_new_words',
        });
        await addAiWordsToSession(session.id, session.theme_slug, gen.words, user.level);
        const refreshed = (await getSessionById(session.id))!;
        const all_ = await getWordsByIds(refreshed.target_word_ids);
        // 把库里已有的词也补上记忆抓手，前端展示统一
        const hookMap = new Map(gen.words.map((w) => [w.term.toLowerCase(), w]));
        payload = {
          intro_zh: gen.intro_zh,
          words: all_.map((w) => {
            const ai = hookMap.get(w.term.toLowerCase());
            return {
              id: w.id,
              term: w.term,
              phonetic: ai?.phonetic ?? w.phonetic ?? '',
              pos: ai?.pos ?? w.pos ?? '',
              meaning_zh: w.meaning_zh,
              meaning_en: ai?.meaning_en ?? w.meaning_en ?? '',
              example_en: ai?.example_en ?? w.example_en ?? '',
              example_zh: ai?.example_zh ?? w.example_zh ?? '',
              memory_hook_zh: ai?.memory_hook_zh ?? '',
              collocations: ai?.collocations ?? [],
            };
          }),
        };
      } else {
        // 库里够用：只需要给这批词补记忆抓手和贴合主题的例句
        const gen = await generateJson(S.NewWordsPayload, {
          system: P.systemPrompt(learner),
          prompt: [
            P.newWordsPrompt(ctx, [], existing.length),
            '',
            `注意：必须严格使用下面这批词，不要替换、不要增减：${existing.map((w) => w.term).join(', ')}`,
          ].join('\n'),
          maxTokens: 6000,
          toolName: 'emit_new_words',
        });
        const aiMap = new Map(gen.words.map((w) => [w.term.toLowerCase(), w]));
        payload = {
          intro_zh: gen.intro_zh,
          words: existing.map((w) => {
            const ai = aiMap.get(w.term.toLowerCase());
            return {
              id: w.id,
              term: w.term,
              phonetic: ai?.phonetic ?? w.phonetic ?? '',
              pos: ai?.pos ?? w.pos ?? '',
              meaning_zh: w.meaning_zh,
              meaning_en: ai?.meaning_en ?? w.meaning_en ?? '',
              example_en: ai?.example_en ?? w.example_en ?? '',
              example_zh: ai?.example_zh ?? w.example_zh ?? '',
              memory_hook_zh: ai?.memory_hook_zh ?? '',
              collocations: ai?.collocations ?? [],
            };
          }),
        };
      }
      break;
    }

    case 'grammar': {
      const gid = session.grammar_ids[0];
      const point = gid ? await getGrammarById(gid) : null;
      if (!point) {
        payload = { focus_zh: '语法点已经全部学过一轮了，换个日子会重新考。', mini_lesson_zh: '', examples: [], exercises: [] };
        break;
      }
      payload = {
        point: {
          id: point.id,
          title_zh: point.title_zh,
          title_en: point.title_en,
          pattern: point.pattern,
          pitfalls: point.pitfalls,
        },
        ...(await generateJson(S.GrammarPayload, {
          system: P.systemPrompt(learner),
          prompt: P.grammarPrompt(ctx, point, await termsOf(session)),
          maxTokens: 6000,
          toolName: 'emit_grammar',
        })),
      };
      break;
    }

    case 'listening':
      payload = await generateJson(S.ListeningPayload, {
        system: P.systemPrompt(learner),
        prompt: P.listeningPrompt(ctx, await termsOf(session)),
        maxTokens: 6000,
        toolName: 'emit_listening',
      });
      break;

    case 'reading':
      payload = await generateJson(S.ReadingPayload, {
        system: P.systemPrompt(learner),
        prompt: P.readingPrompt(ctx, await termsOf(session)),
        maxTokens: 6000,
        toolName: 'emit_reading',
      });
      break;

    case 'speaking':
      payload = await generateJson(S.SpeakingPayload, {
        system: P.systemPrompt(learner),
        prompt: P.speakingPrompt(ctx, await termsOf(session)),
        maxTokens: 4000,
        toolName: 'emit_speaking',
      });
      break;

    case 'writing':
      payload = await generateJson(S.WritingPayload, {
        system: P.systemPrompt(learner),
        prompt: P.writingPrompt(ctx, await termsOf(session)),
        maxTokens: 4000,
        toolName: 'emit_writing',
      });
      break;
  }

  await saveStageContent(session.id, stage, payload);
  return { payload, meta: await metaFor((await getSessionById(session.id)) ?? session, stage) };
}

async function metaFor(session: SessionRow, stage: Stage): Promise<Record<string, unknown>> {
  const words = await targetWordsOf(session);
  return {
    stage,
    sessionId: session.id,
    themeZh: session.theme_zh,
    themeEn: session.theme_en,
    stagesDone: session.stages_done,
    targetWords: words.map((w) => ({
      id: w.id,
      term: w.term,
      meaning_zh: w.meaning_zh,
      phonetic: w.phonetic,
    })),
  };
}

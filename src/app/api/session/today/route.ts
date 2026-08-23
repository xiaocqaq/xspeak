import { currentUser, handle } from '@/lib/api';
import { getOrCreateToday } from '@/lib/repo/session';
import { getWordsByIds } from '@/lib/repo/words';
import { getGrammarById } from '@/lib/repo/grammar';
import { getSummary } from '@/lib/repo/stats';
import { STAGES } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 今天的学习计划总览。首页和学习页都用它开局。 */
export async function GET() {
  return handle(async () => {
    const user = await currentUser();
    const s = await getOrCreateToday(user);
    const [grammar, reviewWords, targetWords, stats] = await Promise.all([
      s.grammar_ids[0] ? getGrammarById(s.grammar_ids[0]) : null,
      getWordsByIds(s.review_word_ids),
      getWordsByIds(s.target_word_ids),
      getSummary(user.id),
    ]);
    return {
      session: {
        id: s.id,
        day: s.day,
        themeSlug: s.theme_slug,
        themeZh: s.theme_zh,
        themeEn: s.theme_en,
        stageIndex: s.stage_index,
        stagesDone: s.stages_done,
        minutesSpent: s.minutes_spent,
        completedAt: s.completed_at,
        stages: STAGES,
      },
      reviewWords: reviewWords.map((w) => ({
        id: w.id,
        term: w.term,
        meaning_zh: w.meaning_zh,
      })),
      targetWords: targetWords.map((w) => ({
        id: w.id,
        term: w.term,
        meaning_zh: w.meaning_zh,
        phonetic: w.phonetic,
      })),
      grammar: grammar
        ? { id: grammar.id, title_zh: grammar.title_zh, title_en: grammar.title_en, cefr: grammar.cefr }
        : null,
      stats,
      user: {
        name: user.name,
        level: user.level,
        goal: user.goal,
        interests: user.interests,
        dailyMinutes: user.daily_minutes,
        newWordsPerDay: user.new_words_per_day,
        onboarded: Boolean(user.onboarded),
        voice: user.voice,
      },
    };
  });
}

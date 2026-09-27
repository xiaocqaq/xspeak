import { after } from 'next/server';
import { currentUser, handle } from '@/lib/api';
import { getOrCreateToday, startNextTheme } from '@/lib/repo/session';
import { getWordsByIds } from '@/lib/repo/words';
import { getGrammarById } from '@/lib/repo/grammar';
import { getSummary } from '@/lib/repo/stats';
import { prewarmNewWords } from '@/lib/stage';
import { missingStages, prefillUserSpeech } from '@/lib/stage-prefill';
import { STAGES, type SessionRow, type UserProfile } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 进门兜底：凌晨 cron（prefresh）没覆盖到这个用户的场景 —— 新用户、
 * 超 48h 回归、昨晚 cron 失败 —— 在这里补上同样的「六环内容 + TTS 音频
 * 预生成」。用户走到各环节时直接命中当日缓存和 TTS 磁盘缓存，不用现场等 AI。
 *
 * 放 after() 里：响应先走，预取在后台慢慢跑（一次 AI 生成 20~40s +
 * TTS 合成几秒，用户从首页点进第一环正好来得及）。
 *
 * missingStages 只返回还没有内容的环节：cron 已经跑过的用户这里是空数组，
 * 一次 AI 调用都不补发（幂等，进门零浪费）。TTS 音频是按句查磁盘缓存的
 * （prefillTts 先 readCache），已合成过的句子自动跳过。
 *
 * 2026-08-28 多主题/天：GET 和 POST（进入下一个主题）共用这段 ——
 * 新开的主题同样吃兜底，不然点「下一个主题」进去还要现场等 AI。
 *
 * TTS 预合成只有云端 MiMo 一家（2026-09-09 起，自建 Kokoro 整条下线）：
 * 这两条路都是「用户已经在屏幕前了」——「进门发现凌晨 cron 没覆盖到」和
 * 「刚点了下一个主题」。cron（prefresh）与这里的兜底走同一套 MiMo 音色、
 * 与播放请求共用同一份磁盘缓存，等用户点到那一句基本必中。
 */
function backfillAfter(user: UserProfile, s: SessionRow) {
  after(async () => {
    try {
      await prewarmNewWords(user, s);
      const missing = await missingStages(s);
      if (missing.length) {
        console.log(`[prefill] 用户 ${user.id} 进门兜底：补 ${missing.join('/')}（TTS 走 MiMo 快路）`);
        await prefillUserSpeech(user, s, missing);
      }
    } catch (err) {
      console.warn('[prefill] 进门兜底失败（用户走到环节时会现场生成）：', (err as Error).message);
    }
  });
}

/** 今日计划总览的响应体。GET 和 POST 返回同一形状，首页不用区分。 */
async function todayPayload(user: UserProfile, s: SessionRow) {
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
      aiVoice: user.ai_voice,
      speechPace: user.speech_pace,
    },
  };
}

/** 今天的学习计划总览。首页和学习页都用它开局。 */
export async function GET() {
  return handle(async () => {
    const user = await currentUser();
    const s = await getOrCreateToday(user);
    backfillAfter(user, s);
    return todayPayload(user, s);
  });
}

/**
 * 进入下一个主题（2026-08-28）：当前 session 标记完成入历史（哪怕一个
 * 环节都没走），立刻组装新主题返回。一天可以连开多个主题；已完成的
 * session 不占「每天一条未完成」的坑。
 */
export async function POST() {
  return handle(async () => {
    const user = await currentUser();
    const s = await startNextTheme(user);
    backfillAfter(user, s);
    return todayPayload(user, s);
  });
}

import type { Stage } from '@/lib/types';

export type StageMeta = {
  stage: Stage;
  sessionId: number;
  themeZh: string;
  themeEn: string;
  stagesDone: Stage[];
  /** 2026-08-28：热身用 —— 到期复习词的 id 映射（FSRS 记账靠它）+ 释义单选题面 */
  reviewWords?: {
    id: number;
    term: string;
    meaning_zh: string;
    phonetic: string | null;
    pos?: string | null;
  }[];
  targetWords: { id: number; term: string; meaning_zh: string; phonetic: string | null }[];
};

/** 提交给 /api/review 的内容。各环节按自己产生的数据填一部分。 */
export type ReviewBody = {
  words?: { wordId: number; rating: 1 | 2 | 3 | 4; mode?: string; elapsedMs?: number; context?: string }[];
  grammar?: { grammarId: number; rating: 1 | 2 | 3 | 4; wrongCount?: number }[];
  produced?: number[];
  enroll?: number[];
  mistakes?: {
    kind: 'grammar' | 'word_choice' | 'spelling' | 'style' | 'pronunciation' | 'listening' | 'reading';
    stage?: string;
    wordId?: number | null;
    grammarId?: number | null;
    wrong: string;
    correct?: string | null;
    note?: string | null;
  }[];
  speech?: { target: string; transcript: string; sessionId?: number | null }[];
  spokenSeconds?: number;
};

export type StageProps<T> = {
  payload: T;
  meta: StageMeta;
  /** 环节做完：把学习数据交上去并进入下一环节。 */
  onDone: (review?: ReviewBody) => void;
  /**
   * 换一批内容。只有新词环节会用 —— 它换词是从词典按 CEFR 等级+词频取，
   * 零 token、几十毫秒，随便换。其余环节换一批都是重新调一次 AI（十几秒、
   * 几千 token），给个随手可点的入口只会让人白花钱，所以那些环节不给。
   * 内容真出错了走 ErrorNote 上的重试，不需要这个。
   */
  onRegenerate: () => void;
  submitting: boolean;
};

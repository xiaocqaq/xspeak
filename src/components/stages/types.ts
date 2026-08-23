import type { Stage } from '@/lib/types';

export type StageMeta = {
  stage: Stage;
  sessionId: number;
  themeZh: string;
  themeEn: string;
  stagesDone: Stage[];
  targetWords: { id: number; term: string; meaning_zh: string; phonetic: string | null }[];
};

/** 提交给 /api/review 的内容。各环节按自己产生的数据填一部分。 */
export type ReviewBody = {
  words?: { wordId: number; rating: 1 | 2 | 3 | 4; mode?: string; elapsedMs?: number; context?: string }[];
  grammar?: { grammarId: number; rating: 1 | 2 | 3 | 4; wrongCount?: number }[];
  produced?: number[];
  enroll?: number[];
  mistakes?: {
    kind: 'grammar' | 'word_choice' | 'spelling' | 'style' | 'pronunciation' | 'listening';
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
  /** 换一批内容（重新调 AI）。 */
  onRegenerate: () => void;
  submitting: boolean;
};

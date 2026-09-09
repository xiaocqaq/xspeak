/** 全站共用的领域类型。 */

/*
 * 顺序就是每天走的顺序，最后一个环节走完算今天完成。
 * 原来末尾还有一个 writing（写作批改），已经整条去掉 ——
 * 手机上打一段英文的成本太高，实际没人在这一步停下来写，
 * 收尾改由 speaking 承担。
 */
export const STAGES = [
  'warmup',
  'newwords',
  'grammar',
  'listening',
  'reading',
  'speaking',
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_META: Record<Stage, { zh: string; en: string; minutes: number; icon: string }> = {
  warmup: { zh: '热身复习', en: 'Warm-up', minutes: 5, icon: 'flame' },
  newwords: { zh: '新词', en: 'New words', minutes: 6, icon: 'sparkles' },
  grammar: { zh: '语法', en: 'Grammar', minutes: 5, icon: 'ruler' },
  listening: { zh: '听力', en: 'Listening', minutes: 4, icon: 'headphones' },
  reading: { zh: '阅读', en: 'Reading', minutes: 4, icon: 'book-open' },
  speaking: { zh: '口语', en: 'Speaking', minutes: 6, icon: 'mic' },
};

export type SpeechPace = 'slow' | 'normal' | 'fast';

export type UserProfile = {
  id: number;
  name: string;
  level: string;
  goal: string;
  interests: string[];
  daily_minutes: number;
  new_words_per_day: number;
  /** 逐句朗读音色偏好：'mimo:xx' = 云端 MiMo 音色；浏览器语音包名 = 系统本地嗓音 */
  voice: string | null;
  /** StepFun realtime 的音色 id，给畅聊用。和 voice 不通用 */
  ai_voice: string | null;
  speech_pace: SpeechPace;
  onboarded: number;
};

export type WordRow = {
  id: number;
  term: string;
  phonetic: string | null;
  pos: string | null;
  meaning_zh: string;
  meaning_en: string | null;
  cefr: string;
  theme: string | null;
  example_en: string | null;
  example_zh: string | null;
  /** seed=内置词表 dict=离线词典 ai=AI 生成 lookup=查词时落库 */
  source: string;
  /** 记忆抓手。一个词只问 AI 一次，之后从库里读 */
  memory_hook_zh: string | null;
  collocations: string[];
  /** ECDICT 词频排名，越小越常用；0 表示未知 */
  frq: number;
};

export type UserWordRow = {
  word_id: number;
  state: number;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  last_review: string | null;
  produced_count: number;
  seen_contexts: string[];
  starred: number;
};

export type VocabEntry = WordRow & {
  progress: UserWordRow | null;
};

export type GrammarRow = {
  id: number;
  slug: string;
  title_zh: string;
  title_en: string;
  cefr: string;
  explain_zh: string;
  pattern: string | null;
  examples: { en: string; zh: string }[];
  pitfalls: string[];
  ord: number;
};

export type SessionRow = {
  id: number;
  user_id: number;
  day: string;
  theme_slug: string;
  theme_zh: string;
  theme_en: string;
  target_word_ids: number[];
  review_word_ids: number[];
  grammar_ids: number[];
  stage_index: number;
  stages_done: Stage[];
  minutes_spent: number;
  completed_at: string | null;
};

export type MistakeRow = {
  id: number;
  kind: string;
  stage: string | null;
  wrong: string;
  correct: string | null;
  note_zh: string | null;
  times: number;
  resolved: number;
  created_at: string;
};

/**
 * 一个可以点进去开聊的场景。
 *
 * 和 StartConfig 一样放在这里：生成它的路由、展示它的对话页、把它缓存下来的
 * scenario-store 三边互不相识，谁 import 谁都会牵出多余的依赖。
 */
export type ChatScenario = {
  zh: string;
  hint: string;
  aiRole: string;
  openingEn: string;
  openingZh: string;
  /** 这个场景绑定的今日目标词，展示用 */
  targetTerms: string[];
  /** 对应的词 id，开对话时带上，说出口才算 produced */
  targetWordIds: number[];
};

/**
 * 开一段对话需要的全部信息。
 *
 * 放在这里而不是某个组件里：产生它的地方（对话页挑场景、口语环节、首页）
 * 和消费它的地方（通话启动器）互不相识，让其中一方去 import 另一方的组件
 * 只是为了拿个类型，反过来会把组件也一起拖进依赖图。
 */
export type StartConfig = {
  title: string;
  themeSlug?: string | null;
  scenarioZh: string;
  aiRole: string;
  openingEn?: string | null;
  openingZh?: string | null;
  targetWordIds?: number[];
  /**
   * 目标词原文。
   *
   * 和 targetWordIds 并存不是冗余：id 用来落库和判定 produced_count，
   * 而通话的 instructions 需要的是词本身 —— 中转层不查库，拿不到 id 对应的词。
   */
  targetTerms?: string[];
  sessionId?: number | null;
};

export type StatsSummary = {
  streak: number;
  totalWords: number;
  learningWords: number;
  matureWords: number;
  dueToday: number;
  reviewsToday: number;
  accuracyToday: number | null;
  producedToday: number;
  minutesToday: number;
  last14: { day: string; reviews: number; correct: number; minutes: number; new_words: number }[];
  retention30: number | null;
  openMistakes: number;
  grammarLearned: number;
};

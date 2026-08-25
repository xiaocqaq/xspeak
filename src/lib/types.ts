/** 全站共用的领域类型。 */

export const STAGES = [
  'warmup',
  'newwords',
  'grammar',
  'listening',
  'reading',
  'speaking',
  'writing',
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_META: Record<Stage, { zh: string; en: string; minutes: number; icon: string }> = {
  warmup: { zh: '热身复习', en: 'Warm-up', minutes: 5, icon: 'flame' },
  newwords: { zh: '新词', en: 'New words', minutes: 6, icon: 'sparkles' },
  grammar: { zh: '语法', en: 'Grammar', minutes: 5, icon: 'ruler' },
  listening: { zh: '听力', en: 'Listening', minutes: 4, icon: 'headphones' },
  reading: { zh: '阅读', en: 'Reading', minutes: 4, icon: 'book-open' },
  speaking: { zh: '口语', en: 'Speaking', minutes: 4, icon: 'mic' },
  writing: { zh: '写作', en: 'Writing', minutes: 2, icon: 'pen-line' },
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
  /** 浏览器 Web Speech 的语音包名字，给逐句朗读用 */
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
  source: string;
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

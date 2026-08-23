/**
 * SQLite 表结构。所有语句都是幂等的，进程启动时顺序执行一遍即可建库。
 * FSRS 相关字段（state/due/stability/difficulty/...）直接对应 ts-fsrs 的 Card 结构，
 * 单词和语法点各存一份，这样两者都能走同一套间隔重复调度。
 */
export const PRAGMAS = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA foreign_keys = ON',
  'PRAGMA busy_timeout = 5000',
];

export const DDL: string[] = [];

DDL.push(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '学习者',
  level TEXT NOT NULL DEFAULT 'A1',
  goal TEXT NOT NULL DEFAULT 'daily_talk',
  interests TEXT NOT NULL DEFAULT '[]',
  daily_minutes INTEGER NOT NULL DEFAULT 30,
  new_words_per_day INTEGER NOT NULL DEFAULT 8,
  voice TEXT,
  onboarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

DDL.push(`CREATE TABLE IF NOT EXISTS words (
  id INTEGER PRIMARY KEY,
  term TEXT NOT NULL UNIQUE,
  phonetic TEXT,
  pos TEXT,
  meaning_zh TEXT NOT NULL,
  meaning_en TEXT,
  cefr TEXT NOT NULL DEFAULT 'A1',
  theme TEXT,
  example_en TEXT,
  example_zh TEXT,
  source TEXT NOT NULL DEFAULT 'seed',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

DDL.push(`CREATE INDEX IF NOT EXISTS idx_words_theme ON words(theme)`);
DDL.push(`CREATE INDEX IF NOT EXISTS idx_words_cefr ON words(cefr)`);

// user_words：每个词的掌握状态。produced_count 记录"你主动说/写出来过几次"，
// 这是本站和普通背单词 app 的关键差别：只认得不算掌握。
DDL.push(`CREATE TABLE IF NOT EXISTS user_words (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  state INTEGER NOT NULL DEFAULT 0,
  due TEXT NOT NULL DEFAULT (datetime('now')),
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  elapsed_days REAL NOT NULL DEFAULT 0,
  scheduled_days REAL NOT NULL DEFAULT 0,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  last_review TEXT,
  produced_count INTEGER NOT NULL DEFAULT 0,
  seen_contexts TEXT NOT NULL DEFAULT '[]',
  starred INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, word_id)
)`);
DDL.push(`CREATE INDEX IF NOT EXISTS idx_uw_due ON user_words(user_id, due)`);
DDL.push(`CREATE INDEX IF NOT EXISTS idx_uw_state ON user_words(user_id, state)`);

DDL.push(`CREATE TABLE IF NOT EXISTS grammar_points (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title_zh TEXT NOT NULL,
  title_en TEXT NOT NULL,
  cefr TEXT NOT NULL DEFAULT 'A1',
  explain_zh TEXT NOT NULL,
  pattern TEXT,
  examples TEXT NOT NULL DEFAULT '[]',
  pitfalls TEXT NOT NULL DEFAULT '[]',
  ord INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'seed'
)`);

DDL.push(`CREATE TABLE IF NOT EXISTS user_grammar (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grammar_id INTEGER NOT NULL REFERENCES grammar_points(id) ON DELETE CASCADE,
  state INTEGER NOT NULL DEFAULT 0,
  due TEXT NOT NULL DEFAULT (datetime('now')),
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  elapsed_days REAL NOT NULL DEFAULT 0,
  scheduled_days REAL NOT NULL DEFAULT 0,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  last_review TEXT,
  error_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, grammar_id)
)`);
DDL.push(`CREATE INDEX IF NOT EXISTS idx_ug_due ON user_grammar(user_id, due)`);

DDL.push(`CREATE TABLE IF NOT EXISTS review_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  rating INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT 'recall',
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  reviewed_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
DDL.push(`CREATE INDEX IF NOT EXISTS idx_rl_user_time ON review_logs(user_id, reviewed_at)`);

DDL.push(`CREATE TABLE IF NOT EXISTS themes (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  zh TEXT NOT NULL,
  en TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  last_used_on TEXT
)`);

// 一天一条 session。stage_index 记录进行到第几环节，刷新页面能原地续上。
DDL.push(`CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  theme_slug TEXT NOT NULL,
  theme_zh TEXT NOT NULL,
  theme_en TEXT NOT NULL,
  target_word_ids TEXT NOT NULL DEFAULT '[]',
  review_word_ids TEXT NOT NULL DEFAULT '[]',
  grammar_ids TEXT NOT NULL DEFAULT '[]',
  stage_index INTEGER NOT NULL DEFAULT 0,
  stages_done TEXT NOT NULL DEFAULT '[]',
  minutes_spent REAL NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, day)
)`);

// AI 生成的环节内容缓存：同一天同一环节只生成一次，刷新不重复扣 token。
DDL.push(`CREATE TABLE IF NOT EXISTS stage_content (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, stage)
)`);

// 错误档案：拼写/语法/发音/用词错误全部落这里，明天的例句和语法点会针对性复现。
DDL.push(`CREATE TABLE IF NOT EXISTS mistakes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  stage TEXT,
  word_id INTEGER,
  grammar_id INTEGER,
  wrong TEXT NOT NULL,
  correct TEXT,
  note_zh TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  times INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
DDL.push(`CREATE INDEX IF NOT EXISTS idx_mistakes_user ON mistakes(user_id, resolved, created_at)`);

DDL.push(`CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id INTEGER,
  title TEXT NOT NULL DEFAULT '自由对话',
  theme_slug TEXT,
  target_word_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')))`);

DDL.push(`CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  translation_zh TEXT,
  feedback TEXT,
  used_words TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
DDL.push(`CREATE INDEX IF NOT EXISTS idx_msg_conv ON chat_messages(conversation_id, id)`);

DDL.push(`CREATE TABLE IF NOT EXISTS writings (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id INTEGER,
  prompt_en TEXT NOT NULL,
  prompt_zh TEXT,
  text TEXT NOT NULL,
  corrected TEXT,
  score INTEGER,
  feedback TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

DDL.push(`CREATE TABLE IF NOT EXISTS speech_attempts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id INTEGER,
  target TEXT NOT NULL,
  transcript TEXT NOT NULL,
  score INTEGER NOT NULL,
  detail TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

// 你自己扔进来的素材（文章/字幕/技术文档），AI 从里面抽词和语法点。
DDL.push(`CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'article',
  raw TEXT NOT NULL,
  summary_zh TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  extracted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

DDL.push(`CREATE TABLE IF NOT EXISTS daily_stats (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  reviews INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  new_words INTEGER NOT NULL DEFAULT 0,
  produced INTEGER NOT NULL DEFAULT 0,
  spoken_seconds INTEGER NOT NULL DEFAULT 0,
  minutes REAL NOT NULL DEFAULT 0,
  UNIQUE(user_id, day)
)`);
DDL.push(`CREATE INDEX IF NOT EXISTS idx_ds_user_day ON daily_stats(user_id, day)`);


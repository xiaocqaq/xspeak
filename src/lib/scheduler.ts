import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs';

/**
 * FSRS 调度封装。单词和语法点共用同一套逻辑，只是存在不同表里。
 *
 * request_retention 0.9 = 目标记忆保持率 90%：复习会安排得比默认更密一点，
 * 对"背了就忘"的情况更稳。enable_fuzz 打开可以避免所有词挤在同一天到期。
 */
const params = generatorParameters({
  request_retention: 0.9,
  enable_fuzz: true,
  enable_short_term: true,
});

export const scheduler = fsrs(params);
export { Rating, State };

/** 数据库行 → ts-fsrs Card */
export type CardRow = {
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
};

export function rowToCard(row: CardRow): Card {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

export function cardToRow(card: Card): CardRow {
  return {
    state: card.state,
    due: toSql(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    last_review: card.last_review ? toSql(card.last_review) : null,
  };
}

export function emptyCardRow(now = new Date()): CardRow {
  return cardToRow(createEmptyCard(now));
}

/**
 * 评分后算出新的卡片状态。rating: 1=完全忘了 2=有点难 3=记得 4=很轻松
 * 1-4 正好对应 ts-fsrs 的 Grade（Rating 里排除 Manual=0 的那四个）。
 */
export function applyRating(row: CardRow, rating: 1 | 2 | 3 | 4, now = new Date()): CardRow {
  const result = scheduler.next(rowToCard(row), now, rating as Grade);
  return cardToRow(result.card);
}

/**
 * SQLite 里统一存 'YYYY-MM-DD HH:MM:SS' 的 UTC 字符串，
 * 这样能直接和 datetime('now') 比较大小。
 */
export function toSql(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function nowSql(): string {
  return toSql(new Date());
}

/** 本地日期（按服务器时区）'YYYY-MM-DD'，用于按天分组统计和每日 session。 */
export function localDay(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 给复习界面展示：四个评分各自对应多久后再见 */
export function previewIntervals(row: CardRow, now = new Date()): Record<number, string> {
  const out: Record<number, string> = {};
  const scheduled = scheduler.repeat(rowToCard(row), now);
  for (const r of [1, 2, 3, 4] as const) {
    const card = scheduled[r as Grade]?.card;
    if (!card) continue;
    out[r] = humanizeUntil(card.due, now);
  }
  return out;
}

function humanizeUntil(due: Date, now: Date): string {
  const mins = Math.round((due.getTime() - now.getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} 分钟`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.round(hours)} 小时`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)} 天`;
  const months = days / 30;
  if (months < 12) return `${months.toFixed(1)} 个月`;
  return `${(days / 365).toFixed(1)} 年`;
}

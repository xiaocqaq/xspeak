import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DDL, PRAGMAS } from './schema';
import { seedIfEmpty } from './seed';

/**
 * 单进程内共享一个连接。Next dev 会热重载模块，用 globalThis 兜住，
 * 否则每次改代码都会新建连接、重复跑 DDL。
 */
const g = globalThis as unknown as { __linxiDb?: Database.Database };

function resolveDbPath(): string {
  const custom = process.env.LINXI_DB_PATH?.trim();
  if (custom) return path.resolve(custom);
  return path.resolve(process.cwd(), 'data', 'linxi.db');
}

function create(): Database.Database {
  const file = resolveDbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  for (const p of PRAGMAS) db.pragma(p.replace(/^PRAGMA\s+/i, ''));
  db.transaction(() => {
    for (const stmt of DDL) db.exec(stmt);
  })();
  seedIfEmpty(db);
  return db;
}

export function getDb(): Database.Database {
  if (!g.__linxiDb) g.__linxiDb = create();
  return g.__linxiDb;
}

/** 当前唯一用户（本地单人使用，固定 id=1；没有就建一条默认档案）。 */
export function getOrCreateUser(db = getDb()): {
  id: number;
  name: string;
  level: string;
  goal: string;
  interests: string[];
  daily_minutes: number;
  new_words_per_day: number;
  voice: string | null;
  onboarded: number;
} {
  let row = db.prepare('SELECT * FROM users WHERE id = 1').get() as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    db.prepare(
      `INSERT INTO users (id, name, level, goal, interests, daily_minutes, new_words_per_day)
       VALUES (1, '学习者', 'A1', 'daily_talk', '[]', 30, 8)`,
    ).run();
    row = db.prepare('SELECT * FROM users WHERE id = 1').get() as Record<string, unknown>;
  }
  return {
    id: 1,
    name: String(row.name),
    level: String(row.level),
    goal: String(row.goal),
    interests: safeJson<string[]>(row.interests, []),
    daily_minutes: Number(row.daily_minutes),
    new_words_per_day: Number(row.new_words_per_day),
    voice: (row.voice as string | null) ?? null,
    onboarded: Number(row.onboarded),
  };
}

export function safeJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export type Db = Database.Database;

import { getPool, all as rawAll, one as rawOne, run as rawRun, withTx as rawWithTx, type Exec, type Params } from './pool';
import { DDL, SCHEMA_LOCK_KEY } from './schema';
import { seedBuiltins } from './seed';
import type { UserProfile } from '@/lib/types';

/**
 * 数据访问入口。仓储层只从这里取查询助手，不直接碰 pool。
 *
 * 建表 + 播种是一个只跑一次的 Promise。下面几个助手在真正发查询之前都会
 * await 它，所以调用方不需要关心初始化时机 —— 第一个进来的请求顺带把库建好。
 */

const g = globalThis as unknown as { __linxiReady?: Promise<void> };

async function init(): Promise<void> {
  // 单独占一条连接：建表和播种要在同一个会话里持有咨询锁。
  // 多实例（或 next dev 热重载）同时启动时，后来的会等前面建完再进。
  const client = await getPool().connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK_KEY]);
    for (const stmt of DDL) await client.query(stmt);
    await seedBuiltins(client);
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK_KEY]);
    } catch {
      // 连接已经废了，锁会随会话结束自动释放
    }
    client.release();
  }
}

/** 保证表结构和内置数据就位。重复调用只会初始化一次；失败后允许下次重试。 */
export function ready(): Promise<void> {
  if (!g.__linxiReady) {
    g.__linxiReady = init().catch((err) => {
      g.__linxiReady = undefined;
      throw err;
    });
  }
  return g.__linxiReady;
}

/* ---------- 查询助手（自动等初始化完成） ---------- */

export async function all<T>(sql: string, params?: Params, ex?: Exec): Promise<T[]> {
  await ready();
  return rawAll<T>(sql, params, ex);
}

/** 取第一行；没有行返回 undefined。 */
export async function one<T>(sql: string, params?: Params, ex?: Exec): Promise<T | undefined> {
  await ready();
  return rawOne<T>(sql, params, ex);
}

/** 执行写操作，返回受影响行数。 */
export async function run(sql: string, params?: Params, ex?: Exec): Promise<number> {
  await ready();
  return rawRun(sql, params, ex);
}

/** 在一个事务里跑一串操作；回调里的查询要把 client 显式传给助手。 */
export async function withTx<T>(fn: Parameters<typeof rawWithTx<T>>[0]): Promise<T> {
  await ready();
  return rawWithTx(fn);
}

/**
 * jsonb 列的入参。
 * pg 会把 JS 数组翻译成 Postgres 数组字面量（`{1,2}`），塞进 jsonb 会报错，
 * 所以写 jsonb 一律先 stringify。
 */
export function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/* ---------- 用户 ---------- */

/** 当前唯一用户（本地单人使用，固定 id=1；没有就建一条默认档案）。 */
export async function getOrCreateUser(): Promise<UserProfile> {
  let row = await one<Record<string, unknown>>('SELECT * FROM users WHERE id = 1');
  if (!row) {
    await run(
      `INSERT INTO users (id, name, level, goal, interests, daily_minutes, new_words_per_day)
       VALUES (1, '学习者', 'A1', 'daily_talk', '[]'::jsonb, 30, 8)
       ON CONFLICT (id) DO NOTHING`,
    );
    row = (await one<Record<string, unknown>>('SELECT * FROM users WHERE id = 1'))!;
  }
  return {
    id: 1,
    name: String(row.name),
    level: String(row.level),
    goal: String(row.goal),
    // interests 是 jsonb，驱动已经解析好了
    interests: Array.isArray(row.interests) ? (row.interests as string[]) : [],
    daily_minutes: Number(row.daily_minutes),
    new_words_per_day: Number(row.new_words_per_day),
    voice: (row.voice as string | null) ?? null,
    onboarded: Number(row.onboarded),
  };
}

/**
 * 解析存在 TEXT 列里的 JSON（比如 chat_messages.content 里塞的场景设定）。
 * jsonb 列不需要它 —— 驱动读出来就是对象。
 */
export function safeJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw !== 'string') return raw as T;
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export { closePool, getPool } from './pool';
export type { Exec, Params } from './pool';

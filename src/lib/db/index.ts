import { getPool, all as rawAll, one as rawOne, run as rawRun, withTx as rawWithTx, type Exec, type Params } from './pool';
import { DDL, SCHEMA_LOCK_KEY } from './schema';
import { seedBuiltins } from './seed';
import type { SpeechPace, UserProfile } from '@/lib/types';

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

/** 上游身份里本地要用到的部分。完整结构见 src/lib/auth。 */
export type ExternalIdentity = {
  externalId: string;
  username: string;
  email: string;
  displayName: string;
};

/**
 * 单人模式的固定档案（没配 AUTH_UPSTREAM_URL 时走这条）。
 *
 * 保留它是为了本地开发和冒烟测试不用先起一套身份服务。
 * 一旦配了上游，所有入口都会走 getOrCreateExternalUser。
 */
export async function getOrCreateUser(): Promise<UserProfile> {
  let row = await one<Record<string, unknown>>('SELECT * FROM users WHERE id = 1');
  if (!row) {
    await run(
      `INSERT INTO users (id, name, level, goal, interests, daily_minutes, new_words_per_day)
       VALUES (1, '学习者', 'A1', 'daily_talk', '[]'::jsonb, 30, 10)
       ON CONFLICT (id) DO NOTHING`,
    );
    row = (await one<Record<string, unknown>>('SELECT * FROM users WHERE id = 1'))!;
  }
  return toProfile(row, 1);
}

/**
 * 上游身份 → 本地档案，一人一份。没有就新建。
 *
 * `adoptUserId` 处理升级路径：单人模式攒下的历史档案（默认 id=1，external_id 为 NULL）
 * 让**第一个**登录的人接管，而不是变成一条谁都进不去的孤儿数据。之后再登录的人各建新档。
 * 不想让任何人继承那份历史数据就设 AUTH_ADOPT_USER_ID=0。
 *
 * 整个过程在一个事务里，并且认领历史档案那句带 `external_id IS NULL` 条件 ——
 * 两个人同时首次登录时，只有一个人的 UPDATE 会命中，另一个自然落到新建分支。
 */
export async function getOrCreateExternalUser(
  identity: ExternalIdentity,
  adoptUserId = 0,
): Promise<UserProfile> {
  const found = await one<Record<string, unknown>>('SELECT * FROM users WHERE external_id = ?', [
    identity.externalId,
  ]);
  if (found) {
    // 上游改了用户名/邮箱就跟着更新，但不动本地的 name —— 那是用户在引导里自己填的
    if (
      String(found.external_username ?? '') !== identity.username ||
      String(found.external_email ?? '') !== identity.email
    ) {
      await run('UPDATE users SET external_username = ?, external_email = ? WHERE id = ?', [
        identity.username,
        identity.email,
        Number(found.id),
      ]);
    }
    return toProfile(found, Number(found.id));
  }

  return withTx(async (tx) => {
    if (adoptUserId > 0) {
      const adopted = await one<Record<string, unknown>>(
        `UPDATE users
            SET external_id = ?, external_username = ?, external_email = ?
          WHERE id = ? AND external_id IS NULL
          RETURNING *`,
        [identity.externalId, identity.username, identity.email, adoptUserId],
        tx,
      );
      if (adopted) return toProfile(adopted, Number(adopted.id));
    }

    const created = await one<Record<string, unknown>>(
      `INSERT INTO users (name, level, goal, interests, daily_minutes, new_words_per_day,
                          external_id, external_username, external_email)
       VALUES (?, 'A1', 'daily_talk', '[]'::jsonb, 30, 10, ?, ?, ?)
       RETURNING *`,
      [identity.displayName || '学习者', identity.externalId, identity.username, identity.email],
      tx,
    );
    if (!created) throw new Error('建用户档案失败');
    return toProfile(created, Number(created.id));
  });
}

/** users 行 → UserProfile。列的兜底逻辑集中在这里，两个入口共用。 */
function toProfile(row: Record<string, unknown>, id: number): UserProfile {
  return {
    id,
    name: String(row.name),
    level: String(row.level),
    goal: String(row.goal),
    // interests 是 jsonb，驱动已经解析好了
    interests: Array.isArray(row.interests) ? (row.interests as string[]) : [],
    daily_minutes: Number(row.daily_minutes),
    new_words_per_day: Number(row.new_words_per_day),
    voice: (row.voice as string | null) ?? null,
    voice_offline: (row.voice_offline as string | null) ?? null,
    ai_voice: (row.ai_voice as string | null) ?? null,
    // 老库刚补上列时可能是 null，也要防住手写进去的非法值
    speech_pace: normalizePace(row.speech_pace),
    onboarded: Number(row.onboarded),
  };
}

const PACES: SpeechPace[] = ['slow', 'normal', 'fast'];

function normalizePace(v: unknown): SpeechPace {
  return PACES.includes(v as SpeechPace) ? (v as SpeechPace) : 'normal';
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

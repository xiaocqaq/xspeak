import { Pool, types, type PoolClient } from 'pg';

/**
 * PostgreSQL 连接池 + 一层很薄的查询助手。
 *
 * 助手只做两件事：
 * 1. 把 `?` / `@name` 占位符翻译成 PG 的 `$1`，仓储层的 SQL 读起来还是原来的样子；
 * 2. 统一 all / one / run 三种取值方式，省掉每处都写 `res.rows`。
 *
 * 没有引 ORM 或 query builder —— SQL 本来就是手写的，翻译占位符这一层足够了。
 */

/* ---------- 类型解析：让返回值和代码里的既有假设对齐 ---------- */

// timestamp / date 原样返回字符串。ts-fsrs 那边生成的就是 'YYYY-MM-DD HH:MM:SS'，
// 全站也都按字符串传，解析成 Date 反而要在几十处做适配。
types.setTypeParser(types.builtins.TIMESTAMP, (v) => v);
types.setTypeParser(types.builtins.DATE, (v) => v);
// COUNT() 是 bigint、SUM()/AVG() 是 numeric，pg 默认都给字符串。
// 这个应用的量级不可能超出 Number 的安全范围，直接当数字用。
types.setTypeParser(types.builtins.INT8, (v) => Number(v));
types.setTypeParser(types.builtins.NUMERIC, (v) => Number(v));

/* ---------- 连接池 ---------- */

const g = globalThis as unknown as { __linxiPool?: Pool };

function config() {
  const url = process.env.DATABASE_URL?.trim();
  const common = {
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // 连接建立时就把会话时区钉死成 UTC。这样 SQL 里的 now() 和
    // scheduler.toSql() 写进去的字符串是同一个时间基准，可以直接比大小。
    options: '-c timezone=UTC',
  };
  if (url) return { connectionString: url, ...common };

  const host = process.env.PGHOST?.trim();
  if (!host) {
    throw new Error(
      '数据库连接信息缺失：请在 .env.local 里填 PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE，或者给一个 DATABASE_URL。',
    );
  }
  return {
    host,
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    ...common,
  };
}

/** 单进程内共享一个池。Next dev 会热重载模块，用 globalThis 兜住。 */
export function getPool(): Pool {
  if (!g.__linxiPool) {
    const pool = new Pool(config());
    // 空闲连接被服务端掐掉时 pg 会在池上抛 error，没有监听会直接崩进程。
    pool.on('error', (err) => console.error('[linxi pg] 空闲连接出错：', err.message));
    g.__linxiPool = pool;
  }
  return g.__linxiPool;
}

export async function closePool(): Promise<void> {
  if (!g.__linxiPool) return;
  const pool = g.__linxiPool;
  g.__linxiPool = undefined;
  await pool.end();
}

/* ---------- 占位符翻译 ---------- */

export type Params = readonly unknown[] | Record<string, unknown>;

/** Pool 和事务里的 PoolClient 都能当执行器用。 */
export type Exec = Pool | PoolClient;

const IDENT = /[A-Za-z0-9_]/;

/**
 * 把 `?`（位置参数）或 `@name`（命名参数）翻译成 `$1`。
 * 字符串字面量和 `--` 注释里的内容会被跳过，不会被当成占位符。
 * 一条 SQL 里两种风格不能混用 —— 混用基本都是笔误，直接报错比默默错位好。
 */
function compile(sql: string, params?: Params): { text: string; values: unknown[] } {
  const named = params != null && !Array.isArray(params);
  const values: unknown[] = named ? [] : [...((params as readonly unknown[] | undefined) ?? [])];
  const slot = new Map<string, number>();
  let used = 0;
  let out = '';
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    if (ch === "'") {
      // 字符串字面量：'' 是转义的单引号，不算结束
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      const end = nl === -1 ? sql.length : nl;
      out += sql.slice(i, end);
      i = end;
      continue;
    }

    if (ch === '?') {
      if (named) throw new Error(`SQL 用了 ? 占位符，但传进来的是命名参数：${sql}`);
      used++;
      out += `$${used}`;
      i++;
      continue;
    }

    if (ch === '@' && sql[i + 1] && IDENT.test(sql[i + 1])) {
      let j = i + 1;
      while (j < sql.length && IDENT.test(sql[j])) j++;
      const name = sql.slice(i + 1, j);
      if (!named) throw new Error(`SQL 用了 @${name} 命名参数，但传进来的是数组：${sql}`);
      const bag = params as Record<string, unknown>;
      if (!(name in bag)) throw new Error(`SQL 里的 @${name} 没有对应的参数值`);
      let at = slot.get(name);
      if (at == null) {
        values.push(bag[name]);
        at = values.length;
        slot.set(name, at);
      }
      out += `$${at}`;
      i = j;
      continue;
    }

    out += ch;
    i++;
  }

  if (!named && used !== values.length) {
    throw new Error(`占位符数量和参数不匹配：SQL 里有 ${used} 个 ?，传了 ${values.length} 个值`);
  }
  return { text: out, values };
}

/* ---------- 查询助手 ---------- */

export async function all<T>(sql: string, params?: Params, ex: Exec = getPool()): Promise<T[]> {
  const { text, values } = compile(sql, params);
  const res = await ex.query({ text, values });
  return res.rows as T[];
}

/** 取第一行；没有行返回 undefined。 */
export async function one<T>(sql: string, params?: Params, ex?: Exec): Promise<T | undefined> {
  const rows = await all<T>(sql, params, ex);
  return rows[0];
}

/** 执行写操作，返回受影响行数。 */
export async function run(sql: string, params?: Params, ex: Exec = getPool()): Promise<number> {
  const { text, values } = compile(sql, params);
  const res = await ex.query({ text, values });
  return res.rowCount ?? 0;
}

/** 在一个事务里跑一串操作。回调里的查询都要显式传 client。 */
export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // 回滚也失败说明连接已经废了，把原始错误抛出去更有用
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 清库重来。DROP 掉本项目的所有表，下次启动自动重建 + 重新播种。
 *
 * 用法：
 *   npm run db:reset -- --yes            # 直接清
 *   npm run db:reset -- --yes --dump out.sql  # 先用 pg_dump 备份再清（需要本机有 pg_dump）
 *
 * 不带 --yes 只打印将要删的表，什么都不做 —— 远程库上手滑一次的代价太大。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

import { ALL_TABLES } from '../src/lib/db/schema.ts';

/** 读 .env.local，不覆盖已经存在的环境变量。 */
function loadEnv() {
  const file = path.resolve(process.cwd(), '.env.local');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const val = m[2].trim().replace(/^["'](.*)["']$/, '$1');
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

loadEnv();

const argv = process.argv.slice(2);
const confirmed = argv.includes('--yes');
const dumpAt = argv[argv.indexOf('--dump') + 1];
const wantDump = argv.includes('--dump') && dumpAt && !dumpAt.startsWith('--');

const url = process.env.DATABASE_URL?.trim();
const conn = url
  ? { connectionString: url }
  : {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    };

if (!url && !conn.host) {
  console.error('没有连接信息：请在 .env.local 里配好 PGHOST 等变量，或给一个 DATABASE_URL。');
  process.exit(1);
}

const where = url ? url.replace(/:\/\/[^@]*@/, '://***@') : `${conn.host}:${conn.port}/${conn.database}`;

if (!confirmed) {
  console.log(`目标库：${where}`);
  console.log(`将要 DROP 的表（共 ${ALL_TABLES.length} 张）：`);
  console.log('  ' + ALL_TABLES.join(', '));
  console.log('\n确认无误后加 --yes 再跑一次：npm run db:reset -- --yes');
  console.log('想先备份：npm run db:reset -- --yes --dump backup.sql');
  process.exit(0);
}

if (wantDump) {
  const out = path.resolve(dumpAt);
  const args = url ? ['-d', url, '-f', out] : ['-h', conn.host, '-p', String(conn.port), '-U', conn.user, '-d', conn.database, '-f', out];
  const res = spawnSync('pg_dump', args, {
    stdio: 'inherit',
    env: { ...process.env, PGPASSWORD: conn.password ?? process.env.PGPASSWORD },
  });
  if (res.error || res.status !== 0) {
    console.error('pg_dump 失败，为安全起见不继续清库。本机可能没装 pg_dump。');
    process.exit(1);
  }
  console.log(`已备份 → ${out}`);
}

const client = new pg.Client(conn);
await client.connect();
try {
  // 一条语句里全部 DROP，CASCADE 处理外键依赖，不用管顺序
  await client.query(`DROP TABLE IF EXISTS ${ALL_TABLES.join(', ')} CASCADE`);
  console.log(`已清空 ${where} 上的 ${ALL_TABLES.length} 张表。`);
  console.log('下次启动会重建表结构并重新播种内置词表和语法点。');
} finally {
  await client.end();
}

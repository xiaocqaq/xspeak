/**
 * 数据库体检：连得上吗、表建全了吗、每张表有多少行、关键 jsonb 列类型对不对。
 * 迁移或改 schema 之后跑一下，比手工连 psql 快。
 *
 *   npm run db:check
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

// 这个脚本在 Next 之外跑，自己读一遍 .env.local
const file = path.resolve(process.cwd(), '.env.local');
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
    }
  }
}

const url = process.env.DATABASE_URL?.trim();
const client = new pg.Client(
  url
    ? { connectionString: url, connectionTimeoutMillis: 10_000 }
    : {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT ?? 5432),
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE,
        connectionTimeoutMillis: 10_000,
      },
);

// schema.ts 里建的所有表，缺了要报出来
const EXPECTED = [
  'chat_messages',
  'conversations',
  'daily_stats',
  'grammar_points',
  'materials',
  'mistakes',
  'review_logs',
  'sessions',
  'speech_attempts',
  'stage_content',
  'themes',
  'user_grammar',
  'user_words',
  'users',
  'words',
  'writings',
];

try {
  await client.connect();
} catch (err) {
  console.error(`连不上数据库：${err.message}`);
  process.exit(1);
}

const info = await client.query('SELECT current_database() AS db, current_user AS usr, version()');
const { db, usr, version } = info.rows[0];
console.log(`${usr}@${db} · ${String(version).split(' ').slice(0, 2).join(' ')}\n`);

const found = (
  await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  )
).rows.map((r) => r.table_name);

const missing = EXPECTED.filter((t) => !found.includes(t));
const extra = found.filter((t) => !EXPECTED.includes(t));

for (const name of found) {
  // 表名来自 information_schema，不是外部输入；仍然加引号避免大小写/保留字问题
  const { rows } = await client.query(`SELECT count(*)::int AS c FROM "${name}"`);
  console.log(`  ${name.padEnd(16)} ${rows[0].c}`);
}

console.log('');
if (missing.length) console.log(`缺表：${missing.join(' ')}`);
if (extra.length) console.log(`额外的表：${extra.join(' ')}`);

// jsonb 列必须真的是 jsonb —— 早期迁移时这几列被写成过 TEXT
const jsonbCols = [
  ['users', 'interests'],
  ['sessions', 'target_word_ids'],
  ['sessions', 'review_word_ids'],
  ['sessions', 'grammar_ids'],
  ['sessions', 'stages_done'],
  ['user_words', 'seen_contexts'],
  ['grammar_points', 'examples'],
  ['grammar_points', 'pitfalls'],
  ['stage_content', 'payload'],
];
const types = new Map(
  (
    await client.query(
      `SELECT table_name || '.' || column_name AS k, data_type FROM information_schema.columns
       WHERE table_schema = 'public'`,
    )
  ).rows.map((r) => [r.k, r.data_type]),
);
const wrong = jsonbCols
  .map(([t, c]) => [`${t}.${c}`, types.get(`${t}.${c}`)])
  .filter(([, ty]) => ty !== 'jsonb');
if (wrong.length) {
  console.log(`列类型不对（应为 jsonb）：${wrong.map(([k, ty]) => `${k}=${ty ?? '不存在'}`).join(' ')}`);
}

const user = (await client.query('SELECT id, name, level, onboarded FROM users WHERE id = 1')).rows[0];
console.log(user ? `用户：#1 ${user.name} · ${user.level} · onboarded=${user.onboarded}` : '用户：还没建');

await client.end();

const bad = missing.length > 0 || wrong.length > 0;
console.log(bad ? '\n有问题，见上面。' : '\n一切正常。');
process.exit(bad ? 1 : 0);

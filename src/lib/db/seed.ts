import { one, run, type Exec } from './pool';
import { SEED_WORDS } from '@/data/words';
import { SEED_GRAMMAR } from '@/data/grammar';
import { SEED_THEMES } from '@/data/themes';

/**
 * 灌入内置词表/语法点/主题池。
 *
 * 做的是"补齐"而不是"首次填充"：先数一下库里有多少条内置数据，少于代码里的份数就
 * 整批 INSERT ... ON CONFLICT DO NOTHING 走一遍，已有的原样跳过。
 * 这样后来往 src/data 里加词、加语法点，下次启动会自动补进来，
 * 而不是因为"表不空"就永远不再播种。
 *
 * 调用方（db/index.ts 的 init）已经持有咨询锁并开好了连接，所以这里直接用
 * 传进来的 client，不再自己开事务 —— 建表和播种是同一次初始化的两半。
 */

/** 一次 INSERT 塞多少行。参数上限是 65535，取 200 行足够宽松又不会发太多次。 */
const CHUNK = 200;

/**
 * words.term 上有唯一约束，词表里写重了的话 ON CONFLICT DO NOTHING 会静默丢掉一条，
 * 结果就是某个主题少一个词而没人发现。开发时直接喊出来。
 */
function warnDuplicateTerms(): void {
  if (process.env.NODE_ENV === 'production') return;
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const w of SEED_WORDS) {
    if (seen.has(w.term)) dupes.push(w.term);
    else seen.add(w.term);
  }
  if (dupes.length) {
    console.warn(`[seed] 词表里有重复的词，会被丢掉：${dupes.join(', ')}`);
  }
}

/** 库里已有的内置数据条数。用于判断要不要补。 */
async function seededCount(table: string, ex: Exec): Promise<number> {
  const row = await one<{ c: number }>(
    `SELECT count(*)::int AS c FROM ${table} WHERE source = 'seed'`,
    [],
    ex,
  );
  return row?.c ?? 0;
}

/** 把 rows 按 CHUNK 拆开，拼成多行 VALUES 一次性插入。 */
async function insertMany(
  head: string,
  cols: number,
  rows: unknown[][],
  ex: Exec,
  tail = 'ON CONFLICT DO NOTHING',
): Promise<void> {
  const group = `(${Array.from({ length: cols }, () => '?').join(', ')})`;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values = slice.map(() => group).join(', ');
    await run(`${head} VALUES ${values} ${tail}`, slice.flat(), ex);
  }
}

export async function seedBuiltins(ex: Exec): Promise<void> {
  if ((await seededCount('words', ex)) < SEED_WORDS.length) {
    warnDuplicateTerms();
    await insertMany(
      `INSERT INTO words
         (term, phonetic, pos, meaning_zh, meaning_en, cefr, theme, example_en, example_zh, source)`,
      10,
      SEED_WORDS.map((w) => [
        w.term,
        w.phonetic,
        w.pos,
        w.meaning_zh,
        w.meaning_en,
        w.cefr,
        w.theme,
        w.example_en,
        w.example_zh,
        'seed',
      ]),
      ex,
      // term 上有唯一约束：AI 生成过的同名词保持原样，不被内置版本覆盖
      'ON CONFLICT (term) DO NOTHING',
    );
  }

  if ((await seededCount('grammar_points', ex)) < SEED_GRAMMAR.length) {
    await insertMany(
      `INSERT INTO grammar_points
         (slug, title_zh, title_en, cefr, explain_zh, pattern, examples, pitfalls, ord, source)`,
      10,
      SEED_GRAMMAR.map((g) => [
        g.slug,
        g.title_zh,
        g.title_en,
        g.cefr,
        g.explain_zh,
        g.pattern,
        // examples / pitfalls 是 jsonb 列，参数要先 stringify，否则 pg 会当成 PG 数组
        JSON.stringify(g.examples),
        JSON.stringify(g.pitfalls),
        g.ord,
        'seed',
      ]),
      ex,
      'ON CONFLICT (slug) DO NOTHING',
    );
  }

  // themes 没有 source 列 —— 主题池全部来自内置数据，直接按条数比。
  const themeCount = await one<{ c: number }>('SELECT count(*)::int AS c FROM themes', [], ex);
  if ((themeCount?.c ?? 0) < SEED_THEMES.length) {
    await insertMany(
      `INSERT INTO themes (slug, zh, en, tags)`,
      4,
      SEED_THEMES.map((t) => [t.slug, t.zh, t.en, t.tags]),
      ex,
      // last_used_on 要保留，冲突就跳过
      'ON CONFLICT (slug) DO NOTHING',
    );
  }
}

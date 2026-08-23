import type Database from 'better-sqlite3';
import { SEED_WORDS } from '@/data/words';
import { SEED_GRAMMAR } from '@/data/grammar';
import { SEED_THEMES } from '@/data/themes';

/**
 * 首次启动时灌入内置词表/语法点/主题池。
 * 用 INSERT OR IGNORE + 按表判空，重复调用不会产生重复数据。
 */
export function seedIfEmpty(db: Database.Database): void {
  const count = (t: string) =>
    (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;

  db.transaction(() => {
    if (count('words') === 0) {
      const ins = db.prepare(
        `INSERT OR IGNORE INTO words
         (term, phonetic, pos, meaning_zh, meaning_en, cefr, theme, example_en, example_zh, source)
         VALUES (@term, @phonetic, @pos, @meaning_zh, @meaning_en, @cefr, @theme, @example_en, @example_zh, 'seed')`,
      );
      // words.term 上有 UNIQUE，词表里写重了的话 OR IGNORE 会静默丢掉一条，
      // 结果就是某个主题少一个词而没人发现。开发时直接喊出来。
      if (process.env.NODE_ENV !== 'production') {
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
      for (const w of SEED_WORDS) ins.run(w);
    }

    if (count('grammar_points') === 0) {
      const ins = db.prepare(
        `INSERT OR IGNORE INTO grammar_points
         (slug, title_zh, title_en, cefr, explain_zh, pattern, examples, pitfalls, ord, source)
         VALUES (@slug, @title_zh, @title_en, @cefr, @explain_zh, @pattern, @examples, @pitfalls, @ord, 'seed')`,
      );
      for (const g of SEED_GRAMMAR) {
        ins.run({
          slug: g.slug,
          title_zh: g.title_zh,
          title_en: g.title_en,
          cefr: g.cefr,
          explain_zh: g.explain_zh,
          pattern: g.pattern,
          examples: JSON.stringify(g.examples),
          pitfalls: JSON.stringify(g.pitfalls),
          ord: g.ord,
        });
      }
    }

    if (count('themes') === 0) {
      const ins = db.prepare(
        `INSERT OR IGNORE INTO themes (slug, zh, en, tags) VALUES (@slug, @zh, @en, @tags)`,
      );
      for (const t of SEED_THEMES) ins.run(t);
    }
  })();
}

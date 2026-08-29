/**
 * 导入单词的 CEFR 等级（CEFR-J + Octanove）。
 *
 * 为什么要这个：选词原本靠 ECDICT 的考纲标签（zk/gk/cet4/cet6/ky/toefl/ielts/gre）
 * 当分级代理，但"进了 cet4 大纲"不等于"这个词是 B1"——实测和人工标注的 CEFR
 * 只有 54% 对得上（相差 ≤1 级的占 93%）。这两份表是语言学家按 CEFR 逐词标的，
 * 拿它定等级边界比考纲标签准。
 *
 * 只导等级，不导释义：两份表都不带中文和音标，单独用不了。中文释义、音标、
 * 词频仍然全部来自 dictionary（ECDICT），靠 word 列 join —— 8493 个词里
 * 8418（99.1%）能对上，其中 8115 同时有中文和音标。
 *
 * 用法：
 *   npm run levels:import           # 导入（已有数据会跳过）
 *   npm run levels:import -- --force  # 已有数据也重新导
 *
 * 数据来源与授权：
 * - CEFR-J Wordlist Version 1.5（A1-B2，7799 行）
 *   Compiled by Yukio Tono, Tokyo University of Foreign Studies.
 *   研究和商业用途均免费，条件是正确署名。
 * - Octanove Vocabulary Profile C1/C2 Version 1.0（2136 行）
 *   CC BY-SA 4.0（https://creativecommons.org/licenses/by-sa/4.0/）
 * 两份都经 openlanguageprofiles/olp-en-cefrj 分发。
 * 应用内的署名在设置页「关于」区块，别删。
 *
 * 走 cdn.jsdelivr.net 而不是 raw.githubusercontent.com：实测这台机器上 raw
 * 经常超时（下到一半断），jsdelivr 稳定。import-dict.mjs 用 raw 是历史原因，
 * 那份 63MB 有本地缓存兜着，这两份加起来不到 300KB，重下的代价可以忽略。
 */

import process from 'node:process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import pg from 'pg';

const BASE = 'https://cdn.jsdelivr.net/gh/openlanguageprofiles/olp-en-cefrj@master';
/** 两份表的等级范围不重叠，合起来才是完整的 A1-C2*/
const SOURCES = [
  { src: 'cefrj', file: 'cefrj-vocabulary-profile-1.5.csv', cache: 'cefrj-1.5.csv' },
  { src: 'octanove', file: 'octanove-vocabulary-profile-c1c2-1.0.csv', cache: 'octanove-c1c2-1.0.csv' },
];

const args = process.argv.slice(2);
const FORCE = args.includes('--force');

// 复用项目的 .env.local，不额外引 dotenv
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const pool = new pg.Pool({ max: 4 });

/**
 * 极简 CSV 解析。和 import-dict.mjs 里那份同源。
 * 不能按 \n 切行 —— CEFR-J 的字段里带换行（headword 列有多行的备注），
 * 按行切会把 7799 行读成 2018 行。所以按字符扫，跟踪引号状态。
 */
function* parseCsv(text) {
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      yield row;
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    yield row;
  }
}

async function fetchCsv({ file, cache }) {
  if (existsSync(cache)) {
    console.log(`· 用本地缓存 ${cache}`);
    return readFileSync(cache, 'utf8');
  }
  console.log(`· 下载 ${file}…`);
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) throw new Error(`下载 ${file} 失败 HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(cache, text, 'utf8');
  return text;
}

const LEVELS = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
const ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/**
 * 规整 headword。
 *
 * 原始表里一个条目可能写成 "a.m./A.M./am/AM" 或 "colour/color" —— 斜杠分隔的
 * 拼写变体。只取第一个：变体拿去 join ECDICT 也是同一条释义，全展开只会
 * 让同一个词在词表里出现四次，每天新词里就可能连着出四个"同一个词"。
 *
 * 返回 null 表示这条不要：带空格的是词组（144 条，1.8%），本项目的新词环节
 * 是单词卡片，词组该走阅读/听力材料；带数字或符号的是标注残留。
 */
function normalize(headword) {
  const first = String(headword ?? '').split('/')[0].trim().toLowerCase();
  if (!first) return null;
  if (!/^[a-z][a-z'-]*$/.test(first)) return null;
  return first;
}

async function main() {
  const exists = await pool.query(`SELECT to_regclass('word_level') IS NOT NULL AS ok`);
  if (!exists.rows[0].ok) {
    console.error('✗ word_level 表不存在。先启动一次应用让它建表（npm run dev），或跑 npm run db:check。');
    process.exit(1);
  }

  const { rows: cnt } = await pool.query('SELECT count(*)::int AS n FROM word_level');
  if (cnt[0].n > 0 && !FORCE) {
    console.log(`· 已有 ${cnt[0].n.toLocaleString()} 条等级，跳过。要重建加 --force。`);
    await pool.end();
    return;
  }
  if (FORCE && cnt[0].n > 0) {
    console.log(`· --force：清空原有 ${cnt[0].n.toLocaleString()} 条`);
    await pool.query('TRUNCATE word_level');
  }

  /**
   * 同一个词在不同词性下可能标不同等级（bank 名词 A1、动词 B2）。
   * 取最低那级：新词卡片一次只教一个词，按最容易的义项先认识它，
   * 难的义项等阅读里遇到再说。取高的会让 A1 用户永远见不到 bank。
   */
  const merged = new Map();
  let seen = 0;
  let dropped = 0;

  for (const source of SOURCES) {
    const text = await fetchCsv(source);
    let header = true;
    for (const row of parseCsv(text)) {
      if (header) {
        header = false;
        continue;
      }
      const [headword, pos, cefr] = row;
      if (!headword) continue;
      seen++;
      const lvl = String(cefr ?? '').trim().toUpperCase();
      if (!LEVELS.has(lvl)) {
        dropped++;
        continue;
      }
      const word = normalize(headword);
      if (!word) {
        dropped++;
        continue;
      }
      const prev = merged.get(word);
      if (!prev || ORDER.indexOf(lvl) < ORDER.indexOf(prev.cefr)) {
        merged.set(word, { cefr: lvl, pos: String(pos ?? '').trim() || null, src: source.src });
      }
    }
  }

  console.log(`· 解析 ${seen.toLocaleString()} 行，丢弃 ${dropped.toLocaleString()}（词组/无效等级），合并后 ${merged.size.toLocaleString()} 个单词`);

  const entries = [...merged.entries()];
  const B = 1000;
  for (let i = 0; i < entries.length; i += B) {
    const chunk = entries.slice(i, i + B);
    const values = chunk
      .map((_, r) => `($${r * 4 + 1},$${r * 4 + 2},$${r * 4 + 3},$${r * 4 + 4})`)
      .join(',');
    await pool.query(
      `INSERT INTO word_level (word, cefr, pos, src) VALUES ${values}
       ON CONFLICT (word) DO NOTHING`,
      chunk.flatMap(([w, v]) => [w, v.cefr, v.pos, v.src]),
    );
  }

  const { rows: dist } = await pool.query(
    `SELECT cefr, count(*)::int AS n FROM word_level GROUP BY cefr ORDER BY cefr`,
  );
  console.log(`✓ 导入完成：${entries.length.toLocaleString()} 条`);
  console.log('  ' + dist.map((r) => `${r.cefr} ${r.n}`).join(' / '));

  /*
   * 报一下能 join 上 dictionary 的比例。这个数直接决定选词池够不够 ——
   * 等级表再准，join 不上就取不出中文和音标，等于没有。
   */
  const { rows: joined } = await pool.query(
    `SELECT count(*)::int AS matched,
            count(*) FILTER (WHERE d.translation IS NOT NULL AND d.translation <> ''
                               AND d.phonetic IS NOT NULL AND d.phonetic <> '')::int AS usable
       FROM word_level wl JOIN dictionary d ON d.word = wl.word`,
  );
  const m = joined[0];
  if (!m.matched) {
    console.log('· dictionary 还是空的，先跑 npm run dict:import，否则选词取不到释义');
  } else {
    const pct = ((m.matched / entries.length) * 100).toFixed(1);
    console.log(`  join dictionary：${m.matched.toLocaleString()}（${pct}%），其中带中文+音标 ${m.usable.toLocaleString()}`);
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error('✗ 导入失败：', e.message);
  await pool.end().catch(() => {});
  process.exit(1);
});

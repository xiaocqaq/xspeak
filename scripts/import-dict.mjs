/**
 * 导入 ECDICT 离线词典。
 *
 * 为什么要这个：查词原本每次都走 AI，慢（几秒）、烧 token，而且同一个词
 * 查两次结果还可能不一样。ECDICT 是 MIT 许可的开源英汉词典，77 万词条，
 * 带音标、词性、中英释义、词频、考纲标签 —— 日常学习要的信息它全有。
 * 导入之后查词是毫秒级的本地查询，AI 只在词典查不到时兜底。
 *
 * 用法：
 *   npm run dict:import              # 全量导入（77 万词，约 5-10 分钟）
 *   npm run dict:import -- --top 20000   # 只导词频最高的 N 个词
 *   npm run dict:import -- --force   # 已有数据也重新导
 *
 * 数据源走 raw.githubusercontent.com 而不是 release 的 zip：
 * 实测这台机器上 release 下载不通，raw 可以，而且免去解压依赖。
 */

import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import process from 'node:process';
import { readFileSync, existsSync, createReadStream } from 'node:fs';
import pg from 'pg';

const CSV_URL = 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv';
/** 本地缓存，避免反复下载 63MB */
const CACHE = 'ecdict.csv';

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const topIdx = args.indexOf('--top');
const TOP = topIdx >= 0 ? Number(args[topIdx + 1]) : 0;

// 复用项目的 .env.local，不额外引 dotenv
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const pool = new pg.Pool({ max: 4 });

/**
 * 极简 CSV 解析。
 * 不能按 \n 切行 —— ECDICT 的 translation 字段里就带换行（多个义项用 \n 分隔），
 * 按行切会把一条记录劈成好几段。所以要按字符扫，跟踪引号状态。
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

async function download() {
  if (existsSync(CACHE)) {
    const size = readFileSync(CACHE).length;
    console.log(`· 用本地缓存 ${CACHE}（${(size / 1e6).toFixed(1)} MB）`);
    return readFileSync(CACHE, 'utf8');
  }
  console.log(`· 下载 ECDICT（约 63 MB，取决于网速可能要几分钟）…`);
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  const text = await res.text();
  const { writeFileSync } = await import('node:fs');
  writeFileSync(CACHE, text, 'utf8');
  console.log(`· 已缓存到 ${CACHE}（${(text.length / 1e6).toFixed(1)} MB）`);
  return text;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const nul = (v) => (v === '' ? null : v);

async function main() {
  const exists = await pool.query(`SELECT to_regclass('dictionary') IS NOT NULL AS ok`);
  if (!exists.rows[0].ok) {
    console.error('✗ dictionary 表不存在。先启动一次应用让它建表（npm run dev），或跑 npm run db:check。');
    process.exit(1);
  }

  const { rows: cnt } = await pool.query('SELECT count(*)::int AS n FROM dictionary');
  if (cnt[0].n > 0 && !FORCE) {
    console.log(`· 词典里已有 ${cnt[0].n.toLocaleString()} 条，跳过。要重建加 --force。`);
    await pool.end();
    return;
  }
  if (FORCE && cnt[0].n > 0) {
    console.log(`· --force：清空原有 ${cnt[0].n.toLocaleString()} 条`);
    await pool.query('TRUNCATE dictionary');
  }

  const text = await download();

  console.log('· 解析并写入…');
  const t0 = Date.now();
  let batch = [];
  let done = 0;
  let skipped = 0;
  let header = true;

  /** 攒够一批再写，逐条 INSERT 在 77 万量级下会慢到不可用 */
  const flush = async () => {
    if (!batch.length) return;
    // 13 列 × N 行的参数占位符
    const cols = 13;
    const values = batch
      .map((_, r) => `(${Array.from({ length: cols }, (_, c) => `$${r * cols + c + 1}`).join(',')})`)
      .join(',');
    await pool.query(
      `INSERT INTO dictionary
         (word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange, detail, audio)
       VALUES ${values}
       ON CONFLICT (word) DO NOTHING`,
      batch.flat(),
    );
    done += batch.length;
    batch = [];
    if (done % 50000 === 0) {
      process.stdout.write(`\r  已写入 ${done.toLocaleString()} 条…`);
    }
  };

  for (const row of parseCsv(text)) {
    if (header) {
      header = false;
      continue;
    }
    const [word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange, detail, audio] = row;
    if (!word) continue;

    // --top：只要词频排名靠前的。frq 为 0 表示词频未知，这类词通常是生僻词或专名。
    if (TOP > 0) {
      const f = num(frq);
      if (f === 0 || f > TOP) {
        skipped++;
        continue;
      }
    }
    // 中文释义是这个词典对本项目的核心价值，没有的直接跳过
    if (!translation) {
      skipped++;
      continue;
    }

    batch.push([
      word,
      nul(phonetic),
      nul(definition),
      translation,
      nul(pos),
      num(collins) || null,
      num(oxford) || null,
      nul(tag),
      num(bnc),
      num(frq),
      nul(exchange),
      nul(detail),
      nul(audio),
    ]);
    if (batch.length >= 2000) await flush();
  }
  await flush();

  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✓ 导入完成：${done.toLocaleString()} 条，跳过 ${skipped.toLocaleString()} 条，耗时 ${sec}s`);

  const { rows: sample } = await pool.query(
    `SELECT word, phonetic, translation FROM dictionary WHERE word IN ('hello','commute','sore') ORDER BY word`,
  );
  for (const s of sample) {
    console.log(`  ${s.word} [${s.phonetic ?? ''}] ${String(s.translation).split('\n')[0]}`);
  }
  await pool.end();
}

main().catch(async (e) => {
  console.error('✗ 导入失败：', e.message);
  await pool.end().catch(() => {});
  process.exit(1);
});

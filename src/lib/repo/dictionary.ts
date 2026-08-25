import { one } from '@/lib/db';

/**
 * 离线词典查询（ECDICT）。
 *
 * 存在的意义：查词以前每次都走 AI —— 慢好几秒、烧 token，同一个词查两次
 * 结果还可能不一样。词典能覆盖的部分就不该问 AI。
 * AI 只留给词典查不到的情况（新造词、专有名词、俚语变体）。
 */

export type DictEntry = {
  word: string;
  phonetic: string | null;
  /** 中文释义。ECDICT 里多个义项用 \n 分隔 */
  translation: string;
  /** 英文释义，可能为空 */
  definition: string | null;
  pos: string | null;
  /** 考纲标签：zk（中考）gk（高考）cet4 cet6 ky（考研）toefl ielts… */
  tag: string | null;
  /** 词频排名，越小越常用；0 表示未知 */
  frq: number;
  /** 时态/复数等变形，格式如 "p:did/d:done/i:doing" */
  exchange: string | null;
};

type Row = Record<string, unknown>;

function toEntry(r: Row): DictEntry {
  return {
    word: String(r.word),
    phonetic: (r.phonetic as string | null) ?? null,
    translation: String(r.translation ?? ''),
    definition: (r.definition as string | null) ?? null,
    pos: (r.pos as string | null) ?? null,
    tag: (r.tag as string | null) ?? null,
    frq: Number(r.frq ?? 0),
    exchange: (r.exchange as string | null) ?? null,
  };
}

/**
 * 按词形查词典。
 *
 * 走两步：先精确（小写）匹配，命中就返回；没命中再尝试还原变形 ——
 * 用户在阅读里点到的往往是 "walked" / "cups" 这类屈折形式，
 * 而词典的主条目是原形，不还原就会大量误判为"查不到"然后白跑一次 AI。
 */
export async function lookupDict(term: string): Promise<DictEntry | null> {
  const q = term.trim().toLowerCase();
  if (!q) return null;

  const exact = await one<Row>(
    `SELECT word, phonetic, definition, translation, pos, tag, frq, exchange
       FROM dictionary WHERE lower(word) = ? LIMIT 1`,
    [q],
  );
  if (exact) return toEntry(exact);

  for (const cand of stems(q)) {
    const hit = await one<Row>(
      `SELECT word, phonetic, definition, translation, pos, tag, frq, exchange
         FROM dictionary WHERE lower(word) = ? LIMIT 1`,
      [cand],
    );
    if (hit) return toEntry(hit);
  }
  return null;
}

/**
 * 粗糙的英文词形还原。
 *
 * 刻意不引词干提取库：这里只需要覆盖日常阅读里最常见的几种屈折，
 * 猜错了也只是回落到 AI 查词，代价可控。返回的是候选列表而不是单个结果，
 * 因为规则之间有歧义（比如 "cities" 既可能是 citie+s 也可能是 city+ies）。
 */
function stems(w: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    if (s.length >= 2 && s !== w && !out.includes(s)) out.push(s);
  };

  // 复数 / 第三人称单数
  if (w.endsWith('ies')) push(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) {
    push(w.slice(0, -2));
    push(w.slice(0, -1));
  }
  if (w.endsWith('s')) push(w.slice(0, -1));

  // 过去式 / 过去分词
  if (w.endsWith('ied')) push(w.slice(0, -3) + 'y');
  if (w.endsWith('ed')) {
    push(w.slice(0, -2));
    push(w.slice(0, -1));
    // stopped → stop（双写辅音）
    if (/([bdfglmnprt])\1ed$/.test(w)) push(w.slice(0, -3));
  }

  // 进行式
  if (w.endsWith('ing')) {
    push(w.slice(0, -3));
    push(w.slice(0, -3) + 'e'); // making → make
    if (/([bdfglmnprt])\1ing$/.test(w)) push(w.slice(0, -4)); // running → run
  }

  // 比较级 / 最高级
  if (w.endsWith('er')) push(w.slice(0, -2));
  if (w.endsWith('est')) push(w.slice(0, -3));

  return out;
}

/** 词典里有多少条。设置页/诊断用。 */
export async function dictSize(): Promise<number> {
  const r = await one<{ n: number }>(`SELECT count(*)::int AS n FROM dictionary`);
  return r?.n ?? 0;
}

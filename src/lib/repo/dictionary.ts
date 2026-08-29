import { all, one } from '@/lib/db';

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
/**
 * 印刷体撇号（U+2019）归一成 ASCII 撇号。
 *
 * AI 生成的阅读原文用的是印刷体撇号 `’`，而 ECDICT 里是 ASCII `'`。
 * 不归一的话 `tonight’s`、`that’s`、`don’t` 全都精确匹配失败。
 */
function normalizeApostrophe(s: string): string {
  return s.replace(/[\u2018\u2019\u02BC\u055A]/g, "'");
}

export async function lookupDict(term: string): Promise<DictEntry | null> {
  const q = normalizeApostrophe(term.trim().toLowerCase());
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

  /*
   * 所有格和缩写（2026-08-29 补）。
   *
   * 放在最前面，因为剥掉撇号之后还要继续走后面的屈折规则 ——
   * 比如 "coaches'" 要先剥成 "coaches" 再由复数规则还原成 "coach"。
   *
   * 用户实锤：点 tonight’s 一直转圈。词典里只有 tonight，于是落到 AI 兜底，
   * 而中转站那会儿正在回「I am GPT-5.6 Luna.」→ 502。可这个词根本不用问 AI，
   * 它就是 tonight + 所有格。撇号类的形态在阅读原文里非常密集
   * （that's / don't / it's / 名词所有格），漏掉等于把一批常见词全推给 AI。
   */
  if (w.includes("'")) {
    // tonight's → tonight（所有格 / is / has 缩写）
    if (w.endsWith("'s")) push(w.slice(0, -2));
    // coaches' → coaches（复数所有格）
    if (w.endsWith("'")) push(w.slice(0, -1));
    // don't → do、isn't → is
    if (w.endsWith("n't")) push(w.slice(0, -3));
    // I'll → I、they're → they、I've → I、I'd → I
    for (const suf of ["'ll", "'re", "'ve", "'d", "'m"]) {
      if (w.endsWith(suf)) push(w.slice(0, -suf.length));
    }
    // 兜底：整体去掉撇号（o'clock 这类词典里可能带撇号也可能不带）
    push(w.replace(/'/g, ''));
  }

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

/* ---------- 分级词表：把词典当选词来源 ---------- */

/**
 * 每个 CEFR 等级的词频下限（数字越小越常用）。
 *
 * 等级本身来自 word_level 表（CEFR-J + Octanove 的人工标注，见 import-levels.mjs）。
 * 这里只管"跳过这个等级的人早会了的词"：CEFR-J 的 A1 按词频排头部是
 * the / be / and / of，标成 A1 没错 —— 但拿来当每日新词是浪费额度。
 *
 * 下限是照着实际数据挑的（括号里是过质量门后剩下的量）：
 * - A1 从 400 起是 once / white / learn / change / minute（680）
 * - A2 从 1200 起是 complete / normal / solution / attempt / lack（786）
 * - B1 从 1500 起是 device / progress / application / damage / intend（1722）
 * - B2 从 2000 起是 legislation / assess / technical / criticism / priority（2023）
 * - C1/C2 不设下限：这两级本身就没有"早会了"的词，最常用的
 *   coverage / cite / diversity、tactic / cognitive / hypothesis 都该学。
 *   设了反而白砍池子（C1 756 → 750）。
 */
const LEVEL_FLOORS: Record<string, number> = {
  A1: 400,
  A2: 1200,
  B1: 1500,
  B2: 2000,
  C1: 0,
  C2: 0,
};

/**
 * 旧的考纲标签分级，只在 word_level 表为空时兜底。
 *
 * 保留的理由：先部署后导入的窗口期里（或者导入失败时）选词不能静默失效 ——
 * pickGradedWords 返回空的话上层会退回 AI 现场造词，每天几千 token、十几秒延迟。
 * 标签方案不如人工标注准（两者只有 54% 对得上），但比没有强。
 *
 * 相邻两级刻意重叠一个标签，让"刚升级"的人不会突然掉进一堆生词里。
 */
const TAG_BANDS: Record<string, { tags: string[]; frqFloor: number }> = {
  A1: { tags: ['zk'], frqFloor: 400 },
  A2: { tags: ['zk', 'gk'], frqFloor: 700 },
  B1: { tags: ['gk', 'cet4'], frqFloor: 1500 },
  B2: { tags: ['cet4', 'cet6', 'ky'], frqFloor: 3000 },
  C1: { tags: ['cet6', 'ky', 'toefl', 'ielts'], frqFloor: 4000 },
  C2: { tags: ['toefl', 'ielts', 'gre'], frqFloor: 5000 },
};

/**
 * word_level 表里有没有数据。
 *
 * 缓存成一次性检查：选词是每天每人调一次的热路径，没必要每次多查一遍
 * count(*)。只缓存"有数据"这个结论 —— 导入是单向的（导完就一直在），
 * 空的时候继续查，这样先部署后导入不用重启进程就能切过去。
 */
let hasLevels = false;
async function levelsReady(): Promise<boolean> {
  if (hasLevels) return true;
  const r = await one<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM word_level LIMIT 1) AS ok`,
  ).catch(() => null); // 表还没建（老库首次启动）时不要炸，退回 tag 方案
  hasLevels = r?.ok ?? false;
  return hasLevels;
}

/**
 * 词条质量门槛。达不到的不进每日新词 —— 宁可少给几个，不给垃圾条目。
 *
 * - 必须有中文释义（没有的话这词条对本项目没价值）和音标（新词卡片要显示、要朗读）
 * - `exchange LIKE '%0:%'` 表示"这条本身是某个词的变形"（walked → 0:walk），
 *   变形不该当新词教。注意 SQL 里 NULL NOT LIKE 得到 NULL 而不是 true，
 *   而 67 万条的 exchange 是 NULL，所以必须显式带上 IS NULL 分支。
 * - 词形限制成纯字母（允许连字符和撇号），挡掉缩写、词组和带数字的条目
 * - 首行是 [计] [法] 这类学科标注的条目排掉：那种词条只有专业义项，
 *   拿来当日常新词没意义（7533 个 CEFR 候选里只有 11 个，损失可以忽略）
 * - 短的全大写词排掉：TV / AM / FAX 这类缩写不适合当每日新词。
 *   只掐长度 <= 4 是为了留下 American / Chinese / English 这些真该学的专有词。
 *
 * 列名一律带 d. 前缀：拼进 word_level 的 join 时 word 两边都有，不限定会报
 * ambiguous。所以用这个片段的查询必须把 dictionary 起名成 d。
 */
const QUALITY = `d.translation IS NOT NULL AND d.translation <> ''
    AND d.phonetic IS NOT NULL AND d.phonetic <> ''
    AND (d.exchange IS NULL OR d.exchange NOT LIKE '%0:%')
    AND d.word ~ '^[a-zA-Z][a-zA-Z''-]*$'
    AND d.frq > 0
    AND split_part(d.translation, chr(10), 1) NOT LIKE '[%'
    AND NOT (d.word = upper(d.word) AND length(d.word) <= 4)`;

export type GradedWord = {
  term: string;
  phonetic: string;
  /** 词性，多个用 / 连接，如 "n./vt." */
  pos: string;
  /** 整理成一行的中文释义，见 formatSenses */
  meaning_zh: string;
  meaning_en: string;
  tag: string | null;
  frq: number;
};

/** ECDICT 的 [计] [医] [法] 这类学科标注行，对日常学习者是噪音 */
const DOMAIN_LINE = /^\[/;
/** 义项行开头的词性，如 "n. 装置, 设计" */
const POS_HEAD = /^([a-zA-Z]+\.)\s*/;
/** ECDICT 用 a. 表形容词、int. 表感叹词，统一成项目里其它地方的写法 */
const POS_ALIAS: Record<string, string> = { 'a.': 'adj.', 'int.': 'interj.' };
/** 卡片上释义就一行的位置，超了截断 */
const MEANING_MAX = 42;
/**
 * 词性最多显示几个。fine 这种词有 5 个词性，全列出来是 "n./adj./vt./vi./adv."，
 * 在卡片上比单词本身还长。释义里每段都带着词性前缀，这里截断不丢信息。
 */
const POS_MAX = 3;

/**
 * 把 ECDICT 的 translation 整理成一行能看的释义，同时把词性抽出来。
 *
 * 原始格式是每个词性一行（"n. 等待, 等候\nvt. 等候, 期待, 延缓..."），
 * 直接拼起来卡片上会是一大坨，所以每个词性只取前两个义项。
 * 抽词性是因为 dictionary.pos 这一列在这份数据里是空的，但信息就在释义行开头，
 * 而新词卡片要显示词性 —— 与其再问一次 AI，不如就地解析。
 */
export function formatSenses(translation: string): { pos: string; meaning_zh: string } {
  const lines = String(translation ?? '')
    .split('\n')
    .map((s) => s.trim())
    // ECDICT 有一批条目的释义行以 "+" 开头（如 gym → "+体育馆，体育训练"），
    // 那是它的补充标记，不是内容。不剥掉的话卡片上会显示 "+体育馆"。
    .map((s) => s.replace(/^\++\s*/, '').trim())
    .filter((l) => l && !DOMAIN_LINE.test(l));
  if (!lines.length) return { pos: '', meaning_zh: '' };

  // 只有一个词性时多给一个义项：反正就一段，信息密度可以高一点
  const keep = lines.length === 1 ? 3 : 2;
  const posList: string[] = [];
  const parts: string[] = [];

  for (const ln of lines) {
    const m = ln.match(POS_HEAD);
    const raw = m?.[1] ?? '';
    const pos = raw ? (POS_ALIAS[raw] ?? raw) : '';
    if (pos && !posList.includes(pos)) posList.push(pos);

    const senses = ln
      .slice(m?.[0].length ?? 0)
      .split(/[,，;；]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!senses.length) continue;

    // 多词性时每段都标上词性，不然"等待，等候，期待"分不出哪个义项属于哪个词性
    const seg = (lines.length > 1 && pos ? `${pos} ` : '') + senses.slice(0, keep).join('，');
    // 至少留一段，之后超长就停 —— 宁可少给义项，不让卡片被释义挤爆
    if (parts.length && [...parts, seg].join('；').length > MEANING_MAX) break;
    parts.push(seg);
  }

  return { pos: posList.slice(0, POS_MAX).join('/'), meaning_zh: parts.join('；') };
}

/**
 * ECDICT 把语法说明也塞在释义位置上（lost → "lose的过去式和过去分词"）。
 * 那不是义项，补进卡片只会占掉宝贵的显示长度还什么都没教。
 */
const GRAMMAR_NOTE = /(的过去式|的过去分词|的比较级|的最高级|的复数|的现在分词|的第三人称)/;

/**
 * 给「只有一个义项」的释义补上其余义项（数据源：本地 ECDICT）。
 *
 * 起因（2026-08-28 用户报）：查词卡上 introduce 只显示「介绍」一个意思，
 * 而 ECDICT 里有 "vt. 介绍, 引入, 采用, 输入"。原因是 seed 词和 AI 造的词
 * 往往只给一个义项，而入库时只做了"清洗"、没做"补全"。
 *
 * 两条规则（干跑真实数据踩出来的，改这里必须一起守）：
 * 1. **人工首义打头且绝不给它贴词性**。首义是挑过的核心义项（beans 在这个
 *    App 里首义是「咖啡豆」而非 ECDICT 的「豆子」），必须保留在最前。
 *    但它属于哪个词性这里判断不了 —— 猜 ECDICT 第一组会输出
 *    "n. 直地"（straight 的「直地」是 adv.）、"vi. 放松" 这种错误信息。
 *    词性整体已经在 pos 列显示，段落里不贴反而更干净。
 * 2. **同词性的补充义项并进首段**，不另起一段：fresh 的「新鲜的」和
 *    「新奇的」都是 adj.，分两段看着像两个词性。
 *
 * 已经有「；」（多义项）的释义原样返回 —— 不重复加工，也保证幂等。
 */
export function enrichSenses(
  meaningZh: string,
  translation: string,
  pos: string,
): string {
  const head = String(meaningZh ?? '').trim();
  if (!head || head.includes('；')) return head;

  /*
   * 首义按逗号拆成单项，作为去重的基准粒度。
   *
   * 2026-08-29 修：seen 原来装的是**整条**首义（"应该，将要"），而 picked
   * 是按逗号切开的**单项**（"应该"、"将要"）—— 粒度不一致，seen.has("应该")
   * 永远是 false，于是首义被原样再拼一遍。生产实锤：should 查出来是
   * 「应该，将要，应该，将要」。第 309 行那个幂等守卫也只认「；」，
   * 逗号连接的重复全漏过去了。
   */
  const headItems = head
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const lines = String(translation ?? '')
    .split('\n')
    .map((s) => s.trim().replace(/^\++\s*/, '').trim())
    .filter((l) => l && !DOMAIN_LINE.test(l));
  if (!lines.length) return head;

  // 首义所属词性只用来决定"该不该并段"，不写进文本。猜错只是多分一段。
  const headPos = pos.split('/')[0]?.trim() || null;
  const parts = [head];
  // 装单项而不是整条：这样 seen.has('应该') 才拦得住重复
  const seen = new Set(headItems);
  let merged = 0;

  for (const ln of lines) {
    const m = ln.match(POS_HEAD);
    const raw = m?.[1] ?? '';
    const linePos = raw ? (POS_ALIAS[raw] ?? raw) : '';
    const picked = ln
      .slice(m?.[0].length ?? 0)
      .split(/[,，;；]/)
      .map((s) => s.trim())
      .filter((s) => s && !seen.has(s) && !GRAMMAR_NOTE.test(s))
      .slice(0, lines.length === 1 ? 3 : 2);
    if (!picked.length) continue;
    for (const s of picked) seen.add(s);

    if (headPos && linePos === headPos && merged < 2) {
      const next = `${parts[0]}，${picked.join('，')}`;
      if ([next, ...parts.slice(1)].join('；').length <= MEANING_MAX) {
        parts[0] = next;
        merged += picked.length;
        continue;
      }
    }
    const seg = (lines.length > 1 && linePos ? `${linePos} ` : '') + picked.join('，');
    if ([...parts, seg].join('；').length > MEANING_MAX) break;
    parts.push(seg);
  }
  return parts.join('；');
}

/** 查 ECDICT 的原始 translation（给 enrichSenses 当补全数据源）。 */
export async function rawTranslation(term: string): Promise<string | null> {
  const q = term.trim().toLowerCase();
  if (!q) return null;
  const r = await one<{ translation: string | null }>(
    `SELECT translation FROM dictionary WHERE lower(word) = ? LIMIT 1`,
    [q],
  );
  return r?.translation ?? null;
}

function toGraded(r: Row): GradedWord {
  const { pos, meaning_zh } = formatSenses(String(r.translation ?? ''));
  return {
    term: String(r.word),
    phonetic: (r.phonetic as string | null) ?? '',
    pos,
    meaning_zh,
    meaning_en: String(r.definition ?? '').split('\n')[0]?.trim() ?? '',
    tag: (r.tag as string | null) ?? null,
    frq: Number(r.frq ?? 0),
  };
}

/**
 * 从词典里挑这个等级该学的词，按词频从高到低（越常用越先学）。
 *
 * 排除两类：这个用户已经在学的（user_words 里有的），以及调用方点名跳过的
 * （同一次组卷里已经挑过的词）。**不**排除 words 表里已存在但该用户没学过的词 ——
 * 那种词只是别人学过或者被查过，对这个用户仍然是新词。
 *
 * 为什么这里直接查 dictionary 而不是先把候选灌进 words 表：
 * words 表的语义是"有人在学的词"，灌进去会让它从几百行涨到上万行，
 * 而且大部分行永远不会被任何人关联。挑中了再 promote 单条，见 promoteDictWords。
 *
 * 等级从 word_level 来（人工标注）；那张表空着就退回 dictionary.tag 的考纲分级，
 * 见 TAG_BANDS。两条分支的返回形状一样，调用方不用区分。
 */
export async function pickGradedWords(
  userId: number,
  level: string,
  limit: number,
  skipTerms: string[] = [],
): Promise<GradedWord[]> {
  if (limit <= 0) return [];
  const skip = skipTerms.map((t) => t.trim().toLowerCase()).filter(Boolean);

  if (await levelsReady()) {
    const floor = LEVEL_FLOORS[level] ?? LEVEL_FLOORS.A2;
    return all<GradedWord>(
      `SELECT d.word, d.phonetic, d.definition, d.translation, d.tag, d.frq
         FROM word_level wl
         JOIN dictionary d ON d.word = wl.word
        WHERE wl.cefr = @level
          AND ${QUALITY}
          AND d.frq >= @floor
          AND NOT EXISTS (
            SELECT 1 FROM user_words uw
              JOIN words w ON w.id = uw.word_id
             WHERE uw.user_id = @userId AND lower(w.term) = lower(d.word)
          )
          AND lower(d.word) <> ALL(@skip::text[])
        ORDER BY d.frq
        LIMIT @limit`,
      { level, floor, userId, skip, limit },
    ).then((rows) => (rows as unknown as Row[]).map(toGraded));
  }

  const band = TAG_BANDS[level] ?? TAG_BANDS.A2;
  // tag 是空格分隔的多标签串，用词边界匹配避免 cet4 命中 cet40 这类
  const tagRe = `(^| )(${band.tags.join('|')})( |$)`;
  return all<GradedWord>(
    `SELECT d.word, d.phonetic, d.definition, d.translation, d.tag, d.frq
       FROM dictionary d
      WHERE ${QUALITY}
        AND d.tag ~ @tagRe
        AND d.frq >= @floor
        AND NOT EXISTS (
          SELECT 1 FROM user_words uw
            JOIN words w ON w.id = uw.word_id
           WHERE uw.user_id = @userId AND lower(w.term) = lower(d.word)
        )
        AND lower(d.word) <> ALL(@skip::text[])
      ORDER BY d.frq
      LIMIT @limit`,
    { tagRe, floor: band.frqFloor, userId, skip, limit },
  ).then((rows) => (rows as unknown as Row[]).map(toGraded));
}

/**
 * 这个等级还剩多少词可学。设置页/诊断用，也是"词表快用完了"的预警。
 */
export async function gradedPoolSize(userId: number, level: string): Promise<number> {
  if (await levelsReady()) {
    const r = await one<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM word_level wl
         JOIN dictionary d ON d.word = wl.word
        WHERE wl.cefr = @level
          AND ${QUALITY}
          AND d.frq >= @floor
          AND NOT EXISTS (
            SELECT 1 FROM user_words uw
              JOIN words w ON w.id = uw.word_id
             WHERE uw.user_id = @userId AND lower(w.term) = lower(d.word)
          )`,
      { level, floor: LEVEL_FLOORS[level] ?? LEVEL_FLOORS.A2, userId },
    );
    return r?.n ?? 0;
  }

  const band = TAG_BANDS[level] ?? TAG_BANDS.A2;
  const r = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM dictionary d
      WHERE ${QUALITY}
        AND d.tag ~ @tagRe
        AND d.frq >= @floor
        AND NOT EXISTS (
          SELECT 1 FROM user_words uw
            JOIN words w ON w.id = uw.word_id
           WHERE uw.user_id = @userId AND lower(w.term) = lower(d.word)
        )`,
    { tagRe: `(^| )(${band.tags.join('|')})( |$)`, floor: band.frqFloor, userId },
  );
  return r?.n ?? 0;
}

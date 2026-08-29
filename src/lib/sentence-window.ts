/**
 * 从一整段文本里截出「被点那个词所在的那一句」。
 *
 * 为什么需要：查词卡原来把**整篇阅读原文**当 context 发给后端
 * （TappableText 里 `context={text}`）。两个后果：
 *
 * ① 长文必 422 —— 后端 schema 卡 context ≤ 600，而实测 16 篇阅读里 9 篇
 *    是 600-683 字符，于是超过一半的阅读环节点任何词都查不了。
 * ② 就算放宽上限也不该发整篇 —— AI 判断词义只需要那一句，多给几百字符
 *    是纯浪费 token，还会稀释真正有用的线索。
 *
 * 所以改成发「所在句 + 必要时前后各一句」。上下文质量升了，体积降了。
 */

/** 句子边界。中英标点都算，省略号不当边界（`...` 里的点会切碎句子）。 */
const BOUNDARY = /[.!?。！？]/;

/**
 * 空行也算边界。
 *
 * 标题、小标题这类内容不带句末标点，只靠换行和正文分开 —— 光看标点的话
 * 「A New Fitness App Helps Mia\n\nOn Monday, Mia read…」会被当成一句，
 * 点正文第一句的词就会把标题一起发出去（实测多带 28 字符）。
 */
const BLANK_LINE = /\n\s*\n/g;

/**
 * 一句话最多带多长。
 *
 * 只用来兜超长句 —— 实测阅读单句最长不到 200，正常情况下用不到这个上限。
 *
 * 2026-08-29：这个值原来是 300，而且配了一段「句子太短就向两侧补邻句凑到
 * 300」的逻辑。那是过度设计：点 morning 时所在句只有 50 字符，于是它一路
 * 往后补了三句、发出去 264 字符。查一个词只需要它所在的那一句，邻句是噪声。
 */
export const WINDOW_MAX = 220;

/** 把文本按句子切开，保留每段在原文里的起止位置。 */
function splitSentences(text: string): { start: number; end: number }[] {
  // 空行处先硬切一刀（标题/段落分隔），下标要落在空白之后
  const hardCuts = new Set<number>();
  for (const m of text.matchAll(BLANK_LINE)) {
    hardCuts.add((m.index ?? 0) + m[0].length);
  }

  const out: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (hardCuts.has(i) && i > start) {
      out.push({ start, end: i });
      start = i;
    }
    if (!BOUNDARY.test(text[i])) continue;
    // 连续的标点（?! 或 ...）算同一个边界，一起吃掉
    let j = i;
    while (j + 1 < text.length && BOUNDARY.test(text[j + 1])) j++;
    // 引号/括号收在句末，跟着这一句走，别单独漂到下一句开头
    while (j + 1 < text.length && /["'”’)\]]/.test(text[j + 1])) j++;
    out.push({ start, end: j + 1 });
    start = j + 1;
    i = j;
  }
  if (start < text.length) out.push({ start, end: text.length });
  return out.filter((s) => text.slice(s.start, s.end).trim().length > 0);
}

/**
 * 取 offset 处那个词所在的句子；不够长就向两侧各补一句。
 *
 * offset 是**词在 text 里的字符下标**。给 -1 或越界值时退化成「从头截」，
 * 不抛异常 —— 查词是个随手动作，不该因为定位算错就整个失败。
 */
export function sentenceWindow(text: string, offset: number, max = WINDOW_MAX): string {
  const src = text ?? '';
  if (!src.trim()) return '';
  /*
   * 不管整段多短，都要切到句 —— 这里原来有个 `src.length <= max` 就整段返回的
   * 快捷路径，结果 220 字符以内的听力对话/语法例句仍然整段发出去。
   * 既然结论是「只发所在句」，就没有"够短所以整段发"这回事。
   */
  const sents = splitSentences(src);
  if (!sents.length) return src.slice(0, max).trim();

  // 命中哪一句：offset 落在区间内；越界就按最近的一句算
  let hit = sents.findIndex((s) => offset >= s.start && offset < s.end);
  if (hit < 0) hit = offset <= 0 ? 0 : sents.length - 1;

  /*
   * 就发所在这一句，不补邻句。
   *
   * 原来这里有个向两侧扩张、凑到 300 字符的循环。删掉的理由：判断一个词
   * 在句中的意思，所在句就是全部信息；邻句既是噪声也是白烧的 token。
   * 而且 context 只有「词典和库都查不到、走 AI 兜底」那条路才会被读到 ——
   * 为一条冷路径多发两百字符，每次点词都要付。
   */
  const win = src.slice(sents[hit].start, sents[hit].end).trim();
  // 单句本身就超过 max（超长句）：只能硬截，这是唯一需要截的情况
  return win.length <= max ? win : win.slice(0, max).trim();
}

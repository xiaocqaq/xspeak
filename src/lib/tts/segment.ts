/**
 * 把一段英文切成适合逐段合成的小块。
 *
 * ── 为什么不能整段发给 /api/speak ──
 *
 * 那个接口限长 300 字符（见 api/speak/route.ts 的 MAX_TEXT），而且合成时间
 * 基本和字数成正比：实测 194 字符要 13.36 秒（见 lib/tts/kokoro.ts 的实测表）。
 * 一篇阅读三四百字，整段合成要等半分钟以上，而且是「全部合完才出声」——
 * 点一下"朗读全文"然后盯着屏幕等 30 秒，不如不做。
 *
 * 切成句子以后：
 * 1. 第一句一两秒就能出声，后面的句子在前一句播放的几秒里预取，接得上；
 * 2. 每句单独进磁盘缓存，命中率比整段高得多 —— 同一句话换个上下文还是同一句；
 * 3. 顺带拿到了"现在读到第几句"，界面可以跟着高亮。
 *
 * ── 为什么是 220 而不是 300 ──
 *
 * 300 是接口上限，贴着上限切会让 query string 也贴着极限（文本要 URL 编码，
 * 一个引号变三个字符），而且 300 字符那一句本身就要十几秒。220 留了余量，
 * 正常英文句子几乎都在这个长度以内，切出来一句就是一句。
 */

/** 单块最长多少字符。留在 /api/speak 的 MAX_TEXT(300) 以内。 */
export const MAX_SEGMENT_CHARS = 220;

/**
 * 句末标点后面跟空白就断开。
 *
 * 用 lookbehind 而不是 split + 拼回去：标点要留在前一句里，
 * 不然合成出来的句子没有句末语调（而且 Kokoro 对没标点的短句还会
 * 偶发返回空音频，见 kokoro.ts 里那段说明）。
 *
 * 缩写会被误断（"Dr. Smith" 切成两块）—— 接受这个代价：
 * 读出来只是多一个停顿，而为了少一个停顿去维护缩写词表不值得。
 */
const SENTENCE_END = /(?<=[.!?。！？])\s+/;

/** 兜底切分点：分号、冒号、逗号、破折号。长句没有句号时用。 */
const SOFT_BREAK = /(?<=[;:,；：，—])\s+/;

/**
 * 按空格硬切。一句话 220 字符里连逗号都没有时才会走到这里
 * （正常英文写不出这种句子，但模型偶尔会吐没有标点的长串）。
 */
function hardWrap(text: string, limit: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    // 单个词就超长（URL、乱码）：单独成块，硬切单词只会让发音变成乱念
    if (word.length >= limit) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      out.push(word);
      continue;
    }
    if (cur && cur.length + 1 + word.length > limit) {
      out.push(cur);
      cur = word;
    } else {
      cur = cur ? `${cur} ${word}` : word;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 用某个分隔符把超长块继续切碎，切完还超长的交给下一级。 */
function breakUp(chunk: string, re: RegExp, limit: number): string[] {
  const pieces = chunk.split(re).map((s) => s.trim()).filter(Boolean);
  // 切不动（没有这种标点）就原样退回，让调用方走下一级
  if (pieces.length <= 1) return [chunk];

  /*
   * 切完再尽量合回去：逗号分句往往很短，一个逗号一块会让朗读变得一顿一顿。
   * 合到 limit 为止。
   */
  const out: string[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last && last.length + 1 + p.length <= limit) out[out.length - 1] = `${last} ${p}`;
    else out.push(p);
  }
  return out;
}

/**
 * 切分。返回的每块都保证非空、且长度 <= limit（除了单个超长词那种极端情况）。
 *
 * 三级降级：句号 → 分号/逗号 → 按空格硬切。
 */
export function segmentForSpeech(text: string, limit = MAX_SEGMENT_CHARS): string[] {
  const body = text.replace(/\s+/g, ' ').trim();
  if (!body) return [];
  if (body.length <= limit) return [body];

  const out: string[] = [];
  for (const sentence of body.split(SENTENCE_END)) {
    const s = sentence.trim();
    if (!s) continue;
    if (s.length <= limit) {
      out.push(s);
      continue;
    }
    for (const soft of breakUp(s, SOFT_BREAK, limit)) {
      if (soft.length <= limit) out.push(soft);
      else out.push(...hardWrap(soft, limit));
    }
  }
  return out;
}

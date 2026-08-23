/**
 * 发音评分。
 *
 * 原理说明（重要，别把它当成专业发音评测）：浏览器 Web Speech API 只返回识别出的
 * 文本，不给音素级别的声学得分。所以这里算的是"识别结果和目标句的一致度"——
 * 你念得清楚，识别器就能听对；念错或含糊，识别结果就会偏。
 * 它能可靠地告出「哪个词没被听清」，但不能告诉你「th 的舌位不对」。
 */

export type WordScore = {
  target: string;
  heard: string | null;
  status: 'ok' | 'close' | 'miss';
};

export type PronounceResult = {
  score: number;
  words: WordScore[];
  summaryZh: string;
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  const n = normalize(s);
  return n ? n.split(' ') : [];
}

/** 编辑距离，用于判断两个词是不是"接近"。 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

function similar(a: string, b: string): number {
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length, 1);
}

/**
 * 用最长公共子序列做词级对齐，再逐词判定。
 * 对齐比逐位比较更稳：漏读一个词不会让后面全部错位。
 */
export function scorePronunciation(target: string, transcript: string): PronounceResult {
  const t = tokens(target);
  const h = tokens(transcript);
  if (!t.length) {
    return { score: 0, words: [], summaryZh: '没有目标句子。' };
  }
  if (!h.length) {
    return {
      score: 0,
      words: t.map((w) => ({ target: w, heard: null, status: 'miss' as const })),
      summaryZh: '没听到内容，检查一下麦克风权限，然后再大声念一遍。',
    };
  }

  // LCS 表（相似度 >= 0.75 视为同一个词，容忍轻微识别偏差）
  const n = t.length;
  const m = h.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        similar(t[i - 1], h[j - 1]) >= 0.75
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // 回溯得到每个目标词的匹配情况
  const words: WordScore[] = t.map((w) => ({ target: w, heard: null, status: 'miss' }));
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (similar(t[i - 1], h[j - 1]) >= 0.75) {
      const sim = similar(t[i - 1], h[j - 1]);
      words[i - 1] = {
        target: t[i - 1],
        heard: h[j - 1],
        status: sim === 1 ? 'ok' : 'close',
      };
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  const ok = words.filter((w) => w.status === 'ok').length;
  const close = words.filter((w) => w.status === 'close').length;
  const miss = words.filter((w) => w.status === 'miss').length;
  // 完全对得 1 分，接近得 0.6 分，漏掉 0 分；多念的词轻微扣分
  const extra = Math.max(0, m - (ok + close));
  const raw = (ok + close * 0.6) / n - extra * 0.03;
  const score = Math.max(0, Math.min(100, Math.round(raw * 100)));

  return { score, words, summaryZh: summarize(score, words, miss, close) };
}

function summarize(score: number, words: WordScore[], miss: number, close: number): string {
  const problems = words
    .filter((w) => w.status !== 'ok')
    .slice(0, 4)
    .map((w) => (w.heard ? `${w.target}（听成 ${w.heard}）` : w.target));
  if (score >= 90) return '很清楚，整句都听得准。';
  if (score >= 75) {
    return problems.length
      ? `整体不错。这几个词还可以更清楚：${problems.join('、')}。`
      : '整体不错，继续保持。';
  }
  if (score >= 50) {
    return `能听懂大意，但有 ${miss + close} 个词不够清楚：${problems.join('、')}。放慢一点，把词尾读完整。`;
  }
  return `识别偏差比较大，先放慢速度逐词念：${problems.join('、')}。也可以先点喇叭听一遍再跟读。`;
}

/**
 * 环节答题进度的本地存档。
 *
 * 为什么需要：环节组件的进度（第几题、答对哪几个、已收集的 FSRS 记账）
 * 原来全是 useState —— 刷新、切到别的环节再切回来、手机上被系统回收标签页，
 * 一律从第一题重来。更糟的是 warmup 的 collected 是内存累积、只在最后一次
 * onDone 提交，所以中途离开等于**已答的题连复习记录一起丢**（用户实测：
 * 「热身复习的记录也没有本地存储，每次进去都要重新开始学习」）。
 *
 * 为什么放本地而不是入库：进度是「这台设备上这一次做到哪」，不是学习成果。
 * 学习成果（FSRS、错题）本来就在库里，由 onDone 提交。进度做成服务端状态
 * 要加表、加接口、还要处理多设备并发写，收益只有换设备续做 —— 不值。
 * 清缓存/换设备退回「从第一题开始」，和现在的行为一样，无害。
 *
 * 存档带指纹：换一批词、第二天新的题目、到期词变了，旧进度立刻作废，
 * 不会出现「第 7 题」指向一个只有 3 题的队列。
 */

const KEY = 'xlearn.stage-progress.v1';

/**
 * 热身的存档内容。
 *
 * words/mistakes 就是 ReviewBody 里那两块 —— 存下来是为了「答到第 9 题退出，
 * 回来接着答完，前 8 题的 FSRS 记账一起提交」。这里故意用结构类型而不是
 * import ReviewBody：这个模块是纯前端存储，不该依赖环节的类型定义。
 */
export type WarmupProgress = {
  idx: number;
  results: boolean[];
  resultTerms: string[];
  words: { wordId: number; rating: 1 | 2 | 3 | 4; mode?: string; elapsedMs?: number; context?: string }[];
  mistakes: {
    kind: 'grammar' | 'word_choice' | 'spelling' | 'style' | 'pronunciation' | 'listening' | 'reading';
    stage?: string;
    wordId?: number | null;
    grammarId?: number | null;
    wrong: string;
    correct?: string | null;
    note?: string | null;
  }[];
};

/**
 * 新词的存档内容。
 *
 * revealed 存的是**词 id**而不是下标：下标会被「换一批词」错位，
 * id 换了批次自然对不上，多一层保险。
 */
export type NewWordsProgress = {
  idx: number;
  revealedIds: number[];
};

/** 最多留几条环节存档。一天最多 6 条，留 24 条 ≈ 最近四天，够了。 */
const MAX_ENTRIES = 24;

/** 超过这个天数的存档直接丢 —— 隔天的进度没有续做价值。 */
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

type Entry = {
  /** 题目队列的指纹，对不上就作废 */
  fp: string;
  /** 写入时间，用于过期清理 */
  at: number;
  data: unknown;
};

type Store = Record<string, Entry>;

function readStore(): Store {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Store;
  } catch {
    // 隐私模式会抛，坏 JSON 也会抛 —— 当作没有存档
    return {};
  }
}

function writeStore(s: Store): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 配额满/隐私模式：功能退化成「只在本次会话内保持」，不该影响答题
  }
}

/** 丢掉过期的和最老的，别让存档无限长。 */
function prune(s: Store): Store {
  const now = Date.now();
  const alive = Object.entries(s).filter(([, e]) => e && now - (e.at ?? 0) < MAX_AGE_MS);
  // 新的在前，砍掉尾巴
  alive.sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0));
  return Object.fromEntries(alive.slice(0, MAX_ENTRIES));
}

function keyOf(sessionId: number, stage: string): string {
  return `${sessionId}:${stage}`;
}

/**
 * 题目队列的指纹。
 *
 * 用「稳定的题面标识」而不是整个 payload 的哈希：payload 里有 intro_zh 这类
 * 文案，换了不影响进度有效性。传进来的应该是决定队列长度和顺序的东西
 * （词 id、题目 term），顺序敏感 —— 顺序变了第 N 题就不是同一题。
 */
export function fingerprint(parts: readonly (string | number | null | undefined)[]): string {
  const s = parts.map((p) => String(p ?? '')).join('|');
  // djb2：够短够稳，不需要密码学强度
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${parts.length}-${(h >>> 0).toString(36)}`;
}

/**
 * 读某个环节的进度。指纹对不上（题目换了）返回 null。
 *
 * 注意要在 useState 初始化器里同步调用，别放 effect —— 放 effect 会先渲染
 * 一帧「第 1 题」再跳到第 7 题，看着像闪屏。
 */
export function loadProgress<T>(sessionId: number, stage: string, fp: string): T | null {
  const s = readStore();
  const e = s[keyOf(sessionId, stage)];
  if (!e || e.fp !== fp) return null;
  if (Date.now() - (e.at ?? 0) >= MAX_AGE_MS) return null;
  return (e.data as T) ?? null;
}

/** 写进度。每答一题调一次，成本是一次 JSON.stringify，可以忽略。 */
export function saveProgress(sessionId: number, stage: string, fp: string, data: unknown): void {
  const s = readStore();
  s[keyOf(sessionId, stage)] = { fp, at: Date.now(), data };
  writeStore(prune(s));
}

/**
 * 清掉某个环节的进度。环节做完时调 —— 留着只会让「重做这一环」时
 * 直接跳到最后一题。
 */
export function clearProgress(sessionId: number, stage: string): void {
  const s = readStore();
  delete s[keyOf(sessionId, stage)];
  writeStore(s);
}

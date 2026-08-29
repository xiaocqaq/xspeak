'use client';

/**
 * 对话场景的浏览器侧缓存。
 *
 * 生成一批场景要调一次 AI，真实耗时 20~30 秒。而对话页是个普通路由，
 * 离开 /chat 组件就卸载了，回来时 useRef 那道防重入的门也跟着重置 ——
 * 结果切走再切回就是重新生成一批，等半分钟，还白花一次 token。
 * 所以把生成结果落一份到 localStorage：回到页面先读缓存，命中就直接显示。
 *
 * 缓存按「天」失效。每天的 session 换了主题和目标词，昨天的场景绑的是昨天的词，
 * 拿来练不算今天的 produced，不如重新生成。
 *
 * 「生成」「换一批」是用户明确要新的，照旧调 AI，回来覆盖缓存。
 */

import type { ChatScenario } from './types';

/**
 * 存储键沿用旧前缀（项目曾叫 linxi），和 linxi.speechPace / linxi.ttsVoice 保持一致。
 * 见 pace-store.ts 里的说明：换前缀会让已经存在用户浏览器里的偏好读不到。
 */
const KEY = 'linxi.chatScenarios';

export type CachedScenarios = {
  scenarios: ChatScenario[];
  themeZh: string;
  sessionId: number | null;
  themeSlug: string | null;
  /** 最近出现过的场景名，「换一批」时告诉后端别再出这些 */
  seen: string[];
};

type Stored = CachedScenarios & {
  /** 生成时的本地日期 'YYYY-MM-DD'，换天就作废 */
  day: string;
};

/** 本地日期。没直接用 scheduler 里的 localDay：那个模块会把 ts-fsrs 拖进浏览器包。 */
function today(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 只认结构对得上的缓存。手改过、或旧版本写的半截数据，一律当没有。 */
function valid(v: unknown): v is Stored {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.day !== 'string' || !Array.isArray(o.scenarios) || o.scenarios.length === 0) return false;
  return o.scenarios.every((s) => {
    if (!s || typeof s !== 'object') return false;
    const c = s as Record<string, unknown>;
    return (
      typeof c.zh === 'string' &&
      typeof c.hint === 'string' &&
      typeof c.aiRole === 'string' &&
      typeof c.openingEn === 'string' &&
      Array.isArray(c.targetTerms) &&
      Array.isArray(c.targetWordIds)
    );
  });
}

/** 读今天的缓存。没有、过期、或存坏了都返回 null。 */
export function readScenarios(): CachedScenarios | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // 隐私模式下 localStorage 会抛，当作没缓存
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!valid(parsed) || parsed.day !== today()) return null;
  return {
    scenarios: parsed.scenarios,
    themeZh: typeof parsed.themeZh === 'string' ? parsed.themeZh : '',
    sessionId: typeof parsed.sessionId === 'number' ? parsed.sessionId : null,
    themeSlug: typeof parsed.themeSlug === 'string' ? parsed.themeSlug : null,
    seen: Array.isArray(parsed.seen) ? parsed.seen.filter((s): s is string => typeof s === 'string') : [],
  };
}

export function writeScenarios(v: CachedScenarios): void {
  if (typeof window === 'undefined') return;
  const stored: Stored = { ...v, day: today() };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // 写不进去（配额满 / 隐私模式）不影响本次会话，内存里已经有这批场景了
  }
}

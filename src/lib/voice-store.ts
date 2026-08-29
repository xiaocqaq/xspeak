'use client';

/**
 * 朗读音色偏好的浏览器侧缓存。
 *
 * 和 pace-store 是同一个道理，也是同一个坑：朗读按钮（useTts）散在新词、听力、
 * 阅读、跟读等十几个纯展示组件里，没有共同父级去传档案。这些调用点原来一律
 * 写成 `useTts()` —— 不带参数，于是 pickVoice 永远走"取第一个本地英文包"的
 * 默认分支。结果是设置页里选的音色只对设置页自己的试听生效，退出去到任何一个
 * 环节又变回系统默认，看着就像"切换音色没反应"。
 *
 * 所以档案里的 voice 落一份到 localStorage：useTts 同步读它当默认音色，
 * 设置页改完立刻写回并广播。localStorage 只是缓存，真值仍在数据库 ——
 * 换设备时由 /api/profile 回填。
 *
 * 存的是语音包名字（SpeechSynthesisVoice.name，如 "Moira"）而不是索引：
 * 索引在不同系统、甚至同一系统装卸语音包后都会变。名字在这台机器上找不到时
 * pickVoice 会自己退回默认包，不会哑掉。
 */

/** 存储键沿用旧前缀（项目曾叫 linxi），和 pace-store 保持一致。 */
const KEY = 'linxi.ttsVoice';
/** 自建音色偏好的独立键（双音色方案：在线 + 自建各存一个）。 */
const KEY_OFFLINE = 'linxi.ttsVoiceOffline';
/** storage 事件只跨标签页触发，同页内改动要靠自定义事件通知。 */
const EVENT = 'linxi:voice';
const EVENT_OFFLINE = 'linxi:voiceOffline';

/** null = 跟随系统默认（设置页里的第一项）。 */
export function readVoice(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(KEY);
    return v && v.trim() ? v : null;
  } catch {
    // 隐私模式下 localStorage 会抛，退回系统默认
    return null;
  }
}

export function writeVoice(next: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (next) window.localStorage.setItem(KEY, next);
    else window.localStorage.removeItem(KEY);
  } catch {
    // 写不进去也不影响本次会话，内存里的偏好由事件传递
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

/** 订阅音色变化。返回取消订阅的函数。 */
export function subscribeVoice(fn: (v: string | null) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onLocal = () => fn(readVoice());
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) fn(readVoice());
  };
  window.addEventListener(EVENT, onLocal);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, onLocal);
    window.removeEventListener('storage', onStorage);
  };
}

/* ---------------- 自建（Kokoro）音色偏好：同一套机制的平行副本 ---------------- */

/** 读自建音色偏好。null = 跟随默认（af_heart）。 */
export function readOfflineVoice(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(KEY_OFFLINE);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

export function writeOfflineVoice(next: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (next) window.localStorage.setItem(KEY_OFFLINE, next);
    else window.localStorage.removeItem(KEY_OFFLINE);
  } catch {
    /* 同上：写不进也不影响本次会话 */
  }
  window.dispatchEvent(new CustomEvent(EVENT_OFFLINE, { detail: next }));
}

export function subscribeOfflineVoice(fn: (v: string | null) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onLocal = () => fn(readOfflineVoice());
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY_OFFLINE) fn(readOfflineVoice());
  };
  window.addEventListener(EVENT_OFFLINE, onLocal);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT_OFFLINE, onLocal);
    window.removeEventListener('storage', onStorage);
  };
}

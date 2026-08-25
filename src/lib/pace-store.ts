'use client';

/**
 * 语速偏好的浏览器侧缓存。
 *
 * 为什么需要它：逐句朗读（useTts）散布在听力、新词、跟读、对话等十几个位置，
 * 都是纯展示组件，没有一个共同的父级去传档案。如果让每个调用点自己去读
 * /api/profile，会变成十几次重复请求，而且首帧拿不到值 —— 朗读按钮点下去
 * 用的还是旧语速。
 *
 * 所以档案里的 speech_pace 落一份到 localStorage：useTts 同步读它当默认语速，
 * 设置页改完立刻写回并广播，已挂载的组件下一次朗读就是新语速。
 * localStorage 只是缓存，真值仍在数据库 —— 换设备时由 /api/profile 回填。
 */

import { DEFAULT_PACE, PACE_KEYS, pace } from './voice-options';
import type { SpeechPace } from './types';

/**
 * 存储键沿用旧前缀（项目曾叫 linxi）。
 * 改成 xlearn 会让已经存在用户浏览器里的语速偏好读不到，不值得为了命名一致耍丢它。
 */
const KEY = 'linxi.speechPace';
/** storage 事件只跨标签页触发，同页内改动要靠自定义事件通知。 */
const EVENT = 'linxi:pace';

export function readPace(): SpeechPace {
  if (typeof window === 'undefined') return DEFAULT_PACE;
  try {
    const v = window.localStorage.getItem(KEY);
    return PACE_KEYS.includes(v as SpeechPace) ? (v as SpeechPace) : DEFAULT_PACE;
  } catch {
    // 隐私模式下 localStorage 会抛，退回默认档
    return DEFAULT_PACE;
  }
}

export function writePace(next: SpeechPace): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    // 写不进去也不影响本次会话，内存里的偏好由事件传递
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

/** 订阅语速变化。返回取消订阅的函数。 */
export function subscribePace(fn: (p: SpeechPace) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onLocal = () => fn(readPace());
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) fn(readPace());
  };
  window.addEventListener(EVENT, onLocal);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, onLocal);
    window.removeEventListener('storage', onStorage);
  };
}

/** 当前档位对应的 Web Speech rate。 */
export function currentWebSpeechRate(): number {
  return pace(readPace()).webSpeechRate;
}

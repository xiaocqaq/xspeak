/**
 * voice-options.mjs 的类型门面。
 * 运行时常量在 .mjs 里（server.mjs 要用，见那边的头注释），这里只补类型并原样转出。
 */

import {
  AI_VOICES as RAW_AI_VOICES,
  AI_VOICE_IDS as RAW_AI_VOICE_IDS,
  AI_VOICE_GROUPS as RAW_AI_VOICE_GROUPS,
  PACES as RAW_PACES,
  PACE_KEYS as RAW_PACE_KEYS,
  DEFAULT_AI_VOICE as RAW_DEFAULT_AI_VOICE,
  DEFAULT_PACE as RAW_DEFAULT_PACE,
  pace as rawPace,
} from './voice-options.mjs';

import type { SpeechPace } from './types';

export type AiVoiceGroupKey = 'female' | 'male';

export type AiVoice = { id: string; zh: string; hint: string; group: AiVoiceGroupKey };

export type AiVoiceGroup = { key: AiVoiceGroupKey; zh: string };

export type PaceSpec = {
  zh: string;
  hint: string;
  /** StepFun TTS 的 speed 参数：真语速 */
  ttsSpeed: number;
  /** 浏览器 SpeechSynthesis 的 rate：真语速 */
  webSpeechRate: number;
  /** 畅聊播放倍速：会变调，只在 0.9~1.1 内动 */
  playbackRate: number;
  /** 写进 realtime instructions 的软要求 */
  instruction: string;
};

export const AI_VOICES = RAW_AI_VOICES as AiVoice[];
export const AI_VOICE_IDS = RAW_AI_VOICE_IDS as string[];
export const AI_VOICE_GROUPS = RAW_AI_VOICE_GROUPS as AiVoiceGroup[];
export const DEFAULT_AI_VOICE = RAW_DEFAULT_AI_VOICE as string;
export const PACES = RAW_PACES as Record<SpeechPace, PaceSpec>;
export const PACE_KEYS = RAW_PACE_KEYS as SpeechPace[];
export const DEFAULT_PACE = RAW_DEFAULT_PACE as SpeechPace;
export const pace = rawPace as (key: string | null | undefined) => PaceSpec;

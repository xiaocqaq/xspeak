/**
 * 服务端 TTS 的合成层（仅服务端用，import 了 node:fs —— 别从客户端组件引）。
 *
 * 音色表/分组/归属判断这些纯数据在 ./server-voice-list（客户端安全），
 * 这边只留「调云端 MiMo 合成」的统一入口。拆两个文件的原因见
 * server-voice-list.ts 的头注释。
 *
 * 2026-09-09：自建 Kokoro 下线，这里不再有 provider 分流，只有 MiMo 一家。
 */

import { mimoConfig, mimoSpeakCached } from './mimo';

export async function speakWithProvider(
  text: string,
  voiceId: string,
): Promise<{ audio: Buffer; hit: boolean; key: string }> {
  // MiMo 没有语速参数，恒按 1.0 合成（缓存键也按 1.0 算，换档位不重复花钱）
  return mimoSpeakCached(text, voiceId, 1);
}

/** 配了 MiMo 密钥才算「本站音色可用」。 */
export function serverTtsEnabled(): boolean {
  return mimoConfig().enabled;
}

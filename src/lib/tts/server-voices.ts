/**
 * 服务端 TTS 的合成层（仅服务端用，import 了 node:fs —— 别从客户端组件引）。
 *
 * 音色表/分组/provider 判断这些纯数据在 ./server-voice-list（客户端安全），
 * 这边只留「按 provider 发合成请求」的统一入口。拆两个文件的原因见
 * server-voice-list.ts 的头注释。
 */

import { kokoroConfig, speakCached as kokoroSpeakCached } from './kokoro';
import { mimoConfig, mimoSpeakCached } from './mimo';
import type { ServerVoiceProvider } from './server-voice-list';
import { serverVoiceProvider } from './server-voice-list';

export async function speakWithProvider(
  text: string,
  voiceId: string,
  speed: number,
): Promise<{ audio: Buffer; hit: boolean; key: string; provider: ServerVoiceProvider }> {
  if (serverVoiceProvider(voiceId) === 'mimo') {
    const { audio, hit, key } = await mimoSpeakCached(text, voiceId, speed);
    return { audio, hit, key, provider: 'mimo' };
  }
  const cfg = kokoroConfig();
  const { audio, hit, key } = await kokoroSpeakCached(text, voiceId, speed, cfg);
  return { audio, hit, key, provider: 'kokoro' };
}

/** 两家只要有一家配了就算「本站音色可用」。 */
export function serverTtsEnabled(): boolean {
  return mimoConfig().enabled || kokoroConfig().enabled;
}

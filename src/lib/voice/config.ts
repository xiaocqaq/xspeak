/**
 * 语音服务配置的类型门面。
 *
 * 实现在同目录的 config.mjs —— server.mjs 和中转层跑在 Next 编译流程之外，
 * 用不了 TS，所以真正的解析逻辑放 .mjs 让两边共享一份，这里只补类型。
 * 环境变量清单和实测约束都写在 config.mjs 的头注释里。
 */

import { voiceConfig as raw, MISSING_KEY_MESSAGE } from './config.mjs';

export type VoiceConfig = {
  /** 服务商标识，只用于日志和报错文案 */
  provider: string;
  /** 没配 key 时是 undefined，调用方必须自己挡掉 */
  apiKey: string | undefined;
  realtimeUrl: string;
  realtimeModel: string;
  ttsUrl: string;
  ttsModel: string;
  asrModel: string;
  defaultVoice: string;
};

export const voiceConfig = raw as () => VoiceConfig;
export { MISSING_KEY_MESSAGE };

/**
 * 语音服务配置。
 *
 * 语音这条线有三块：realtime（端到端语音对话）、tts（音色试听）、asr（转写）。
 * 现在的实现是 StepFun，但**地址、模型名、音色、key 全部走环境变量**，
 * 换服务商不用改代码 —— 只要对方也是 OpenAI Realtime 那套事件协议就能直接接。
 *
 * 这个文件是 .mjs：server.mjs 跑在 Next 编译流程之外，用不了 TS 和路径别名，
 * 中转层（relay.mjs）要读同一份配置，所以放这里，TS 侧再包一层 config.ts 转出去。
 *
 * 环境变量：
 *
 *   VOICE_PROVIDER        标识用的服务商名，只进日志和报错文案，默认 stepfun
 *   VOICE_API_KEY         语音服务密钥（没配就回落 STEP_API_KEY）
 *   VOICE_REALTIME_URL    realtime WebSocket 地址
 *   VOICE_REALTIME_MODEL  realtime 模型名
 *   VOICE_TTS_URL         TTS 接口地址（OpenAI 风格的 /audio/speech）
 *   VOICE_TTS_MODEL       TTS 模型名
 *   VOICE_ASR_MODEL       转写模型名，写进 session.update
 *   VOICE_DEFAULT_VOICE   默认音色 id
 *
 * 旧变量 STEP_API_KEY / STEP_REALTIME_URL / STEP_TTS_URL 仍然认，
 * 所以现有的 .env.local 不改也能跑。
 */

/** 读环境变量，空串当没配。 */
function env(name) {
  const v = process.env[name];
  const t = typeof v === 'string' ? v.trim() : '';
  return t || undefined;
}

function pick(...names) {
  for (const n of names) {
    const v = env(n);
    if (v) return v;
  }
  return undefined;
}

/**
 * StepFun 的默认值。
 *
 * 两个实测硬约束，换服务商之前先看 protocol.mjs 头注释：
 * - 地址是 /step_plan/v1/realtime，不是文档写的 /v1/realtime；
 * - 不能开 server_vad，否则拿不到学生原话的转写。
 */
const STEPFUN = {
  realtimeUrl: 'wss://api.stepfun.com/step_plan/v1/realtime',
  realtimeModel: 'stepaudio-2.5-realtime',
  ttsUrl: 'https://api.stepfun.com/step_plan/v1/audio/speech',
  ttsModel: 'stepaudio-2.5-tts',
  asrModel: 'stepaudio-2.5-asr',
  defaultVoice: 'jingdiannvsheng',
};

/**
 * 当前语音配置。
 *
 * 每次调用重新读环境变量，不缓存 —— 一次通话的开销远大于读几个字符串，
 * 换来的是改完 .env.local 重启即生效。
 *
 * @returns {{
 *   provider: string,
 *   apiKey: string | undefined,
 *   realtimeUrl: string,
 *   realtimeModel: string,
 *   ttsUrl: string,
 *   ttsModel: string,
 *   asrModel: string,
 *   defaultVoice: string,
 * }}
 */
export function voiceConfig() {
  return {
    provider: env('VOICE_PROVIDER') ?? 'stepfun',
    apiKey: pick('VOICE_API_KEY', 'STEP_API_KEY'),
    realtimeUrl: pick('VOICE_REALTIME_URL', 'STEP_REALTIME_URL') ?? STEPFUN.realtimeUrl,
    realtimeModel: env('VOICE_REALTIME_MODEL') ?? STEPFUN.realtimeModel,
    ttsUrl: pick('VOICE_TTS_URL', 'STEP_TTS_URL') ?? STEPFUN.ttsUrl,
    ttsModel: env('VOICE_TTS_MODEL') ?? STEPFUN.ttsModel,
    asrModel: env('VOICE_ASR_MODEL') ?? STEPFUN.asrModel,
    defaultVoice: env('VOICE_DEFAULT_VOICE') ?? STEPFUN.defaultVoice,
  };
}

/** 缺 key 时的统一提示，中转层和 TTS 接口共用一份文案。 */
export const MISSING_KEY_MESSAGE =
  '服务端缺少语音服务密钥，请在 .env.local 里配 VOICE_API_KEY（或 STEP_API_KEY）。';

/**
 * 实时语音对话的共享运行时常量。
 *
 * 这个文件是 .mjs 而不是 .ts，因为自定义 server（server.mjs）跑在 Next 的编译流程之外，
 * 用不了 TS 的 `@/` 路径别名。做成 .mjs 之后，server.mjs 和 TS 侧（protocol.ts）
 * 都能 import 同一份，不需要把常量抄两遍。
 *
 * 类型定义在同目录的 protocol.ts 里。
 *
 * ── 架构 ──
 *
 *   浏览器 ──ws://本机/api/realtime──▶ server.mjs ──wss://api.stepfun.com──▶ StepFun
 *
 * 为什么要中转：浏览器的 WebSocket 不能带自定义请求头，而 StepFun 唯一支持的
 * 浏览器侧鉴权是把 key 塞进子协议 —— 那等于把 API key 明文发给客户端。
 * 中转之后 key 只留在服务端。
 *
 * ── 两个实测硬约束（和官方文档不一致，改之前先跑 scripts/probe-realtime.mjs）──
 *
 * 1. 服务地址是 `/step_plan/v1/realtime`，不是文档写的 `/v1/realtime`（后者连不上，
 *    而且那个 base 的配额已用尽）。
 * 2. 不能开 `server_vad`。一旦带上它，服务端会静默丢弃 `input_audio_transcription`
 *    配置，拿不到学生原话的转写，教学闭环就断了。所以只用手动模式：
 *    前端按住说话、松手 commit，服务端才回转写。
 */

/** 采样率。上下行同频，用「输出音频回灌」验证过。 */
export const SAMPLE_RATE = 16_000;

/** 一片音频的时长。100ms @16k mono s16le = 3200 字节。 */
export const CHUNK_MS = 100;

export const REALTIME_MODEL = 'stepaudio-2.5-realtime';

/** 转写学生原话用的 ASR 模型，写在 session.update 的 input_audio_transcription 里。 */
export const ASR_MODEL = 'stepaudio-2.5-asr';

/** Realtime 的默认音色。和 TTS 接口的音色名不通用。 */
export const DEFAULT_VOICE = 'jingdiannvsheng';

/** 中转层监听的 WebSocket 路径。 */
export const REALTIME_PATH = '/api/realtime';

/** 上游默认地址，可用 STEP_REALTIME_URL 覆盖。 */
export const UPSTREAM_URL = 'wss://api.stepfun.com/step_plan/v1/realtime';

/** 上游音频格式，session.update 时原样发过去。 */
export const UPSTREAM_AUDIO = {
  input_audio_format: 'pcm16',
  output_audio_format: 'pcm16',
};

/**
 * 拼 instructions。
 *
 * 关键一条是明确禁止 AI 纠错 —— 纠正由旁路的文本分析负责。畅聊模式的价值就在
 * 「不被打断地把话说完」，如果语音这条线也开始挑错，两件事会互相削弱。
 */
export function buildInstructions({ aiRole, targetTerms, level, paceInstruction }) {
  const lines = [
    `You are ${aiRole}. You are helping a Chinese learner practice spoken English.`,
    `Their level is ${level}, so keep your sentences short and your vocabulary simple.`,
    'Reply in English only, one or two sentences at a time, then let them speak.',
    // 语速只能这样软控制：realtime 完全没有语速参数（实测见 voice-options.mjs 头注释），
    // 模型基本会听，但不精确、每回合不完全一致。
    paceInstruction || 'Speak at a calm, clear pace, a little slower than a native speaker would.',
    'Sound like a real person in a real conversation: react to what they said, ask follow-up questions.',
    // 畅聊模式不打断
    'Do NOT correct their grammar or pronunciation, and do not comment on their mistakes.',
    'If you cannot understand them, just ask them to say it again in a friendly way.',
  ];
  if (targetTerms && targetTerms.length) {
    lines.push(
      `Try to steer the conversation so they naturally need these words: ${targetTerms.join(', ')}.`,
    );
  }
  return lines.join(' ');
}

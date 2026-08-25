/**
 * AI 音色与语速的共享定义。
 *
 * 和 realtime/protocol.mjs 同理做成 .mjs：server.mjs 跑在 Next 编译流程之外，
 * 用不了 `@/` 别名，中转层要读音色白名单和语速指令，所以常量放这里两边共享。
 * 类型门面在同目录的 voice-options.ts。
 *
 * ── 实测约束（2026-08-24 探测，改之前先重跑 scripts/probe-realtime.mjs）──
 *
 * 1. realtime 的 session.update 只认官方音色 id，不认的会明确报
 *    "voice xxx is not valid"，不是静默降级。
 * 2. 官方音色里有 yingwennansheng / yingwennvsheng（英文男女声），但 realtime
 *    明确拒绝它们 —— 那两个只属于 step-tts-2 系的 TTS 模型。所以畅聊只能让
 *    中文音色说英文，口音会偏中式，这是上游能力边界，不是我们的实现问题。
 * 3. realtime 完全没有语速参数。speed / speech_rate / rate / audio.output.speed
 *    四种写法服务端都静默忽略（不报错，但 session.updated 回显里不出现）。
 *    唯一被保留的 volume_ratio 是音量。所以畅聊语速只能软控制 + 播放倍速。
 * 4. TTS 接口（/v1/audio/speech，model=stepaudio-2.5-tts）反而支持 speed，
 *    音色试听走它 —— 既能真实反映语速，也不用为试听建一条 realtime 连接。
 *    realtime 连续快速建连会被限流，试听如果走 realtime 会连锁失败。
 */

/**
 * 畅聊可用的音色。都是官方内置音色，realtime 接受。
 * 顺序按「听起来适合陪练」排，第一个是默认。
 */
export const AI_VOICES = [
  { id: 'jingdiannvsheng', zh: '经典女声', hint: '清亮标准，默认' },
  { id: 'linjiajiejie', zh: '邻家姐姐', hint: '亲和自然，语速偏稳' },
  { id: 'linjiameimei', zh: '邻家妹妹', hint: '年轻活泼，稚气感' },
  { id: 'qinqienvsheng', zh: '亲切女声', hint: '温和耐心' },
  { id: 'zhixingjiejie', zh: '知性姐姐', hint: '沉稳清晰，像老师' },
  { id: 'shuangkuaijiejie', zh: '爽快姐姐', hint: '干脆利落，节奏快' },
  { id: 'wenrounansheng', zh: '温柔男声', hint: '轻缓，听起来不紧张' },
  { id: 'qingniandaxuesheng', zh: '青年大学生', hint: '同龄人感，随意' },
  { id: 'zhengpaiqingnian', zh: '正派青年', hint: '端正清楚' },
  { id: 'ruyananshi', zh: '儒雅男士', hint: '偏慢偏稳，适合听力吃力时' },
];

export const AI_VOICE_IDS = AI_VOICES.map((v) => v.id);

/**
 * 三档语速。同一个档位在三条链路上是不同的实现手段：
 *
 * - ttsSpeed：TTS 接口的 speed，真语速，用于音色试听
 * - webSpeechRate：浏览器 SpeechSynthesis 的 rate，真语速，用于逐句朗读
 * - playbackRate：畅聊播放倍速，会连带变调，所以只在 0.9~1.1 内动。
 *   再往外调声音会明显发闷或发尖，得不偿失。
 * - instruction：写进 realtime instructions 的软要求。模型基本会听，
 *   但不精确、每次不完全一致 —— 界面上要如实说明这一点。
 */
export const PACES = {
  slow: {
    zh: '慢',
    hint: '听不清时用这档',
    ttsSpeed: 0.8,
    webSpeechRate: 0.8,
    playbackRate: 0.92,
    instruction: 'Speak noticeably slowly and articulate each word clearly, with short pauses between sentences.',
  },
  normal: {
    zh: '正常',
    hint: '比母语者稍慢',
    ttsSpeed: 1,
    webSpeechRate: 0.92,
    playbackRate: 1,
    instruction: 'Speak at a calm, clear pace, a little slower than a native speaker would.',
  },
  fast: {
    zh: '快',
    hint: '接近真实语速',
    ttsSpeed: 1.2,
    webSpeechRate: 1.05,
    playbackRate: 1.08,
    instruction: 'Speak at a natural, conversational native pace.',
  },
};

export const PACE_KEYS = ['slow', 'normal', 'fast'];

export const DEFAULT_PACE = 'normal';

/** 取语速档位，非法值一律回落到 normal（老库刚补列时是 null）。 */
export function pace(key) {
  return PACES[key] ?? PACES[DEFAULT_PACE];
}

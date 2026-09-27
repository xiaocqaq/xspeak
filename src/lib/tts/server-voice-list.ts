/**
 * 服务端音色的「纯数据」层 —— 没有任何 node 依赖，客户端可以放心 import。
 *
 * 为什么单独拆一个文件：设置页（客户端组件）要拿分组表来画格子，
 * 原来放在 server-voices.ts 里的话，那个文件同时 import 了 mimo.ts
 * （node:fs），Turbopack 会把 node 模块追进浏览器 chunk，构建直接报
 * 「does not support external modules」。
 *
 * 拆分规则：
 * - 这里：音色表、分组、性别、归属判断 —— 纯常量纯函数；
 * - server-voices.ts：合成（speakWithProvider）、配置、缓存 —— 仅服务端。
 *
 * 2026-09-09：自建 Kokoro 整条下线，逐句朗读只走云端 MiMo，
 * 表里不再有 provider 字段，也不用再按 provider 分桶。
 */

export type ServerVoice = {
  id: string;
  zh: string;
  hint: string;
  /** 听力分嗓音用。MiMo 官方没标性别，按听感标的（2026-08-27 人耳验证） */
  gender: 'male' | 'female';
};

/** MiMo 的 4 个英文音色。官方没给性别标注，gender 是听感标注。 */
const MIMO_VOICES: ServerVoice[] = [
  { id: 'Mia', zh: '米娅', hint: '清亮女声，念课文干脆', gender: 'female' },
  { id: 'Chloe', zh: '克洛伊', hint: '沉稳女声，适合长句', gender: 'female' },
  { id: 'Milo', zh: '米洛', hint: '年轻男声，轻快', gender: 'male' },
  { id: 'Dean', zh: '迪恩', hint: '厚实男声，像新闻播音', gender: 'male' },
  // 2026-08-28 补齐：上游 400 报错列出的全部 9 个音色
  // （Available voices: [mimo_default, 冰糖, 茉莉, 苏打, 白桦, Mia, Chloe, Milo, Dean]），
  // 性别是逐个合成英文样本测 F0 基频定的（Mia 225Hz/Milo 139Hz 校准，方法可信）。
  { id: 'mimo_default', zh: '默认女声', hint: 'MiMo 出厂默认，明亮女声', gender: 'female' },
  { id: '冰糖', zh: '冰糖', hint: '清甜女声，音高偏高', gender: 'female' },
  { id: '茉莉', zh: '茉莉', hint: '柔和女声', gender: 'female' },
  { id: '苏打', zh: '苏打', hint: '女声，略低沉一点', gender: 'female' },
  { id: '白桦', zh: '白桦', hint: '低沉男声', gender: 'male' },
];

/**
 * 设置页展示。就一组 MiMo —— 云端快、母语质量，是逐句朗读唯一的上游。
 */
export const SERVER_VOICE_GROUPS: { key: string; zh: string; voices: ServerVoice[] }[] = [
  { key: 'mimo', zh: 'MiMo · 云端在线音色', voices: MIMO_VOICES },
];

/** 展示表平铺。 */
export const SERVER_VOICES: ServerVoice[] = SERVER_VOICE_GROUPS.flatMap((g) => g.voices);

/** 白名单判断：这个 id 是不是本站音色（会拿服务端 key 去调付费接口，不能放任意串透传）。 */
export function isServerVoice(voiceId: string): boolean {
  return SERVER_VOICES.some((v) => v.id === voiceId);
}

/** 默认音色。MiMo 第一个 —— 云端合成快，当门面。 */
export const DEFAULT_SERVER_VOICE = SERVER_VOICES[0]!.id;

/**
 * 把存库/存 localStorage 的偏好解析成 MiMo 裸 id。
 *
 * 只认 `mimo:xxx`；浏览器语音包名、以及已下线的 `kokoro:xxx` 老值
 * 一律返回 null（调用方按默认音色处理）。
 * 缓存键必须用裸 id（带前缀会算出另一个 key，历史上栽过两次）。
 *
 * 这个函数是**前后端共用的唯一入口**：听力分嗓音要在服务端预合成和
 * 浏览器播放两处算出完全一样的结果，否则预合成的音色和播放请求的音色
 * 对不上，缓存永远 miss。两边都调它，就不会漂。
 */
export function preferredMimoVoiceId(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const MIMO_PREFIX = 'mimo:';
  if (!stored.startsWith(MIMO_PREFIX)) return null;
  const raw = stored.slice(MIMO_PREFIX.length).trim();
  return raw && isServerVoice(raw) ? raw : null;
}

/**
 * 播放倍速的全局加成。
 *
 * 用户反馈 MiMo 原速偏慢（2026-08-28）。MiMo 的语速全靠 playbackRate
 * 兑现，所以在这里乘一个 boost 就是全局调快 —— 服务端这里和 useSpeech.ts
 * 的 speak()/previewServerVoice 两处拷贝必须同步改（HTMLAudioElement
 * 拿不到响应头）。
 *
 * 1.15：normal 档听感自然；fast 档 1.25×1.15≈1.44 仍可听。
 */
const MIMO_PLAYBACK_BOOST = 1.15;

/**
 * 播放端的倍速（MiMo 专用）。
 *
 * MiMo 合成恒为 1.0，用户的语速档位完全靠 playbackRate 兑现。
 * slow（慢速朗读按钮）再打 0.8 折 —— playbackRate 大幅低于 0.8 会有明显
 * 颗粒感，不能更低了。
 *
 * 注意：useSpeech.ts 的 speak()/previewServerVoice 里各有一份同式拷贝
 * （HTMLAudioElement 拿不到响应头，服务端发的 x-tts-playback-rate 只有
 * smoke/排障能用）。改这里的公式必须三处一起改。
 */
export function playbackRateFor(ttsSpeed: number, slow: boolean): number {
  const rate = (slow ? Math.max(0.8, ttsSpeed - 0.2) : ttsSpeed) * MIMO_PLAYBACK_BOOST;
  return Math.min(1.6, Math.round(rate * 100) / 100);
}

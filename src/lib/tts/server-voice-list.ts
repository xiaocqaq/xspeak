/**
 * 服务端音色的「纯数据」层 —— 没有任何 node 依赖，客户端可以放心 import。
 *
 * 为什么单独拆一个文件：设置页（客户端组件）要拿分组表来画格子，
 * 原来放在 server-voices.ts 里的话，那个文件同时 import 了 kokoro.ts
 * （node:fs/promises）和 mimo.ts，Turbopack 会把 node 模块追进浏览器
 * chunk，构建直接报「does not support external modules」。
 *
 * 拆分规则：
 * - 这里：音色表、分组、性别、provider 判断 —— 纯常量纯函数；
 * - server-voices.ts：合成（speakWithProvider）、配置、缓存 —— 仅服务端。
 */

export type ServerVoiceProvider = 'mimo' | 'kokoro';

export type ServerVoice = {
  id: string;
  zh: string;
  hint: string;
  provider: ServerVoiceProvider;
  /** 听力分嗓音用。MiMo 官方没标性别，按听感标的（2026-08-27 人耳验证） */
  gender: 'male' | 'female';
};

/** MiMo 的 4 个英文音色。官方没给性别标注，gender 是听感标注。 */
const MIMO_VOICES: ServerVoice[] = [
  { id: 'Mia', zh: '米娅', hint: '清亮女声，念课文干脆', provider: 'mimo', gender: 'female' },
  { id: 'Chloe', zh: '克洛伊', hint: '沉稳女声，适合长句', provider: 'mimo', gender: 'female' },
  { id: 'Milo', zh: '米洛', hint: '年轻男声，轻快', provider: 'mimo', gender: 'male' },
  { id: 'Dean', zh: '迪恩', hint: '厚实男声，像新闻播音', provider: 'mimo', gender: 'male' },
  // 2026-08-28 补齐：上游 400 报错列出的全部 9 个音色
  // （Available voices: [mimo_default, 冰糖, 茉莉, 苏打, 白桦, Mia, Chloe, Milo, Dean]），
  // 性别是逐个合成英文样本测 F0 基频定的（Mia 225Hz/Milo 139Hz 校准，方法可信）。
  { id: 'mimo_default', zh: '默认女声', hint: 'MiMo 出厂默认，明亮女声', provider: 'mimo', gender: 'female' },
  { id: '冰糖', zh: '冰糖', hint: '清甜女声，音高偏高', provider: 'mimo', gender: 'female' },
  { id: '茉莉', zh: '茉莉', hint: '柔和女声', provider: 'mimo', gender: 'female' },
  { id: '苏打', zh: '苏打', hint: '女声，略低沉一点', provider: 'mimo', gender: 'female' },
  { id: '白桦', zh: '白桦', hint: '低沉男声', provider: 'mimo', gender: 'male' },
];

/** Kokoro 展示表（缩编：每档留最好的几个），加上性别给听力分嗓音用。 */
const KOKORO_VOICES: ServerVoice[] = [
  { id: 'af_heart', zh: '暖心', hint: '官方数据量最足的音色，最稳', provider: 'kokoro', gender: 'female' },
  { id: 'af_bella', zh: '贝拉', hint: '明亮有感情，念例句好听', provider: 'kokoro', gender: 'female' },
  { id: 'af_nicole', zh: '妮可', hint: '气声偏轻，像贴耳讲话', provider: 'kokoro', gender: 'female' },
  { id: 'af_aoede', zh: '奥德', hint: '清亮匀速', provider: 'kokoro', gender: 'female' },
  { id: 'af_kore', zh: '珂芮', hint: '沉稳一点，像老师', provider: 'kokoro', gender: 'female' },
  { id: 'af_sarah', zh: '莎拉', hint: '中性平实', provider: 'kokoro', gender: 'female' },
  { id: 'am_michael', zh: '迈克尔', hint: '厚实清楚，男声里最稳', provider: 'kokoro', gender: 'male' },
  { id: 'am_fenrir', zh: '芬里尔', hint: '低沉有力', provider: 'kokoro', gender: 'male' },
  { id: 'am_puck', zh: '帕克', hint: '轻快活泼', provider: 'kokoro', gender: 'male' },
  { id: 'am_onyx', zh: '欧尼克斯', hint: '低沉磁性', provider: 'kokoro', gender: 'male' },
  { id: 'bf_emma', zh: '艾玛', hint: '标准英音，英音里最稳', provider: 'kokoro', gender: 'female' },
  { id: 'bf_isabella', zh: '伊莎贝拉', hint: '端正偏正式', provider: 'kokoro', gender: 'female' },
  { id: 'bf_lily', zh: '莉莉', hint: '年轻清亮', provider: 'kokoro', gender: 'female' },
  { id: 'bm_george', zh: '乔治', hint: '沉稳绅士腔', provider: 'kokoro', gender: 'male' },
  { id: 'bm_fable', zh: '费博', hint: '讲故事的调子', provider: 'kokoro', gender: 'male' },
  { id: 'bm_daniel', zh: '丹尼尔', hint: '平实', provider: 'kokoro', gender: 'male' },
];

/**
 * 设置页展示顺序：MiMo 在前（快、母语质量，当门面），Kokoro 分组往后。
 * 组标题写清归属，排障时一眼能认出音色背后是哪家服务。
 */
export const SERVER_VOICE_GROUPS: { key: string; zh: string; voices: ServerVoice[] }[] = [
  { key: 'mimo', zh: 'MiMo · 母语发音（快）', voices: MIMO_VOICES },
  { key: 'kokoro-us-female', zh: '自建 Kokoro · 美音女', voices: KOKORO_VOICES.filter((v) => v.id.startsWith('af_')) },
  { key: 'kokoro-us-male', zh: '自建 Kokoro · 美音男', voices: KOKORO_VOICES.filter((v) => v.id.startsWith('am_')) },
  { key: 'kokoro-gb-female', zh: '自建 Kokoro · 英音女', voices: KOKORO_VOICES.filter((v) => v.id.startsWith('bf_')) },
  { key: 'kokoro-gb-male', zh: '自建 Kokoro · 英音男', voices: KOKORO_VOICES.filter((v) => v.id.startsWith('bm_')) },
];

/** 展示表平铺。 */
export const SERVER_VOICES: ServerVoice[] = SERVER_VOICE_GROUPS.flatMap((g) => g.voices);

/** 音色 → 上游。白名单判断和路由分流都走它。 */
export function serverVoiceProvider(voiceId: string): ServerVoiceProvider | null {
  return SERVER_VOICES.find((v) => v.id === voiceId)?.provider ?? null;
}

/** 音色 → 性别。Kokoro 老表里的音色（没进展示表的）按前缀第二个字母认。 */
export function serverVoiceGender(voiceId: string): 'male' | 'female' | undefined {
  const inTable = SERVER_VOICES.find((v) => v.id === voiceId);
  if (inTable) return inTable.gender;
  const c = voiceId[1];
  return c === 'f' ? 'female' : c === 'm' ? 'male' : undefined;
}

/** 默认音色。MiMo 第一个 —— 云端合成快一倍以上，当门面。 */
export const DEFAULT_SERVER_VOICE = SERVER_VOICES[0]!.id;

/**
 * 把存库/存 localStorage 的音色偏好解析成「某一家的裸 id」。
 *
 * 存的值有三种形态：`kokoro:af_bella`、`mimo:Mia`、老数据的裸名。
 * 缓存键必须用裸 id（带前缀会算出另一个 key，历史上栽过两次）。
 *
 * 这个函数是**前后端共用的唯一入口**：听力分嗓音要在服务端预合成和
 * 浏览器播放两处算出完全一样的结果，否则预合成的音色和播放请求的音色
 * 对不上，缓存永远 miss。两边都调它，就不会漂。
 *
 * 不是这一家的音色返回 null（调用方按默认处理）—— 比如用户选了 MiMo 的
 * Mia，问「Kokoro 偏好是什么」时不该把 Mia 当成 Kokoro 音色。
 */
export function preferredVoiceId(
  stored: string | null | undefined,
  provider: ServerVoiceProvider,
): string | null {
  if (!stored) return null;
  const i = stored.indexOf(':');
  const raw = (i >= 0 ? stored.slice(i + 1) : stored).trim();
  if (!raw) return null;
  return SERVER_VOICES.some((v) => v.id === raw && v.provider === provider) ? raw : null;
}

/**
 * 合成用的「速度」参数。
 *
 * MiMo 没有语速接口，速度在播放端调（audio.playbackRate），所以它所有
 * 合成都按 1.0 走 —— 同一句文本不管用户选什么档位，缓存键都一样，
 * 换档位不用重新花钱合成。Kokoro 照旧把档位写进合成参数。
 */
export function synthSpeed(voiceId: string, ttsSpeed: number): number {
  return serverVoiceProvider(voiceId) === 'mimo' ? 1 : ttsSpeed;
}

/**
 * MiMo 播放倍速的全局加成。
 *
 * 用户反馈 MiMo 原速偏慢、不如自建 Kokoro 自然利落（2026-08-28）。
 * MiMo 的语速全靠 playbackRate 兑现，所以在这里乘一个 boost 就是全局
 * 调快 —— 服务端这里和 useSpeech.ts 的 speak()/previewServerVoice 两处
 * 拷贝必须同步改（HTMLAudioElement 拿不到响应头）。
 *
 * 1.15：normal 档听感与 Kokoro 1.0 对齐；fast 档 1.25×1.15≈1.44 仍可听。
 */
const MIMO_PLAYBACK_BOOST = 1.15;

/**
 * 播放端的倍速（MiMo 专用）。
 *
 * MiMo 合成恒为 1.0，用户的语速档位完全靠 playbackRate 兑现；Kokoro 已经
 * 把速度合成进音频里了，播放端不动。slow（慢速朗读按钮）再打 0.8 折 ——
 * playbackRate 大幅低于 0.8 会有明显颗粒感，不能更低了。
 *
 * 注意：useSpeech.ts 的 speak()/previewServerVoice 里各有一份同式拷贝
 * （HTMLAudioElement 拿不到响应头，服务端发的 x-tts-playback-rate 只有
 * smoke/排障能用）。改这里的公式必须三处一起改。
 */
export function playbackRateFor(voiceId: string, ttsSpeed: number, slow: boolean): number {
  if (serverVoiceProvider(voiceId) !== 'mimo') return 1;
  const rate = (slow ? Math.max(0.8, ttsSpeed - 0.2) : ttsSpeed) * MIMO_PLAYBACK_BOOST;
  return Math.min(1.6, Math.round(rate * 100) / 100);
}

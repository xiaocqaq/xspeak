/**
 * 自建 Kokoro-82M 的音色表，给「逐句朗读」用。
 *
 * 和 voice-options.ts 里的 AI_VOICES 是两套东西，别弄混：
 * - AI_VOICES：StepFun realtime 的中文人设音色，畅聊/打电话用，中文母语者说英文。
 * - 这里：Kokoro 的英/美母语音色，朗读单词和例句用，口音是对的。
 *
 * ── 为什么只收英文音色 ──
 *
 * 服务端一共 54 个（含中/日/西/法/印/意/葡），但这个 App 只朗读英文内容，
 * 列 54 个用户扫不动。中文音色留在 KOKORO_ALL_VOICES 里让路由放行 ——
 * 万一以后要读中文释义，不用改白名单。
 *
 * ── 音色前缀就是语种，服务端靠它选 espeak 语言 ──
 *
 * af/am = 美音女/男，bf/bm = 英音女/男，zf/zm = 中文，其余见 KOKORO_ALL_VOICES。
 *
 * ── 质量分级来自 Kokoro 官方的训练时长标注 ──
 *
 * 上游按每个音色的训练数据量给了 A–D 等，数据少的会有金属音和吞音。
 * 这里只把 B 级以上摆在前面，D 级的（am_santa 之类的彩蛋音）干脆不收。
 */

export type KokoroVoiceGroupKey = 'us-female' | 'us-male' | 'gb-female' | 'gb-male';

export type KokoroVoice = {
  id: string;
  zh: string;
  hint: string;
  group: KokoroVoiceGroupKey;
};

export const KOKORO_VOICE_GROUPS: { key: KokoroVoiceGroupKey; zh: string }[] = [
  { key: 'us-female', zh: '美音 · 女' },
  { key: 'us-male', zh: '美音 · 男' },
  { key: 'gb-female', zh: '英音 · 女' },
  { key: 'gb-male', zh: '英音 · 男' },
];

/** 摆到设置页里的音色。第一个是默认。 */
export const KOKORO_VOICES: KokoroVoice[] = [
  // 美音女声。af_heart 是官方标注训练数据最多的那个，当默认
  { id: 'af_heart', zh: '暖心', hint: '官方数据量最足的音色，最稳', group: 'us-female' },
  { id: 'af_bella', zh: '贝拉', hint: '明亮有感情，念例句好听', group: 'us-female' },
  { id: 'af_nicole', zh: '妮可', hint: '气声偏轻，像贴耳讲话', group: 'us-female' },
  { id: 'af_aoede', zh: '奥德', hint: '清亮匀速', group: 'us-female' },
  { id: 'af_kore', zh: '珂芮', hint: '沉稳一点，像老师', group: 'us-female' },
  { id: 'af_sarah', zh: '莎拉', hint: '中性平实', group: 'us-female' },
  { id: 'af_nova', zh: '诺瓦', hint: '干净利落', group: 'us-female' },
  { id: 'af_sky', zh: '斯凯', hint: '轻快偏年轻', group: 'us-female' },
  { id: 'af_alloy', zh: '艾洛', hint: '平直不带情绪，适合抠发音', group: 'us-female' },
  { id: 'af_jessica', zh: '杰西卡', hint: '略带鼻音', group: 'us-female' },
  { id: 'af_river', zh: '瑞沃', hint: '偏低平', group: 'us-female' },
  // 美音男声
  { id: 'am_michael', zh: '迈克尔', hint: '厚实清楚，男声里最稳', group: 'us-male' },
  { id: 'am_fenrir', zh: '芬里尔', hint: '低沉有力', group: 'us-male' },
  { id: 'am_puck', zh: '帕克', hint: '轻快活泼', group: 'us-male' },
  { id: 'am_echo', zh: '艾科', hint: '平实中性', group: 'us-male' },
  { id: 'am_eric', zh: '埃里克', hint: '偏亮偏年轻', group: 'us-male' },
  { id: 'am_liam', zh: '利亚姆', hint: '温和', group: 'us-male' },
  { id: 'am_onyx', zh: '欧尼克斯', hint: '低沉磁性', group: 'us-male' },
  { id: 'am_adam', zh: '亚当', hint: '略粗，偶尔有金属感', group: 'us-male' },
  // 英音女声
  { id: 'bf_emma', zh: '艾玛', hint: '标准英音，英音里最稳', group: 'gb-female' },
  { id: 'bf_isabella', zh: '伊莎贝拉', hint: '端正偏正式', group: 'gb-female' },
  { id: 'bf_alice', zh: '爱丽丝', hint: '轻柔', group: 'gb-female' },
  { id: 'bf_lily', zh: '莉莉', hint: '年轻清亮', group: 'gb-female' },
  // 英音男声
  { id: 'bm_george', zh: '乔治', hint: '沉稳绅士腔', group: 'gb-male' },
  { id: 'bm_fable', zh: '费博', hint: '讲故事的调子', group: 'gb-male' },
  { id: 'bm_lewis', zh: '刘易斯', hint: '低沉', group: 'gb-male' },
  { id: 'bm_daniel', zh: '丹尼尔', hint: '平实', group: 'gb-male' },
];

export const DEFAULT_KOKORO_VOICE = KOKORO_VOICES[0]!.id;

export const KOKORO_VOICE_IDS: string[] = KOKORO_VOICES.map((v) => v.id);

/**
 * 服务端实际认的全部 54 个（2026-08-27 从 /v1/audio/voices 抓的）。
 * 路由的白名单用这个，比展示表宽 —— 不然以后想读中文得改两处。
 */
export const KOKORO_ALL_VOICES: string[] = [
  'af_alloy', 'af_aoede', 'af_bella', 'af_heart', 'af_jessica', 'af_kore',
  'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky',
  'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael',
  'am_onyx', 'am_puck', 'am_santa',
  'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily',
  'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis',
  'ef_dora', 'em_alex', 'em_santa', 'ff_siwis',
  'hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi',
  'if_sara', 'im_nicola',
  'jf_alpha', 'jf_gongitsune', 'jf_nezumi', 'jf_tebukuro', 'jm_kumo',
  'pf_dora', 'pm_alex', 'pm_santa',
  'zf_xiaobei', 'zf_xiaoni', 'zf_xiaoxiao', 'zf_xiaoyi',
  'zm_yunjian', 'zm_yunxi', 'zm_yunxia', 'zm_yunyang',
];

/**
 * 设置页存进 users.voice 时加的前缀。
 *
 * 那一列本来存浏览器语音包的名字（"Samantha" 这种），现在要能同时存
 * 服务端音色。加前缀区分，省一次数据库迁移：没前缀的照旧当浏览器语音包名。
 */
export const KOKORO_PREFIX = 'kokoro:';

/** 在线 MiMo 音色存库用的前缀（users.voice / users.voice_offline 通用）。 */
export const MIMO_PREFIX = 'mimo:';

/** 把 users.voice / users.voice_offline 的值拆成「服务端音色」或「浏览器语音包名」。 */
export function parseVoicePref(v: string | null | undefined): {
  kokoro: string | null;
  mimo: string | null;
  browser: string | null;
} {
  if (!v) return { kokoro: null, mimo: null, browser: null };
  if (v.startsWith(KOKORO_PREFIX)) {
    const id = v.slice(KOKORO_PREFIX.length);
    return { kokoro: id || null, mimo: null, browser: null };
  }
  if (v.startsWith(MIMO_PREFIX)) {
    const id = v.slice(MIMO_PREFIX.length);
    return { kokoro: null, mimo: id || null, browser: null };
  }
  return { kokoro: null, mimo: null, browser: v };
}

/** 反向：拼出要写进 users.voice 的值。 */
export function kokoroVoicePref(id: string): string {
  return `${KOKORO_PREFIX}${id}`;
}

const BY_ID = new Map(KOKORO_VOICES.map((v) => [v.id, v]));

export function kokoroVoiceLabel(id: string): string {
  return BY_ID.get(id)?.zh ?? id;
}

/**
 * 服务端音色按性别分桶，给听力的多人对话分嗓音用。
 *
 * 比浏览器语音包那条路好办得多：这里有 27 个真嗓音，不用靠改音高硬凑
 * （音高拉到 1.3 会变得又尖又假，见 useSpeech 里 buildVoiceCast 的说明）。
 * 桶内顺序就是 KOKORO_VOICES 的顺序，也就是官方训练数据量从多到少 ——
 * 先发的说话人拿到最稳的嗓音。
 */
export function kokoroVoicesByGender(gender: 'male' | 'female'): string[] {
  const groups: KokoroVoiceGroupKey[] =
    gender === 'female' ? ['us-female', 'gb-female'] : ['us-male', 'gb-male'];
  return KOKORO_VOICES.filter((v) => groups.includes(v.group)).map((v) => v.id);
}

/** 从音色 id 反推性别。前缀第二个字母 f/m 就是（af_/bf_ 女，am_/bm_ 男）。 */
export function kokoroVoiceGender(id: string): 'male' | 'female' | undefined {
  const c = id[1];
  return c === 'f' ? 'female' : c === 'm' ? 'male' : undefined;
}

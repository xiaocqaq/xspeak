/**
 * AI 音色与语速的共享定义。
 *
 * 和 realtime/protocol.mjs 同理做成 .mjs：server.mjs 跑在 Next 编译流程之外，
 * 用不了 `@/` 别名，中转层要读音色白名单和语速指令，所以常量放这里两边共享。
 * 类型门面在同目录的 voice-options.ts。
 *
 * ── 实测约束（2026-08-26 用 scripts/probe-voices.mjs 重测，改之前先重跑一遍）──
 *
 * 1. realtime 的 session.update 只认官方音色 id，不认的会明确报
 *    "voice xxx is not valid"，不是静默降级。
 * 2. 官方「音频合成最佳实践」里标了支持 stepaudio-2.5-tts 的 27 个音色，
 *    realtime 认其中 25 个，只拒绝 tianmeinvsheng 和 wenrougongzi。
 *    那张表的「支持模型」列压根没提 realtime，只写了三个 TTS 模型，
 *    realtime 文档正文又只举了四个例子就用「等」字带过 —— 两边都不是完整答案，
 *    这 25 个是实测出来的。只支持 step-tts-2 / step-tts-mini 的音色一律不收：
 *    试听走 stepaudio-2.5-tts，那些音色就算 realtime 认也试听不出来。
 * 3. realtime 完全没有语速参数。speed / speech_rate / rate / audio.output.speed
 *    四种写法服务端都静默忽略（不报错，但 session.updated 回显里不出现）。
 *    唯一被保留的 volume_ratio 是音量。所以畅聊语速只能软控制 + 播放倍速。
 * 4. TTS 接口（/v1/audio/speech，model=stepaudio-2.5-tts）反而支持 speed，
 *    音色试听走它 —— 既能真实反映语速，也不用为试听建一条 realtime 连接。
 * 5. 探测音色要用「一条连接连发多次 session.update」：voice 只在模型首次产出音频后
 *    才锁定，探测全程不喂音频就一直可改。一个音色一条连接会在第 12 个左右撞上限流，
 *    而限流报出来的「连接错误」和「音色不认」长得一模一样，整轮数据会全废。
 *
 * ── 英文清晰度：测了，但测不出差别（scripts/score-voices.mjs）──
 *
 * 思路是同一批英文句子合成后送回 ASR 算词错率。结果 25 个音色里 24 个是 0.0%，
 * 只有 qingchunshaonv 把 vanilla 念成了 anila（3.8%）。所以这个指标废了：
 * 上游 ASR 认自家 TTS 认得太准，分不出高下，别再用它排序。
 *
 * 有用的副产物是合成时长 —— 同一批句子、speed 都是 1，时长差就是语速差，
 * 从 13.4s（zhixingjiejie）到 21.1s（jingdiannvsheng），最慢的比最快的拖 57%。
 * 下面 hint 里的快慢就是这么来的；音质好不好听脚本测不了，只能人听。
 *
 * 顺带一提：原来的默认 jingdiannvsheng 正是这批里最拖的那个。
 */

/**
 * 畅聊可用的音色，全部实测 realtime 接受 + 试听接口出得来音频。
 *
 * group 用来在设置页分组 —— 25 个平铺太长，扫不动。
 * 第一个是默认（也是 voice/config.mjs 里 defaultVoice 的值）。
 *
 * hint 里「偏快 / 偏慢」有实测支撑（见上面的合成时长），音色本身的形容来自官方命名。
 */
export const AI_VOICES = [
  // 官方 realtime 文档正文点名的两个，放最前面当首选
  { id: 'elegantgentle-female', zh: '气质温婉', hint: '官方点名的音色，语速偏快', group: 'female' },
  { id: 'livelybreezy-female', zh: '活力轻快', hint: '官方点名的音色，语速中等', group: 'female' },
  { id: 'zhixingjiejie', zh: '知性姐姐', hint: '沉稳像老师，这批里最快', group: 'female' },
  { id: 'wenrounvsheng', zh: '温柔女声', hint: '轻声细语，偏快', group: 'female' },
  { id: 'linjiameimei', zh: '邻家妹妹', hint: '年轻活泼，偏快', group: 'female' },
  { id: 'qinqienvsheng', zh: '亲切女声', hint: '温和耐心', group: 'female' },
  { id: 'youyanvsheng', zh: '优雅女声', hint: '从容不赶', group: 'female' },
  { id: 'lengyanyujie', zh: '冷艳御姐', hint: '低沉冷感，气场足', group: 'female' },
  { id: 'qingchunshaonv', zh: '清纯少女', hint: '干净年轻，念长词偶尔含混', group: 'female' },
  { id: 'jilingshaonv', zh: '机灵少女', hint: '灵动跳脱', group: 'female' },
  { id: 'yuanqishaonv', zh: '元气少女', hint: '高扬有劲', group: 'female' },
  { id: 'ruanmengnvsheng', zh: '软萌女声', hint: '偏甜偏软', group: 'female' },
  { id: 'wenjingxuejie', zh: '文静学姐', hint: '安静清淡', group: 'female' },
  { id: 'shuangkuaijiejie', zh: '爽快姐姐', hint: '语气干脆，但实测不快', group: 'female' },
  { id: 'linjiajiejie', zh: '邻家姐姐', hint: '亲和自然，偏慢', group: 'female' },
  { id: 'wenroushunv', zh: '温柔熟女', hint: '成熟偏低，偏慢', group: 'female' },
  { id: 'jingdiannvsheng', zh: '经典女声', hint: '原来的默认，这批里最拖', group: 'female' },

  { id: 'cixingnansheng', zh: '磁性男声', hint: '低沉有质感，偏快', group: 'male' },
  { id: 'zhengpaiqingnian', zh: '正派青年', hint: '端正清楚，偏快', group: 'male' },
  { id: 'yuanqinansheng', zh: '元气男声', hint: '明快有精神，偏快', group: 'male' },
  { id: 'boyinnansheng', zh: '播音男声', hint: '标准播音腔', group: 'male' },
  { id: 'qingniandaxuesheng', zh: '青年大学生', hint: '同龄人感，随意', group: 'male' },
  { id: 'wenrounansheng', zh: '温柔男声', hint: '轻缓，听起来不紧张', group: 'male' },
  { id: 'ruyananshi', zh: '儒雅男士', hint: '儒雅偏稳', group: 'male' },
  { id: 'shenchennanyin', zh: '深沉男音', hint: '更低更厚，偏慢', group: 'male' },
];

/** 分组标题。设置页按这个顺序渲染。 */
export const AI_VOICE_GROUPS = [
  { key: 'female', zh: '女声' },
  { key: 'male', zh: '男声' },
];

export const AI_VOICE_IDS = AI_VOICES.map((v) => v.id);

/**
 * 没选过音色时用哪个。
 *
 * 这里是唯一来源：voice/config.mjs 的 defaultVoice 读它，设置页显示「当前」也读它。
 * 以前两边各写一份（config 里是 jingdiannvsheng，设置页用 AI_VOICES[0]），
 * 一改顺序就会「界面显示 A、实际打出来是 B」—— 正是最难查的那类 bug。
 */
export const DEFAULT_AI_VOICE = AI_VOICES[0].id;

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

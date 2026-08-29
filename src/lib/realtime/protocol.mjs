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
 *   浏览器 ──ws://本机/api/realtime──▶ server.mjs ──wss://上游──▶ 语音服务商
 *
 * 为什么要中转：浏览器的 WebSocket 不能带自定义请求头，而这类服务唯一支持的
 * 浏览器侧鉴权是把 key 塞进子协议 —— 那等于把 API key 明文发给客户端。
 * 中转之后 key 只留在服务端。上游地址和模型名见 ../voice/config.mjs。
 *
 * ── 两个实测硬约束（StepFun 实测，和官方文档不一致，改之前先跑 scripts/probe-realtime.mjs）──
 *
 * 1. 服务地址是 `/step_plan/v1/realtime`，不是文档写的 `/v1/realtime`（后者连不上，
 *    而且那个 base 的配额已用尽）。
 * 2. 不能开 `server_vad`。一旦带上它，服务端会静默丢弃 `input_audio_transcription`
 *    配置，拿不到学生原话的转写，教学闭环就断了。所以只用手动模式：
 *    前端按住说话、松手 commit，服务端才回转写。
 */

/**
 * 上行采样率：麦克风采集后降采样到这个频率再发给上游。
 *
 * 上下行不同频，别合成一个常量 —— 合过一次，播放端拿 16000 去建 AudioBuffer，
 * 结果 24000 的音频被拉慢 1.5 倍、音调降了五度，女声全变成低沉男声，
 * 而且换任何音色都一样低（问题不在音色）。
 */
export const INPUT_SAMPLE_RATE = 16_000;

/**
 * 下行采样率：上游 response.audio.delta 里 pcm16 的真实频率。
 *
 * `output_audio_format: 'pcm16'` 只声明「16 位有符号小端」，不带频率，
 * 所以这个值只能靠实测。scripts/probe-audio-rate.mjs 用自相关求基频定的：
 * 同一段音频按 16000 算 f0≈139Hz（男声区），按 24000 算 f0≈209Hz（成年女声区），
 * 后者才对。StepFun 文档里的浏览器播放示例也写死 24000。
 */
export const OUTPUT_SAMPLE_RATE = 24_000;

/** 一片上行音频的时长。100ms @16k mono s16le = 3200 字节。 */
export const CHUNK_MS = 100;

/** 中转层监听的 WebSocket 路径。 */
export const REALTIME_PATH = '/api/realtime';

/*
 * 上游地址、模型名、默认音色都搬到 ../voice/config.mjs 了 ——
 * 那些是「当前用哪家服务商」，会随环境变量变；这里只留协议本身的常量。
 */

/**
 * 这句转写里有没有汉字。
 *
 * 名字只说它测了什么，别再当成「学生说了中文」—— 这一点栽过一次。
 * 上游那个识别模型（stepaudio-2.5-asr）是中文为主的，学生说带中文口音的英文时它
 * 会按中文猜，转写回来一句汉字。所以有汉字有两种可能，本地分不出来：
 *   a) 学生真的说了中文；
 *   b) 学生说的是英文，识别听成了中文。
 *
 * 用户明确反馈过 b 才是常见情况（「不是我说中文 是它老把我说的英文识别成中文了」）。
 * 因此这个判断只能用来「软处理」：界面上给一句两种可能都涵盖的说明、纠错时提醒模型
 * 这句可能是转写错的、以及别把它写进错题本。绝对不能用来跳过纠错分析 ——
 * 两个方向的代价不对等：误判成中文会把学生真正需要的那条纠正整条吞掉，
 * 而漏判只是多喂一句怪句子给纠错提示词，那边本来就要求容忍转写噪声。
 *
 * 顺带一句实测：想在识别层锁定英文这条路是死的，input_audio_transcription 的
 * language 字段被上游忽略（跑过两次，中英输入都无效）。
 *
 * 判据是「有没有汉字」而不是「汉字占比」：中英混着说（"这个 word 怎么说"）也要算上。
 * 范围取常用汉字 + 扩展 A，不含全角标点 —— ASR 给英文句子也会配中文逗号句号，
 * 按标点判会把纯英文误判成中文。
 *
 * @param {string} text 一句转写
 * @returns {boolean}
 */
export function hasChinese(text) {
  return /[一-鿿㐀-䶿]/.test(String(text ?? ''));
}

/**
 * 转写出现汉字时给学生看的一句话。中转层和前端共用，措辞只维护一处。
 *
 * 措辞不能是「你说了中文」这种断言 —— 见 hasChinese 的注释，识别把英文听成中文
 * 是更常见的那一种，断错了等于当着学生的面冤枉他。所以两种可能都写上，
 * 并且都给一句下一步该干什么。
 */
export const SPEAK_ENGLISH_HINT =
  '这句识别成了中文。你要是说的本来就是英文，那是识别听错了，不用管它接着说；要是真说不出来，AI 会用英文把这个意思说一遍，跟着念就行。';

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
    /*
     * 学生说中文时怎么办。
     *
     * 这一条只能写在提示词里：上游的 input_audio_transcription 不认 language 字段
     * （scripts/probe-input-lang.mjs 实测，加 language: 'en' 前后中文转写一字不差），
     * 所以没法在识别层把输入锁成英文，只能靠模型的反应把人带回英文。
     *
     * 措辞刻意避开「纠正」：下面「不打断」那条管的是英文说错，这条管的是没说英文，
     * 给一句现成的英文让人照着说，比指出问题更省事。
     */
    'If they speak Chinese, stay in English and do not translate the whole thing for them:'
      + ' warmly invite them to try it in English, and give them the one short English sentence'
      + ' they were reaching for so they can copy it.',
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

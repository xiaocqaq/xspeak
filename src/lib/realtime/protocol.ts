/**
 * 实时语音对话的类型定义。
 *
 * 运行时常量在同目录的 protocol.mjs 里 —— 自定义 server 跑在 Next 编译流程之外，
 * 用不了 `@/` 别名，所以常量放 .mjs 让两边共享，这里只补类型并原样转出。
 * 架构说明和实测约束都写在 protocol.mjs 的头注释里。
 *
 * 服务商相关的东西（上游地址、模型名、默认音色）不在这里，在 @/lib/voice/config。
 */

export {
  INPUT_SAMPLE_RATE,
  OUTPUT_SAMPLE_RATE,
  CHUNK_MS,
  REALTIME_PATH,
  UPSTREAM_AUDIO,
  SPEAK_ENGLISH_HINT,
  buildInstructions,
  hasChinese,
} from './protocol.mjs';

/* ---------------------------- 浏览器 → 中转层 ---------------------------- */

export type ClientToServer =
  /** 开场：告诉中转层这次练什么场景，中转层据此建上游会话。 */
  | {
      type: 'start';
      conversationId: number;
      /** AI 扮演的角色，英文，直接进 instructions */
      aiRole: string;
      /** 场景中文说明，用于落库和展示 */
      scenarioZh: string;
      /** 今天要求说出口的词，写进 instructions 引导 AI 把话题带过去 */
      targetTerms: string[];
      level?: string;
      /** StepFun realtime 的音色 id。不在白名单里会被中转层换成默认音色 */
      voice?: string;
      /**
       * 语速档位。realtime 没有语速参数，中转层只能把它翻成 instructions 里的
       * 一句软要求；真正的倍速调整在浏览器端播放时做。
       */
      paceKey?: string;
    }
  /** 一片麦克风音频，base64 的 PCM16。 */
  | { type: 'audio'; audio: string }
  /** 松手：这一句说完了，请上游开始回应。 */
  | { type: 'commit' }
  /** 打断正在播放的回答。 */
  | { type: 'cancel' };

/* ---------------------------- 中转层 → 浏览器 ---------------------------- */

export type Correction = { has_issue: boolean; corrected_en: string; note_zh: string };

export type ServerToClient =
  /** 上游会话就绪，可以开口了。 */
  | { type: 'ready' }
  /**
   * 学生这句话的转写。
   *
   * zh 为真表示转写里有汉字 —— 只是这个意思，不代表学生说了中文（见 protocol.mjs
   * 的 hasChinese，识别把带口音的英文听成中文更常见）。识别层也锁不住输入语言，
   * language 字段被上游忽略，所以只能等转写回来再判。
   *
   * 前端据此在那句气泡下面单独加一块说明，纠正卡片照常显示 —— 这一轮同样有分析，
   * 只是提示词里会提醒模型这句可能是转写错的。
   */
  | { type: 'user_transcript'; text: string; zh?: boolean }
  /** AI 回复的文本增量。 */
  | { type: 'assistant_delta'; text: string }
  /** AI 回复的音频增量，base64 PCM16。 */
  | { type: 'audio_delta'; audio: string }
  /** 这一回合结束，带完整文本。 */
  | { type: 'turn_done'; text: string }
  /**
   * 教学侧的异步分析结果。语音回合先跑完，纠正随后补上 ——
   * 畅聊模式刻意的取舍：不打断说话节奏，反馈迟到一两秒。
   */
  | {
      type: 'coaching';
      /** 对应哪一句学生原话 */
      userText: string;
      correction: Correction;
      usedTerms: string[];
    }
  /**
   * 「试试这样说」提示：AI 话音刚落就发，赶在学生开口之前给他下一句的参考。
   * 独立于 coaching —— 提示要快（不落库、不等分析），纠正要全（落库、进错题本），
   * 两条路并行跑、互不等待。turn 是回合序号：中转层按它挡掉过时的旧结果，
   * 前端照单全收最新的。tip 为 null 表示这次没生成出来，界面保持原样。
   */
  | { type: 'tip'; turn: number; tip: { en: string; zh: string } | null }
  /**
   * 不致命但用户得知道的事。两种来源：这一通的音色没按设置生效（上游不认或被
   * 静默换掉）；提交上去的那段音频上游没听出人声（"no speech found"）。
   *
   * 和 error 分开是因为通话还能继续，不该把状态打成 error 把整个面板变成错误态。
   * 后一种还会跟一条空的 turn_done，把前端从 thinking 放回 ready、重新开麦。
   */
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string };

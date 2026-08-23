/**
 * 实时语音对话的类型定义。
 *
 * 运行时常量在同目录的 protocol.mjs 里 —— 自定义 server 跑在 Next 编译流程之外，
 * 用不了 `@/` 别名，所以常量放 .mjs 让两边共享，这里只补类型并原样转出。
 * 架构说明和实测约束都写在 protocol.mjs 的头注释里。
 */

export {
  SAMPLE_RATE,
  CHUNK_MS,
  REALTIME_MODEL,
  ASR_MODEL,
  DEFAULT_VOICE,
  REALTIME_PATH,
  UPSTREAM_URL,
  UPSTREAM_AUDIO,
  buildInstructions,
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
      voice?: string;
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
  /** 学生这句话的转写。 */
  | { type: 'user_transcript'; text: string }
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
  | { type: 'error'; message: string };

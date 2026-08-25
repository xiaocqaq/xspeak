'use client';

/**
 * 端到端语音对话的浏览器侧。
 *
 * 三件事：采麦克风、连中转层、播放回传的音频。
 *
 * 为什么不用 Web Speech API：那条路只给识别出来的文本，音频本身拿不到，
 * 也就没法交给端到端模型。这里走 AudioContext 拿原始 PCM。
 *
 * 采集：麦克风采样率由设备决定（常见 48000），上游要 16000，所以自己做降采样。
 * 播放：回传的是裸 PCM16 分片，不是完整音频文件，必须排成队列用 AudioBuffer 接续播，
 *       不能直接丢给 <audio>。
 * 断句：VAD 放在这里做，不用上游的 server_vad —— 那个一开就拿不到学生原话的转写
 *       （见 lib/realtime/protocol.mjs）。所以本地判断「说完了」，再让中转层手动 commit，
 *       这样既是打电话式的连续对话，转写也还在。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SAMPLE_RATE, REALTIME_PATH, type Correction, type ServerToClient } from '@/lib/realtime/protocol';
import { pace } from '@/lib/voice-options';
import type { SpeechPace } from '@/lib/types';

export type VoiceTurn = {
  /** 本地生成的 id，用于把迟到的纠正对上号 */
  key: string;
  role: 'user' | 'assistant';
  text: string;
  /** 只有 user 回合会有：异步补上来的纠正 */
  correction?: Correction | null;
  usedTerms?: string[];
};

export type VoiceStatus = 'idle' | 'connecting' | 'ready' | 'listening' | 'thinking' | 'speaking' | 'error';

/* ------------------------------ VAD 参数 ------------------------------ */

/**
 * 这几个阈值是按「安静房间里的正常说话音量」定的，改动前先想清楚代价：
 * 门槛太低会把键盘声和呼吸当成说话，太高则小声说话被当成没开口。
 */
const VAD = {
  /** 判定「有人在说」的音量下限（RMS）。 */
  speakRms: 0.018,
  /** 判定「安静」的上限。留一段迟滞区间，避免在边界反复跳。 */
  silenceRms: 0.008,
  /** 连续静音多久算这句说完了。太短会切断句中停顿，太长则等得难受。 */
  silenceMs: 900,
  /** 一句话至少要这么长才提交，滤掉咳嗽、桌子响之类的单次噪声。 */
  minSpeechMs: 350,
  /** 一句话最长录这么久就强制提交，避免一直说没有尽头。 */
  maxSpeechMs: 30_000,
  /**
   * AI 说完之后等一会儿再重新开麦。
   * 扬声器外放时尾音会被麦克风收回去，立刻开麦会自问自答。
   */
  resumeAfterAiMs: 450,
  /**
   * 确认开口之前要回补几片音频。
   * VAD 需要攒够能量才敢判定「在说话」，那之前的几十毫秒往往是单词的第一个辅音，
   * 丢掉会让识别吃字（"sorry" 听成 "orry"）。一片约 85ms，留 3 片够用。
   */
  prerollChunks: 3,
  /**
   * 抢话（打断 AI）的音量门槛，明显高于普通开口门槛。
   *
   * AI 说话时麦克风还开着，为的是能像打电话一样插话。代价是扬声器外放时它自己的声音
   * 会被收回去 —— 浏览器的回声消除能压掉大部分，但压不干净。所以这里要求更响、
   * 且要连续响够 bargeInMs 才认，宁可漏判一次抢话，也不能让 AI 自己把自己打断。
   */
  bargeInRms: 0.05,
  /** 抢话要连续这么久才算真的在插话，滤掉单次爆音。 */
  bargeInMs: 260,
};

/** 一段音频的均方根音量。 */
function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

export type StartOpts = {
  conversationId: number;
  aiRole: string;
  scenarioZh: string;
  targetTerms: string[];
  level: string;
  voice?: string;
  /**
   * 语速档位。两条路一起用，因为单独哪条都不够：
   * - 传给中转层写进 instructions（软控制，不精确但不变调）
   * - 在本地按 playbackRate 微调播放（精确但会变调，所以只在 0.9~1.1 内动）
   */
  paceKey?: SpeechPace;
};

/* ------------------------------ 音频工具 ------------------------------ */

/** Float32（-1..1）→ 16-bit PCM 小端，再 base64。 */
function floatToPcm16Base64(input: Float32Array): string {
  const buf = new ArrayBuffer(input.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < input.length; i++) {
    // 夹一下再量化，避免溢出造成爆音
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buf);
  let bin = '';
  // 分块拼，避免超长参数把栈打爆
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    bin += String.fromCharCode(...bytes.subarray(i, i + STEP));
  }
  return btoa(bin);
}

/** base64 PCM16 → Float32，供 AudioBuffer 播放。 */
// 返回值显式标 Float32Array<ArrayBuffer>：默认的 Float32Array 带 ArrayBufferLike，
// 而 copyToChannel 只收 ArrayBuffer 支撑的数组，不收 SharedArrayBuffer。
function pcm16Base64ToFloat(b64: string): Float32Array<ArrayBuffer> {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const out = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const lo = bin.charCodeAt(i * 2);
    const hi = bin.charCodeAt(i * 2 + 1);
    let v = (hi << 8) | lo;
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v / 0x8000;
  }
  return out;
}

/** 线性降采样到目标采样率。设备一般给 48000，上游要 16000。 */
function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const len = Math.floor(input.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/* -------------------------------- Hook -------------------------------- */

export function useVoiceChat() {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** AI 正在说的这句话的实时文本 */
  const [partial, setPartial] = useState('');
  /** 学生主动闭麦（想歇一会儿、或者环境太吵） */
  const [muted, setMutedState] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const micRef = useRef<{ ctx: AudioContext; stream: MediaStream; node: ScriptProcessorNode } | null>(null);
  /** 播放用的 AudioContext 和「下一段该从什么时刻开始」的游标 */
  const playRef = useRef<{ ctx: AudioContext; cursor: number } | null>(null);
  /** 麦克风是否在往上游送音频。 */
  const openMicRef = useRef(false);
  /** muted 的 ref 镜像：音频回调里要读它，不能依赖闭包里的 state 快照。 */
  const mutedRef = useRef(false);
  /**
   * AI 是否正在出声。
   * 只有在它真的在说的时候才做抢话判断 —— 「刚说完等回声散去」的那几百毫秒里
   * 收到的响声大概率就是尾音本身，不该当成学生插话。
   */
  const aiSpeakingRef = useRef(false);
  /**
   * 抢话之后，这一回合剩下的音频要全部丢掉。
   *
   * 发出 cancel 的那一刻，上游可能已经把后续音频片推在路上了。如果照常处理，
   * `audio_delta` 会把 aiSpeakingRef 重新置 true、把麦克风关掉 ——
   * 学生刚开口的话就被吞了。这个标志在下一回合开始时清掉。
   */
  const droppingRef = useRef(false);
  /** 最近一句学生原话的 key，纠正回来时按它对号 */
  const lastUserKey = useRef<string | null>(null);

  /**
   * VAD 的运行状态。放在 ref 里而不是 state：音频回调每 ~85ms 就跑一次，
   * 走 state 会引发大量重渲染。
   */
  const vadRef = useRef({
    /** 当前是否认定「学生正在说」 */
    speaking: false,
    /** 这句话开始的时刻 */
    startedAt: 0,
    /** 最近一次听到声音的时刻，用来算静音时长 */
    lastVoiceAt: 0,
    /**
     * 说话前的一小段音频。VAD 要攒够能量才确认「开口了」，
     * 那之前的几十毫秒（往往是单词的第一个辅音）不能丢，否则识别会吃字。
     */
    preroll: [] as string[],
    /** AI 说话期间连续听到大声说话的片数，攒够才认定是抢话 */
    bargeIn: 0,
  });

  /**
   * 当前的播放倍速。start 时按语速档位写进来。
   * 放 ref 里是因为 playChunk 每来一片音频就跑一次，走 state 会白白重渲染。
   */
  const playbackRateRef = useRef(1);

  /** AI 说完后延迟开麦的定时器 */
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * 连接代次。严格模式下组件会挂载两次，旧连接的回调可能晚于新连接到达；
   * 每次 connect 递增它，回调里比对后丢弃过期事件。
   */
  const genRef = useRef(0);

  const supported =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof AudioContext !== 'undefined';

  /* ---------- 播放 ---------- */

  const playChunk = useCallback((b64: string) => {
    if (!playRef.current) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      playRef.current = { ctx: new Ctor({ sampleRate: SAMPLE_RATE }), cursor: 0 };
    }
    const { ctx } = playRef.current;
    void ctx.resume();

    const pcm = pcm16Base64ToFloat(b64);
    if (!pcm.length) return;
    const buf = ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
    buf.copyToChannel(pcm, 0);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    // 上游没有语速参数，本地只能靠倍速微调。倍速会连带变调，
    // 所以档位表里把它限制在 0.9~1.1，再往外调声音就明显发闷或发尖了。
    const speed = playbackRateRef.current;
    if (speed !== 1) src.playbackRate.value = speed;
    src.connect(ctx.destination);

    // 分片要首尾相接。落后于当前时间就从"现在"重新起排，避免累积漂移。
    // 注意这里必须按倍速后的实际时长推进游标，否则变速播放时分片会互相叠上。
    const startAt = Math.max(ctx.currentTime + 0.02, playRef.current.cursor);
    src.start(startAt);
    playRef.current.cursor = startAt + buf.duration / speed;
  }, []);

  const stopPlayback = useCallback(() => {
    const p = playRef.current;
    if (!p) return;
    playRef.current = null;
    void p.ctx.close().catch(() => {});
  }, []);

  /* ---------- 断句 ---------- */

  /**
   * 学生抢话：停掉正在播的回答，让上游别再往下说，马上开麦收他这句。
   *
   * 这里不走 resumeMic 的延迟 —— 抢话时人已经在说了，再等几百毫秒会吃掉开头。
   */
  const interrupt = useCallback(() => {
    aiSpeakingRef.current = false;
    // 取消是异步的：已经在网络上的音频分片还会继续到，
    // 不打这个标记的话它们会把麦克风又关掉，学生刚开口的半句就没了。
    droppingRef.current = true;
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
    stopPlayback();
    setPartial('');
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'cancel' }));
    }
    const v = vadRef.current;
    v.speaking = false;
    v.preroll = [];
    openMicRef.current = true;
    setStatus('ready');
  }, [stopPlayback]);

  /** AI 说完（或被打断）之后重新开麦。留一点间隔，躲开扬声器尾音。 */
  const resumeMic = useCallback(() => {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => {
      resumeTimerRef.current = null;
      const v = vadRef.current;
      v.speaking = false;
      v.preroll = [];
      // 用户主动静音了就别擅自开麦
      if (mutedRef.current) return;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        openMicRef.current = true;
        setStatus('ready');
      }
    }, VAD.resumeAfterAiMs);
  }, []);

  /* ---------- 录音 ---------- */

  const stopMic = useCallback(() => {
    const m = micRef.current;
    if (!m) return;
    micRef.current = null;
    try {
      m.node.disconnect();
      m.stream.getTracks().forEach((t) => t.stop());
      void m.ctx.close();
    } catch {
      // 已经关了
    }
  }, []);

  const startMic = useCallback(async () => {
    if (micRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        // 这三项交给浏览器做，能显著减少扬声器回声被当成学生说话的情况
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    const source = ctx.createMediaStreamSource(stream);
    // ScriptProcessor 已废弃但所有浏览器都还支持，且不需要额外加载 worklet 文件。
    // 这里只做切片、算音量、降采样，运算量很小，不至于卡住音频线程。
    const node = ctx.createScriptProcessor(4096, 1, 1);

    node.onaudioprocess = (e) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      // 学生主动闭麦：什么都不做
      if (mutedRef.current) return;

      const raw = e.inputBuffer.getChannelData(0);
      const level = rms(raw);
      const now = performance.now();
      const v = vadRef.current;

      // AI 正在说话：不送音频，只盯「学生是不是要插话」。
      // 门槛取得高、而且要连续响够久，因为外放时它自己的声音也会被麦克风收回来。
      if (aiSpeakingRef.current) {
        if (level >= VAD.bargeInRms) {
          v.bargeIn++;
          const heldMs = (v.bargeIn * raw.length * 1000) / ctx.sampleRate;
          if (heldMs >= VAD.bargeInMs) {
            v.bargeIn = 0;
            interrupt();
          }
        } else {
          // 不连续就重新数，单次爆音不算抢话
          v.bargeIn = 0;
        }
        return;
      }
      v.bargeIn = 0;

      // 刚说完、还在等回声散去的窗口里也不采集
      if (!openMicRef.current) return;

      const pcm = downsample(raw, ctx.sampleRate, SAMPLE_RATE);
      const b64 = floatToPcm16Base64(pcm);

      if (!v.speaking) {
        // 还没开口：先攒前导缓冲，够响了再算这句话的开始
        v.preroll.push(b64);
        if (v.preroll.length > VAD.prerollChunks) v.preroll.shift();

        if (level >= VAD.speakRms) {
          v.speaking = true;
          v.startedAt = now;
          v.lastVoiceAt = now;
          setStatus('listening');
          // 把开口前那几十毫秒一起送出去，否则首个辅音会被吃掉
          for (const chunk of v.preroll) {
            ws.send(JSON.stringify({ type: 'audio', audio: chunk }));
          }
          v.preroll = [];
        }
        return;
      }

      // 正在说：一律送，句中的短暂停顿也要保留，不然听起来是断的
      ws.send(JSON.stringify({ type: 'audio', audio: b64 }));
      if (level > VAD.silenceRms) v.lastVoiceAt = now;

      const spoken = now - v.startedAt;
      const quietFor = now - v.lastVoiceAt;
      // 静音够久 = 这句说完了；说太久则强制断一次，避免没有尽头
      const done =
        (quietFor >= VAD.silenceMs && spoken >= VAD.minSpeechMs) || spoken >= VAD.maxSpeechMs;
      if (!done) return;

      v.speaking = false;
      v.preroll = [];
      if (spoken < VAD.minSpeechMs) {
        // 太短，当噪声丢掉，不去打扰上游
        return;
      }
      // 提交这一句并等回应。等 AI 说完再开麦，避免自问自答。
      openMicRef.current = false;
      // 新回合开始，上一次抢话留下的「丢弃残余音频」标志到此为止，
      // 否则被打断过一次之后，之后所有回答的音频都会被当成残余丢掉。
      droppingRef.current = false;
      ws.send(JSON.stringify({ type: 'commit' }));
      setStatus('thinking');
    };

    source.connect(node);
    // 必须接到 destination 才会被驱动，但增益设 0，否则会听到自己的回声
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);

    micRef.current = { ctx, stream, node };
  }, [interrupt]);

  /* ---------- 连接 ---------- */

  const connect = useCallback(
    (opts: StartOpts) =>
      new Promise<void>((resolve, reject) => {
        setError(null);
        setStatus('connecting');

        // 每次连接分配一个代次。React 严格模式下组件会挂载两次（挂载→清理→再挂载），
        // 旧连接的回调可能在新连接建立之后才到，用代次把它们挡掉，
        // 否则会出现「新连接刚 ready 又被旧连接的 onclose 改回 idle」。
        const gen = ++genRef.current;
        const stale = () => gen !== genRef.current;

        // 同一时刻只保留一条连接，重连前先把上一条关掉，避免上游会话泄漏计费
        const prev = wsRef.current;
        if (prev) {
          wsRef.current = null;
          try {
            prev.close();
          } catch {
            // 已经断了
          }
        }

        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${proto}://${location.host}${REALTIME_PATH}`);
        wsRef.current = ws;

        ws.onopen = () => {
          if (stale()) {
            try {
              ws.close();
            } catch {
              // 无所谓
            }
            return;
          }
          ws.send(JSON.stringify({ type: 'start', ...opts }));
        };

        ws.onmessage = (ev) => {
          if (stale()) return;
          let msg: ServerToClient;
          try {
            msg = JSON.parse(ev.data as string) as ServerToClient;
          } catch {
            return;
          }

          switch (msg.type) {
            case 'ready':
              setStatus('ready');
              // 会话就绪，开麦开始听。之后麦克风一直开着，靠 VAD 断句。
              openMicRef.current = !mutedRef.current;
              resolve();
              break;

            case 'user_transcript': {
              const key = `u${Date.now()}`;
              lastUserKey.current = key;
              setTurns((t) => [...t, { key, role: 'user', text: msg.text, correction: null, usedTerms: [] }]);
              setStatus('thinking');
              break;
            }

            case 'assistant_delta':
              setPartial((p) => p + msg.text);
              setStatus('speaking');
              break;

            case 'audio_delta':
              // 被抢话打断的这一回合，剩下的音频一律丢掉，不能再关麦
              if (droppingRef.current) break;
              // AI 开始出声。置位之后音频回调切到「只盯抢话」的分支：
              // 不再往上游送音频，但仍然监听，学生一插话就能打断。
              aiSpeakingRef.current = true;
              openMicRef.current = false;
              playChunk(msg.audio);
              break;

            case 'turn_done':
              setPartial('');
              if (droppingRef.current) {
                // 这一回合是被打断的：文本不入列（学生没听完），状态也不要动 ——
                // interrupt 已经把麦开好了，这里再改会把人刚说的话切掉。
                droppingRef.current = false;
                break;
              }
              if (msg.text) {
                setTurns((t) => [...t, { key: `a${Date.now()}`, role: 'assistant', text: msg.text }]);
              }
              aiSpeakingRef.current = false;
              setStatus('ready');
              // AI 说完了，隔一小会儿再开麦 —— 外放时扬声器的尾音会被麦克风
              // 收回去，立刻开麦会变成自问自答。
              resumeMic();
              break;

            case 'coaching':
              // 迟到的纠正：按文本匹配回填到对应的学生发言上
              setTurns((t) =>
                t.map((x) =>
                  x.role === 'user' && x.text === msg.userText && !x.correction
                    ? { ...x, correction: msg.correction, usedTerms: msg.usedTerms }
                    : x,
                ),
              );
              break;

            case 'error':
              // 出错时 AI 可能正在说话，必须把标志清掉 ——
              // 否则采集回调会一直停在「盯抢话」的分支，麦克风再也送不出音频
              aiSpeakingRef.current = false;
              setError(msg.message);
              setStatus('error');
              break;
          }
        };

        ws.onerror = () => {
          if (stale()) return;
          aiSpeakingRef.current = false;
          setError('语音连接出错了，试试重新开始。');
          setStatus('error');
          reject(new Error('ws error'));
        };

        ws.onclose = () => {
          // 旧连接的关闭不能影响新连接的状态
          if (stale()) return;
          wsRef.current = null;
          openMicRef.current = false;
          aiSpeakingRef.current = false;
          setStatus((s) => (s === 'error' ? s : 'idle'));
        };
      }),
    [playChunk, resumeMic],
  );

  const start = useCallback(
    async (opts: StartOpts) => {
      if (!supported) {
        setError('这个浏览器不支持录音，换 Chrome / Edge 或手机 Safari 试试。');
        setStatus('error');
        return;
      }
      // 倍速要在建连之前设好：第一片音频可能在 start 返回前就到了
      playbackRateRef.current = pace(opts.paceKey).playbackRate;
      try {
        await connect(opts);
        await startMic();
        // 连上就开麦，之后全靠 VAD 断句 —— 不需要再按任何按钮
        openMicRef.current = true;
        setStatus('ready');
      } catch (e) {
        const msg = (e as Error).message;
        setError(
          msg.includes('Permission') || msg.includes('NotAllowed')
            ? '麦克风权限被拒绝了。浏览器地址栏左侧可以重新允许。'
            : `开始失败：${msg}`,
        );
        setStatus('error');
      }
    },
    [connect, startMic, supported],
  );

  /**
   * 静音开关。
   *
   * 唯一需要它的场合是「旁边有人说话，别让 AI 听见」，
   * 正常对话不用碰 —— 这是打电话式交互的重点。
   */
  const setMuted = useCallback(
    (next: boolean) => {
      setMutedState(next);
      // ref 是给音频回调用的：那里跑在 state 之外，读不到最新的 muted
      mutedRef.current = next;
      if (next) {
        // 静音时把没说完的这句丢掉，不要下次开麦时和新的话拼在一起
        const v = vadRef.current;
        v.speaking = false;
        v.preroll = [];
        openMicRef.current = false;
        setStatus((s) => (s === 'listening' ? 'ready' : s));
        return;
      }
      // 取消静音：只有在不是 AI 说话的时候才立刻开麦
      setStatus((s) => {
        if (s === 'speaking' || s === 'thinking') return s;
        openMicRef.current = true;
        return s === 'idle' ? s : 'ready';
      });
    },
    [],
  );

  const stop = useCallback(() => {
    // 推进代次：这条连接之后到达的回调一律作废，不再改状态
    genRef.current++;
    openMicRef.current = false;
    aiSpeakingRef.current = false;
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
    stopMic();
    stopPlayback();
    const ws = wsRef.current;
    wsRef.current = null;
    try {
      ws?.close();
    } catch {
      // 无所谓
    }
    setStatus('idle');
    setPartial('');
  }, [stopMic, stopPlayback]);

  // 离开页面时一定要断开，否则上游会话会一直挂着计费
  useEffect(() => () => stop(), [stop]);

  return { status, turns, partial, error, supported, muted, start, stop, setMuted };
}

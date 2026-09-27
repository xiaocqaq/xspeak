'use client';

/**
 * 浏览器原生语音能力封装。
 * - 朗读用 SpeechSynthesis（免费、离线可用、桌面和手机都支持）。
 * - 识别用 SpeechRecognition / webkitSpeechRecognition。Chrome / Edge / 手机 Safari 支持，
 *   Firefox 不支持 —— 所以每个用到识别的地方都必须提供打字兜底，见 supported 字段。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { readPace, subscribePace } from '@/lib/pace-store';
import { readVoice, subscribeVoice } from '@/lib/voice-store';
import { pace } from '@/lib/voice-options';
import { DEFAULT_SERVER_VOICE, SERVER_VOICES, playbackRateFor, preferredMimoVoiceId } from '@/lib/tts/server-voice-list';
import { withBase } from '@/lib/base-path';
import type { SpeechPace } from '@/lib/types';

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/* ------------------------------ 语音包质量分级 ------------------------------ */

/**
 * 给浏览器语音包排个高下。
 *
 * ── 为什么必须排 ──
 *
 * 原来这里只写了「优先 localService」。在桌面上没问题，但 **iOS 上所有语音包的
 * localService 都是 true**，于是这个条件等于没有条件，实际拿到的是 getVoices()
 * 返回的第一个英文包 —— 那往往是 Eloquence（上世纪的机器音）或者 compact 版
 * （体积压过的低码率版本）。这就是「iOS 离线语音不好听」的直接原因：
 * 不是 iOS 只有难听的音，是我们没在好音里挑。
 *
 * ── 靠 voiceURI 判断，不靠 name ──
 *
 * name 在 iOS 上会重名：compact 和 enhanced 版的 Samantha 都叫 "Samantha"。
 * voiceURI 才带质量层级，形如：
 *   com.apple.voice.premium.en-US.Ava          ← 最好，要用户手动下载
 *   com.apple.voice.enhanced.en-US.Samantha    ← 好，也要下载
 *   com.apple.ttsbundle.siri_female_en-US_compact
 *   com.apple.voice.compact.en-US.Samantha     ← 系统自带，就是"不好听"那个
 *   com.apple.eloquence.en-US.Rocko            ← 机器音，最差
 *
 * ── 彩蛋音必须排到最后 ──
 *
 * macOS 自带一批玩具音（Bells / Zarvox / Trinoids…），lang 是 en-US、
 * localService 是 true，各项条件全满足，但拿来读单词是灾难。
 */
const VOICE_TIER = [
  { tier: 6, zh: '超高音质', re: /\.premium\./i },
  { tier: 5, zh: '高音质', re: /\.enhanced\.|premium|enhanced/i },
  { tier: 4, zh: 'Siri', re: /siri/i },
  { tier: 2, zh: '精简版', re: /\.compact\.|-compact\b|_compact\b/i },
  { tier: 1, zh: '机器音', re: /eloquence/i },
] as const;

/** macOS / iOS 自带的玩具音色，读课文一律不用。 */
const NOVELTY =
  /^(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|jester|junior|kathy|organ|superstar|trinoids|whisper|wobble|zarvox|grandma|grandpa|rocko|shelley|sandy|flo|eddy|reed|ralph|fred|princess|bruce|agnes|victoria \(retired\))$/i;

/** 音质档位，0（彩蛋音）到 6（premium）。用于排序，也用于界面上标注。 */
export function voiceTier(v: SpeechSynthesisVoice): { tier: number; zh: string } {
  if (NOVELTY.test(v.name.trim())) return { tier: 0, zh: '玩具音' };
  const uri = v.voiceURI || '';
  for (const t of VOICE_TIER) {
    if (t.re.test(uri) || t.re.test(v.name)) return { tier: t.tier, zh: t.zh };
  }
  // 没有任何标记：Windows 的 Zira/David、Chrome 的 Google 系列都落在这里，
  // 它们比 compact 好、比 enhanced 差，正好是中间档
  return { tier: 3, zh: v.localService ? '标准' : '云端' };
}

/**
 * 英文语音包按好听程度排序。
 *
 * 排序键的顺序就是优先级：音质档位 → en-US/en-GB 优先（en-IN、en-ZA 这些
 * 口音对初学者不友好）→ 本地合成优先（这一条降级成同分时的加分项，
 * 不再是决定性条件）→ 名字，只为让结果稳定，不然 getVoices() 的顺序一变
 * 用户就发现"声音自己换了"。
 */
export function rankEnglishVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const mainstream = (lang: string) => {
    const l = lang.toLowerCase();
    return l.startsWith('en-us') || l.startsWith('en_us') ? 2 : l.startsWith('en-gb') || l.startsWith('en_gb') ? 1 : 0;
  };
  return voices
    .filter((v) => v.lang.toLowerCase().startsWith('en'))
    .sort(
      (a, b) =>
        voiceTier(b).tier - voiceTier(a).tier ||
        mainstream(b.lang) - mainstream(a.lang) ||
        Number(b.localService) - Number(a.localService) ||
        a.name.localeCompare(b.name),
    );
}

/* ------------------------------ 服务端音色播放 ------------------------------ */

/**
 * 云端 MiMo 合成的音频，用一个 <audio> 播。
 *
 * ── 为什么全程共用一个元素 ──
 *
 * iOS 要求 `play()` 出现在用户手势的同一个事件循环里。一旦某个 <audio> 在手势里
 * play 过一次，它就"解锁"了，之后换 src 再 play 不再需要手势。所以这里存一个
 * 模块级元素反复用 —— 每次朗读都新建一个的话，第一次之后全被拦。
 */
let sharedAudio: HTMLAudioElement | null = null;
/** 整个页面只有一个播放所有者，换按钮先取消旧请求和它的回调。 */
let activePlayback: (() => void) | null = null;

function getAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = 'auto';
  }
  return sharedAudio;
}

/**
 * 冷合成也必须一次点击后自动播放。原来的 700ms 预算会在音频到达前切走，
 * iOS 上异步回退的系统朗读又可能被手势策略拦住，造成「第二次才响」。
 * 统一等待实际完成；35s 覆盖服务端默认 30s 超时和传输余量，真失败才降级。
 */
const SERVER_TTS_HARD_MS = 35_000;

/**
 * 服务端连续失败几次就这一整个会话不再试。
 *
 * 没配 MIMO_TTS_KEY 的部署会稳定拿到 503，服务挂了也一样。这种情况下
 * 每次点朗读都先白等一次请求、再退回浏览器语音包，体验比直接用浏览器还差。
 * 允许一次失败是给瞬时网络抖动留的余地，第二次就认定是真不可用。
 */
let serverFails = 0;
const SERVER_TTS_GIVE_UP = 2;
/**
 * 熔断冷却（2026-08-28 加）。
 *
 * 原来 serverFails 是模块级变量、**只在成功出声时归零**：上游抖两下
 * （2026-08 实测上游对个别句子稳定 502）之后，这个标签页里的所有朗读
 * 就永久走浏览器语音包 —— 用户看到的是"点发音没声、连后端请求都没有"，
 * 只能刷新页面。现在给熔断加 60 秒有效期，过期自动再试一次；真不可用
 * 时最多每分钟白等一次请求，代价可接受。
 */
const SERVER_TTS_COOLDOWN_MS = 60_000;
let serverFailedAt = 0;
/** 熔断是否仍然生效（含冷却判断）。过了冷却期顺手把计数清掉。 */
function serverTtsBlocked(): boolean {
  if (serverFails < SERVER_TTS_GIVE_UP) return false;
  if (Date.now() - serverFailedAt >= SERVER_TTS_COOLDOWN_MS) {
    serverFails = 0;
    return false;
  }
  return true;
}
/** 记一次服务端失败（同时刷新熔断起点）。 */
function noteServerFail(): void {
  serverFails += 1;
  serverFailedAt = Date.now();
}

/** 单次请求的文本上限，和 api/speak 的 MAX_TEXT 对齐。超了前端切块连播（splitSpeechChunks）。 */
const SERVER_TTS_MAX_CHARS = 300;

/**
 * 服务端链路愿意接的总量上限。超过它切块数太多，等真嗓音的体验不如
 * 系统语音包一口气读完 —— 整页文档级别的朗读本来也不是这个功能的目标。
 */
const SERVER_TTS_TOTAL_CHARS = 1200;

/**
 * 把超过接口限长的文本按句子切块（每块 ≤ max）。
 *
 * 阅读「朗读全文」动辄五六百字符，api/speak 会直接 413 —— 原来的处理是
 * 整篇丢给系统语音，等于阅读环节永远用不上服务端音色。切块而不是截断：
 * 短文是学习材料，一个字都不能少。按句边界切，保证每块单独拿出来读也是
 * 通顺的一句话，哪一块超时退回浏览器语音包时，直接把剩下几块拼起来念就行。
 * 极少数无标点的超长"一句话"（模型偶发的坏输出）按词硬切兜底。
 */
export function splitSpeechChunks(text: string, max = SERVER_TTS_MAX_CHARS): string[] {
  const body = text.replace(/\s+/g, ' ').trim();
  if (body.length <= max) return [body];

  const pieces = body.match(/[^.!?。！？]+[.!?。！？]*["')\]]*\s*/g) ?? [body];
  const chunks: string[] = [];
  let cur = '';
  const flush = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = '';
  };
  for (const piece of pieces) {
    let s = piece.trim();
    if (!s) continue;
    while (s.length > max) {
      const cut = s.lastIndexOf(' ', max);
      const at = cut > max * 0.5 ? cut : max;
      flush();
      chunks.push(s.slice(0, at));
      s = s.slice(at).trim();
    }
    if (cur && cur.length + 1 + s.length > max) flush();
    cur = cur ? `${cur} ${s}` : s;
  }
  flush();
  return chunks.filter(Boolean);
}

/**
 * 试听某个服务端音色，等它放完。
 *
 * 和 speak 里那条路的区别：这里**不设超时兜底**。设置页点试听就是想听这个音色，
 * 换成浏览器语音包读出来等于没试听 —— 宁可转圈等几秒（第一次现合成 1.5s 左右，
 * 之后同一句话就命中缓存）。所以调用方要自己画 loading。
 */
export async function previewServerVoice(
  text: string,
  voiceId: string,
  paceKey: SpeechPace,
  signal?: AbortSignal,
): Promise<void> {
  const audio = getAudio();
  if (!audio) throw new Error('当前环境不能播放音频');
  if (signal?.aborted) return;
  activePlayback?.();
  window.speechSynthesis?.cancel();
  const rate = playbackRateFor(pace(paceKey).ttsSpeed, false);
  await new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('error', onErr);
      signal?.removeEventListener('abort', cancel);
      if (activePlayback === cancel) {
        activePlayback = null;
        audio.pause();
      }
      if (error) reject(error);
      else resolve();
    };
    const cancel = () => finish();
    const onPlaying = () => {
      window.clearTimeout(timer);
      audio.playbackRate = rate;
    };
    const onEnd = () => finish();
    const onErr = () => finish(new Error('试听失败，服务端音色暂时用不了'));
    const timer = window.setTimeout(() => finish(new Error('试听加载超时，请稍后重试')), SERVER_TTS_HARD_MS);
    activePlayback = cancel;
    signal?.addEventListener('abort', cancel, { once: true });
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('error', onErr);
    audio.pause();
    audio.muted = false;
    const qs = new URLSearchParams({ text, voice: voiceId, pace: paceKey });
    audio.src = withBase(`/api/speak?${qs.toString()}`);
    audio.load();
    audio.playbackRate = rate;
    audio.play().catch((e) => finish(e instanceof Error ? e : new Error(String(e))));
  });
}

/**
 * 服务端音色能不能用。设置页拿它决定要不要把这批音色画出来 ——
 * 没配 MIMO_TTS_KEY 的部署（比如别人克隆下来自己跑）不该看到一排点了没反应的音色。
 *
 * 用 HEAD 不带参数探，只认 400 为「能用」：
 * 配好了才会走到参数校验、因为缺 text 返回 400；没配是 503，没登录是 401。
 */
export async function serverVoicesAvailable(): Promise<boolean> {
  try {
    const r = await fetch(withBase('/api/speak'), { method: 'HEAD' });
    return r.status === 400;
  } catch {
    return false;
  }
}

/**
 * 服务端缓存命中情况：qs → 命中/未命中。**必须在点击之前就拿到结果**。
 *
 * 为什么不能"点了再探"：`<audio>.play()` 得在点击的同一个 tick 里调用，否则
 * iOS 判它不属于用户手势、直接拒播（这也是上一版"点两次才响"的成因之一）。
 * 所以顺序反过来 —— 内容渲染时就 HEAD 探一次，点的时候同步查表：
 *   'hit'      立刻走真嗓音（几十毫秒，本来也没什么好优化）
 *   'miss'     当场用系统语音出声（先有声音，不用干等），同时把这句排进后台合成；
 *              这一次听到的是系统英语，下一次点（或下次进这个环节）就是真嗓音
 *   undefined  没探到/探失败：保持原样，等真嗓音
 * onlineOnly（听力/阅读）不看这张表：那两处宁可等，也不换掉训练材料。
 */
const speechCache = new Map<string, 'hit' | 'miss'>();
/** 同一句只探一次：页面里十个词的朗读按钮同时挂载，也只发一个 HEAD。 */
const probing = new Set<string>();

/**
 * 渲染时调用：问服务端这句的音频在不在缓存里，结果记进 speechCache。
 * 只处理"整句一块"的文本 —— 长文切块后是逐块请求，预检表反而对不上。
 */
export function probeServerSpeech(texts: string[]): void {
  if (typeof fetch === 'undefined') return;
  // 音色/档位与 speak() 用同一套解析，否则算出来的 qs 和播放时的缓存键对不上
  const voice = preferredMimoVoiceId(readVoice()) ?? DEFAULT_SERVER_VOICE;
  const paceKey = readPace();
  for (const raw of texts) {
    const body = raw.replace(/\s+/g, ' ').trim();
    if (!body || body.length > SERVER_TTS_TOTAL_CHARS) continue;
    const chunks = splitSpeechChunks(body);
    if (chunks.length !== 1) continue;
    const qs = new URLSearchParams({ text: chunks[0]!, voice, pace: paceKey }).toString();
    if (speechCache.has(qs) || probing.has(qs)) continue;
    probing.add(qs);
    fetch(withBase(`/api/speak?${qs}`), { method: 'HEAD' })
      .then((r) => {
        if (r.status === 200) speechCache.set(qs, 'hit');
        else if (r.status === 404) speechCache.set(qs, 'miss');
        // 其它状态（401/503/400）说明服务端这条路现在不可用，不能记成 miss ——
        // 那会在点击时把人推去系统语音，而其实只是暂时探不通
      })
      .catch(() => {})
      .finally(() => probing.delete(qs));
  }
}

/**
 * 预热请求的限流阀：同一路最多并发 2 个。
 *
 * 云端合成虽快，几十个并发同时发也会互相拖慢（2026-08-27 实测）。
 * 进听力环节一次要热 4–8 句台词，必须排队、最多两个在飞。
 * 播放时 startWarm 和 warmServerSpeech 共用这一个队列，谁先触发都行。
 */
const WARM_CONCURRENCY = 2;
const warmQueue = new Set<string>(); // 进行中的 key（qs 串）
const warmPending: string[] = []; // 排队中的 qs 串

function pumpWarm() {
  while (warmPending.length && warmQueue.size < WARM_CONCURRENCY) {
    const qs = warmPending.shift()!;
    if (warmQueue.has(qs)) continue;
    warmQueue.add(qs);
    fetch(withBase(`/api/speak?${qs}`))
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        // 合成完写盘了，预检表跟着更新：下次点击直接走真嗓音，不再退回系统语音
        speechCache.set(qs, 'hit');
        // 响应体读完才算合成完写盘 —— 不 body 的话连接一断缓存就没了
        return r.arrayBuffer();
      })
      .catch(() => {})
      .finally(() => {
        warmQueue.delete(qs);
        pumpWarm();
      });
  }
}

/** 把一批文本排进预热队列（去重已在键里：同样的 文本/音色/档位 只发一次）。 */
function enqueueWarm(qsList: string[]) {
  for (const qs of qsList) {
    if (!warmQueue.has(qs) && !warmPending.includes(qs)) warmPending.push(qs);
  }
  pumpWarm();
}

/** 播放链路用的即时插队：开播某块时它后面的块优先于远处还没排的 */
function startWarmImmediate(qsList: string[]) {
  for (let i = qsList.length - 1; i >= 0; i--) {
    const qs = qsList[i]!;
    if (!warmQueue.has(qs) && !warmPending.includes(qs)) warmPending.unshift(qs);
  }
  pumpWarm();
}

/**
 * 听力进环节时调：把整段对话的台词提前送去服务端合成并写盘。
 * 之后逐句播放时几乎都命中磁盘缓存（几十毫秒），对话不再有"等一句卡一下"。
 * 返回排队句数（调试用）。
 */
export function warmServerSpeech(
  lines: { text: string; voice?: string }[],
  paceKey: SpeechPace,
): number {
  const qsList = lines
    .filter((l) => l.text.trim() && l.text.length <= SERVER_TTS_TOTAL_CHARS)
    .flatMap((l) => splitSpeechChunks(l.text).map((text) => new URLSearchParams({
      text,
      voice: l.voice ?? DEFAULT_SERVER_VOICE,
      pace: paceKey,
    }).toString()));
  enqueueWarm(qsList);
  return qsList.length;
}

/* ---------------------------------- 朗读 ---------------------------------- */

/**
 * @param preferredVoice 指定音色名。只有设置页需要传（它要试听"某一个"包，
 *   包括用户还没保存的那个选择）。其余调用点一律不传 —— 不传就用用户存下来的
 *   偏好（voice-store），这才是"设置里选的音色到处都生效"的那条路。
 */
export function useTts(preferredVoice?: string) {
  // speaking 表示本次朗读仍在进行；synthesizing 单独区分等待音频和真正出声。
  const [speaking, setSpeaking] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const localSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const supported = typeof window !== 'undefined' && (localSupported || typeof Audio !== 'undefined');
  const paceRef = useRef<SpeechPace>(readPace());
  const voiceRef = useRef<string | null>(readVoice());
  useEffect(() => subscribePace((p) => (paceRef.current = p)), []);
  useEffect(() => subscribeVoice((v) => (voiceRef.current = v)), []);

  useEffect(() => {
    if (!localSupported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, [localSupported]);

  const pickVoice = useCallback(() => {
    const want = preferredVoice ?? voiceRef.current;
    return voices.find((v) => v.name === want) ?? rankEnglishVoices(voices)[0];
  }, [voices, preferredVoice]);

  const cleanupRef = useRef<(() => void) | null>(null);
  const pendingRef = useRef<string | null>(null);
  const stop = useCallback(() => {
    // 只停止自己拥有的播放。无关词卡卸载不应暂停别的按钮正在等待的音频。
    cleanupRef.current?.();
    setSpeechError(null);
  }, []);

  const speak = useCallback(
    (text: string, opts?: {
      rate?: number;
      slow?: boolean;
      onEnd?: () => void;
      voice?: SpeechSynthesisVoice;
      pitch?: number;
      serverVoiceId?: string;
      /** 听力/阅读只用在线音色；失败必须报错，不能跳过没读完的块。 */
      onlineOnly?: boolean;
    }) => {
      const body = text.replace(/\s+/g, ' ').trim();
      if (!body) return;
      const paceKey = paceRef.current;
      const serverVoice = opts?.serverVoiceId ??
        preferredMimoVoiceId(preferredVoice) ??
        preferredMimoVoiceId(voiceRef.current) ?? DEFAULT_SERVER_VOICE;
      const requestKey = JSON.stringify([
        body, serverVoice, paceKey, opts?.slow, opts?.rate, opts?.pitch,
        opts?.voice?.voiceURI, opts?.voice?.name, opts?.onlineOnly,
      ]);
      // React 还没来得及刷新 disabled 时，同一句的第二次点击也不重启下载。
      if (pendingRef.current === requestKey) return;
      stop();
      activePlayback?.();

      const audio = getAudio();
      let done = false;
      let timer = 0;
      let utterance: SpeechSynthesisUtterance | null = null;
      let detachAudio = () => {};
      const finish = (fireEnd: boolean) => {
        if (done) return;
        // 先失效，再 pause/cancel：旧 play() 的 AbortError 会在微任务里迟到。
        done = true;
        window.clearTimeout(timer);
        detachAudio();
        if (utterance) {
          utterance.onstart = utterance.onend = utterance.onerror = null;
          window.speechSynthesis.cancel();
        }
        if (activePlayback === cancel) {
          activePlayback = null;
          audio?.pause();
        }
        if (cleanupRef.current === cancel) cleanupRef.current = null;
        pendingRef.current = null;
        setSpeaking(false);
        setSynthesizing(false);
        if (fireEnd) opts?.onEnd?.();
      };
      const cancel = () => finish(false);
      cleanupRef.current = cancel;
      activePlayback = cancel;
      setSpeaking(true);
      const fail = (message: string) => {
        if (done) return;
        setSpeechError(message);
        finish(false);
      };

      const speakLocal = (localText: string) => {
        if (done) return;
        pendingRef.current = null;
        setSynthesizing(false);
        if (!localSupported) {
          fail('语音暂时无法播放，请稍后重试或换用支持语音的浏览器');
          return;
        }
        const u = new SpeechSynthesisUtterance(localText);
        utterance = u;
        const v = opts?.voice ?? pickVoice();
        if (v) u.voice = v;
        u.lang = v?.lang ?? 'en-US';
        if (opts?.pitch !== undefined) u.pitch = Math.min(2, Math.max(0, opts.pitch));
        const base = pace(paceKey).webSpeechRate;
        u.rate = opts?.rate ?? (opts?.slow ? Math.max(0.5, base - 0.22) : base);
        u.onend = () => finish(true);
        u.onerror = () => fail('浏览器未能播放语音，请重试或在设置中更换音色');
        try {
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(u);
        } catch {
          fail('浏览器未能播放语音，请重试或在设置中更换音色');
        }
      };

      const online = Boolean(opts?.onlineOnly);
      const canServer = audio && (online || !serverTtsBlocked()) &&
        (online || Boolean(opts?.serverVoiceId) || (!opts?.voice && opts?.pitch === undefined)) &&
        opts?.rate === undefined && body.length <= SERVER_TTS_TOTAL_CHARS;
      if (!canServer || !audio) {
        if (online) {
          fail(body.length > SERVER_TTS_TOTAL_CHARS ? '这段太长了，没法在线朗读' : '在线语音暂时用不了');
        } else {
          speakLocal(body);
        }
        return;
      }

      const chunks = splitSpeechChunks(body);
      const qsFor = (t: string) => {
        const q = new URLSearchParams({ text: t, voice: serverVoice, pace: paceKey });
        if (opts?.slow) q.set('slow', '1');
        return q.toString();
      };
      const playbackRate = playbackRateFor(pace(paceKey).ttsSpeed, Boolean(opts?.slow));
      /*
       * 冷启动「先出声」：探过、且明确没缓存 —— 当场用系统语音把这句读完
       * （仍在同一个手势里，iOS 不会拦），同时排进后台合成。这一次是系统英语，
       * 下一次点（或下次进这个环节）就是真嗓音。这正是 /api/speak 的 HEAD 注释
       * 写的那套策略，此前只在设置页用来探「服务端音色能不能用」，按句粒度一直
       * 没落地 —— 结果是每次冷启动都要干等两三秒真嗓音。
       *
       * 三个前提缺一不可：
       * · 不是 onlineOnly —— 听力/阅读宁可等，也不拿系统英语换掉训练材料；
       * · 整句一块 —— 长文是逐块请求，一张预检表对不上；
       * · 浏览器有系统语音 —— 否则这条路只会更静音，不如老实等服务端。
       */
      if (
        !online &&
        localSupported &&
        chunks.length === 1 &&
        speechCache.get(qsFor(chunks[0]!)) === 'miss'
      ) {
        startWarmImmediate([qsFor(chunks[0]!)]);
        speakLocal(body);
        return;
      }
      let index = 0;
      let fellBack = false;
      let started = false;
      let currentUrl = '';
      /**
       * 元素是否还指着我们要的那一块。
       * 不直接比 currentSrc：资源选择完成前它是空串，playing 可能先到，
       * 那样这一块会被判成过期 → 白白等到硬超时才出声。src 赋值后立即可读，
       * 两个都看一眼才稳。
       */
      const isCurrent = () => audio.currentSrc === currentUrl || audio.src === currentUrl;
      const fallback = (message: string) => {
        if (done || fellBack) return;
        fellBack = true;
        window.clearTimeout(timer);
        detachAudio();
        audio.pause();
        if (online) {
          fail(message);
        } else {
          // 仅真实失败/硬超时才降级，保留当前块和所有未读的内容。
          speakLocal(chunks.slice(index).join(' '));
        }
      };
      const onPlaying = () => {
        if (done || fellBack || !isCurrent()) return;
        started = true;
        audio.playbackRate = playbackRate;
        window.clearTimeout(timer);
        serverFails = 0;
        pendingRef.current = null;
        setSynthesizing(false);
        startWarmImmediate(chunks.slice(index + 1, index + 3).map(qsFor));
      };
      const onEnded = () => {
        if (done || fellBack || !started || !isCurrent()) return;
        if (index + 1 < chunks.length) playChunk(index + 1);
        else finish(true);
      };
      const onError = () => {
        if (done || fellBack || !audio.error) return;
        noteServerFail();
        fallback('在线语音加载失败，请稍后重试');
      };
      const playChunk = (i: number) => {
        if (done || fellBack) return;
        index = i;
        started = false;
        pendingRef.current = requestKey;
        setSynthesizing(true);
        currentUrl = new URL(withBase(`/api/speak?${qsFor(chunks[i]!)}`), window.location.href).href;
        audio.pause();
        audio.muted = false;
        audio.src = currentUrl;
        audio.load(); // 同一句重播也从头开始，不复用上一句未完成的播放位置。
        audio.playbackRate = playbackRate;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          noteServerFail();
          fallback('语音加载超时，请检查网络后重试');
        }, SERVER_TTS_HARD_MS);
        const onRejected = (err: unknown) => {
          if (done || fellBack || index !== i) return;
          fallback((err as Error)?.name === 'NotAllowedError'
            ? '浏览器阻止了播放，请允许声音后重试'
            : '语音未能播放，请稍后重试');
        };
        // 必须在点击事件中同步 play，不能 await fetch 后丢失 iOS 用户手势。
        try {
          audio.play().catch(onRejected);
        } catch (err) {
          onRejected(err);
        }
      };
      audio.addEventListener('playing', onPlaying);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
      detachAudio = () => {
        audio.removeEventListener('playing', onPlaying);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
      };
      playChunk(0);
    },
    [localSupported, pickVoice, preferredVoice, stop],
  );

  useEffect(() => stop, [stop]);
  return { speak, stop, speaking, synthesizing, speechError, supported, voices };
}

/* -------------------------------- 多人对话配音 -------------------------------- */

/**
 * 从语音包名字猜性别。名单是各平台常见的英文嗓音（Windows / macOS / Chrome 自带）。
 * 猜不出来无所谓 —— 只是用来让第一个和第二个说话人尽量听着不一样，
 * 猜错了两个人也还是两个嗓音。注意先判女后判男：`/male/` 会匹配到 "female"。
 */
const FEMALE_HINT =
  /female|woman|zira|hazel|susan|samantha|karen|moira|tessa|fiona|victoria|allison|ava|serena|kate|nicky|joanna/i;
const MALE_HINT = /male|man|david|mark|george|daniel|alex|fred|tom|guy|oliver|james|arthur|aaron|matthew/i;

/**
 * 说话人 → 朗读参数。
 *
 * 一个人说一句就换嗓音，对话才听得出是对话。Web Speech 没有"角色"概念，
 * 能调的只有语音包和音高，所以分两层：
 *
 * 1. 先按性别把系统里的英文语音包交错排开（女/男/不确定轮着取），
 *    这样前两个说话人拿到的嗓音差别最大 —— 两人对话是最常见的情况。
 * 2. 语音包不够分时（很多 Linux / 精简系统只装了一个英文包），
 *    同一个包上叠不同音高。音高只在这时候才动，够用就不动 ——
 *    好嗓音被拉到 1.3 会变得又尖又假。
 */
export type VoiceCast = {
  /** 这个说话人该用什么嗓音。认不出来就返回空对象，走默认。 */
  get(speaker: string): { voice?: SpeechSynthesisVoice; pitch?: number };
  /** 分到了几个说话人。>1 才值得在界面上说"多音色" */
  count: number;
};

/** 一句台词里我们关心的部分。gender 是模型填的，老缓存里没有。 */
export type CastLine = { speaker: string; gender?: 'male' | 'female' };

const PITCH_TIERS = [1, 1.28, 0.78, 1.14];

/**
 * @param preferred 用户在设置里选的音色名。这里是"优先"而不是"强制"：
 *   对话就是要一人一个嗓音，硬把所有人都换成同一个包，多人对话就听不出是对话了。
 *   所以只把它排到自己性别那一桶的最前面 —— 性别对得上的那个说话人会拿到它，
 *   其余人照常分别的包。这样设置里选的音色在独白/单人对话里必然生效，
 *   多人对话里也至少有一个人是它，同时不会出现"男角色配了个女声"。
 */
export function buildVoiceCast(
  lines: CastLine[],
  voices: SpeechSynthesisVoice[],
  preferred?: string | null,
): VoiceCast {
  const key = (s: string) => s.trim().toLowerCase();

  // 按出场顺序去重：谁先说话谁先挑嗓音。性别取这个人第一次报上来的那个
  const order: string[] = [];
  const wants = new Map<string, 'male' | 'female' | undefined>();
  for (const l of lines) {
    const k = key(l.speaker);
    if (!k) continue;
    if (!order.includes(k)) {
      order.push(k);
      wants.set(k, l.gender);
    } else if (!wants.get(k) && l.gender) {
      wants.set(k, l.gender);
    }
  }

  /*
   * 排序决定谁先被挑走：用户选的那个排最前，剩下的按音质分级（rankEnglishVoices）。
   * 分级不能只看 localService —— iOS 上那个字段恒为 true，等于没筛，
   * 结果就是 Eloquence 那种机器音先被挑走，第一个说话人反而最难听。
   * 音质差的包不排除 —— 分嗓音时数量比音质重要，实在不够分才会用到它们。
   */
  const sorted = rankEnglishVoices(voices).sort(
    (a, b) => Number(b.name === preferred) - Number(a.name === preferred),
  );
  /** 0 女 / 1 男 / 2 猜不出 */
  const buckets: SpeechSynthesisVoice[][] = [[], [], []];
  for (const v of sorted) {
    buckets[FEMALE_HINT.test(v.name) ? 0 : MALE_HINT.test(v.name) ? 1 : 2].push(v);
  }

  /*
   * 挑嗓音分两步：
   * 先让报了性别的人各自去自己那一桶里领（模型说了 Ben 是男的，就给男声）；
   * 剩下的（老缓存、或者桶空了）按女/男/不确定轮着发，保证前两个人差别最大。
   */
  const taken = new Set<SpeechSynthesisVoice>();
  const assigned = new Map<string, SpeechSynthesisVoice>();
  const unmet: string[] = [];
  for (const k of order) {
    const want = wants.get(k);
    if (!want) continue;
    const b = buckets[want === 'female' ? 0 : 1];
    const free = b.find((v) => !taken.has(v));
    if (free) {
      taken.add(free);
      assigned.set(k, free);
    } else if (b.length) {
      unmet.push(k);
    }
  }
  /*
   * 同性别的包不够分（两个女生但系统只有一个女声）：宁可让第二个女生用
   * 同一个女声换个音高，也不给她派个男声 —— 听着像另一个女的，比听着像男的对。
   */
  unmet.forEach((k, i) => {
    const b = buckets[wants.get(k) === 'female' ? 0 : 1];
    assigned.set(k, b[i % b.length]);
  });

  // 交错剩下的包：女一个、男一个、不确定一个，这样轮
  const rest: SpeechSynthesisVoice[] = [];
  for (let round = 0; rest.length + taken.size < sorted.length; round++) {
    for (const b of buckets) {
      const v = b.filter((x) => !taken.has(x))[round];
      if (v) rest.push(v);
    }
  }

  // 先把每个人的包定下来（可能重复），音高最后统一补
  const chosen = new Map<string, SpeechSynthesisVoice | undefined>();
  let restAt = 0;
  order.forEach((k, i) => {
    const own = assigned.get(k);
    if (own) {
      chosen.set(k, own);
      return;
    }
    if (restAt < rest.length) {
      chosen.set(k, rest[restAt++]);
      return;
    }
    // 包比人少（或系统一个英文包都没有，那就 undefined 走默认嗓音）
    chosen.set(k, sorted.length ? sorted[i % sorted.length] : undefined);
  });

  /*
   * 同一个包被两个人用上了才动音高：第一个用它的人保持原样，
   * 后面的往上下岔开。好嗓音被拉到 1.3 会又尖又假，能不动就不动。
   */
  const users = new Map<SpeechSynthesisVoice | undefined, number>();
  const table = new Map<string, { voice?: SpeechSynthesisVoice; pitch?: number }>();
  for (const k of order) {
    const voice = chosen.get(k);
    const n = users.get(voice) ?? 0;
    users.set(voice, n + 1);
    table.set(k, n === 0 ? { voice } : { voice, pitch: PITCH_TIERS[n % PITCH_TIERS.length] });
  }

  return {
    get: (speaker: string) => table.get(key(speaker)) ?? {},
    count: order.length,
  };
}

/* --------------------- 多人对话配音（服务端音色版） --------------------- */

/**
 * 说话人 → 服务端音色 id。
 *
 * 听力对话优先走这条而不是 buildVoiceCast（浏览器语音包）：服务端音色是
 * 真人质量的母语嗓音，也不用等 voiceschanged。分法照搬 buildVoiceCast 的
 * 「性别对上优先」：报了性别的说话人去同性别的桶里按顺序领，没报的按
 * 女/男轮着发 —— 前两个说话人性别一定不同，两人对话（最常见）立刻听出是对话。
 *
 * 服务端朗读只有 MiMo 一家（2026-09-09 起），桶就是 MiMo 音色按性别分。
 * 服务端预合成的 serverCastFor 用的是同一套桶序和规则 —— 两边必须一致，
 * 否则预合成的音色和播放请求的音色对不上，缓存永远 miss。
 * 用户选的在线音色仍排它性别桶的最前。
 */
export function buildServerVoiceCast(
  lines: CastLine[],
  preferred?: string | null,
): Map<string, string> {
  const key = (s: string) => s.trim().toLowerCase();

  // 出场顺序去重，性别取第一次报的
  const order: string[] = [];
  const wants = new Map<string, 'male' | 'female' | undefined>();
  for (const l of lines) {
    const k = key(l.speaker);
    if (!k) continue;
    if (!order.includes(k)) {
      order.push(k);
      wants.set(k, l.gender);
    } else if (!wants.get(k) && l.gender) {
      wants.set(k, l.gender);
    }
  }

  // 桶：MiMo 音色按性别分 —— 与服务端 serverCastFor 同序，缓存键才对得上
  const female = SERVER_VOICES.filter((v) => v.gender === 'female').map((v) => v.id);
  const male = SERVER_VOICES.filter((v) => v.gender === 'male').map((v) => v.id);

  // 用户选的音色排到它性别桶的最前：单人独白必然用它，多人对话至少一人是它
  const prefId = preferredMimoVoiceId(preferred);
  const bump = (arr: string[]) => {
    if (!prefId) return arr;
    const i = arr.indexOf(prefId);
    if (i <= 0) return arr;
    return [prefId, ...arr.slice(0, i), ...arr.slice(i + 1)];
  };

  const taken = new Set<string>();
  /** 内部表（键小写）。出口处换成大小写不敏感的包装 —— 见 return。 */
  const inner = new Map<string, string>();
  // 第一轮：报了性别的先领
  for (const k of order) {
    const want = wants.get(k);
    if (!want) continue;
    const bucket = bump(want === 'female' ? female : male).filter((id) => !taken.has(id));
    if (bucket[0]) {
      taken.add(bucket[0]);
      inner.set(k, bucket[0]);
    }
  }
  // 第二轮：没报性别（或桶空了）的按女/男轮着发，从和自己前一个人不同的桶拿
  let flip = true;
  for (const k of order) {
    if (inner.has(k)) continue;
    const bucket = bump(flip ? female : male).filter((id) => !taken.has(id));
    flip = !flip;
    // 对方的桶空了就换自己的桶，再不行就复用（同一个声音也比哑掉强）
    const alt = bump(flip ? female : male).filter((id) => !taken.has(id));
    const pick = bucket[0] ?? alt[0];
    if (pick) {
      taken.add(pick);
      inner.set(k, pick);
    }
  }

  /*
   * 查找键不区分大小写。台词里的说话人名是模型写的（"Ben"），这里的表键是
   * 归一化的小写（"ben"）—— 上一版直接把内部 Map 返回出去，listening.tsx 用
   * `serverCast.get('Ben')` 原样取名永远拿到 undefined，整条服务端分嗓音链路
   * 静默失效、全部退回本地语音包。归一化收在数据结构自己身上，调用方不用记着
   * 先 toLowerCase，写错也不炸。
   */
  const table = new Map<string, string>(inner);
  table.get = (k: string) => Map.prototype.get.call(table, String(k).trim().toLowerCase());
  table.has = (k: string) => Map.prototype.has.call(table, String(k).trim().toLowerCase());
  return table;
}

/* ---------------------------------- 识别 ---------------------------------- */

export type SttState = {
  listening: boolean;
  transcript: string;
  interim: string;
  error: string | null;
  supported: boolean;
};

export function useStt(opts?: { continuous?: boolean; onFinal?: (text: string) => void }) {
  const [state, setState] = useState<SttState>({
    listening: false,
    transcript: '',
    interim: '',
    error: null,
    supported: false,
  });
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef('');
  const onFinalRef = useRef(opts?.onFinal);
  onFinalRef.current = opts?.onFinal;
  const continuous = opts?.continuous ?? true;

  useEffect(() => {
    setState((s) => ({ ...s, supported: getRecognitionCtor() !== null }));
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setState((s) => ({
        ...s,
        error: '当前浏览器不支持语音识别（可用 Chrome / Edge / 手机 Safari），可以直接打字。',
      }));
      return;
    }
    recRef.current?.abort();
    finalRef.current = '';
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = continuous;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => setState((s) => ({ ...s, listening: true, error: null, transcript: '', interim: '' }));
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? '';
        if (r.isFinal) finalRef.current += (finalRef.current ? ' ' : '') + text.trim();
        else interim += text;
      }
      setState((s) => ({ ...s, transcript: finalRef.current, interim }));
    };
    rec.onerror = (e: any) => {
      const map: Record<string, string> = {
        'not-allowed': '麦克风权限被拒绝了。浏览器地址栏左侧可以重新允许。',
        'service-not-allowed': '浏览器阻止了语音服务，可能需要 HTTPS 或 localhost 环境。',
        'no-speech': '没听到声音，再试一次？',
        network: '语音识别需要联网（这一步用的是浏览器自带的在线识别）。',
        aborted: '',
      };
      const msg = map[e.error] ?? `语音识别出错：${e.error}`;
      setState((s) => ({ ...s, listening: false, error: msg || null }));
    };
    rec.onend = () => {
      setState((s) => ({ ...s, listening: false, interim: '' }));
      if (finalRef.current.trim()) onFinalRef.current?.(finalRef.current.trim());
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      setState((s) => ({ ...s, error: '无法启动麦克风，请检查设备。' }));
    }
  }, [continuous]);

  const stop = useCallback(() => recRef.current?.stop(), []);
  const reset = useCallback(() => {
    finalRef.current = '';
    setState((s) => ({ ...s, transcript: '', interim: '', error: null }));
  }, []);

  useEffect(() => () => recRef.current?.abort(), []);

  return { ...state, start, stop, reset };
}

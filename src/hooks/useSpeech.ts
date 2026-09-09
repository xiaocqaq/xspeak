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
import { DEFAULT_SERVER_VOICE, SERVER_VOICES, preferredMimoVoiceId } from '@/lib/tts/server-voice-list';
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

function getAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = 'auto';
  }
  return sharedAudio;
}

/**
 * 服务端出声前等多久就让浏览器语音包顶上（毫秒）—— 按块长阶梯。
 *
 * - ≤20 字符（单词/短语）：700ms。高频小操作要极速反馈；超时的后台下载
 *   照旧写盘，第二次点同一句就走缓存拿到好声音。
 * - 更长的按 2s 起步、每多 100 字符再加 1s、封顶 6s：MiMo 冷合成实测
 *   短句 1.5s、长句 3-4s；300 字符的大块硬卡 2s 必然每次
 *   超时退回系统语音，等于白配了音色。封顶是因为等真嗓音的耐心有限，
 *   兜底线再高也不能让用户对着转圈的按钮干等。
 * - 听力的整段对话在进环节时就预热好了（warmServerSpeech），轮到播放
 *   基本都命中缓存，预算只是兜底线的刻度，不是正常等待时长。
 */
const SERVER_TTS_BUDGET_MS = 700;
/** 快慢档分界：只有单词/短语级的小文本才吃极速档。 */
const SERVER_TTS_SHORT_CHARS = 20;
const SERVER_TTS_BUDGET_BASE_MS = 2000;
const SERVER_TTS_BUDGET_PER_100_CHARS_MS = 1000;
const SERVER_TTS_BUDGET_MAX_MS = 6000;

/**
 * onlineOnly（听力/阅读）的硬上限：等到这个时间还没出声就放弃这一句。
 *
 * 和上面那套「兜底预算」不是一回事：那是"等多久就换系统语音包"，这是
 * "等多久算彻底失败"。既然没有退路，就该等得起 —— 在线合成实测 3s 左右，
 * 20s 给足了首次冷合成 + 网络抖动的余量，同时不至于让人对着转圈无限等。
 */
const ONLINE_ONLY_HARD_MS = 20_000;

function serverTtsBudgetMs(chars: number): number {
  if (chars <= SERVER_TTS_SHORT_CHARS) return SERVER_TTS_BUDGET_MS;
  const scaled =
    SERVER_TTS_BUDGET_BASE_MS +
    Math.floor(chars / 100) * SERVER_TTS_BUDGET_PER_100_CHARS_MS;
  return Math.min(scaled, SERVER_TTS_BUDGET_MAX_MS);
}

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
export async function previewServerVoice(text: string, voiceId: string, paceKey: SpeechPace): Promise<void> {
  const audio = getAudio();
  if (!audio) throw new Error('当前环境不能播放音频');
  if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
  audio.pause();
  audio.muted = false;
  audio.playbackRate = 1;
  const qs = new URLSearchParams({ text, voice: voiceId, pace: paceKey });
  audio.src = withBase(`/api/speak?${qs.toString()}`);
  /*
   * MiMo 恒按 1.0 合成，试听也要按档位调 playbackRate，不然用户选了慢档
   * 听到的却是正常速度，试听就骗人了。公式和 speak() 里那条一致。
   */
  const base = pace(paceKey).ttsSpeed;
  // 与服务端 playbackRateFor 同式（含 1.15 boost）
  const rate = Math.min(1.6, Math.round(base * 1.15 * 100) / 100);
  if (rate !== 1) {
    try {
      audio.playbackRate = rate;
    } catch {
      /* 忽略 */
    }
  }
  await new Promise<void>((resolve, reject) => {
    const off = () => {
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('error', onErr);
    };
    const onEnd = () => {
      off();
      resolve();
    };
    const onErr = () => {
      off();
      // 拿不到具体状态码（media error 不带 HTTP 信息），只能给一句能行动的话
      reject(new Error('试听失败，服务端音色暂时用不了'));
    };
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('error', onErr);
    audio.play().catch((e) => {
      off();
      reject(e instanceof Error ? e : new Error(String(e)));
    });
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
    .map((l) => {
      const q = new URLSearchParams({
        text: l.text,
        // 预热是"用户已经进环节了"的路径，走 MiMo 快路（2026-08-28 二次调整）：
        // 原来默认 af_heart 想省钱，但预热跑得比用户点播放还慢就白热了。
        // 必须和播放时请求的音色一致，否则热的是另一个缓存键，等于没热。
        voice: l.voice ?? DEFAULT_SERVER_VOICE,
        pace: paceKey,
      });
      return q.toString();
    });
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
  const [speaking, setSpeaking] = useState(false);
  /**
   * 「在线语音正在合成、还没出声」（onlineOnly 模式专用，2026-08-28）。
   *
   * 和 speaking 分开：speaking 从按下那一刻就点亮（让按钮有反应），
   * 但听力/阅读需要区分「已经在响」和「还在等」——只有后者才该显示
   * 「语音生成中…」的 tip。出第一声（playing 事件）时置回 false。
   */
  const [synthesizing, setSynthesizing] = useState(false);
  /** onlineOnly 模式下合成失败的原因。有退路的普通模式不用它（静默退回本地）。 */
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  /**
   * 语速档位。朗读按钮散布在十几个纯展示组件里，都拿不到用户档案，
   * 所以从 localStorage 缓存同步读（真值在数据库，由 /api/profile 回填）。
   * 放 ref 而不是 state：speak 是回调，只在触发那一刻需要最新值，
   * 档位变化不该让所有挂了朗读按钮的组件重渲染。
   */
  const paceRef = useRef<SpeechPace>(readPace());
  useEffect(() => subscribePace((p) => (paceRef.current = p)), []);
  /** 音色偏好，同上：ref + 订阅，读的是同一份 localStorage 缓存。 */
  const voiceRef = useRef<string | null>(readVoice());
  useEffect(() => subscribeVoice((v) => (voiceRef.current = v)), []);

  useEffect(() => {
    if (!supported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, [supported]);

  const pickVoice = useCallback(() => {
    if (!voices.length) return undefined;
    /*
     * 想要哪个包：调用点显式指定的优先，否则用用户存下来的偏好。
     * voiceRef 是 ref，所以这里读到的是"按下朗读那一刻"的值 ——
     * 在设置页改完音色，已经挂载的那些朗读按钮不用重渲染也会跟上。
     */
    const want = preferredVoice ?? voiceRef.current;
    if (want) {
      const exact = voices.find((v) => v.name === want);
      // 找不到就往下走默认分支：换了设备、或者系统卸了这个语音包，
      // 宁可用别的嗓音读出来，也不能哑掉。
      if (exact) return exact;
    }
    /*
     * 没有指定（或指定的包不在了）就挑系统里最好听的英文包。
     * 排序规则见 rankEnglishVoices —— 不能只看 localService，
     * iOS 上那个字段恒为 true，等于没筛。
     */
    return rankEnglishVoices(voices)[0];
  }, [voices, preferredVoice]);

  /** 上一次朗读挂的看门狗和监听器，换一句要先拆干净 */
  const cleanupRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    const a = getAudio();
    if (a) {
      a.pause();
      // src 留着不清：清了会中断下载，服务端那次合成就白花了
      a.currentTime = 0;
    }
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false);
    // 手动停下时「生成中」提示也要撤 —— 否则用户按了暂停，tip 还挂着
    setSynthesizing(false);
  }, [supported]);

  const speak = useCallback(
    // voice 用于设置页试听某个具体嗓音，其余场景交给 pickVoice
    (
      text: string,
      opts?: {
        rate?: number;
        /** 在当前语速档位上再放慢一档，用于「慢速朗读」按钮 */
        slow?: boolean;
        onEnd?: () => void;
        voice?: SpeechSynthesisVoice;
        /**
         * 音高。1 是原样。给听力对话区分说话人用 ——
         * 系统里英文语音包只有一个的时候，只能靠这个把两个人分开。
         */
        pitch?: number;
        /**
         * 指定服务端音色 id，盖过用户的偏好。给听力对话一人一个嗓音用。
         *
         * 和 voice/pitch 互斥：那两个是浏览器语音包那条路的参数。传了这个就说明
         * 调用方要的是服务端音色，所以下面的 canServer 不再因为"有 voice"而否决。
         * （2026-09-09 前叫 kokoroVoice；自建 Kokoro 下线、服务端朗读只剩
         * MiMo 之后改名，语义没变。）
         */
        serverVoiceId?: string;
        /**
         * 只用在线 TTS，永不退回浏览器语音包（听力/阅读专用，2026-08-28）。
         *
         * 这两个环节是「听」本身，系统语音包读英文发闷，退过去等于把这一环
         * 的价值抹掉 —— 用户宁可等两三秒真嗓音。所以：
         * - 没有预生成就现场发在线请求，等着（不设兜底超时，只有硬上限）；
         * - 等待期间 synthesizing 为 true，调用方据此显示「语音生成中…」；
         * - 熔断也不拦（没有退路，拦了就是彻底没声）；
         * - 真失败了通过 speechError 报出来，不静默。
         */
        onlineOnly?: boolean;
      },
    ) => {
      const body = text.trim();
      if (!body) return;
      stop();

      /** 两条路只能有一条出声、onEnd 只能触发一次 */
      let done = false;
      const finish = (fireEnd: boolean) => {
        if (done) return;
        done = true;
        setSpeaking(false);
        setSynthesizing(false);
        if (fireEnd) opts?.onEnd?.();
      };

      /** 浏览器语音包那条路。服务端不可用、超时、或者调用点要求了音高时走这里。
       *  它永远是这次朗读的最后一程（见 fallbackFrom —— 兜底后面不会再有别的腿），
       *  所以读完照常 finish/onEnd，驱动听力的逐句连播链。
       */
      const speakLocal = (localText: string) => {
        if (!localText.trim()) {
          finish(false);
          return;
        }
        if (!supported) {
          finish(false);
          return;
        }
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(localText);
        const v = opts?.voice ?? pickVoice();
        if (v) u.voice = v;
        u.lang = v?.lang ?? 'en-US';
        if (opts?.pitch !== undefined) u.pitch = Math.min(2, Math.max(0, opts.pitch));
        // slow 做成相对的：把「慢速」写死成 0.7 的话，用户已经选了慢档时
        // 这个按钮就没有区分度了，选了快档时又会一下掉两档。
        const base = pace(paceRef.current).webSpeechRate;
        u.rate = opts?.rate ?? (opts?.slow ? Math.max(0.5, base - 0.22) : base);
        u.onstart = () => setSpeaking(true);
        u.onend = () => finish(true);
        u.onerror = () => finish(false);
        window.speechSynthesis.speak(u);
      };

      /*
       * 什么时候能走服务端音色：
       * - 用户在设置里选了在线 MiMo 音色（'mimo:xx'），或调用点指定了服务端音色
       * - 调用点没有指定具体的 SpeechSynthesisVoice（设置页试听浏览器某个包）
       * - 没要求 pitch / rate —— 听力对话靠 pitch 区分说话人，服务端改不了音高；
       *   rate 是调用点写死的倍速，服务端的 speed 走档位，两者语义不一样
       * - 文本在接口限长内（见 api/speak 的 MAX_TEXT，超限的由切块连播处理）
       *
       * 2026-09-09 起服务端朗读只有云端 MiMo 一家（自建 Kokoro 下线），
       * 主音色本身就是快路，不再需要 alt 救场，服务端也不再收 kokoro 音色。
       * 偏好只认 'mimo:xx'；浏览器语音包名和老 kokoro:xx 老值一律回落到
       * 默认 Mia。
       */
      const serverVoice =
        opts?.serverVoiceId ??
        preferredMimoVoiceId(preferredVoice) ??
        preferredMimoVoiceId(voiceRef.current) ??
        DEFAULT_SERVER_VOICE;
      const audio = getAudio();
      /*
       * onlineOnly（听力/阅读）把两条否决条件放开：
       * - 熔断不拦：没有退路，拦了就是彻底没声音。真挂了让用户看到报错，
       *   比"静默变成难听的系统语音"更有用（他会知道去反馈）。
       * - pitch 不拦：听力用 pitch 给浏览器兜底路分说话人，onlineOnly 下
       *   兜底路根本不会走，pitch 是死参数，不该因此否决服务端音色。
       */
      const online = Boolean(opts?.onlineOnly);
      const canServer =
        Boolean(serverVoice) &&
        Boolean(audio) &&
        (online || !serverTtsBlocked()) &&
        // 显式指定了服务端音色时，voice/pitch 是调用方给浏览器兜底路留的，不算否决条件
        (online || Boolean(opts?.serverVoiceId) || (!opts?.voice && opts?.pitch === undefined)) &&
        opts?.rate === undefined &&
        // 不再以 300 字符一刀切地否决长文本——超限的由 splitSpeechChunks 切块连播。
        // 只拦确实离谱的超长文（几千字的整篇文档），那种还是留给系统语音包。
        body.length <= SERVER_TTS_TOTAL_CHARS;

      if (!canServer || !audio || !serverVoice) {
        /*
         * onlineOnly 走到这里说明是硬性不可用（浏览器不支持 <audio>、
         * 文本超过 1200 字符上限、或调用方传了 rate）。不偷偷换成系统语音包，
         * 把原因说出来 —— 静默降级正是这次要消除的行为。
         */
        if (online) {
          setSpeechError(
            body.length > SERVER_TTS_TOTAL_CHARS ? '这段太长了，没法在线朗读' : '在线语音暂时用不了',
          );
          finish(false);
          return;
        }
        speakLocal(body);
        return;
      }
      if (online) setSpeechError(null);

      /*
       * 超过接口单次限长的文本（阅读「朗读全文」动辄五六百字符）在前端按句切块、
       * 一块一块接着播。原来直接判给系统语音包，等于阅读环节永远用不上真嗓音。
       * 某块超时/出错退回浏览器语音包时，把还没播的块拼成一整段交给系统念完，
       * onEnd 时序不变；最后一块才失败的话，内容其实已经播完了，不算失败。
       */
      const chunks = splitSpeechChunks(body);

      /*
       * 请求 URL：voice 就是最终出声的那个音色（MiMo）。
       * 服务端只有 MiMo 一家，这条路不带 alt。
       */
      const qsFor = (t: string) => {
        const q = new URLSearchParams({ text: t, voice: serverVoice, pace: paceRef.current });
        if (opts?.slow) q.set('slow', '1');
        return q.toString();
      };

      let index = 0;
      /** 看门狗跟着当前块走：每块按自己的长度重新武装，开播成功就拆除。
       *  预算必须逐块算 —— 阅读全文的第一块经常是短标题（700ms 档），
       *  若整体只用一个预算，后面的长句会被短标题连累成必超时。
       *
       *  onlineOnly 下看门狗的含义完全不同：没有兜底路可退，超时不是
       *  「换系统语音」而是「放弃这一句」。所以给一个宽松的硬上限
       *  （ONLINE_ONLY_HARD_MS），中间一直显示「语音生成中…」让用户知道
       *  在等什么 —— 在线合成实测 3s 左右，20s 才判死足够宽容。 */
      let timer = 0;
      const armTimer = () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(
          () => fallbackFrom(index),
          online ? ONLINE_ONLY_HARD_MS : serverTtsBudgetMs(chunks[index]!.length),
        );
      };

      /** 已经退回浏览器了，服务端后面再出声就得掐掉，不能两个人一起念 */
      let fellBack = false;
      const fallbackFrom = (i: number) => {
        if (fellBack || done) return;
        fellBack = true;
        window.clearTimeout(timer);
        /*
         * onlineOnly：不退回浏览器语音包。已经播过的块不算失败（听力逐句
         * 连播里前几句可能已经念完了），所以照常 finish(true) 让连播链继续；
         * 一句都没出声才报错。静音是为了掐掉可能正在解码的旧 buffer。
         */
        if (online) {
          audio.muted = true;
          audio.pause();
          if (i === 0) setSpeechError('在线语音这次没合成出来，稍等再试');
          finish(i > 0);
          return;
        }
        // 静音而不是清 src：清了这次下载就断了，浏览器 HTTP 缓存里也留不下东西。
        // 让它下完，下次点同一句连请求都不用发。
        // （服务端那边的磁盘缓存不受影响 —— 合成完就写盘了，跟客户端收没收完无关。）
        audio.muted = true;
        /*
         * 兜底文本必须从 i 开始、把超时的那块也带上：单块朗读（听力一句台词、
         * 一段短文）占了绝大多数，slice(i+1) 在这里拼出空串等于整段静音收场 ——
         * 上一版就是栽在这。系统语音包把完整内容念出来，onEnd 照常触发，
         * 听力的连播链（onEnd → step(i+1)）才不会断。
         */
        const rest = chunks.slice(i).join(' ');
        speakLocal(rest);
      };

      /*
       * 预热：一块开播时把它后面最多两块插到共享预热队列最前面（限流阀
       * 同一刻最多 2 个在飞，几十个并发会把上游和磁盘一起打满）。
       * 听力另有大招：进环节时整段对话就通过 warmServerSpeech 排队热好了。
       */
      const startWarm = (i: number) => {
        if (done || fellBack || serverTtsBlocked()) return;
        startWarmImmediate(chunks.slice(i + 1, i + 3).map(qsFor));
      };

      /*
       * MiMo 的语速在播放端兑现（上游没有语速参数，服务端恒按 1.0 合成）：
       * 倍速在这里按用户的档位算，公式和路由的 playbackRateFor 是同一条 ——
       * 两处必须一起改。HTMLAudioElement 拿不到响应头，所以不走服务端下发。
       *
       * 服务端朗读只有 MiMo 一家（2026-09-09 起），不用再按 provider 判断。
       * MIMO_PLAYBACK_BOOST = 1.15 与服务端同步。
       */
      const MIMO_BOOST = 1.15;
      const base = pace(paceRef.current).ttsSpeed;
      const playbackRate = Math.min(
        1.6,
        Math.round((opts?.slow ? Math.max(0.8, base - 0.2) : base) * MIMO_BOOST * 100) / 100,
      );
      const applyPlaybackRate = () => {
        if (playbackRate !== 1) {
          try {
            audio.playbackRate = playbackRate;
          } catch {
            /* 个别播放器对极端取值会抛，忽略按原速放 */
          }
        }
      };

      /*
       * 合成要一两秒起步，先把「朗读中」点亮：朗读按钮的脉冲就是
       * "正在生成语音"的提示，先让用户知道点到了，不是按钮坏了。
       * 无论最终走服务端还是兜底，finish()/speakLocal 都会把状态收敛回来。
       */
      setSpeaking(true);
      // onlineOnly：先亮「生成中」。命中缓存时几十毫秒后 onPlaying 就把它关掉，
      // tip 一闪而过；真要现场合成才会停留住几秒 —— 那正是要告诉用户的情况。
      if (online) setSynthesizing(true);

      const onPlaying = () => {
        if (fellBack) {
          audio.pause();
          return;
        }
        applyPlaybackRate();
        window.clearTimeout(timer); // 这块出声了，看门狗完成使命
        serverFails = 0;
        setSynthesizing(false); // 出声了，「生成中」提示该撤了
        startWarm(index); // 边播边把后面的块备好
      };
      const onEnded = () => {
        if (fellBack) return;
        const next = index + 1;
        if (next >= chunks.length) {
          finish(true);
          return;
        }
        playChunk(next); // 接力下一块（不出手势窗口也能播：元素早已解锁，见 getAudio）
      };
      const onError = () => {
        noteServerFail();
        fallbackFrom(index);
      };

      const playChunk = (i: number) => {
        index = i;
        audio.muted = false;
        audio.playbackRate = 1;
        // 每块都可能要现场合成（阅读全文切成好几块，后面的块未必预热到了），
        // 所以逐块亮「生成中」，由 onPlaying 关掉。
        if (online) setSynthesizing(true);
        const next = withBase(`/api/speak?${qsFor(chunks[i]!)}`);
        /*
         * 2026-08-28 修「点 A 出声是上一句 B」：
         *
         * stop() 只 pause() 不清 src（为了不中断上一次的下载），于是换句时
         * 元素里还挂着旧 src 和旧的已解码数据。如果新旧 URL 恰好相同
         * （同一句连点两次），赋值 src 不触发重新加载，currentTime 还停在
         * 上次结束处 → 听起来像"没反应"；而在旧音频尚未 pause 生效时
         * play() 会先把旧 buffer 放出来 → 听起来像"点 there 念了上一句"。
         *
         * 修法：换句前把播放位置归零，src 变了才赋值，没变就重新 load()。
         * 下载中断的顾虑不成立 —— 服务端合成完就写磁盘缓存了（见 tts/cache.ts
         * writeCache），客户端收没收完与它无关。
         */
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch {
          /* 某些状态下 currentTime 不可写，忽略 */
        }
        if (audio.src === next) {
          audio.load(); // 同一句再点：强制从头取（HTTP 缓存里通常已有）
        } else {
          audio.src = next;
        }
        armTimer();
        // 同步 play()：await 之后再 play 就出了 iOS 的手势窗口，会被拦。
        // 见 api/speak/route.ts 顶部「为什么是 GET 而不是 POST」。
        audio.play().catch(() => {
          // 手势窗口没了、或者 src 根本没能开始加载。不计入 serverFails ——
          // 这是浏览器策略问题，不是服务端不可用。
          window.clearTimeout(timer);
          fallbackFrom(i);
        });
      };

      audio.addEventListener('playing', onPlaying);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
      cleanupRef.current = () => {
        window.clearTimeout(timer);
        audio.removeEventListener('playing', onPlaying);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
      };

      playChunk(0);
    },
    [supported, pickVoice, stop, preferredVoice],
  );

  useEffect(() => stop, [stop]);

  /**
   * synthesizing / speechError 只在 onlineOnly 模式下会变（听力、阅读）：
   * 前者驱动「语音生成中…」的 tip，后者是合成真失败时给用户的一句话。
   * 其余调用点不用管，行为和以前完全一样。
   */
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

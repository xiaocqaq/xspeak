/**
 * 自建 Kokoro-82M TTS 的服务端客户端 + 磁盘缓存。
 *
 * ── 为什么要缓存，而且缓存值得做 ──
 *
 * 要朗读的语料是有限且高度重复的：word_level 表 8493 个词、平均 7 个字符，
 * 全部合成完约 80MB。合成一次以后永远不用再合成，所以「第一次慢」是
 * 这套方案唯一的代价，而不是每次都慢。
 *
 * ── 实测数字（2026-08-27，2 核 Xeon 6271C，onnx fp16）──
 *
 *   单词（8 字符）     1.31s
 *   句子（66 字符）    3.32s
 *   长段（194 字符）  13.36s
 *
 * 换算下来 RTF 约 0.8–1.0，也就是「合成 1 秒语音要算 1 秒」。所以：
 * 1. 超时给得比直觉宽（长句真的要十几秒），但前端不等它 —— 见 route.ts 的注释；
 * 2. 命中缓存后是纯磁盘读，几毫秒；
 * 3. 服务端自己是串行的（那台机器只有 2 核，并行只会互相拖慢），
 *    所以这里不做并发预热，一个一个来。
 *
 * ── fp16 而不是 int8 ──
 *
 * 同一台机器上 int8 反而慢一倍（2.53s vs 1.21s，6 个音素）：这颗 CPU 上
 * 量化/反量化节点的开销盖过了整数乘法的收益。别看着「int8 更小」就换回去。
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { DEFAULT_KOKORO_VOICE, KOKORO_ALL_VOICES } from './kokoro-voices';

export type KokoroConfig = {
  enabled: boolean;
  /** 形如 https://tts.xlingo.fun/kokoro/v1，末尾不带斜杠 */
  baseUrl: string;
  apiKey: string;
  model: string;
  cacheDir: string;
  /** 单次请求超时（毫秒） */
  timeoutMs: number;
};

/**
 * 每次调用重读 env，不缓存 —— 和 voice/config.mjs 一个路子：
 * 改完 .env.local 重启进程就生效，不用管模块加载顺序。
 */
export function kokoroConfig(): KokoroConfig {
  const baseUrl = (process.env.KOKORO_TTS_URL ?? '').trim().replace(/\/+$/, '');
  const apiKey = (process.env.KOKORO_TTS_KEY ?? '').trim();
  return {
    // 两个都配齐才算开。少一个就当没这功能，前端自动退回浏览器语音包
    enabled: Boolean(baseUrl && apiKey),
    baseUrl,
    apiKey,
    model: (process.env.KOKORO_TTS_MODEL ?? 'kokoro').trim() || 'kokoro',
    cacheDir: (process.env.KOKORO_CACHE_DIR ?? '').trim() || join(tmpdir(), 'xspeak-tts'),
    timeoutMs: Number(process.env.KOKORO_TTS_TIMEOUT_MS ?? 30_000),
  };
}

/**
 * 缓存键。文本 + 音色 + 语速三者任一不同就是另一段音频。
 *
 * 用 sha256 的前 24 个十六进制字符（96 位）：8493 个词的量级下碰撞概率
 * 是天文数字级的小，而文件名短一截好翻。
 */
export function cacheKey(text: string, voice: string, speed: number): string {
  const h = createHash('sha256');
  // \u0000 做分隔符：text 里可能出现「voice\u0000speed」这种拼接歧义。
  // 写成转义而不是字面 NUL 字节 —— 字面 NUL 会让 file 把文件认成 data，
  // grep 从此在这个文件永远返回空（HANDOFF「shared.tsx 两个 NUL」同一坑）。
  h.update(`${voice}\u0000${speed.toFixed(2)}\u0000${text}`);
  return h.digest('hex').slice(0, 24);
}

/**
 * 分两级目录存。8493 个文件平铺在一个目录里，ext4 上 readdir 会变慢，
 * 而且出问题时 ls 一下就刷屏。按前两个字符分 256 个桶。
 */
function cachePath(dir: string, key: string): string {
  return join(dir, key.slice(0, 2), `${key}.mp3`);
}

export async function readCache(key: string, cfg = kokoroConfig()): Promise<Buffer | null> {
  try {
    return await readFile(cachePath(cfg.cacheDir, key));
  } catch {
    return null;
  }
}

/**
 * 写缓存。先写临时文件再 rename —— 同一个词被两个请求同时合成时，
 * 直接写会让读的人拿到半个 mp3。rename 在同一文件系统上是原子的。
 */
export async function writeCache(key: string, data: Buffer, cfg = kokoroConfig()): Promise<void> {
  const target = cachePath(cfg.cacheDir, key);
  const dir = join(cfg.cacheDir, key.slice(0, 2));
  try {
    await mkdir(dir, { recursive: true });
    const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, target);
  } catch {
    // 缓存写失败不该让这次朗读失败 —— 音频已经拿到了，照样返回给用户
  }
}

export class KokoroError extends Error {
  /**
   * 写成普通字段而不是构造器参数属性（`readonly status: number`）：
   * 参数属性是 TS 独有语法，node 的 strip-only 类型擦除跑不了，写成那样
   * scripts/ 下的 .mjs 就没法 `node --experimental-strip-types` 直接
   * import 这个模块复用 cacheKey —— 只能把缓存键算法抄一遍，抄一遍就一定
   * 会哪天和这里对不上。（注：真要 import 还得给相对路径补上 .ts 后缀，
   * 本仓库不写后缀，所以目前没有脚本这么用。）
   */
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'KokoroError';
    this.status = status;
  }
}

/** 发一次合成请求。空音频返回 null，交给调用方决定要不要重试。 */
async function requestAudio(
  text: string,
  voice: string,
  speed: number,
  cfg: KokoroConfig,
): Promise<Buffer | null> {
  const res = await fetch(`${cfg.baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      input: text,
      voice,
      response_format: 'mp3',
      speed,
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs),
    cache: 'no-store',
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new KokoroError(
      `kokoro ${res.status}: ${detail.slice(0, 200)}`,
      // 上游 4xx 基本是音色名/文本长度不对，是调用方的问题，透传；
      // 5xx 和超时对前端来说都一样 —— 退回浏览器语音包
      res.status >= 400 && res.status < 500 ? res.status : 502,
    );
  }

  const buf = Buffer.from(await res.arrayBuffer());
  // 44 字节的纯 ID3 头（或空 WAV 头）也是 200。当空音频看。
  return buf.length < 512 ? null : buf;
}

/**
 * 直接问服务端合成，不看缓存。
 *
 * 上游偶尔会对某些短句回 200 + 44 字节的空 MP3（只有 ID3 头，没有音频帧）。
 * 实测是确定性的、跟音素有关：af_heart 念 "hello world" / "how are you" 必空，
 * 但 "hello world." 就正常，换音色或换速度也正常（60 条常见文本里中了 2 条）。
 * 补一个句点重试一次 —— af_heart 是默认音色，而前端连着两次失败就会整个会话
 * 不再走服务端，白白退回 iOS 自带的难听语音包，这个功能就是为了躲开它才做的。
 */
export async function synthesize(
  text: string,
  voice: string,
  speed: number,
  cfg = kokoroConfig(),
): Promise<Buffer> {
  if (!cfg.enabled) throw new KokoroError('kokoro tts not configured', 503);
  const v = KOKORO_ALL_VOICES.includes(voice) ? voice : DEFAULT_KOKORO_VOICE;

  const first = await requestAudio(text, v, speed, cfg);
  if (first) return first;

  // 本来就有末尾标点的，加了也是同一串音素，没必要再问一次
  if (!/[.!?。！？]$/.test(text.trim())) {
    const retry = await requestAudio(`${text.trim()}.`, v, speed, cfg);
    if (retry) return retry;
  }

  // 空音频比报错更难查：宁可这里报出来
  throw new KokoroError('kokoro returned empty audio', 502);
}

/** 缓存优先。返回音频和「是不是刚合成的」。 */
export async function speakCached(
  text: string,
  voice: string,
  speed: number,
  cfg = kokoroConfig(),
): Promise<{ audio: Buffer; hit: boolean; key: string }> {
  const key = cacheKey(text, voice, speed);
  const cached = await readCache(key, cfg);
  if (cached) return { audio: cached, hit: true, key };

  const audio = await synthesize(text, voice, speed, cfg);
  await writeCache(key, audio, cfg);
  return { audio, hit: false, key };
}

/**
 * 服务端 TTS 的磁盘缓存 + 统一错误类型。
 *
 * 2026-09-09 自建 Kokoro 下线后，这套缓存从 kokoro.ts 里拆出来，
 * 变成各家在线 TTS 上游共用的基础设施（现在只有 MiMo 一家在用它）。
 *
 * ── 为什么要缓存，而且缓存值得做 ──
 *
 * 要朗读的语料是有限且高度重复的：word_level 表 8493 个词、平均 7 个字符。
 * 合成一次以后永远不用再合成，所以「第一次慢」是这套方案唯一的代价，
 * 而不是每次都慢。缓存键 = (文本, 音色, 速度)，MiMo 恒按 1.0 合成，
 * 速度参数因此总是 1，但键算法保留速度维度 —— 以后来了支持语速的
 * 上游，同一段代码不用改。
 *
 * ── 缓存目录 ──
 *
 * TTS_CACHE_DIR 优先，KOKORO_CACHE_DIR 是老名字（历史部署配过，还认，
 * 换名不丢已有缓存）。都不配就落系统临时目录。
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * 每次调用重读 env，不缓存 —— 改完 .env.local 重启进程就生效。
 */
export function ttsCacheDir(): string {
  return (
    (process.env.TTS_CACHE_DIR ?? process.env.KOKORO_CACHE_DIR ?? '').trim() ||
    join(tmpdir(), 'xspeak-tts')
  );
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
 * 分两级目录存。几千个文件平铺在一个目录里，ext4 上 readdir 会变慢，
 * 而且出问题时 ls 一下就刷屏。按前两个字符分 256 个桶。
 */
function cachePath(dir: string, key: string): string {
  return join(dir, key.slice(0, 2), `${key}.mp3`);
}

export async function readCache(key: string, dir = ttsCacheDir()): Promise<Buffer | null> {
  try {
    return await readFile(cachePath(dir, key));
  } catch {
    return null;
  }
}

/**
 * 写缓存。先写临时文件再 rename —— 同一个词被两个请求同时合成时，
 * 直接写会让读的人拿到半个 mp3。rename 在同一文件系统上是原子的。
 */
export async function writeCache(key: string, data: Buffer, dir = ttsCacheDir()): Promise<void> {
  const target = cachePath(dir, key);
  const bucket = join(dir, key.slice(0, 2));
  try {
    await mkdir(bucket, { recursive: true });
    const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, target);
  } catch {
    // 缓存写失败不该让这次朗读失败 —— 音频已经拿到了，照样返回给用户
  }
}

/**
 * 服务端 TTS 的统一错误。status 是给 HTTP 层用的：
 * 上游 4xx 基本是音色名/文本长度不对，是调用方的问题，透传；
 * 5xx 和超时对前端来说都一样 —— 退回浏览器语音包。
 */
export class TtsError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TtsError';
    this.status = status;
  }
}

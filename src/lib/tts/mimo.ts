/**
 * 小米 MiMo TTS（mimo-v2.5-tts）的服务端客户端 —— 逐句朗读的唯一在线上游。
 *
 * 2026-09-09 起，自建 Kokoro 整条下线，服务端朗读只剩 MiMo 这一家：
 * 云端推理、不吃本机 CPU，短句约 1.7s、长句约 3.3s（2026-08-27 实测）。
 *
 * ── 接口形态 ──
 *
 * MiMo 走的是 chat/completions 形态：要合成的文本放在 role=assistant 的消息里，
 * （可选的）朗读风格指令放在 role=user 的消息里，音频以 base64 回在
 * choices[0].message.audio.data。2026-08-27 实测：assistant 消息单独就能合成，
 * user 消息可省 —— 但带上朗读者指令能让长句的停顿更自然，留着。
 *
 * ── 为什么没有语速参数 ──
 *
 * audio{} 里只有 format / voice / optimize_text_preview，没有 speed。
 * 语速改由前端播放倍速实现：服务端恒按 1.0 合成（缓存键也按 1.0 算，
 * 见 server-voices.ts），客户端按用户的语速档位设 audio.playbackRate。
 * 慢速朗读按钮因此照样有效，且同一份音频按倍速复用。
 */

import { TtsError, cacheKey, readCache, writeCache } from './cache';

export type MimoConfig = {
  enabled: boolean;
  /** 形如 https://api.xiaomimimo.com/v1，末尾不带斜杠 */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 单次请求超时（毫秒）。云端合成比 Kokoro 快，但留足网络抖动的余地 */
  timeoutMs: number;
};

/**
 * 每次调用重读 env，改完 .env.local 重启进程就生效，不用管模块加载顺序。
 */
export function mimoConfig(): MimoConfig {
  const baseUrl = (process.env.MIMO_TTS_URL ?? 'https://api.xiaomimimo.com/v1')
    .trim()
    .replace(/\/+$/, '');
  const apiKey = (process.env.MIMO_TTS_KEY ?? '').trim();
  return {
    enabled: Boolean(apiKey),
    baseUrl,
    apiKey,
    model: (process.env.MIMO_TTS_MODEL ?? 'mimo-v2.5-tts').trim() || 'mimo-v2.5-tts',
    timeoutMs: Number(process.env.MIMO_TTS_TIMEOUT_MS ?? 30_000),
  };
}

/**
 * 朗读风格指令。MiMo 只在 mimo-v2.5-tts-voicedesign 上要求 user 消息，
 * 普通 tts 里它是可选的风格提示 —— 描述要怎么读，而不是读什么
 * （读什么在 assistant 消息里，别搞反）。
 */
const READ_INSTRUCTION =
  'Read the text aloud naturally and clearly, like a friendly teacher. Keep a steady pace and pronounce every word precisely.';

/**
 * 调 MiMo 合成一段 mp3。
 *
 * 错误一律包成 TtsError（见 tts/cache.ts），路由那边已经会按 status
 * 把它变成对应的 HTTP 响应，不必再写一套分支。
 */
export async function mimoSynthesize(
  text: string,
  voice: string,
  cfg = mimoConfig(),
): Promise<Buffer> {
  if (!cfg.enabled) throw new TtsError('mimo tts not configured', 503);

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'user', content: READ_INSTRUCTION },
          { role: 'assistant', content: text },
        ],
        audio: { format: 'mp3', voice },
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TtsError(`mimo tts request failed: ${msg}`, 502);
  }

  if (!res.ok) {
    // 上游的错误体是 {error:{code,message}}，带出来方便排查（比如音色拼错）
    const detail = await res.text().catch(() => '');
    // 401/403（key 失效、没额度）和 5xx 对前端一样：都是「服务端音色用不了」，
    // 统一 502，让上层退回浏览器语音包而不是当成参数错重试
    throw new TtsError(`mimo tts ${res.status}: ${detail.slice(0, 200) || 'no detail'}`, 502);
  }

  let data: string | undefined;
  try {
    const json = (await res.json()) as {
      choices?: { message?: { audio?: { data?: string } } }[];
    };
    data = json.choices?.[0]?.message?.audio?.data;
  } catch {
    throw new TtsError('mimo tts returned non-JSON response', 502);
  }
  if (!data) throw new TtsError('mimo tts returned no audio', 502);

  const audio = Buffer.from(data, 'base64');
  // 正经一个词的 mp3 也有几 KB；太小说明上游给了空壳（和 Kokoro 那个
  // 44 字节 ID3 的毛病一个性质），宁可报错让上层走兜底，也别放一段静音
  if (audio.length < 1000) {
    throw new TtsError(`mimo tts returned tiny audio (${audio.length}B)`, 502);
  }
  return audio;
}

type CachedSpeech = { audio: Buffer; hit: boolean; key: string };

// ponytail: 同一进程内合并预热、播放和 Range 请求；多实例部署需共享任务锁。
const inFlight = new Map<string, Promise<CachedSpeech>>();

/** 缓存优先；同一音频只合成一次，失败后释放以便重试。 */
export function mimoSpeakCached(
  text: string,
  voice: string,
  speed: number,
): Promise<CachedSpeech> {
  const key = cacheKey(text, voice, speed);
  const running = inFlight.get(key);
  if (running) return running;

  const job = (async () => {
    const cached = await readCache(key);
    if (cached) return { audio: cached, hit: true, key };

    const audio = await mimoSynthesize(text, voice);
    await writeCache(key, audio);
    return { audio, hit: false, key };
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

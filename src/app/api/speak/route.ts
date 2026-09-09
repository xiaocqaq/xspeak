import { TtsError, cacheKey, readCache } from '@/lib/tts/cache';
import { DEFAULT_SERVER_VOICE, isServerVoice, playbackRateFor } from '@/lib/tts/server-voice-list';
import { serverTtsEnabled, speakWithProvider } from '@/lib/tts/server-voices';
import { PACE_KEYS, pace } from '@/lib/voice-options';
import { authConfig, currentIdentity } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 逐句朗读的服务端音频。上游是云端 MiMo（小米 mimo-v2.5-tts），见
 * @/lib/tts/server-voices。2026-09-09 起自建 Kokoro 下线，不再有第二家。
 *
 * ── 为什么是 GET 而不是 POST ──
 *
 * iOS Safari 的自动播放限制：`audio.play()` 必须在用户手势的同一个事件循环里
 * 调用，`await fetch()` 之后再 play 就已经出了手势窗口，会被拦。GET 才能
 * 把 URL 直接塞进 `audio.src` 当场 play，让浏览器自己去下载。
 *
 * 代价是文本走 query string。所以限长 300 字符 —— 逐句朗读的对象是单词和
 * 例句，300 够用，也顺手挡住了拿这个接口当通用 TTS 刷合成的路子。
 *
 * ── 缓存策略 ──
 *
 * 内容由 (text, voice) 完全决定（MiMo 恒按 1.0 合成），所以 immutable +
 * 一年 max-age。参数变了 URL 就变了，不存在「缓存了旧内容」的问题。
 * 服务端还有一层磁盘缓存（见 @/lib/tts/cache）—— 浏览器缓存是每设备的，
 * 磁盘缓存是全站共享的，第二个用户点同一个词就不用再合成一次。
 * 凌晨 4 点的 cron 会预合成当天内容（stage-prefill），用户点开基本必中缓存。
 *
 * ── 语速 ──
 *
 * MiMo 没有语速参数，合成恒为 1.0，语速由播放端 playbackRate 兑现 ——
 * 所以这个接口把倍速写在响应头 x-tts-playback-rate 里，前端照着设，
 * 不用自己再算一遍（算式集中在 server-voice-list 的 playbackRateFor）。
 */

const MAX_TEXT = 300;

/**
 * 必须登录才能用。
 *
 * 这个接口和别的不一样：每次未命中缓存都要花钱（MiMo 按 token 计费），
 * 还会往磁盘里写文件。不挡的话，任何人拿一个循环喂随机文本就能把额度
 * 吃干 —— 而且不需要任何凭据。
 *
 * 用 currentIdentity 而不是 currentUser：只要确认「是登录用户」，
 * 不需要建档案（currentUser 会写库）。朗读一句话不该产生一行 users。
 * 单人模式（没配 AUTH_UPSTREAM_URL）不挡 —— 那是跑在自己机器上的形态。
 */
async function signedIn(): Promise<boolean> {
  if (!authConfig().enabled) return true;
  return Boolean(await currentIdentity());
}

/**
 * 把音频包成响应，顺手支持 Range。
 *
 * iOS Safari 播 <audio> 之前会先拿 Range 探一下路，服务端不按 206 回它
 * 就可能整个不播 —— 而这个功能存在的理由就是 iOS 自带的语音包太难听，
 * 在这儿赌「应该也能播」不值当。音频本来就整份在内存里，切一刀几乎不花钱。
 *
 * 只认单区间。多区间要 multipart/byteranges，播放器不会那么请求。
 */
function audioResponse(
  audio: Buffer,
  etag: string,
  hit: boolean,
  range: string | null,
  playbackRate: number,
): Response {
  const headers: Record<string, string> = {
    'content-type': 'audio/mpeg',
    'cache-control': 'public, max-age=31536000, immutable',
    // 不声明的话有些播放器压根不会尝试 Range，也就拖不了进度
    'accept-ranges': 'bytes',
    etag,
    // 排查用：没命中说明是现合成的，那次请求本来就慢
    'x-tts-cache': hit ? 'hit' : 'miss',
    // MiMo 的语速在播放端兑现，前端读这个头设置 playbackRate
    'x-tts-playback-rate': playbackRate.toFixed(2),
  };

  const m = /^bytes=(\d*)-(\d*)$/.exec((range ?? '').trim());
  if (m && (m[1] || m[2])) {
    const total = audio.length;
    // `bytes=-500` 是「最后 500 字节」，和 `bytes=500-` 不是一回事
    const suffix = !m[1];
    const start = suffix ? Math.max(0, total - Number(m[2])) : Number(m[1]);
    const end = suffix || !m[2] ? total - 1 : Math.min(total - 1, Number(m[2]));
    if (start > end || start >= total) {
      return new Response(null, {
        status: 416,
        headers: { 'content-range': `bytes */${total}`, 'accept-ranges': 'bytes' },
      });
    }
    const slice = audio.subarray(start, end + 1);
    return new Response(new Uint8Array(slice), {
      status: 206,
      headers: {
        ...headers,
        'content-range': `bytes ${start}-${end}/${total}`,
        'content-length': String(slice.length),
      },
    });
  }

  return new Response(new Uint8Array(audio), {
    status: 200,
    headers: { ...headers, 'content-length': String(audio.length) },
  });
}

/**
 * 解析并校验 query 参数。合法时返回字段，不合法时返回要回的错误响应。
 */
function parseParams(
  url: URL,
):
  | { text: string; voice: string; playbackRate: number }
  | { error: Response } {
  const text = (url.searchParams.get('text') ?? '').trim();
  const voiceParam = url.searchParams.get('voice') ?? DEFAULT_SERVER_VOICE;
  const paceParam = url.searchParams.get('pace') ?? 'normal';
  const slow = url.searchParams.get('slow') === '1';

  if (!text) {
    return {
      error: Response.json({ ok: false, error: '没有要读的内容' }, { status: 400 }),
    };
  }
  if (text.length > MAX_TEXT) {
    return {
      error: Response.json({ ok: false, error: `文本超过 ${MAX_TEXT} 字符` }, { status: 413 }),
    };
  }
  // 白名单：这个接口会拿服务端的 key 去调付费 TTS，不能让任意字符串透传。
  // 老收藏里的 `kokoro:xx` 音色随自建 Kokoro 一起下线，不再放行。
  if (!isServerVoice(voiceParam)) {
    return { error: Response.json({ ok: false, error: '未知音色' }, { status: 400 }) };
  }

  const paceKey = (PACE_KEYS as string[]).includes(paceParam) ? paceParam : 'normal';
  const base = pace(paceKey).ttsSpeed;
  // 播放端的倍速：MiMo 的语速全靠它兑现（含 slow 慢速朗读按钮）
  const playbackRate = playbackRateFor(base, slow);
  return { text, voice: voiceParam, playbackRate };
}

export async function GET(req: Request) {
  if (!(await signedIn())) {
    return Response.json({ ok: false, error: '请先登录', code: 'unauthenticated' }, { status: 401 });
  }
  if (!serverTtsEnabled()) {
    // 没配就明确说没配，前端据此退回浏览器语音包（而不是当成故障重试）
    return Response.json({ ok: false, error: 'server tts not configured' }, { status: 503 });
  }

  const parsed = parseParams(new URL(req.url));
  if ('error' in parsed) return parsed.error;
  const { text, voice, playbackRate } = parsed;

  // MiMo 没有语速参数，恒按 1.0 合成 —— 换语速档位不换缓存键
  const key = cacheKey(text, voice, 1);
  const etag = `${key}`;
  // 命中浏览器缓存的话连磁盘都不用读
  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }

  try {
    const { audio, hit } = await speakWithProvider(text, voice);
    return audioResponse(audio, etag, hit, req.headers.get('range'), playbackRate);
  } catch (err) {
    if (err instanceof TtsError) {
      return Response.json({ ok: false, error: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : String(err);
    // 超时走到这里。前端一律退回浏览器语音包，所以不用区分原因
    return Response.json({ ok: false, error: `合成失败：${msg}` }, { status: 502 });
  }
}

/**
 * 只问缓存里有没有，不触发合成。
 *
 * 前端拿它决定「这句能不能立刻用服务端音色播」：命中就走服务端（几毫秒出声），
 * 没命中就先用浏览器语音包出声、同时后台预热，下次点就是好声音。
 * 这样用户永远不用为了音质等十几秒。
 */
export async function HEAD(req: Request) {
  if (!(await signedIn())) return new Response(null, { status: 401 });
  if (!serverTtsEnabled()) return new Response(null, { status: 503 });

  const parsed = parseParams(new URL(req.url));
  if ('error' in parsed) {
    return new Response(null, { status: parsed.error.status });
  }

  const key = cacheKey(parsed.text, parsed.voice, 1);
  const cached = await readCache(key);

  return new Response(null, {
    status: cached ? 200 : 404,
    headers: cached
      ? {
          etag: `${key}`,
          'content-length': String(cached.length),
          'accept-ranges': 'bytes',
          'x-tts-cache': 'hit',
          'x-tts-playback-rate': parsed.playbackRate.toFixed(2),
        }
      : { 'x-tts-cache': 'miss', 'x-tts-playback-rate': parsed.playbackRate.toFixed(2) },
  });
}

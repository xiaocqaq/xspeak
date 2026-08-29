import {
  KokoroError,
  cacheKey,
  kokoroConfig,
  readCache,
} from '@/lib/tts/kokoro';
import {
  DEFAULT_SERVER_VOICE,
  playbackRateFor,
  serverVoiceProvider,
  synthSpeed,
} from '@/lib/tts/server-voice-list';
import { serverTtsEnabled, speakWithProvider } from '@/lib/tts/server-voices';
import { KOKORO_ALL_VOICES } from '@/lib/tts/kokoro-voices';
import { PACE_KEYS, pace } from '@/lib/voice-options';
import { authConfig, currentIdentity } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 逐句朗读的服务端音频。两个上游：MiMo（云端，快）+ 自建 Kokoro，
 * 见 @/lib/tts/server-voices。
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
 * 内容由 (text, voice, speed) 完全决定，所以 immutable + 一年 max-age。
 * 参数变了 URL 就变了，不存在「缓存了旧内容」的问题。
 * 服务端还有一层磁盘缓存 —— 浏览器缓存是每设备的，磁盘缓存是全站共享的，
 * 第二个用户点同一个词就不用再合成一次。
 *
 * ── 语速和两家上游的关系 ──
 *
 * MiMo 没有语速参数，合成恒为 1.0（synthSpeed 归一），语速由播放端
 * playbackRate 兑现 —— 所以这个接口把倍速写在响应头 x-tts-playback-rate
 * 里，前端照着设，不用自己再算一遍（算式集中在一处，改起来不会两边漂）。
 * Kokoro 照旧把速度合成进音频，播放端原速放。
 */

const MAX_TEXT = 300;

/**
 * 必须登录才能用。
 *
 * 这个接口和别的不一样：每次未命中缓存都要花钱（MiMo 按 token 计费）或
 * 花 CPU（Kokoro 1.5～13 秒），还会往磁盘里写文件。不挡的话，任何人拿一个
 * 循环喂随机文本就能把额度/机器吃干 —— 而且不需要任何凭据。
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
  extraHeaders?: Record<string, string>,
): Response {
  const headers: Record<string, string> = {
    'content-type': 'audio/mpeg',
    'cache-control': 'public, max-age=31536000, immutable',
    // 不声明的话有些播放器压根不会尝试 Range，也就拖不了进度
    'accept-ranges': 'bytes',
    etag,
    // 排查用：没命中说明是现合成的，那次请求本来就慢
    'x-tts-cache': hit ? 'hit' : 'miss',
    // MiMo 的语速在播放端兑现，前端读这个头设置 playbackRate（Kokoro 恒为 1）
    'x-tts-playback-rate': playbackRate.toFixed(2),
    ...(extraHeaders ?? {}),
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
 *
 * alt（可选）：备用在线音色 id。主音色的磁盘缓存 miss 且主音色是 Kokoro
 * （合成要 1.5~13s，现场等不起）时，自动改用 alt 现场合成 —— 这是
 * 「定时任务用免费 Kokoro 预生成，用户点击撞到空白时 MiMo 秒级救场」
 * 的服务端开关。主音色是 MiMo 时 alt 无意义（本身就是快路），忽略。
 */
function parseParams(
  url: URL,
): {
  text: string;
  voice: string;
  alt: string | null;
  speed: number;
  playbackRate: number;
} | { error: Response } {
  const text = (url.searchParams.get('text') ?? '').trim();
  const voiceParam = url.searchParams.get('voice') ?? DEFAULT_SERVER_VOICE;
  const paceParam = url.searchParams.get('pace') ?? 'normal';
  const slow = url.searchParams.get('slow') === '1';
  const altParam = url.searchParams.get('alt');

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
  // 白名单：这个接口会拿服务端的 key 去调 TTS，不能让任意字符串透传。
  // 两个白名单都收 —— 老收藏里存着 Kokoro 音色，不能因为接了 MiMo 就作废。
  if (
    serverVoiceProvider(voiceParam) === null &&
    !KOKORO_ALL_VOICES.includes(voiceParam)
  ) {
    return { error: Response.json({ ok: false, error: '未知音色' }, { status: 400 }) };
  }
  // alt 只收 MiMo 音色：它的职责就是「快」，别的没有意义
  const alt = altParam && serverVoiceProvider(altParam) === 'mimo' ? altParam : null;

  const paceKey = (PACE_KEYS as string[]).includes(paceParam) ? paceParam : 'normal';
  const base = pace(paceKey).ttsSpeed;
  // 「慢速朗读」按钮：在当前档位上再降一档，和浏览器那条路的算法保持一致
  // （useSpeech.ts 里是 base - 0.22）。下限 0.5 是服务端接受的最小值。
  const speed = synthSpeed(
    voiceParam,
    Number((slow ? Math.max(0.5, base - 0.22) : base).toFixed(2)),
  );
  // 播放端的倍速：MiMo 靠它兑现语速档位（含 slow），Kokoro 恒为 1
  const playbackRate = playbackRateFor(voiceParam, base, slow);
  return { text, voice: voiceParam, alt, speed, playbackRate };
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
  const { text, voice, alt, speed, playbackRate } = parsed;

  let key = cacheKey(text, voice, speed);
  let etag = `"${key}"`;
  // 命中浏览器缓存的话连磁盘都不用读
  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }

  try {
    /*
     * 兜底分流（alt）：主音色是 Kokoro 且磁盘缓存 miss 时，现场合成要
     * 1.5~13s —— 用户等不起。这时改用 alt（MiMo 在线音色，秒级）合成。
     * 响应头 x-tts-alt 标记这次走了兜底，方便排障和前端统计。
     * 主音色命中缓存（预生成几乎必中）或本身就是 MiMo 时，行为不变。
     */
    const isKokoro = serverVoiceProvider(voice) !== 'mimo';
    let useVoice = voice;
    let useSpeed = speed;
    let useRate = playbackRate;
    let usedAlt = false;
    if (isKokoro && alt) {
      const cached = await readCache(key, kokoroConfig());
      if (!cached) {
        useVoice = alt;
        useSpeed = synthSpeed(alt, speed);
        useRate = playbackRateFor(alt, pace((new URL(req.url)).searchParams.get('pace') ?? 'normal').ttsSpeed, false);
        key = cacheKey(text, useVoice, useSpeed);
        etag = `"${key}"`;
        usedAlt = true;
      }
    }
    const { audio, hit } = await speakWithProvider(text, useVoice, useSpeed);
    // 只在真走了兜底时才带这个头；没用 alt 还挂个 "undefined" 字符串会误导排障
    const headers = usedAlt ? { 'x-tts-alt': alt as string } : undefined;
    return audioResponse(audio, etag, hit, req.headers.get('range'), useRate, headers);
  } catch (err) {
    if (err instanceof KokoroError) {
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

  const key = cacheKey(parsed.text, parsed.voice, parsed.speed);
  const cached = await readCache(key, kokoroConfig());

  return new Response(null, {
    status: cached ? 200 : 404,
    headers: cached
      ? {
          etag: `"${key}"`,
          'content-length': String(cached.length),
          'accept-ranges': 'bytes',
          'x-tts-cache': 'hit',
          'x-tts-playback-rate': parsed.playbackRate.toFixed(2),
        }
      : { 'x-tts-cache': 'miss', 'x-tts-playback-rate': parsed.playbackRate.toFixed(2) },
  });
}

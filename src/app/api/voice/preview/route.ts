import { z } from 'zod';
import { AI_VOICE_IDS, PACE_KEYS, pace } from '@/lib/voice-options';
import { voiceConfig, MISSING_KEY_MESSAGE } from '@/lib/voice/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  voice: z.string().max(60),
  paceKey: z.enum(PACE_KEYS as [string, ...string[]]).default('normal'),
  text: z.string().max(300).default('Hi! Nice to meet you. What do you usually do on weekends?'),
});

/**
 * 音色试听。转发到上游的 TTS 接口（地址和模型见 @/lib/voice/config），返回 mp3。
 *
 * 为什么试听走 TTS 而不是 realtime：
 * 1. realtime 建连本身有成本，而且连续快速建连会被上游限流 —— 用户连点几个音色
 *    就会连锁失败，表现成「音色不可用」的假象。
 * 2. TTS 支持 speed 参数，能把当前语速档位真实听出来；realtime 没有语速参数。
 *
 * 代价是试听用的是 TTS 模型的合成，和 realtime 里同名音色不完全等同 ——
 * 音色特征一致，但语气和呼吸感不同。用来选音色够了。
 */
export async function POST(req: Request) {
  const cfg = voiceConfig();
  if (!cfg.apiKey) {
    return Response.json({ ok: false, error: MISSING_KEY_MESSAGE }, { status: 500 });
  }

  let input: z.infer<typeof Body>;
  try {
    input = Body.parse(await req.json());
  } catch {
    return Response.json({ ok: false, error: '参数不对' }, { status: 422 });
  }

  // 只放行白名单里的音色：这个接口会拿服务端的 key 去调外部付费接口，
  // 不能让任意字符串透传过去。
  if (!AI_VOICE_IDS.includes(input.voice)) {
    return Response.json({ ok: false, error: '未知音色' }, { status: 400 });
  }

  try {
    const upstream = await fetch(cfg.ttsUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.ttsModel,
        input: input.text,
        voice: input.voice,
        response_format: 'mp3',
        speed: pace(input.paceKey).ttsSpeed,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      return Response.json(
        { ok: false, error: `试听失败（${upstream.status}）${detail.slice(0, 200)}` },
        { status: 502 },
      );
    }

    return new Response(upstream.body, {
      headers: {
        'content-type': 'audio/mpeg',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: `试听请求出错：${msg}` }, { status: 502 });
  }
}

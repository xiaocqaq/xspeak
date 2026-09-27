import { cacheKey, readCache } from '@/lib/tts/cache';
import { speakWithProvider } from '@/lib/tts/server-voices';
import { DEFAULT_SERVER_VOICE, SERVER_VOICES, preferredMimoVoiceId } from '@/lib/tts/server-voice-list';
import type { SpeechPace } from '@/lib/types';
import type { SessionRow, UserProfile } from '@/lib/types';
import type {
  GrammarData,
  ListeningData,
  ReadingData,
  SpeakingData,
  WarmupData,
  NewWordData,
} from '@/lib/ai/schemas';
import { buildStage } from '@/lib/stage';
import { getStageContent } from '@/lib/repo/session';

/**
 * 服务端预合成：prefresh 定时任务在生成完当天内容后，把每个环节里
 * 用户会点「朗读」的英文句子送进服务端 TTS 磁盘缓存，用户醒来点开
 * 就是即点即响的在线音色，不用现场等 1~2 秒合成。
 *
 * ── 为什么在服务端做，而不是靠前端 warm ──
 *
 * 前端 warmServerSpeech 只有浏览器打开页面后才会跑；凌晨 4 点用户没开
 * 页面，预热永远不会发生。预合成把这层提前到内容生成的同一时间点。
 *
 * ── 缓存键的一致性（本文件最重要的不变量） ──
 *
 * 播放链路：浏览器 speak() → GET /api/speak?text=&voice=&pace=
 *   → parseParams: key = cacheKey(text, voice, 1)（MiMo 恒按 1.0 合成）
 *   → speakWithProvider → mimoSpeakCached → cacheKey(text, voice, 1)
 *
 * 预合成链路（本文件）用同一个 cacheKey 判断「缓存里有没有」，miss 才调
 * speakWithProvider（其内部 miss 时合成并写盘）。只要 text/voice 一致，
 * 用户点朗读必命中磁盘缓存。
 *
 * ── 音色怎么选（2026-09-09 简化） ──
 *
 * 自建 Kokoro 已整条下线，服务端朗读只有云端 MiMo 一家：凌晨 cron、
 * 进门兜底、开新主题全都走同一套音色偏好（users.voice，缺省 Mia）。
 * 不再有「免费慢路 vs 付费快路」的梯队之分，也就不再有 voice_offline 那一列。
 */

/** 单个用户一轮预合成的全部待合成句子。 */
type PrefillLine = { text: string; voice: string };

/** 预合成对 TTS 上游的并发限制：与前端 warm 队列同数量级，别压垮链路。 */
const TTS_CONCURRENCY = 2;

/** /api/speak 的单次文本上限（MAX_TEXT）。超限文本由切块逻辑处理。 */
const MAX_TEXT = 300;

/**
 * 从 payload 里挖出「用户会点朗读的英文句子」。
 *
 * 挖取原则：前端真的挂了 Speak/朗读按钮的地方才合成 —— 多合一句都是
 * 白花的 token。对照 src/components/stages/*.tsx：
 * - warmup:    每题的完整句（挖空处由前端 filled 变体现场合成，不预合成）
 * - newwords:  词本身、例句、每个搭配（搭配在 chip 上点了才读）
 * - grammar:   每个例句 en；练习题 answer 在答题后才显示，不预合成
 * - listening: 每句台词 text_en（slow 档不预合成，主档覆盖大多数播放）
 * - reading:   标题 + 正文，按句切块（切块逻辑与前端一致）
 * - speaking:  AI 开场白 opening_en
 */
function collectStageLines(stage: string, payload: unknown, fallbackVoice: string): PrefillLine[] {
  const lines: PrefillLine[] = [];
  const add = (text: unknown) => {
    const t = typeof text === 'string' ? text.trim() : '';
    if (t && t.length <= MAX_TEXT) lines.push({ text: t, voice: fallbackVoice });
  };

  switch (stage) {
    case 'warmup': {
      const p = payload as WarmupData | null;
      p?.items?.forEach((it) => add(it.sentence_en));
      break;
    }
    case 'newwords': {
      const p = payload as { words?: NewWordData[] } | null;
      p?.words?.forEach((w) => {
        add(w.term);
        add(w.example_en);
        w.collocations?.forEach((c) => add(c));
      });
      break;
    }
    case 'grammar': {
      const p = payload as GrammarData | null;
      p?.examples?.forEach((ex) => add(ex.en));
      break;
    }
    case 'reading': {
      const p = payload as ReadingData | null;
      if (p) splitSegments(`${p.title_en}. ${p.passage_en}`).forEach(add);
      break;
    }
    case 'speaking': {
      const p = payload as SpeakingData | null;
      add(p?.opening_en);
      break;
    }
  }
  return lines;
}

/**
 * 听力台词的服务端音色分派（prefill 与前端 buildServerVoiceCast 同构）。
 *
 * 关键不变量：分派结果必须与前端 useSpeech.buildServerVoiceCast 完全一致，
 * 否则预合成的音色和播放时请求的音色对不上，缓存永远 miss。两边共用同一张
 * SERVER_VOICES 表、同一套「报性别的先领、没报的按女男轮着发、偏好音色排
 * 桶最前」规则。2026-09-09 后只剩 MiMo 音色，不存在梯队差。
 */
export function serverCastFor(
  dialogue: { speaker: string; gender?: 'male' | 'female' | undefined }[],
  preferred: string | null,
): Map<string, string> {
  const key = (s: string) => s.trim().toLowerCase();
  const prefId = preferredMimoVoiceId(preferred);
  const female = SERVER_VOICES.filter((v) => v.gender === 'female').map((v) => v.id);
  const male = SERVER_VOICES.filter((v) => v.gender === 'male').map((v) => v.id);
  const bump = (arr: string[]) =>
    prefId && arr.includes(prefId) ? [prefId, ...arr.filter((x) => x !== prefId)] : arr;

  // 出场顺序去重，性别取第一次报的（和前端同款）
  const order: string[] = [];
  const wants = new Map<string, 'male' | 'female' | undefined>();
  for (const l of dialogue) {
    const k = key(l.speaker);
    if (!k) continue;
    if (!order.includes(k)) {
      order.push(k);
      wants.set(k, l.gender);
    } else if (!wants.get(k) && l.gender) {
      wants.set(k, l.gender);
    }
  }

  const taken = new Set<string>();
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
  // 第二轮：没报性别（或桶空了）的按女/男轮着发（flip 语义与前端一致：从
  // 自己前一个人不同的桶拿；两行代码交替 flip 的次序和前端逐行写的一样）
  let flip = true;
  for (const k of order) {
    if (inner.has(k)) continue;
    const bucket = bump(flip ? female : male).filter((id) => !taken.has(id));
    flip = !flip;
    const alt = bump(flip ? female : male).filter((id) => !taken.has(id));
    const pick = bucket[0] ?? alt[0];
    if (pick) {
      taken.add(pick);
      inner.set(k, pick);
    }
  }
  return inner;
}

/**
 * 听力的台词单独处理：多人对话按说话人分嗓音（分派与前端一致，见 serverCastFor）。
 */
function listeningLines(payload: unknown, preferred: string | null): PrefillLine[] {
  const p = payload as ListeningData | null;
  if (!p?.dialogue?.length) return [];
  const cast = serverCastFor(p.dialogue, preferred);
  return p.dialogue
    .map((d) => {
      const t = d.text_en.trim();
      const v = cast.get(d.speaker.trim().toLowerCase()) ?? DEFAULT_SERVER_VOICE;
      return t && t.length <= MAX_TEXT ? { text: t, voice: v } : null;
    })
    .filter((x): x is PrefillLine => x !== null);
}

/**
 * 与前端 splitSpeechChunks 同一套句子切分的复制版（不 import 的原因：
 * useSpeech.ts 是 'use client' 模块，从服务端路由引它会拖进浏览器代码）。
 * 切法必须一致：预合成的就是播放时请求的那一块。
 */
function splitSegments(text: string, max = 220): string[] {
  const body = text.replace(/\s+/g, ' ').trim();
  if (!body) return [];
  if (body.length <= max) return [body];
  const HARD = /(?<=[.!?。！？])\s+/g;
  const SOFT = /(?<=[;:,；：，—])\s+/g;
  const cutAt = (s: string): number => {
    let hard = -1;
    let m: RegExpExecArray | null;
    HARD.lastIndex = 0;
    while ((m = HARD.exec(s))) hard = m.index + m[0].length;
    if (hard > 0) return hard;
    let soft = -1;
    SOFT.lastIndex = 0;
    while ((m = SOFT.exec(s))) soft = m.index + m[0].length;
    return soft > 40 ? soft : s.length;
  };
  const parts: string[] = [];
  let rest = body;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = cutAt(window);
    if (cut <= 0 || cut > max) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * 预合成一批句子。已在磁盘缓存里的直接跳过；miss 的合成并写盘。
 * 失败不抛：预合成是锦上添花，任何一句失败都不该挡住整体 prefresh。
 */
async function prefillTts(
  lines: PrefillLine[],
): Promise<{ lines: number; synthesized: number; cached: number; failed: number }> {
  // 缓存键与 /api/speak parseParams 完全一致：MiMo 恒按 1.0 合成
  let synthesized = 0;
  let cached = 0;
  let failed = 0;

  for (let i = 0; i < lines.length; i += TTS_CONCURRENCY) {
    const batch = lines.slice(i, i + TTS_CONCURRENCY);
    await Promise.all(
      batch.map(async (l) => {
        const key = cacheKey(l.text, l.voice, 1);
        if (await readCache(key)) {
          cached += 1;
          return;
        }
        try {
          await speakWithProvider(l.text, l.voice);
          synthesized += 1;
        } catch {
          failed += 1;
        }
      }),
    );
  }
  return { lines: lines.length, synthesized, cached, failed };
}

/**
 * 预合成总入口：把一个用户当天六环的朗读音频备好。
 *
 * prefresh 路由（凌晨 cron）逐用户调用；单用户内部串行
 * （六环逐个走，TTS 两并发），避免抢上游配额。
 *
 * stages 参数限定要跑的环节 —— 用户进门兜底（/api/session/today 的
 * after()）传「还没生成内容」的环节：内容已生成的环节直接查 TTS 缓存
 * 补音频（buildStage 命中当日缓存，不会再花 AI 钱），还没生成内容的
 * 环节才走完整「生成 + 预合成」。
 */
export async function prefillUserSpeech(
  user: UserProfile,
  session: SessionRow,
  stages?: readonly string[],
): Promise<Record<string, unknown>> {
  // 只认 users.voice 里的 MiMo 音色（'mimo:xx'），其它形态一律默认 Mia
  const prefId = preferredMimoVoiceId(user.voice);

  const all = ['warmup', 'newwords', 'grammar', 'listening', 'reading', 'speaking'] as const;
  const run = stages?.length ? all.filter((s) => stages.includes(s)) : all;
  const stats: Record<string, unknown> = {};
  for (const stage of run) {
    try {
      // buildStage：有当日缓存走缓存，没有就生成（同一天的缓存全天命中）
      const { payload } = await buildStage(user, session, stage);
      const voice = prefId ?? DEFAULT_SERVER_VOICE;
      const lines =
        stage === 'listening'
          ? listeningLines(payload, prefId)
          : collectStageLines(stage, payload, voice).map((l) => ({ ...l, voice }));
      const r = await prefillTts(lines);
      stats[stage] = r;
    } catch (err) {
      stats[stage] = { error: (err as Error).message };
    }
  }
  return stats;
}

/**
 * 进门兜底用：这个 session 还缺哪些环节的内容。
 *
 * 凌晨 cron 跑过的话六环全有缓存，这里返回空数组 → 进门不做任何事。
 * cron 没跑（新用户、超 48h 回归、昨晚失败）时返回缺的环节，
 * /api/session/today 的 after() 只对这些环节发起「生成 + TTS 预合成」。
 */
export async function missingStages(session: SessionRow): Promise<string[]> {
  const all = ['warmup', 'newwords', 'grammar', 'listening', 'reading', 'speaking'] as const;
  const missing: string[] = [];
  for (const stage of all) {
    const cached = await getStageContent(session.id, stage);
    if (!cached) missing.push(stage);
  }
  return missing;
}

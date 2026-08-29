'use client';

import { useState } from 'react';
import { Mic, RotateCcw, Square } from 'lucide-react';
import { Button } from '@/components/ui';
import { Speak } from '@/components/stages/shared';
import { useStt } from '@/hooks/useSpeech';
import { apiPost } from '@/lib/fetcher';
import { cn } from '@/lib/cn';

type WordScore = { target: string; heard: string | null; status: 'ok' | 'close' | 'miss' };
type Scored = { score: number; words: WordScore[]; summaryZh: string };

/**
 * 跟读打分。说明一下这个分数是什么：
 * 浏览器的语音识别只给文字，所以这里比的是"识别出来的词和目标句对不对得上"。
 * 它能告诉你哪个词没被听清（通常就是念得不准的那个），但它不是声学音素分析，
 * 不能告诉你舌位该怎么放。
 */
export function ShadowCard({
  target,
  zh,
  sessionId,
  onScored,
}: {
  target: string;
  zh?: string;
  sessionId?: number | null;
  onScored?: (score: number, transcript: string) => void;
}) {
  const [result, setResult] = useState<Scored | null>(null);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (transcript: string) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await apiPost<{ scored: Scored }>('/api/pronounce', {
        target,
        transcript,
        sessionId: sessionId ?? null,
      });
      setResult(res.scored);
      onScored?.(res.scored.score, transcript);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stt = useStt({ continuous: false, onFinal: submit });

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-start gap-2">
        <p className="en flex-1 text-[16px] font-medium leading-relaxed text-[var(--text-title)]">{target}</p>
        <Speak text={target} />
      </div>
      {zh && <p className="mt-1.5 text-xs dim">{zh}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {stt.supported && !manual ? (
          <Button
            variant={stt.listening ? 'danger' : 'outline'}
            size="sm"
            onClick={() => (stt.listening ? stt.stop() : (setResult(null), stt.start()))}
            loading={busy}
            className={cn(stt.listening && 'recording')}
          >
            {stt.listening ? (
              <>
                <Square className="size-3.5" aria-hidden /> 说完了
              </>
            ) : (
              <>
                <Mic className="size-3.5" aria-hidden /> 跟读
              </>
            )}
          </Button>
        ) : null}
        {result && (
          <Button variant="ghost" size="sm" onClick={() => (setResult(null), stt.reset())}>
            <RotateCcw className="size-3.5" aria-hidden /> 再来
          </Button>
        )}
        {!manual && !stt.supported && (
          <button type="button" onClick={() => setManual(true)} className="text-xs dim hover:underline">
            这个浏览器不能录音，改成打字
          </button>
        )}
      </div>

      {stt.listening && (
        <p className="mt-2 text-sm dim">
          在听… <span className="en">{stt.interim}</span>
        </p>
      )}
      {stt.error && <p className="mt-2 text-xs text-warm-600 dark:text-warm-300">{stt.error}</p>}
      {err && <p className="mt-2 text-xs text-[var(--danger)]">{err}</p>}

      {manual && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const input = (e.currentTarget.elements.namedItem('t') as HTMLInputElement).value;
            if (input.trim()) submit(input.trim());
          }}
        >
          <input
            name="t"
            className={cn(
              'en h-9 flex-1 rounded-lg px-3 text-sm',
              'border border-[var(--border-control)] bg-[var(--surface)] text-[var(--text-body)]',
              'placeholder:text-[var(--text-faint)]',
              'transition-[border-color,box-shadow] duration-150 focus:outline-none',
              'focus:border-brand-500 focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-brand-400)_22%,transparent)]',
            )}
            placeholder="把这句话打出来"
            aria-label="手打这句话"
          />
          <Button size="sm" type="submit" loading={busy}>
            对照
          </Button>
        </form>
      )}

      {result && (
        <div className="mt-3 fade-up">
          <div className="flex items-center gap-3">
            {/* 分数牌和写作批改那块同形：描边 + 衬线数字，不用实心圆 */}
            <div
              className={cn(
                'grid size-11 shrink-0 place-items-center rounded-lg border',
                result.score >= 85
                  ? 'border-[color-mix(in_srgb,var(--success)_40%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,var(--surface))] text-[var(--success)]'
                  : result.score >= 65
                    ? 'border-warm-300 bg-warm-50 text-warm-600 dark:border-warm-800 dark:bg-warm-900/25 dark:text-warm-300'
                    : 'border-[color-mix(in_srgb,var(--danger)_36%,transparent)] bg-[color-mix(in_srgb,var(--danger)_9%,var(--surface))] text-[var(--danger)]',
              )}
            >
              <span className="serif text-[19px] font-bold leading-none tabular-nums">{result.score}</span>
            </div>
            <p className="flex-1 text-xs leading-relaxed dim">{result.summaryZh}</p>
          </div>
          <p className="mt-2 flex flex-wrap gap-x-1.5 gap-y-1">
            {result.words.map((w, i) => (
              <span
                key={i}
                className={cn(
                  'en rounded-[3px] px-1 text-[15px]',
                  // 听清了就是普通正文色（不奖励"正常"），只有听不清的才染色
                  w.status === 'ok' && 'text-[var(--text-body)]',
                  w.status === 'close' &&
                    'bg-warm-100 text-warm-800 underline decoration-warm-500 decoration-dotted underline-offset-[3px] dark:bg-warm-900/40 dark:text-warm-200',
                  w.status === 'miss' &&
                    'bg-[color-mix(in_srgb,var(--danger)_12%,var(--surface))] text-[var(--danger)] line-through',
                )}
                title={
                  w.status === 'ok'
                    ? '听清了'
                    : w.status === 'close'
                      ? `接近，听成了 ${w.heard}`
                      : '没识别到这个词'
                }
              >
                {w.target}
              </span>
            ))}
          </p>
          {stt.transcript && (
            <p className="mt-1.5 text-xs dim">
              识别到：<span className="en">{stt.transcript}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

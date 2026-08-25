'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Eye, ListChecks } from 'lucide-react';
import { Badge, Button, Card, ErrorNote, Textarea } from '@/components/ui';
import { Speak, StageIntro, TappableText } from './shared';
import { apiPost } from '@/lib/fetcher';
import type { StageProps } from './types';
import type { CorrectionData, WritingData } from '@/lib/ai/schemas';
import { cn } from '@/lib/cn';

type Result = CorrectionData & { usedWordIds: number[] };

/**
 * 写作。批改结果会把原文里出问题的片段标出来（issues[].wrong 是原文子串），
 * 每条问题都自动进错误本 —— 明天的练习会拿这些错重新考你。
 */
export function WritingStage({ payload, meta, onDone, onRegenerate, submitting }: StageProps<WritingData>) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSample, setShowSample] = useState(false);

  const mustUse = payload.must_use ?? [];
  const used = useMemo(() => {
    const lower = text.toLowerCase();
    return new Set(mustUse.filter((w) => lower.includes(w.toLowerCase())));
  }, [text, mustUse]);

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<Result>('/api/writing', {
        sessionId: meta.sessionId,
        promptEn: payload.prompt_en,
        promptZh: payload.prompt_zh,
        text: text.trim(),
        mustUse,
        targetWordIds: meta.targetWords.map((w) => w.id),
      });
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <StageIntro>{payload.prompt_zh}</StageIntro>

      <Card>
        <div className="flex items-start gap-2">
          <p className="en flex-1 text-[15px] font-medium">{payload.prompt_en}</p>
          <Speak text={payload.prompt_en} />
        </div>

        {mustUse.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-xs dim">要用上：</span>
            {mustUse.map((w) => (
              <span
                key={w}
                className={cn(
                  'en rounded-md px-2 py-0.5 text-xs transition-colors',
                  used.has(w)
                    ? 'bg-brand-500 text-white'
                    : 'border border-dashed border-[var(--border)] text-[var(--text-dim)]',
                )}
              >
                {used.has(w) && '✓ '}
                {w}
              </span>
            ))}
          </div>
        )}

        <Textarea
          rows={6}
          className="en mt-3"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="写几句就行。写错不要紧 —— 这一步就是为了把错误找出来。"
          disabled={Boolean(result)}
          aria-label="你的写作"
        />
        <div className="mt-1.5 flex items-center justify-between text-xs dim">
          <span>{words} 词</span>
          {!result && (
            <button type="button" onClick={() => setShowSample((s) => !s)} className="hover:underline">
              <Eye className="mr-1 inline size-3.5" aria-hidden />
              {showSample ? '藏起参考' : '实在写不出，看参考'}
            </button>
          )}
        </div>

        {showSample && !result && (
          <div className="mt-2 rounded-xl bg-[var(--surface-2)] p-3">
            <p className="text-xs dim">参考写法（先自己试，再看会学得更牢）</p>
            <TappableText text={payload.sample_en} className="mt-1 block text-sm" />
          </div>
        )}

        {payload.checklist_zh.length > 0 && !result && (
          <div className="mt-3 rounded-xl border border-[var(--border)] p-3">
            <div className="flex items-center gap-1.5">
              <ListChecks className="size-3.5 dim" aria-hidden />
              <p className="text-xs font-semibold dim">交之前自己过一遍</p>
            </div>
            <ul className="mt-1.5 space-y-0.5">
              {payload.checklist_zh.map((c, i) => (
                <li key={i} className="text-xs dim">
                  · {c}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!result && (
          <Button className="mt-4 w-full" onClick={submit} loading={busy} disabled={!text.trim()}>
            交给 AI 批改
          </Button>
        )}
      </Card>

      {error && <ErrorNote message={error} onRetry={submit} />}

      {result && (
        <>
          <Card className="fade-up">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'grid size-12 shrink-0 place-items-center rounded-full text-base font-bold text-white',
                  result.score >= 85 ? 'bg-brand-500' : result.score >= 65 ? 'bg-warm-500' : 'bg-red-500',
                )}
              >
                {result.score}
              </div>
              <p className="flex-1 text-sm">{result.summary_zh}</p>
            </div>
          </Card>

          <Card>
            <p className="text-sm font-semibold">你写的（问题已标出）</p>
            <p className="en mt-2 text-sm leading-relaxed">
              <Highlighted text={text} issues={result.issues} />
            </p>
          </Card>

          {result.issues.length > 0 && (
            <Card>
              <p className="text-sm font-semibold">逐条看</p>
              <ul className="mt-3 space-y-3">
                {result.issues.map((it, i) => (
                  <li key={i} className="border-l-2 border-warm-400 pl-3">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm">
                      <span className="en text-red-600 line-through dark:text-red-400">{it.wrong}</span>
                      <span className="dim">→</span>
                      <span className="en text-brand-700 dark:text-brand-400">{it.correct}</span>
                      <Badge>{kindZh(it.kind)}</Badge>
                    </div>
                    <p className="mt-1 text-xs dim">{it.note_zh}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs dim">
                这些已经进错误本了。接下来几天的题目会悄悄把它们再考一遍。
              </p>
            </Card>
          )}

          <Card>
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <p className="text-sm font-semibold">改好的版本</p>
                <TappableText text={result.corrected_en} className="mt-2 block text-sm leading-relaxed" />
              </div>
              <Speak text={result.corrected_en} />
            </div>
          </Card>

          {result.used_target_words.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <CheckCircle2 className="size-4 text-brand-500" aria-hidden />
              <span className="text-xs dim">主动用出：</span>
              {result.used_target_words.map((w) => (
                <Badge key={w} tone="success">
                  {w}
                </Badge>
              ))}
            </div>
          )}

          <Button
            className="w-full"
            onClick={() => onDone({ produced: result.usedWordIds })}
            loading={submitting}
          >
            今天到这里
          </Button>
        </>
      )}

      {!result && (
        <button type="button" onClick={onRegenerate} className="w-full text-center text-xs dim hover:underline">
          换个题目
        </button>
      )}
    </div>
  );
}

/** 把批改里指出的错误片段在原文上标红。issues[].wrong 是原文子串，所以能直接定位。 */
function Highlighted({ text, issues }: { text: string; issues: CorrectionData['issues'] }) {
  const marks: { start: number; end: number }[] = [];
  for (const it of issues) {
    if (!it.wrong) continue;
    const i = text.indexOf(it.wrong);
    if (i >= 0) marks.push({ start: i, end: i + it.wrong.length });
  }
  marks.sort((a, b) => a.start - b.start);
  // 去掉重叠区间，避免切片错位
  const clean: typeof marks = [];
  for (const m of marks) {
    if (!clean.length || m.start >= clean[clean.length - 1].end) clean.push(m);
  }
  if (!clean.length) return <>{text}</>;

  const out: React.ReactNode[] = [];
  let cur = 0;
  clean.forEach((m, i) => {
    if (m.start > cur) out.push(<span key={`t${i}`}>{text.slice(cur, m.start)}</span>);
    out.push(
      <mark
        key={`m${i}`}
        className="rounded bg-warm-200 px-0.5 text-inherit dark:bg-warm-800/60"
      >
        {text.slice(m.start, m.end)}
      </mark>,
    );
    cur = m.end;
  });
  if (cur < text.length) out.push(<span key="tail">{text.slice(cur)}</span>);
  return <>{out}</>;
}

function kindZh(k: string) {
  return { grammar: '语法', word_choice: '用词', spelling: '拼写', style: '表达' }[k] ?? k;
}

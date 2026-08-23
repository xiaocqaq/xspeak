'use client';

import { useEffect, useState } from 'react';
import { Check, Flame, Mic, PenLine, TrendingUp } from 'lucide-react';
import { Badge, Button, Card, Empty, ErrorNote, Spinner } from '@/components/ui';
import { apiGet, apiPatch } from '@/lib/fetcher';
import type { MistakeRow, StatsSummary } from '@/lib/types';
import { cn } from '@/lib/cn';

type Stats = {
  summary: StatsSummary;
  forecast: { day: string; c: number }[];
  speech: { avg: number | null; count: number };
  writing: { avg: number | null; count: number };
  topMistakeKinds: { kind: string; n: number }[];
  mistakes: MistakeRow[];
  sessions: { day: string; themeZh: string; stagesDone: number; completed: boolean; minutes: number }[];
};

const KIND_ZH: Record<string, string> = {
  grammar: '语法',
  word_choice: '用词',
  spelling: '拼写',
  style: '表达',
  pronunciation: '发音',
  listening: '听力',
};

/** 数据页。重点不是"你有多努力"，是"哪些东西你其实还不会"。 */
export function StatsPage() {
  const [d, setD] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = () => {
    setError(null);
    apiGet<Stats>('/api/stats')
      .then(setD)
      .catch((e) => setError(e.message));
  };

  useEffect(load, []);

  const resolve = async (id: number) => {
    setBusy(id);
    try {
      await apiPatch('/api/profile', { resolveMistakeId: id });
      setD((prev) => (prev ? { ...prev, mistakes: prev.mistakes.filter((m) => m.id !== id) } : prev));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (error && !d) return <ErrorNote message={error} onRetry={load} />;
  if (!d) return <div className="py-10"><Spinner /></div>;

  const s = d.summary;
  const maxRev = Math.max(1, ...s.last14.map((x) => x.reviews));
  const maxFc = Math.max(1, ...d.forecast.map((x) => x.c));

  return (
    <div className="space-y-4 py-2 fade-up">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">数据</h1>
        <p className="mt-1.5 text-sm dim">看留存率和错题，不看打卡天数 —— 前者才说明有没有真的记住。</p>
      </header>

      {error && <ErrorNote message={error} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Big icon={<Flame className="size-4 text-warm-500" />} label="连续学习" value={`${s.streak} 天`} />
        <Big
          icon={<TrendingUp className="size-4 text-emerald-500" />}
          label="30 天留存率"
          value={s.retention30 == null ? '—' : `${s.retention30}%`}
          hint="复习时第一次就答对的比例"
        />
        <Big
          icon={<Mic className="size-4 text-brand-500" />}
          label="发音一致度"
          value={d.speech.avg == null ? '—' : String(d.speech.avg)}
          hint={`${d.speech.count} 次跟读`}
        />
        <Big
          icon={<PenLine className="size-4 text-brand-500" />}
          label="写作平均分"
          value={d.writing.avg == null ? '—' : String(d.writing.avg)}
          hint={`${d.writing.count} 篇`}
        />
      </div>

      <Card>
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">词汇状态</h2>
          <span className="text-xs dim">共 {s.totalWords} 个</span>
        </div>
        <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-[var(--surface-2)]">
          <Bar n={s.matureWords} total={s.totalWords} className="bg-emerald-500" />
          <Bar n={s.learningWords} total={s.totalWords} className="bg-amber-500" />
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <Legend className="bg-emerald-500" label="记住了" n={s.matureWords} />
          <Legend className="bg-amber-500" label="学习中" n={s.learningWords} />
          <Legend className="bg-[var(--surface-2)]" label="待开始" n={Math.max(0, s.totalWords - s.matureWords - s.learningWords)} />
        </div>
        <p className="mt-3 text-xs dim">
          今天主动用出 <span className="font-medium text-emerald-600 dark:text-emerald-400">{s.producedToday}</span> 个词。
          说出口、写进句子才算会用，认得不算。
        </p>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold">最近 14 天</h2>
        <div className="mt-3 flex h-24 items-end gap-1">
          {s.last14.map((x) => (
            <div key={x.day} className="group relative flex-1">
              <div
                className="w-full rounded-t bg-brand-400 transition-colors group-hover:bg-brand-600"
                style={{ height: `${Math.max(x.reviews ? 6 : 2, (x.reviews / maxRev) * 92)}px` }}
              />
              <span className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--text)] px-2 py-1 text-[11px] text-[var(--surface)] group-hover:block">
                {x.day.slice(5)} · {x.reviews} 次 · {Math.round(x.minutes)} 分
              </span>
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] dim">
          <span>{s.last14[0]?.day.slice(5)}</span>
          <span>今天</span>
        </div>
      </Card>

      <Card>
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">未来 14 天复习量</h2>
          <span className="text-xs dim">今天到期 {s.dueToday}</span>
        </div>
        {d.forecast.length === 0 ? (
          <p className="mt-2 text-sm dim">还没有排期。</p>
        ) : (
          <>
            <div className="mt-3 flex h-16 items-end gap-1">
              {d.forecast.map((f) => (
                <div key={f.day} className="group relative flex-1">
                  <div
                    className={cn('w-full rounded-t', f.c > 40 ? 'bg-warm-500' : 'bg-brand-300')}
                    style={{ height: `${Math.max(4, (f.c / maxFc) * 60)}px` }}
                  />
                  <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--text)] px-2 py-1 text-[11px] text-[var(--surface)] group-hover:block">
                    {f.day.slice(5)} · {f.c}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs dim">橙色是超过 40 个的日子，那天可以少加新词。</p>
          </>
        )}
      </Card>

      <Card>
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">错题本</h2>
          <span className="text-xs dim">{s.openMistakes} 条待消化</span>
        </div>
        <p className="mt-1 text-xs dim">这些会被悄悄编进后面几天的题目里，不会单独拎出来考你。</p>

        {d.topMistakeKinds.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {d.topMistakeKinds.map((k) => (
              <Badge key={k.kind} tone="warm">
                {KIND_ZH[k.kind] ?? k.kind} {k.n}
              </Badge>
            ))}
          </div>
        )}

        {d.mistakes.length === 0 ? (
          <p className="mt-3 text-sm dim">干净的，没有待消化的错题。</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {d.mistakes.map((m) => (
              <li key={m.id} className="rounded-lg bg-[var(--surface-2)] p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge>{KIND_ZH[m.kind] ?? m.kind}</Badge>
                      {m.times > 1 && <Badge tone="danger">错 {m.times} 次</Badge>}
                    </div>
                    <p className="en mt-1.5 text-sm line-through decoration-red-400">{m.wrong}</p>
                    {m.correct && (
                      <p className="en text-sm text-emerald-600 dark:text-emerald-400">{m.correct}</p>
                    )}
                    {m.note_zh && <p className="mt-1 text-xs dim">{m.note_zh}</p>}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy === m.id}
                    onClick={() => resolve(m.id)}
                    aria-label="标记为已掌握"
                    title="我已经会了"
                  >
                    <Check className="size-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold">学习记录</h2>
        {d.sessions.length === 0 ? (
          <Empty title="还没有记录" hint="去首页开始今天的 30 分钟。" />
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {d.sessions.map((x) => (
              <li key={x.day} className="flex items-center gap-3 py-2.5">
                <span className="w-14 shrink-0 text-xs dim">{x.day.slice(5)}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{x.themeZh}</span>
                <span className="shrink-0 text-xs dim">{x.minutes} 分</span>
                {x.completed ? (
                  <Badge tone="success">完成</Badge>
                ) : (
                  <Badge tone="warm">{x.stagesDone}/7</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Big({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-xs dim">{label}</span>
      </div>
      <p className="mt-1.5 text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] dim">{hint}</p>}
    </Card>
  );
}

function Bar({ n, total, className }: { n: number; total: number; className: string }) {
  if (n <= 0) return null;
  return <div className={className} style={{ width: `${(n / Math.max(1, total)) * 100}%` }} />;
}

function Legend({ n, label, className }: { n: number; label: string; className: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('size-2 rounded-full', className)} aria-hidden />
      {label} {n}
    </span>
  );
}

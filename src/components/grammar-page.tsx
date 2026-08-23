'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { Badge, Card, Empty, ErrorNote, Progress, Spinner } from '@/components/ui';
import { Speak, TappableText } from '@/components/stages/shared';
import { apiGet } from '@/lib/fetcher';
import type { GrammarRow } from '@/lib/types';
import { cn } from '@/lib/cn';

type Item = GrammarRow & {
  state: number | null;
  due: string | null;
  reps: number;
  error_count: number;
};

/** 语法库。24 个点从 A1 到 B1，每个都带中文母语者容易踩的坑。 */
export function GrammarPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const load = () => {
    setError(null);
    apiGet<{ items: Item[] }>('/api/grammar')
      .then((d) => setItems(d.items))
      .catch((e) => setError(e.message));
  };

  useEffect(load, []);

  if (error) return <ErrorNote message={error} onRetry={load} />;
  if (!items) return <div className="py-10"><Spinner /></div>;

  const learned = items.filter((i) => i.state != null).length;

  return (
    <div className="space-y-4 py-2 fade-up">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">语法</h1>
        <p className="mt-1.5 text-sm dim">
          每天一个点，和单词一样进复习队列 —— 讲过一遍不等于会用。
        </p>
      </header>

      <Card>
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium">已经过过一遍</span>
          <span className="text-sm dim">
            {learned}/{items.length}
          </span>
        </div>
        <Progress value={(learned / Math.max(1, items.length)) * 100} className="mt-2" />
      </Card>

      {items.length === 0 ? (
        <Empty title="语法库是空的" />
      ) : (
        <ul className="space-y-2">
          {items.map((g) => {
            const isOpen = open === g.id;
            return (
              <li key={g.id}>
                <Card className="p-0">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : g.id)}
                    aria-expanded={isOpen}
                    className="flex w-full items-start gap-3 p-4 text-left"
                  >
                    <span
                      className={cn(
                        'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
                        g.state == null
                          ? 'bg-[var(--surface-2)] text-[var(--text-dim)]'
                          : g.state === 3
                            ? 'bg-red-500 text-white'
                            : g.state === 2
                              ? 'bg-emerald-500 text-white'
                              : 'bg-amber-500 text-white',
                      )}
                    >
                      {g.ord}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium">{g.title_zh}</span>
                        <Badge>{g.cefr}</Badge>
                        {g.error_count > 0 && <Badge tone="danger">错过 {g.error_count} 次</Badge>}
                      </span>
                      <span className="en mt-0.5 block truncate text-xs dim">{g.title_en}</span>
                    </span>
                    <ChevronDown
                      className={cn('mt-0.5 size-4 shrink-0 dim transition-transform', isOpen && 'rotate-180')}
                      aria-hidden
                    />
                  </button>

                  {isOpen && (
                    <div className="space-y-3 border-t border-[var(--border)] p-4 fade-up">
                      {g.pattern && (
                        <p className="en rounded-lg bg-[var(--surface-2)] px-3 py-2 text-sm">{g.pattern}</p>
                      )}
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{g.explain_zh}</p>

                      {g.examples.length > 0 && (
                        <div className="space-y-2">
                          {g.examples.map((ex, i) => (
                            <div key={i} className="rounded-lg bg-[var(--surface-2)] p-2.5">
                              <div className="flex items-start gap-1.5">
                                <TappableText text={ex.en} className="flex-1 text-sm" />
                                <Speak text={ex.en} className="p-0.5" />
                              </div>
                              <p className="mt-0.5 text-xs dim">{ex.zh}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {g.pitfalls.length > 0 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-900/25">
                          <div className="flex items-center gap-1.5">
                            <AlertTriangle className="size-3.5 text-amber-500" aria-hidden />
                            <p className="text-xs font-semibold">容易踩的坑</p>
                          </div>
                          <ul className="mt-1.5 space-y-1">
                            {g.pitfalls.map((p, i) => (
                              <li key={i} className="text-xs">
                                · {p}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {g.state != null && (
                        <p className="text-xs dim">
                          练过 {g.reps} 次{g.due ? ` · 下次 ${g.due.slice(0, 10)}` : ''}
                        </p>
                      )}
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

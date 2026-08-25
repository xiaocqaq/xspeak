'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { Badge, Card, Empty, ErrorNote, PageHeader, Progress, Spinner } from '@/components/ui';
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
    // 单列正文，拉到 76rem 只会让一行长到读不下去，自己收窄
    <div className="mx-auto max-w-[var(--content-w)] space-y-4 py-2 fade-up">
      <PageHeader eyebrow="Grammar" title="语法">
        每天一个点，和单词一样进复习队列 —— 讲过一遍不等于会用。
      </PageHeader>

      <Card>
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-[var(--text-title)]">已经过过一遍</span>
          <span className="text-sm tabular-nums dim">
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
                    {/*
                      序号章。没学过是空心的（描边 + 纸底），学过才填色 ——
                      这样一眼扫下来，实心的那些就是已经走过的进度。
                    */}
                    <span
                      className={cn(
                        'mt-0.5 grid size-6 shrink-0 place-items-center rounded-md text-[11px] font-semibold tabular-nums',
                        g.state == null
                          ? 'border border-[var(--border)] bg-[var(--bg-sidebar)] text-[var(--text-faint)]'
                          : g.state === 3
                            ? 'bg-[var(--danger)] text-white'
                            : g.state === 2
                              ? 'bg-[var(--accent-bar)] text-white'
                              : 'bg-warm-500 text-white',
                      )}
                    >
                      {g.ord}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold text-[var(--text-title)]">{g.title_zh}</span>
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
                    <div className="space-y-3 border-t border-[var(--hairline)] p-4 fade-up">
                      {/* 句型是"公式"，给它一条左边线，像书里引的一行代码 */}
                      {g.pattern && (
                        <p className="en rounded-r-md border-l-2 border-[var(--accent-bar)] bg-[var(--bg-sidebar)] px-3 py-2 text-sm font-medium text-[var(--text-title)]">
                          {g.pattern}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-body)]">
                        {g.explain_zh}
                      </p>

                      {g.examples.length > 0 && (
                        <div className="space-y-2">
                          {g.examples.map((ex, i) => (
                            <div
                              key={i}
                              className="rounded-lg border border-[var(--hairline)] bg-[var(--bg-sidebar)] p-2.5"
                            >
                              <div className="flex items-start gap-1.5">
                                <TappableText text={ex.en} className="flex-1 text-sm" />
                                <Speak text={ex.en} className="p-0.5" />
                              </div>
                              <p className="mt-1 text-xs dim">{ex.zh}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {g.pitfalls.length > 0 && (
                        <div className="rounded-lg border border-warm-200 bg-warm-50 p-3 dark:border-warm-800 dark:bg-warm-900/25">
                          <div className="flex items-center gap-1.5">
                            <AlertTriangle className="size-3.5 text-warm-500" aria-hidden />
                            <p className="text-xs font-semibold text-warm-700 dark:text-warm-300">容易踩的坑</p>
                          </div>
                          <ul className="mt-1.5 space-y-1">
                            {g.pitfalls.map((p, i) => (
                              <li key={i} className="text-xs leading-relaxed text-[var(--text-body)]">
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

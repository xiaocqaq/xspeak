'use client';

import { useCallback, useEffect, useState } from 'react';
import { RotateCcw, Search, Star, Trash2 } from 'lucide-react';
import { Badge, Button, Card, Empty, ErrorNote, Input, Spinner } from '@/components/ui';
import { LookupCard, Speak } from '@/components/stages/shared';
import { apiGet, apiPost } from '@/lib/fetcher';
import type { VocabEntry } from '@/lib/types';
import { cn } from '@/lib/cn';

type Item = VocabEntry & { nextIntervals: Record<number, string> | null };

const FILTERS = [
  { k: 'all', zh: '全部' },
  { k: 'due', zh: '待复习' },
  { k: 'learning', zh: '学习中' },
  { k: 'mature', zh: '已掌握' },
  { k: 'starred', zh: '标星' },
  { k: 'new', zh: '没学过' },
] as const;

/** 生词本。能看到每个词的调度状态和"主动用出过几次"—— 后者才是真掌握的信号。 */
export function VocabPage() {
  const [filter, setFilter] = useState<string>('all');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<string | null>(null);
  const [addTerm, setAddTerm] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await apiGet<{ items: Item[] }>(
        `/api/words?filter=${filter}&q=${encodeURIComponent(q)}`,
      );
      setItems(d.items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [filter, q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const act = async (action: 'star' | 'reset' | 'remove', wordId: number) => {
    try {
      await apiPost('/api/words', { action, wordIds: [wordId] });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-4 py-2 fade-up">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">词库</h1>
        <p className="mt-1.5 text-sm dim">
          “用出次数”比“复习次数”更能说明你会不会用这个词。
        </p>
      </header>

      <Card className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (addTerm.trim()) setLookup(addTerm.trim());
          }}
        >
          <Input
            value={addTerm}
            onChange={(e) => setAddTerm(e.target.value)}
            placeholder="查个词并加进来，比如 grab"
            aria-label="查词"
          />
          <Button type="submit" disabled={!addTerm.trim()} className="shrink-0">
            查词
          </Button>
        </form>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 dim" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="在词库里搜"
            className="pl-9"
            aria-label="搜索词库"
          />
        </div>
      </Card>

      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.k}
            type="button"
            onClick={() => setFilter(f.k)}
            aria-pressed={filter === f.k}
            className={cn(
              'shrink-0 rounded-full px-3.5 py-1.5 text-sm transition-colors',
              filter === f.k
                ? 'bg-brand-600 text-white'
                : 'bg-[var(--surface-2)] text-[var(--text-dim)] hover:text-[var(--text)]',
            )}
          >
            {f.zh}
          </button>
        ))}
      </div>

      {error && <ErrorNote message={error} onRetry={load} />}
      {items === null ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Empty
          title={q ? '没搜到' : '这个分类下还没有词'}
          hint={q ? '换个词试试，或者用上面的查词加进来' : '学完今天的新词就会出现在这里'}
        />
      ) : (
        <>
          <p className="text-xs dim">{items.length} 个词</p>
          <ul className="space-y-2">
            {items.map((it) => (
              <li key={it.id}>
                <Card className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setLookup(it.term)}
                          className="en text-base font-semibold hover:underline"
                        >
                          {it.term}
                        </button>
                        <Speak text={it.term} className="p-0.5" />
                        {it.phonetic && <span className="en text-xs dim">{it.phonetic}</span>}
                        <StateBadge item={it} />
                      </div>
                      <p className="mt-0.5 truncate text-sm">{it.meaning_zh}</p>
                      {it.example_en && (
                        <p className="en mt-1 truncate text-xs dim">{it.example_en}</p>
                      )}
                      {it.progress && (
                        <p className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] dim">
                          <span>复习 {it.progress.reps} 次</span>
                          <span
                            className={cn(
                              it.progress.produced_count > 0 && 'text-emerald-600 dark:text-emerald-400',
                            )}
                          >
                            用出 {it.progress.produced_count} 次
                          </span>
                          {it.progress.lapses > 0 && <span>忘过 {it.progress.lapses} 次</span>}
                          <span>下次 {it.progress.due.slice(5, 10)}</span>
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => act('star', it.id)}
                        aria-label={it.progress?.starred ? '取消标星' : '标星'}
                        className="rounded-lg p-1.5 hover:bg-[var(--surface-2)]"
                      >
                        <Star
                          className={cn(
                            'size-4',
                            it.progress?.starred
                              ? 'fill-amber-400 text-amber-400'
                              : 'text-[var(--text-dim)]',
                          )}
                          aria-hidden
                        />
                      </button>
                      {it.progress && (
                        <>
                          <button
                            type="button"
                            onClick={() => act('reset', it.id)}
                            aria-label="重置进度"
                            title="从头开始学这个词"
                            className="rounded-lg p-1.5 text-[var(--text-dim)] hover:bg-[var(--surface-2)]"
                          >
                            <RotateCcw className="size-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => act('remove', it.id)}
                            aria-label="从生词本移除"
                            className="rounded-lg p-1.5 text-[var(--text-dim)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      {lookup && (
        <LookupCard
          term={lookup}
          onClose={() => {
            setLookup(null);
            setAddTerm('');
            load();
          }}
        />
      )}
    </div>
  );
}

function StateBadge({ item }: { item: Item }) {
  if (!item.progress) return <Badge>没学过</Badge>;
  const { state, produced_count } = item.progress;
  // state: 0=新 1=学习中 2=复习 3=重新学
  if (state === 3) return <Badge tone="danger">重新学</Badge>;
  if (state === 2) {
    return produced_count > 0 ? <Badge tone="success">已掌握</Badge> : <Badge tone="brand">认得，还没用过</Badge>;
  }
  if (state === 1) return <Badge tone="warm">学习中</Badge>;
  return <Badge>待开始</Badge>;
}

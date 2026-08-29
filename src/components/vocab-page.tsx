'use client';

import { useCallback, useEffect, useState } from 'react';
import { RotateCcw, Search, Star, Trash2 } from 'lucide-react';
import { Badge, Button, Card, Empty, ErrorNote, Input, PageHeader, Spinner } from '@/components/ui';
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
      <PageHeader eyebrow="Vocabulary" title="词库">
        “用出次数”比“复习次数”更能说明你会不会用这个词。
      </PageHeader>

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
              // 筛选片是描边的方角小牌，不是胶囊：胶囊在这套纸感体系里只留给徽标
              'shrink-0 rounded-md border px-3 py-1.5 text-[13px] transition-colors duration-200',
              '[transition-timing-function:var(--ease-standard)]',
              filter === f.k
                ? 'border-[var(--accent-bar)] bg-[var(--accent-bar)] font-semibold text-white'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-title)]',
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
          <p className="text-xs tabular-nums dim">{items.length} 个词</p>
          {/*
            词卡在宽屏排两列。一条词卡的内容（词形 + 一行释义 + 一行例句）
            撑不满 830px，单列的结果是右边空一半、而且几十个词要滚很久。

            两个 minmax(0,…) 和 li 上的 min-w-0 都是必需的，不是保险：
            网格项的默认 min-width 是 auto，也就是"不小于内容的最小尺寸"。
            释义那行是 truncate（nowrap），它的最小尺寸等于整行文字的宽度 ——
            词典里最长的一条释义有 99 个字符宽（"在前台办入住/登记。到了酒店…"，
            全中文没有空格可断），于是网格轨道被顶到 700px 上下，
            手机上整页跟着横向溢出。min-w-0 把这个下限压回 0，truncate 才生效。
          */}
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {items.map((it) => (
              <li key={it.id} className="min-w-0">
                {/*
                  一条词卡分三层：认读（词形/音标/状态）→ 释义例句 → 进度和操作。
                  操作图标刻意不再竖排成一列 —— 那样每条卡片都被撑到三个图标的高度，
                  而这些操作（重置、移除）一年用不到几次，不该占据和内容同等的版面。
                */}
                <Card className="p-4">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        <button
                          type="button"
                          onClick={() => setLookup(it.term)}
                          className="en text-[17px] font-semibold text-[var(--text-title)] hover:underline"
                        >
                          {it.term}
                        </button>
                        <Speak text={it.term} className="p-0.5" />
                        {it.phonetic && <span className="en text-xs dim">{it.phonetic}</span>}
                        <StateBadge item={it} />
                      </div>
                      <p className="mt-1 truncate text-sm text-[var(--text-body)]">{it.meaning_zh}</p>
                      {/* 例句用衬线斜体，和释义区分开：一句是解释，一句是引文 */}
                      {it.example_en && (
                        <p className="en serif mt-1 truncate text-[13px] italic text-[var(--text-secondary)]">
                          {it.example_en}
                        </p>
                      )}
                    </div>

                    {/* 标星是这个词的属性，不是一次性动作，所以放在最显眼的右上角 */}
                    <button
                      type="button"
                      onClick={() => act('star', it.id)}
                      aria-label={it.progress?.starred ? '取消标星' : '标星'}
                      className="-mr-1 -mt-1 shrink-0 rounded-md p-2 transition-colors hover:bg-[var(--surface-hover)]"
                    >
                      <Star
                        className={cn(
                          'size-4',
                          it.progress?.starred
                            ? 'fill-warm-400 text-warm-500'
                            : 'text-[var(--text-faint)]',
                        )}
                        aria-hidden
                      />
                    </button>
                  </div>

                  {it.progress && (
                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--hairline)] pt-2">
                      <p className="flex min-w-0 flex-wrap gap-x-3 text-[11px] tabular-nums dim">
                        <span>复习 {it.progress.reps} 次</span>
                        <span
                          className={cn(
                            it.progress.produced_count > 0 && 'font-semibold text-[var(--success)]',
                          )}
                        >
                          用出 {it.progress.produced_count} 次
                        </span>
                        {it.progress.lapses > 0 && <span>忘过 {it.progress.lapses} 次</span>}
                        <span>下次 {it.progress.due.slice(5, 10)}</span>
                      </p>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => act('reset', it.id)}
                          aria-label="重置进度"
                          title="从头开始学这个词"
                          className="rounded-md p-1.5 text-[var(--text-faint)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-title)]"
                        >
                          <RotateCcw className="size-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => act('remove', it.id)}
                          aria-label="从生词本移除"
                          className="rounded-md p-1.5 text-[var(--text-faint)] transition-colors hover:bg-[color-mix(in_srgb,var(--danger)_12%,var(--surface))] hover:text-[var(--danger)]"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      </div>
                    </div>
                  )}
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

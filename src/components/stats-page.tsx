'use client';

import { useEffect, useState } from 'react';
import { Check, Flame, MessageSquare, Mic, TrendingUp } from 'lucide-react';
import { Badge, Button, Card, Empty, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { DayBars } from '@/components/charts';
import { apiGet, apiPatch } from '@/lib/fetcher';
import { STAGES, type MistakeRow, type StatsSummary } from '@/lib/types';
import { cn } from '@/lib/cn';

type Stats = {
  summary: StatsSummary;
  forecast: { day: string; c: number }[];
  speech: { avg: number | null; count: number };
  /** 近 30 天开口时长（分钟）和对话轮数 */
  talk: { minutes: number; turns: number };
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
  reading: '阅读',
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

  return (
    <div className="space-y-4 py-2 fade-up">
      <PageHeader eyebrow="Progress" title="数据">
        看留存率和错题，不看打卡天数 —— 前者才说明有没有真的记住。
      </PageHeader>

      {error && <ErrorNote message={error} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Big icon={<Flame className="size-4 text-warm-500" />} label="连续学习" value={`${s.streak} 天`} />
        <Big
          icon={<TrendingUp className="size-4 text-brand-500" />}
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
        {/* 写作环节去掉后这一格换成开口时长 —— 现在的收尾环节是口语，看这个更对得上 */}
        <Big
          icon={<MessageSquare className="size-4 text-brand-500" />}
          label="30 天开口"
          value={d.talk.minutes === 0 ? '—' : `${d.talk.minutes} 分`}
          hint={`${d.talk.turns} 轮对话`}
        />
      </div>

      {/*
        宽屏分两列：左边是图（词汇状态、过去 14 天、未来 14 天），右边是清单
        （错题本、学习记录）。图都很矮，单列时它们各占一条、右边空一半；
        清单反而很长，两者叠在一列就得滚半天才看到错题。
      */}
      <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
        <div className="space-y-4">
          <Card>
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm">词汇状态</h2>
              <span className="text-xs dim">共 {s.totalWords} 个</span>
            </div>
            {/* 进度条压扁到 8px 并收成小圆角：细长的一条比胖胶囊更像印在纸上的图表 */}
            <div className="mt-3 flex h-2 overflow-hidden rounded-sm bg-[var(--surface-2)]">
              <Bar n={s.matureWords} total={s.totalWords} className="bg-[var(--accent-bar)]" />
              <Bar n={s.learningWords} total={s.totalWords} className="bg-warm-500" />
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
              <Legend className="bg-[var(--accent-bar)]" label="记住了" n={s.matureWords} />
              <Legend className="bg-warm-500" label="学习中" n={s.learningWords} />
              <Legend className="bg-[var(--surface-2)]" label="待开始" n={Math.max(0, s.totalWords - s.matureWords - s.learningWords)} />
            </div>
            <p className="mt-3 text-xs dim">
              今天主动用出 <span className="font-semibold tabular-nums text-[var(--text-title)]">{s.producedToday}</span> 个词。
              说出口、写进句子才算会用，认得不算。
            </p>
          </Card>

          <Card>
            <h2 className="text-sm">最近 14 天</h2>
            <DayBars
              className="mt-3"
              height={96}
              ariaLabel="最近 14 天每天的复习次数"
              leftLabel={s.last14[0]?.day.slice(5)}
              rightLabel="今天"
              data={s.last14.map((x) => ({
                day: x.day,
                value: x.reviews,
                tip: `${x.reviews} 次 · ${Math.round(x.minutes)} 分`,
              }))}
            />
          </Card>

          <Card>
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm">未来 14 天复习量</h2>
              <span className="text-xs dim">今天到期 {s.dueToday}</span>
            </div>
            <DayBars
              className="mt-3"
              height={64}
              ariaLabel="未来 14 天每天到期的词数"
              leftLabel="今天"
              rightLabel="+14 天"
              warnAbove={40}
              data={d.forecast.map((f) => ({
                day: f.day,
                value: f.c,
                // 超过 40 个的日子标暖色：那天负担重，可以少加新词
                tone: f.c > 40 ? ('warn' as const) : ('normal' as const),
                tip: `${f.c} 个`,
              }))}
            />
            <p className="mt-2 text-xs dim">赭黄是超过 40 个的日子，那天可以少加新词。</p>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm">错题本</h2>
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
                  <li key={m.id} className="rounded-lg border border-[var(--hairline)] bg-[var(--bg-sidebar)] p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge>{KIND_ZH[m.kind] ?? m.kind}</Badge>
                          {m.times > 1 && <Badge tone="danger">错 {m.times} 次</Badge>}
                        </div>
                        {/* 错的划掉、对的跟一行：不写"错误/正确"两个标签，形态本身已经说清楚了 */}
                        <p className="en mt-1.5 text-sm text-[var(--text-secondary)] line-through decoration-[var(--danger)]">
                          {m.wrong}
                        </p>
                        {m.correct && (
                          <p className="en text-sm font-medium text-[var(--text-title)]">{m.correct}</p>
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
            <h2 className="text-sm">学习记录</h2>
            {d.sessions.length === 0 ? (
              <Empty title="还没有记录" hint="去首页开始今天的 30 分钟。" />
            ) : (
              <ul className="mt-3 divide-y divide-[var(--hairline)]">
                {d.sessions.map((x) => (
                  <li key={x.day} className="flex items-center gap-3 py-2.5">
                    <span className="w-14 shrink-0 text-xs tabular-nums dim">{x.day.slice(5)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-body)]">{x.themeZh}</span>
                    <span className="shrink-0 text-xs tabular-nums dim">{x.minutes} 分</span>
                    {x.completed ? (
                      <Badge tone="success">完成</Badge>
                    ) : (
                      /* 环节数跟着 STAGES 走，别写死 —— 去掉写作之后这里曾经一直显示 /7 */
                      <Badge tone="warm">
                        {x.stagesDone}/{STAGES.length}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
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
      {/* 数字是这张卡唯一的主角，用衬线大字撑住；tabular-nums 保证四张卡的数字对齐 */}
      <p className="serif mt-1.5 text-[26px] font-bold leading-none tabular-nums text-[var(--text-title)]">
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[11px] dim">{hint}</p>}
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
      <span className={cn('size-2 rounded-[2px]', className)} aria-hidden />
      {label} {n}
    </span>
  );
}

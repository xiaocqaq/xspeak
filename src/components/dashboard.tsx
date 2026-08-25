'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileInput,
  Flame,
  Ruler,
  Settings,
  Sparkles,
} from 'lucide-react';
import { Badge, Button, Card, ErrorNote, Progress, Spinner } from '@/components/ui';
import { DayBars } from '@/components/charts';
import { apiGet } from '@/lib/fetcher';
import { STAGE_META, STAGES, type Stage, type StatsSummary } from '@/lib/types';
import { cn } from '@/lib/cn';

type TodayData = {
  session: {
    id: number;
    day: string;
    themeZh: string;
    themeEn: string;
    stagesDone: Stage[];
    minutesSpent: number;
    completedAt: string | null;
  };
  reviewWords: { id: number; term: string; meaning_zh: string }[];
  targetWords: { id: number; term: string; meaning_zh: string; phonetic: string | null }[];
  grammar: { id: number; title_zh: string; title_en: string; cefr: string } | null;
  stats: StatsSummary;
  user: { name: string; onboarded: boolean; dailyMinutes: number };
};

export function Dashboard() {
  const router = useRouter();
  const [data, setData] = useState<TodayData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    apiGet<TodayData>('/api/session/today')
      .then((d) => {
        if (!d.user.onboarded) {
          router.replace('/onboarding');
          return;
        }
        setData(d);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(load, []);

  if (error) return <ErrorNote message={error} onRetry={load} />;
  if (!data) return <div className="pt-20"><Spinner label="正在准备今天的内容" /></div>;

  const { session, stats, reviewWords, targetWords, grammar } = data;
  const done = session.stagesDone.length;
  const finished = Boolean(session.completedAt);
  const nextStage = STAGES.find((s) => !session.stagesDone.includes(s));

  return (
    <div className="space-y-4 fade-up">
      <header className="flex items-start justify-between gap-3 pt-2">
        <div>
          <p className="text-sm dim">{formatDay(session.day)}</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">
            {greeting()}，{data.user.name}
          </h1>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="/import"
            aria-label="导入素材"
            className="rounded-lg p-2 text-[var(--text-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
          >
            <FileInput className="size-5" aria-hidden />
          </Link>
          <Link
            href="/settings"
            aria-label="设置"
            className="rounded-lg p-2 text-[var(--text-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
          >
            <Settings className="size-5" aria-hidden />
          </Link>
        </div>
      </header>

      {/* 今日主线 */}
      <Card className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-brand-100 opacity-60 blur-2xl dark:bg-brand-800/40"
          aria-hidden
        />
        <div className="relative">
          <div className="flex items-center justify-between gap-3">
            <Badge tone="brand">今日主题</Badge>
            <span className="text-xs dim">
              {done}/{STAGES.length} 环节 · 约 {data.user.dailyMinutes} 分钟
            </span>
          </div>
          <h2 className="mt-3 text-xl font-semibold">{session.themeZh}</h2>
          <p className="en mt-0.5 text-sm dim">{session.themeEn}</p>

          <Progress value={(done / STAGES.length) * 100} className="mt-4" />

          <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Stat label="待复习" value={String(stats.dueToday)} />
            <Stat label="新词" value={String(targetWords.length)} />
            <Stat label="连续天数" value={`${stats.streak} 天`} />
            <Stat label="今日用时" value={`${Math.round(session.minutesSpent)} 分`} />
          </div>

          <Button
            size="lg"
            className="mt-5 w-full"
            onClick={() => router.push(finished ? '/learn' : `/learn?stage=${nextStage ?? 'warmup'}`)}
          >
            {finished ? (
              <>
                <CheckCircle2 className="size-5" aria-hidden />
                今天已完成，再练一轮
              </>
            ) : done > 0 ? (
              <>
                继续「{STAGE_META[nextStage!].zh}」
                <ArrowRight className="size-5" aria-hidden />
              </>
            ) : (
              <>
                开始今天的 30 分钟
                <ArrowRight className="size-5" aria-hidden />
              </>
            )}
          </Button>
        </div>
      </Card>

      {/* 环节清单 */}
      <Card>
        <h3 className="text-sm font-semibold">今天这样走</h3>
        <ol className="mt-3 space-y-1.5">
          {STAGES.map((s, i) => {
            const isDone = session.stagesDone.includes(s);
            const isNext = s === nextStage;
            return (
              <li key={s}>
                <Link
                  href={`/learn?stage=${s}`}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2 transition-colors',
                    isNext ? 'bg-brand-50 dark:bg-brand-900/30' : 'hover:bg-[var(--surface-2)]',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
                      isDone
                        ? 'bg-brand-500 text-white'
                        : isNext
                          ? 'bg-brand-600 text-white'
                          : 'bg-[var(--surface-2)] text-[var(--text-dim)]',
                    )}
                  >
                    {isDone ? '✓' : i + 1}
                  </span>
                  <span className={cn('flex-1 text-sm', isDone && 'dim line-through')}>
                    {STAGE_META[s].zh}
                  </span>
                  <span className="text-xs dim">{STAGE_META[s].minutes} 分</span>
                </Link>
              </li>
            );
          })}
        </ol>
      </Card>

      {/* 今天会碰到什么 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-brand-500" aria-hidden />
            <h3 className="text-sm font-semibold">今天的新词</h3>
          </div>
          {targetWords.length === 0 ? (
            <p className="mt-3 text-sm dim">内置词库这个主题的词已经学完了，进入环节时会用 AI 补新词。</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {targetWords.map((w) => (
                <li key={w.id} className="flex items-baseline gap-2 text-sm">
                  <span className="en font-medium">{w.term}</span>
                  <span className="truncate dim">{w.meaning_zh}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="flex items-center gap-2">
            <Flame className="size-4 text-warm-500" aria-hidden />
            <h3 className="text-sm font-semibold">到期要复习</h3>
          </div>
          {reviewWords.length === 0 ? (
            <p className="mt-3 text-sm dim">今天没有到期的词。热身环节会直接跳过。</p>
          ) : (
            <>
              <p className="mt-3 text-sm dim">
                共 {reviewWords.length} 个，会放进全新句子里考你，不是原来那句。
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {reviewWords.slice(0, 12).map((w) => (
                  <span key={w.id} className="en rounded-md bg-[var(--surface-2)] px-2 py-0.5 text-xs">
                    {w.term}
                  </span>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      {grammar && (
        <Card>
          <div className="flex items-center gap-2">
            <Ruler className="size-4 text-brand-500" aria-hidden />
            <h3 className="text-sm font-semibold">今天的语法点</h3>
            <Badge>{grammar.cefr}</Badge>
          </div>
          <p className="mt-2 text-sm">{grammar.title_zh}</p>
          <p className="en text-sm dim">{grammar.title_en}</p>
          <Link href="/grammar" className="mt-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:underline dark:text-brand-300">
            看全部语法进度 <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </Card>
      )}

      {stats.openMistakes > 0 && (
        <Card className="border-warm-200 dark:border-warm-900/60">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-warm-500" aria-hidden />
            <div>
              <h3 className="text-sm font-semibold">有 {stats.openMistakes} 个错误还没消掉</h3>
              <p className="mt-1 text-sm dim">
                这些会被塞进接下来几天的练习里重新考你 —— 不会提前告诉你是哪个。
              </p>
              <Link href="/stats" className="mt-2 inline-flex items-center gap-1 text-sm text-brand-600 hover:underline dark:text-brand-300">
                查看错误本 <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex items-center gap-2">
          <Clock className="size-4 dim" aria-hidden />
          <h3 className="text-sm font-semibold">最近两周</h3>
        </div>
        <DayBars
          className="mt-3"
          height={64}
          ariaLabel="最近 14 天每天的复习次数"
          data={stats.last14.map((x) => ({
            day: x.day,
            value: x.reviews,
            tip: `${x.reviews} 次 · ${Math.round(x.minutes)} 分`,
          }))}
        />
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs dim">
          <span>已掌握 {stats.matureWords} 词</span>
          <span>学习中 {stats.learningWords} 词</span>
          <span>主动用出 {stats.producedToday} 次（今天）</span>
          {stats.retention30 != null && <span>30 天记牢率 {stats.retention30}%</span>}
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--surface-2)] px-3 py-2">
      <p className="text-xs dim">{label}</p>
      <p className="mt-0.5 font-semibold">{value}</p>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 19) return '下午好';
  return '晚上好';
}

function formatDay(day: string) {
  const [, m, d] = day.split('-');
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(day).getDay()];
  return `${Number(m)} 月 ${Number(d)} 日 ${week ?? ''}`;
}

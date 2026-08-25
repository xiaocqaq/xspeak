'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Clock, Flame, Ruler, Sparkles } from 'lucide-react';
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
  targetWords: {
    id: number;
    term: string;
    meaning_zh: string;
    phonetic: string | null;
  }[];
  grammar: {
    id: number;
    title_zh: string;
    title_en: string;
    cefr: string;
  } | null;
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
  if (!data)
    return (
      <div className="pt-20">
        <Spinner label="正在准备今天的内容" />
      </div>
    );

  const { session, stats, reviewWords, targetWords, grammar } = data;
  const done = session.stagesDone.length;
  const finished = Boolean(session.completedAt);
  const nextStage = STAGES.find((s) => !session.stagesDone.includes(s));

  return (
    <div className="space-y-4 fade-up">
      {/*
        导入/设置两个入口挪到侧栏了，这里不再放图标按钮 ——
        首屏留给"今天要做什么"，越干净越好。
      */}
      <header>
        <p className="section-label">{formatDay(session.day)}</p>
        <h1 className="mt-2 text-[30px] sm:text-[34px]">
          {greeting()}，{data.user.name}
        </h1>
        <p className="mt-2 max-w-[52ch] text-[15px] text-[var(--text-secondary)]">
          {finished
            ? '今天的六个环节都走完了，想再练一轮随时可以。'
            : `今天围绕「${session.themeZh}」走六个环节，大约 ${data.user.dailyMinutes} 分钟。`}
        </p>
      </header>

      {/*
        宽屏分两列：左边"今天要做什么"（主题卡 + 环节清单），右边是参考信息
        （新词、到期词、语法点、错题、两周曲线）。

        原来这些是一条竖流，首页要滚三屏才能看完，而"今天学什么词"这种
        瞟一眼的东西被埋在最下面。xl 以下仍然是原来的顺序。
      */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] xl:items-start">
        <div className="space-y-4">
          {/*
            今日主线。
            原来这里有一团模糊的主色光斑做装饰，纸感体系里不用那个 ——
            改成左侧一条主色竖边，靠结构而不是光效把"这是主卡片"说清楚。
          */}
          <Card className="relative overflow-hidden">
            <span className="absolute inset-y-0 left-0 w-[3px] bg-[var(--accent-bar)]" aria-hidden />
            <div className="relative">
              <div className="flex items-center justify-between gap-3">
                <Badge tone="brand">今日主题</Badge>
                <span className="text-xs tabular-nums dim">
                  {done}/{STAGES.length} 环节
                </span>
              </div>
              <h2 className="serif mt-3 text-[22px] font-bold">{session.themeZh}</h2>
              <p className="en mt-1 text-sm dim">{session.themeEn}</p>

              <Progress value={(done / STAGES.length) * 100} className="mt-5" />

              <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <Stat label="待复习" value={String(stats.dueToday)} />
                <Stat label="新词" value={String(targetWords.length)} />
                <Stat label="连续天数" value={`${stats.streak} 天`} />
                <Stat label="今日用时" value={`${Math.round(session.minutesSpent)} 分`} />
              </div>

              <Button
                size="lg"
                className="mt-5 w-full"
                onClick={() =>
                  router.push(finished ? '/learn' : `/learn?stage=${nextStage ?? 'warmup'}`)
                }
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

          {/*
            环节清单。
            改成一个容器 + 分隔线的列表，而不是六个各带底色的圆角块 ——
            后者在纸面上会显得碎，分隔线才是读物的分组方式。
          */}
          <Card className="p-0 sm:p-0">
            <h2 className="border-b border-[var(--hairline)] px-5 py-3.5 text-sm">今天这样走</h2>
            <ol className="divide-y divide-[var(--hairline)]">
              {STAGES.map((s, i) => {
                const isDone = session.stagesDone.includes(s);
                const isNext = s === nextStage;
                return (
                  <li key={s}>
                    <Link
                      href={`/learn?stage=${s}`}
                      className={cn(
                        'flex items-center gap-3 px-5 py-3 transition-colors',
                        'hover:bg-[var(--surface-hover)]',
                        isNext && 'bg-[var(--surface-active)]',
                      )}
                    >
                      <span
                        className={cn(
                          // 序号章是方角小牌（圆形实心块站里只留给通话按钮），没走到的空心
                          'grid size-[22px] shrink-0 place-items-center rounded-md text-[11px] font-semibold tabular-nums',
                          isDone
                            ? 'bg-[var(--accent-bar)] text-white'
                            : isNext
                              ? 'bg-brand-600 text-white'
                              : 'border border-[var(--border)] bg-[var(--bg-sidebar)] text-[var(--text-faint)]',
                        )}
                      >
                        {isDone ? '✓' : i + 1}
                      </span>
                      <span
                        className={cn(
                          'flex-1 text-sm',
                          isNext && 'font-semibold text-brand-600',
                          isDone && !isNext && 'dim',
                        )}
                      >
                        {STAGE_META[s].zh}
                      </span>
                      <span className="text-[11.5px] tabular-nums dim">{STAGE_META[s].minutes}′</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>

        <div className="space-y-4">
          {/* 今天会碰到什么。分栏之后右列本身就窄，这里不再套第二层两列 */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <Card>
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-brand-600" strokeWidth={1.8} aria-hidden />
                <h3 className="text-sm">今天的新词</h3>
              </div>
              {targetWords.length === 0 ? (
                <p className="mt-3 text-sm dim">
                  内置词库这个主题的词已经学完了，进入环节时会用 AI 补新词。
                </p>
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
                <Flame className="size-4 text-warm-500" strokeWidth={1.8} aria-hidden />
                <h3 className="text-sm">到期要复习</h3>
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
                      <span
                        key={w.id}
                        className="en rounded-md border border-[var(--border)] bg-[var(--bg-sidebar)] px-2 py-0.5 text-xs"
                      >
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
                <Ruler className="size-4 text-brand-600" strokeWidth={1.8} aria-hidden />
                <h3 className="text-sm">今天的语法点</h3>
                <Badge>{grammar.cefr}</Badge>
              </div>
              <p className="mt-2.5 text-sm text-[var(--text-body)]">{grammar.title_zh}</p>
              <p className="en text-sm dim">{grammar.title_en}</p>
              <Link
                href="/grammar"
                className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--link)] hover:underline"
              >
                看全部语法进度 <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </Card>
          )}

          {/* 提示卡：底色染一点赭黄，比只换描边颜色更容易被注意到 */}
          {stats.openMistakes > 0 && (
            <Card className="border-warm-200 bg-warm-50 dark:border-warm-800 dark:bg-warm-900/20">
              <div className="flex items-start gap-3">
                <AlertCircle
                  className="mt-0.5 size-5 shrink-0 text-warm-500"
                  strokeWidth={1.8}
                  aria-hidden
                />
                <div>
                  <h3 className="text-sm">有 {stats.openMistakes} 个错误还没消掉</h3>
                  <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
                    这些会被塞进接下来几天的练习里重新考你 —— 不会提前告诉你是哪个。
                  </p>
                  <Link
                    href="/stats"
                    className="mt-2.5 inline-flex items-center gap-1 text-sm font-semibold text-[var(--link)] hover:underline"
                  >
                    查看错误本 <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                </div>
              </div>
            </Card>
          )}

          <Card>
            <div className="flex items-center gap-2">
              <Clock className="size-4 dim" strokeWidth={1.8} aria-hidden />
              <h3 className="text-sm">最近两周</h3>
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
      </div>
    </div>
  );
}

/** 四个小数字。描边 + 纸底，不用 fill 色块 —— 和卡片同族但比它浅一层。 */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-sidebar)] px-3 py-2.5">
      <p className="text-[11.5px] dim">{label}</p>
      <p className="mt-1 font-serif text-[17px] font-bold tabular-nums text-[var(--text-title)]">
        {value}
      </p>
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

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Menu, PartyPopper, RefreshCw } from 'lucide-react';
import { Button, Card, ErrorNote } from '@/components/ui';
import { StageLoading } from './shared';
import { StageDrawer, StageSidebar } from './stage-nav';
import { WarmupStage } from './warmup';
import { NewWordsStage } from './newwords';
import { GrammarStage } from './grammar';
import { ListeningStage } from './listening';
import { ReadingStage } from './reading';
import { SpeakingStage } from './speaking';
import type { ReviewBody, StageMeta } from './types';
import { apiGet, apiPost } from '@/lib/fetcher';
import { STAGES, STAGE_META, type Stage } from '@/lib/types';
import { cn } from '@/lib/cn';

type StageResponse = StageMeta & { payload: unknown };

/** 六个环节串成一条线。每个环节做完提交学习数据，然后自动进下一个。 */
export function SessionRunner() {
  const router = useRouter();
  const params = useSearchParams();
  const urlStage = params.get('stage') as Stage | null;
  const [stage, setStage] = useState<Stage>(
    urlStage && STAGES.includes(urlStage) ? urlStage : 'warmup',
  );
  const [data, setData] = useState<StageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [allDone, setAllDone] = useState(false);
  /** 手机上环节抽屉是否开着 */
  const [navOpen, setNavOpen] = useState(false);
  const enteredAt = useRef(Date.now());

  // 已经预取过的环节，避免重复打 AI
  const prefetched = useRef<Set<Stage>>(new Set());

  /**
   * 提前把下一个环节生成好。后端会缓存生成结果，
   * 所以用户点"下一步"时直接命中缓存（实测 100s → 7ms）。
   * 失败无所谓，正式加载时会再试一次。
   */
  const prefetchNext = useCallback((current: Stage) => {
    const next = STAGES[STAGES.indexOf(current) + 1];
    if (!next || prefetched.current.has(next)) return;
    prefetched.current.add(next);
    apiGet(`/api/session/stage?stage=${next}`).catch(() => {
      prefetched.current.delete(next);
    });
  }, []);

  const load = useCallback(
    async (s: Stage, regenerate = false) => {
      setLoading(true);
      setError(null);
      setData(null);
      enteredAt.current = Date.now();
      try {
        const r = await apiGet<StageResponse>(
          `/api/session/stage?stage=${s}${regenerate ? '&regenerate=1' : ''}`,
        );
        setData(r);
        prefetchNext(s);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [prefetchNext],
  );

  useEffect(() => {
    load(stage);
  }, [stage, load]);

  // 让浏览器前进/后退和环节切换对得上
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('stage') !== stage) {
      url.searchParams.set('stage', stage);
      window.history.replaceState(null, '', url.toString());
    }
  }, [stage]);

  const onDone = async (review?: ReviewBody) => {
    setSubmitting(true);
    const minutes = Math.min(60, (Date.now() - enteredAt.current) / 60000);
    try {
      if (review && hasContent(review)) await apiPost('/api/review', review);
      const r = await apiPost<{ stagesDone: Stage[]; completedAt: string | null }>(
        '/api/session/stage',
        { stage, minutes: Math.round(minutes * 10) / 10 },
      );
      const next = STAGES.find((s) => !r.stagesDone.includes(s));
      if (!next) {
        setAllDone(true);
      } else {
        setStage(next);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (allDone) return <Finished />;

  const info = STAGE_META[stage];

  return (
    /**
     * 环节侧栏是 fixed 的（和全站导航同一个框），所以这里只负责主内容区：
     * 宽屏时整体右移一个侧栏宽度。
     *
     * 这里放宽到 76rem，但**不是**把单列拉宽 —— 英文一行超过 ~70 字符就难读。
     * 多出来的横向空间给环节自己去开第二列（见 shared 里的 Split）：
     * 左边材料、右边动手，每列还是 ~36rem。1280px 以下环节会自动收回单列，
     * 这时容器宽度被内容撑不满，视觉上仍是居中的一栏。
     */
    <div className="lg:pl-[var(--sidebar-w)]">
      <StageSidebar current={stage} done={data?.stagesDone ?? []} onPick={setStage} />
      <StageDrawer
        open={navOpen}
        onClose={() => setNavOpen(false)}
        current={stage}
        done={data?.stagesDone ?? []}
        onPick={setStage}
      />

      <div className="mx-auto min-w-0 max-w-[36rem] space-y-6 xl:max-w-[76rem]">
        <header className="flex items-center gap-2">
          {/* 手机上开抽屉；宽屏侧栏已常驻，这个按钮就不需要了 */}
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="切换环节"
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-lg lg:hidden',
              'border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]',
              'transition-colors hover:bg-[var(--surface-hover)] hover:text-brand-600',
            )}
          >
            <Menu className="size-[15px]" strokeWidth={1.8} aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[22px]">{info.zh}</h1>
            <p className="mt-0.5 truncate text-xs dim">
              {data?.themeZh ?? '今日主题'} · 约 {info.minutes} 分钟
            </p>
          </div>
          <button
            type="button"
            onClick={() => load(stage, true)}
            disabled={loading}
            aria-label="重新生成这一环节"
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-lg text-[var(--text-dim)]',
              'transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-title)]',
              'disabled:opacity-40',
            )}
          >
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} aria-hidden />
          </button>
        </header>
        {/*
          原来这里有一条逐段进度细线。有了侧栅/抽屉后它是重复信息，
          而且两个地方都能切环节反而让人迟疑该点哪个，所以去掉了。
        */}

      {error && <ErrorNote message={error} onRetry={() => load(stage)} />}
      {loading && <StageLoading what={info.zh} />}

      {data && !loading && (
        <StageBody
          /*
           * 用 data.stage 而不是外层的 stage：
           * 切环节时 stage 先变，data 还是上一个环节的，用 stage 分派会把
           * 旧 payload 交给新组件，字段对不上就直接报 undefined.length。
           * data.stage 是后端返回的、和 payload 同一批的值，两者永远一致。
           */
          stage={data.stage}
          data={data}
          onDone={onDone}
          onRegenerate={() => load(stage, true)}
          submitting={submitting}
        />
      )}
      </div>
    </div>
  );
}

function StageBody({
  stage,
  data,
  onDone,
  onRegenerate,
  submitting,
}: {
  stage: Stage;
  data: StageResponse;
  onDone: (r?: ReviewBody) => void;
  onRegenerate: () => void;
  submitting: boolean;
}) {
  const props = { meta: data, onDone, onRegenerate, submitting };
  // payload 的形状由后端 schema 保证，这里按环节分派
  switch (stage) {
    case 'warmup':
      return <WarmupStage {...props} payload={data.payload as never} />;
    case 'newwords':
      return <NewWordsStage {...props} payload={data.payload as never} />;
    case 'grammar':
      return <GrammarStage {...props} payload={data.payload as never} />;
    case 'listening':
      return <ListeningStage {...props} payload={data.payload as never} />;
    case 'reading':
      return <ReadingStage {...props} payload={data.payload as never} />;
    case 'speaking':
      return <SpeakingStage {...props} payload={data.payload as never} />;
  }
}

function Finished() {
  const [stats, setStats] = useState<{ streak: number; producedToday: number; reviewsToday: number } | null>(
    null,
  );
  useEffect(() => {
    apiGet<{ stats: { streak: number; producedToday: number; reviewsToday: number } }>(
      '/api/session/today',
    )
      .then((d) => setStats(d.stats))
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col items-center gap-5 py-16 text-center fade-up">
      <PartyPopper className="size-10 text-[var(--accent-bar)]" aria-hidden />
      <div>
        {/* h1 本身已是衬线 700，这里只给字号 */}
        <h1 className="text-[26px] leading-snug">今天的 30 分钟走完了</h1>
        <p className="mt-2.5 text-sm leading-relaxed dim">
          明天这些词会换成新句子再来一次 —— 换了语境还认得，才是真记住了。
        </p>
      </div>

      {stats && (
        <Card className="w-full">
          {/*
            三个数字用竖分隔线切开，而不是各占一张小卡 ——
            它们是一组读数，形态上就该连在一起。数字沿用站里的衬线大字。
          */}
          <div className="grid grid-cols-3 divide-x divide-[var(--hairline)] text-center">
            <Metric n={stats.streak} label="连续天数" />
            <Metric n={stats.reviewsToday} label="今天复习" />
            <Metric n={stats.producedToday} label="主动用出" />
          </div>
        </Card>
      )}

      <div className="flex w-full gap-2">
        <Link href="/" className="flex-1">
          <Button variant="outline" className="w-full">
            回首页
          </Button>
        </Link>
        <Link href="/chat" className="flex-1">
          <Button className="w-full">再聊两句</Button>
        </Link>
      </div>
    </div>
  );
}

function Metric({ n, label }: { n: number; label: string }) {
  return (
    <div className="px-2">
      <p className="serif text-[26px] font-bold leading-none tabular-nums text-[var(--text-title)]">
        {n}
      </p>
      <p className="mt-1.5 text-xs dim">{label}</p>
    </div>
  );
}

function hasContent(r: ReviewBody): boolean {
  return Boolean(
    r.words?.length ||
      r.grammar?.length ||
      r.produced?.length ||
      r.enroll?.length ||
      r.mistakes?.length ||
      r.speech?.length ||
      r.spokenSeconds,
  );
}

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
  /** 走到最后一环时，前面还漏着哪几环 —— 非空就在结束页列出来 */
  const [allDone, setAllDone] = useState<Stage[] | null>(null);
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
      /*
       * 往后走，不回头。
       *
       * 以前这里是 `STAGES.find((s) => !stagesDone.includes(s))` —— 找的是「第一个
       * 没做的」，不是「当前这个的下一个」。第一天没有到期复习，热身是空态、
       * 走过去也不算 done，于是阅读做完提交，find 从头扫又扫回热身：按钮上写着
       * 「去练口语」，人却被送回复习。
       *
       * 六个环节是有顺序的一条线（热身→新词→语法→听力→阅读→口语），
       * 所以「下一个」只能在自己后面找。侧栏和首页仍然可以直接跳到任意一环，
       * 漏掉的那几环留到结束页统一提示，不在这里悄悄插队。
       */
      const rest = STAGES.slice(STAGES.indexOf(stage) + 1);
      const next = rest.find((s) => !r.stagesDone.includes(s));
      if (!next) {
        setAllDone(STAGES.filter((s) => !r.stagesDone.includes(s)));
      } else {
        setStage(next);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (allDone) return <Finished skipped={allDone} onPick={(s) => { setAllDone(null); setStage(s); }} />;

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

      {/*
        2026-09-27：手机上的垂直预算是稀缺的。
        原来这里是 space-y-6（24px）叠 AppShell 的 pt-6（24px），标题占 47px，
        于是第一张卡片要到 188px 才开始 —— 402×874 的屏上等于 21% 的高度
        花在了「今天这样走 / 环节名 / 今日主题·约5分钟」这三行上，
        而底部的主操作按钮就被挤到了折叠线以下。
        窄屏收紧到 3，标题和副标题也并成一行：信息一个没少，只是不再各占一行。
      */}
      <div className="mx-auto min-w-0 max-w-[36rem] space-y-3 xl:max-w-[76rem] xl:space-y-6">
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
            {/*
              窄屏一行放下「环节名 · 约 N 分钟」，主题留到宽屏再出。
              原来两行共 47px，现在一行 29px —— 省下的 18px 直接还给卡片。
            */}
            <h1 className="flex min-w-0 items-baseline gap-2 text-[20px] xl:text-[22px]">
              <span className="truncate">{info.zh}</span>
              <span className="shrink-0 text-xs font-normal dim xl:hidden">约 {info.minutes} 分钟</span>
            </h1>
            <p className="mt-0.5 truncate text-xs dim max-xl:hidden">
              {data?.themeZh ?? '今日主题'} · 约 {info.minutes} 分钟
            </p>
          </div>
          {/*
            重新生成只留给新词环节。它换词是从词典按 CEFR 等级+词频取的，零 token、
            几十毫秒；其余环节点一下就是重新调一次 AI，十几秒加几千 token ——
            放个随手可点的图标在标题旁边，只会让人无意中反复花钱。
            那些环节要换内容，明天自然是新的；真出错了 ErrorNote 上有重试。
          */}
          {stage === 'newwords' && (
            <button
              type="button"
              onClick={() => load(stage, true)}
              disabled={loading}
              aria-label="换一批词"
              className={cn(
                'grid size-8 shrink-0 place-items-center rounded-lg text-[var(--text-dim)]',
                'transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-title)]',
                'disabled:opacity-40',
              )}
            >
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} aria-hidden />
            </button>
          )}
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

/**
 * 结束页。`skipped` 是走到口语时前面还没做的那几环 —— 一般是空的，
 * 但第一天没有到期复习、或者从侧栏直接跳着做，就会剩下几个。
 * 剩了就不说「走完了」，把它们列出来让人自己决定补不补。
 */
function Finished({ skipped, onPick }: { skipped: Stage[]; onPick: (s: Stage) => void }) {
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
    /*
     * 自己收一个宽度上限（2026-08-29 修）。
     *
     * 这一屏的内容就是「一句话 + 三个读数 + 两个按钮」，是张贺卡。
     * 但它挂在环节页的外层容器里，那层宽屏是 xl:max-w-[76rem]（1216px）——
     * 给六个环节的双栏排版用的。结算页跟着一起变宽，于是卡片被抻到 1216，
     * 三个数字相隔几百像素，按钮长得离谱（用户实测 2560px 视口）。
     *
     * 28rem 是照「读数卡三列还舒服、按钮不至于变成长条」定的，
     * 和站里其它单栏内容（--content-w 52rem）不一样是故意的：那是正文宽度，
     * 这里是一张卡片。
     */
    <div className="mx-auto flex max-w-[28rem] flex-col items-center gap-5 py-16 text-center fade-up">
      <PartyPopper className="size-10 text-[var(--accent-bar)]" aria-hidden />
      <div>
        {/* h1 本身已是衬线 700，这里只给字号 */}
        <h1 className="text-[26px] leading-snug">
          {skipped.length ? '口语练完了' : '今天的 30 分钟走完了'}
        </h1>
        <p className="mt-2.5 text-sm leading-relaxed dim">
          {skipped.length
            ? '前面还剩几环没走，想补随时点；不补也算今天练过了。'
            : '明天这些词会换成新句子再来一次 —— 换了语境还认得，才是真记住了。'}
        </p>
      </div>

      {skipped.length > 0 && (
        <Card className="w-full">
          <div className="flex flex-wrap items-center justify-center gap-2">
            {skipped.map((s) => (
              <Button key={s} variant="outline" size="sm" onClick={() => onPick(s)}>
                去{STAGE_META[s].zh}
              </Button>
            ))}
          </div>
        </Card>
      )}

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

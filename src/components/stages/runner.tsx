'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, PartyPopper, RefreshCw } from 'lucide-react';
import { Button, Card, ErrorNote } from '@/components/ui';
import { StageLoading } from './shared';
import { WarmupStage } from './warmup';
import { NewWordsStage } from './newwords';
import { GrammarStage } from './grammar';
import { ListeningStage } from './listening';
import { ReadingStage } from './reading';
import { SpeakingStage } from './speaking';
import { WritingStage } from './writing';
import type { ReviewBody, StageMeta } from './types';
import { apiGet, apiPost } from '@/lib/fetcher';
import { STAGES, STAGE_META, type Stage } from '@/lib/types';
import { cn } from '@/lib/cn';

type StageResponse = StageMeta & { payload: unknown };

/** 七个环节串成一条线。每个环节做完提交学习数据，然后自动进下一个。 */
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
  const enteredAt = useRef(Date.now());

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
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [],
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

  const idx = STAGES.indexOf(stage);
  const info = STAGE_META[stage];

  return (
    <div className="space-y-4 py-2">
      <header className="space-y-3">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            aria-label="回首页"
            className="rounded-lg p-1.5 text-[var(--text-dim)] hover:bg-[var(--surface-2)]"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">{info.zh}</h1>
            <p className="truncate text-xs dim">
              {data?.themeZh ?? '今日主题'} · 第 {idx + 1}/{STAGES.length} 步 · 约 {info.minutes} 分钟
            </p>
          </div>
          <button
            type="button"
            onClick={() => load(stage, true)}
            disabled={loading}
            aria-label="重新生成这一环节"
            className="rounded-lg p-1.5 text-[var(--text-dim)] hover:bg-[var(--surface-2)] disabled:opacity-40"
          >
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} aria-hidden />
          </button>
        </div>

        <ol className="flex gap-1" aria-label="环节进度">
          {STAGES.map((s, i) => {
            const done = data?.stagesDone.includes(s);
            return (
              <li key={s} className="flex-1">
                <button
                  type="button"
                  onClick={() => setStage(s)}
                  aria-label={STAGE_META[s].zh}
                  aria-current={s === stage ? 'step' : undefined}
                  className={cn(
                    'h-1.5 w-full rounded-full transition-colors',
                    s === stage
                      ? 'bg-brand-600'
                      : done
                        ? 'bg-emerald-400'
                        : i < idx
                          ? 'bg-[var(--surface-2)]'
                          : 'bg-[var(--surface-2)]',
                  )}
                />
              </li>
            );
          })}
        </ol>
      </header>

      {error && <ErrorNote message={error} onRetry={() => load(stage)} />}
      {loading && <StageLoading what={info.zh} />}

      {data && !loading && (
        <StageBody
          stage={stage}
          data={data}
          onDone={onDone}
          onRegenerate={() => load(stage, true)}
          submitting={submitting}
        />
      )}
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
    case 'writing':
      return <WritingStage {...props} payload={data.payload as never} />;
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
      <PartyPopper className="size-12 text-brand-500" aria-hidden />
      <div>
        <h1 className="text-2xl font-semibold">今天的 30 分钟走完了</h1>
        <p className="mt-2 text-sm dim">
          明天这些词会换成新句子再来一次 —— 换了语境还认得，才是真记住了。
        </p>
      </div>

      {stats && (
        <Card className="w-full">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-2xl font-semibold">{stats.streak}</p>
              <p className="text-xs dim">连续天数</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">{stats.reviewsToday}</p>
              <p className="text-xs dim">今天复习</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">{stats.producedToday}</p>
              <p className="text-xs dim">主动用出</p>
            </div>
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

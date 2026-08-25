'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, Plus, Volume2, X } from 'lucide-react';
import { Badge, Button, Spinner } from '@/components/ui';
import { apiPost } from '@/lib/fetcher';
import { useTts } from '@/hooks/useSpeech';
import type { LookupData } from '@/lib/ai/schemas';
import { cn } from '@/lib/cn';

/** 朗读按钮。整站英文内容旁边都挂一个。 */
export function Speak({
  text,
  className,
  slow,
  label,
}: {
  text: string;
  className?: string;
  slow?: boolean;
  label?: string;
}) {
  const { speak, speaking, supported } = useTts();
  if (!supported) return null;
  return (
    <button
      type="button"
      onClick={() => speak(text, { slow })}
      aria-label={label ?? `朗读：${text.slice(0, 40)}`}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg p-1.5 transition-colors',
        'text-[var(--text-dim)] hover:bg-[var(--surface-2)] hover:text-brand-600',
        speaking && 'text-brand-600',
        className,
      )}
    >
      <Volume2 className={cn('size-4', speaking && 'animate-pulse')} aria-hidden />
    </button>
  );
}

const WORD_RE = /[A-Za-z][A-Za-z'’-]*/g;

/**
 * 把英文文本切成可点的词。点一下弹查词卡 —— 阅读和听力里遇到生词不用离开页面。
 * highlight 里的词会被标出来（今天的目标词）。
 */
export function TappableText({
  text,
  highlight = [],
  className,
}: {
  text: string;
  highlight?: string[];
  className?: string;
}) {
  const [lookup, setLookup] = useState<string | null>(null);
  const hi = new Set(highlight.map((h) => h.toLowerCase()));

  const parts: { s: string; word: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(WORD_RE)) {
    const i = m.index ?? 0;
    if (i > last) parts.push({ s: text.slice(last, i), word: false });
    parts.push({ s: m[0], word: true });
    last = i + m[0].length;
  }
  if (last < text.length) parts.push({ s: text.slice(last), word: false });

  return (
    <>
      <span className={cn('en', className)}>
        {parts.map((p, i) =>
          p.word ? (
            <button
              key={i}
              type="button"
              onClick={() => setLookup(p.s)}
              className={cn('tappable-word', hi.has(p.s.toLowerCase()) && 'target-word')}
            >
              {p.s}
            </button>
          ) : (
            <span key={i}>{p.s}</span>
          ),
        )}
      </span>
      {lookup && <LookupCard term={lookup} context={text} onClose={() => setLookup(null)} />}
    </>
  );
}

/** 查词浮层。 */
export function LookupCard({
  term,
  context,
  onClose,
}: {
  term: string;
  context?: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<(LookupData & { wordId: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    let alive = true;
    apiPost<LookupData & { wordId: number }>('/api/words/lookup', { term, context })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [term, context]);

  const add = async () => {
    if (!data) return;
    setAdding(true);
    try {
      await apiPost('/api/words', { action: 'enroll', wordIds: [data.wordId] });
      setAdded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`查词 ${term}`}
    >
      <div
        className="max-h-[80dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-[var(--surface)] p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="en truncate text-xl font-semibold">{data?.term ?? term}</h3>
              <Speak text={data?.term ?? term} />
            </div>
            {data && (
              <p className="mt-0.5 text-sm dim">
                <span className="en">{data.phonetic}</span> · {data.pos} · {data.cefr}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-lg p-1.5 text-[var(--text-dim)] hover:bg-[var(--surface-2)]"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        {error && <p className="mt-4 text-sm text-red-600 dark:text-red-300">{error}</p>}
        {!data && !error && <div className="mt-4"><Spinner label="查词中" /></div>}

        {data && (
          <div className="mt-4 space-y-3 text-sm">
            <p className="font-medium">{data.meaning_zh}</p>
            <p className="en dim">{data.meaning_en}</p>

            <div className="space-y-2 rounded-xl bg-[var(--surface-2)] p-3">
              {data.examples.map((ex, i) => (
                <div key={i}>
                  <div className="flex items-start gap-1">
                    <span className="en flex-1">{ex.en}</span>
                    <Speak text={ex.en} />
                  </div>
                  <p className="text-xs dim">{ex.zh}</p>
                </div>
              ))}
            </div>

            {data.memory_hook_zh && (
              <p className="rounded-xl border border-brand-200 bg-brand-50 p-3 text-xs dark:border-brand-800 dark:bg-brand-900/30">
                💡 {data.memory_hook_zh}
              </p>
            )}

            {data.confusable.length > 0 && (
              <div>
                <p className="text-xs font-semibold dim">容易混的词</p>
                <ul className="mt-1 space-y-1">
                  {data.confusable.map((c) => (
                    <li key={c.term} className="text-xs">
                      <span className="en font-medium">{c.term}</span>
                      <span className="dim"> — {c.diff_zh}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Button
              variant={added ? 'outline' : 'primary'}
              className="w-full"
              onClick={add}
              disabled={added}
              loading={adding}
            >
              {added ? (
                <>
                  <Check className="size-4" aria-hidden /> 已加入生词本
                </>
              ) : (
                <>
                  <Plus className="size-4" aria-hidden /> 加入生词本
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** FSRS 四档评分。文案按"记得牢不牢"来写，不用术语。 */
export function RatingRow({
  onRate,
  intervals,
  busy,
}: {
  onRate: (rating: 1 | 2 | 3 | 4) => void;
  /** previewIntervals 的输出：按评分数字索引，显示"下次多久后再来"。 */
  intervals?: Record<number, string>;
  busy?: boolean;
}) {
  /**
   * 四档评分。
   *
   * 不用四个实心色块：那样四个按钮互相争抢注意力，而且原本「记得」和「很容易」
   * 同色，根本区分不出。改成半透明 fill 底 + 彩色文字，四档色相各不相同，
   * 这也是 iOS 里一组平级选项的标准做法。
   */
  const buttons = [
    { r: 1 as const, zh: '忘了', cls: 'bg-[var(--danger)]/12 text-[var(--danger)]' },
    { r: 2 as const, zh: '有点难', cls: 'bg-warm-500/14 text-warm-700 dark:text-warm-400' },
    { r: 3 as const, zh: '记得', cls: 'bg-brand-500/12 text-brand-700 dark:text-brand-300' },
    { r: 4 as const, zh: '很容易', cls: 'bg-[var(--success)]/14 text-[var(--success)]' },
  ];
  return (
    <div className="grid grid-cols-4 gap-2">
      {buttons.map((b) => (
        <button
          key={b.r}
          type="button"
          disabled={busy}
          onClick={() => onRate(b.r)}
          className={cn(
            // 评分是每天要点几十次的动作，手感差一点就很磨人：
            // 44px 高、去掉移动端双击缩放延迟、按下缩放反馈
            'flex min-h-11 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-xl text-[13px] font-medium',
            'transition-all duration-300 [transition-timing-function:var(--ease-standard)] active:scale-[0.96]',
            'disabled:opacity-50 disabled:active:scale-100',
            b.cls,
          )}
        >
          {b.zh}
          {intervals?.[b.r] && <span className="text-[10px] font-normal opacity-70">{intervals[b.r]}</span>}
        </button>
      ))}
    </div>
  );
}

/** 选项题通用渲染：选完立刻显示对错和解释。 */
export function Choices({
  options,
  answer,
  picked,
  onPick,
  disabled,
}: {
  options: string[];
  answer: string;
  picked: string | null;
  onPick: (opt: string) => void;
  disabled?: boolean;
}) {
  return (
    /**
     * iOS 的分组列表：一个容器包住所有选项，内部靠分隔线切开。
     * 不能给每项各自描边 —— 那会变成四个割裂的方块，是这套体系里最扭的形态。
     *
     * 底色用 black/white 透明叠而不是 --surface-2：这组列表嵌在卡片里，
     * 必须比卡片更沉才对（嵌越深越暗）。用 --surface-2 会比卡片还亮，
     * 看起来像浮在卡片上的另一块面板，层级就反了。
     */
    <div className="overflow-hidden rounded-2xl bg-black/[0.04] dark:bg-black/40">
      {options.map((opt, i) => {
        const isPicked = picked === opt;
        const isAnswer = opt === answer;
        const revealed = picked !== null;
        return (
          <button
            key={opt}
            type="button"
            disabled={revealed || disabled}
            onClick={() => onPick(opt)}
            className={cn(
              'flex w-full touch-manipulation items-center gap-3 px-4 text-left',
              // 48px 行高：选项是这页的主要动作，比 44px 下限再宽裕一点
              'min-h-12 py-3',
              'transition-colors duration-300 [transition-timing-function:var(--ease-standard)]',
              // 分隔线从第二项开始
              i > 0 && 'border-t-[0.5px] border-[var(--hairline)]',
              !revealed && 'active:bg-black/5 dark:active:bg-white/10',
              // 揭晓后：对的涂绿、选错的涂红、无关的变淡
              revealed && isAnswer && 'bg-[var(--success)]/15',
              revealed && isPicked && !isAnswer && 'bg-[var(--danger)]/15',
              revealed && !isAnswer && !isPicked && 'opacity-40',
            )}
          >
            <span className="en flex-1 text-[17px]">{opt}</span>
            {revealed && isAnswer && (
              <Check className="size-5 shrink-0 text-[var(--success)]" aria-hidden />
            )}
            {revealed && isPicked && !isAnswer && (
              <X className="size-5 shrink-0 text-[var(--danger)]" aria-hidden />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** 每个环节顶部的说明条。 */
/**
 * 环节开头的一句说明。
 *
 * 以前是深蓝底满宽通栏，视觉重量比题目本身还大 —— 它只是句提示，
 * 不应该抢主角。现在降成次级正文：无底色，靠字号和行高自己站住。
 */
export function StageIntro({ children, tone = 'brand' }: { children: React.ReactNode; tone?: 'brand' | 'neutral' }) {
  return (
    <p className={cn('text-[13px] leading-relaxed', tone === 'brand' ? 'dim' : 'dim')}>
      {children}
    </p>
  );
}

/**
 * 答题后的讲解块。用 fill 底色不描边，去掉左侧的彩色竖线（那是 Material 的语言）。
 */
export function Explain({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-xl bg-[var(--surface-2)] p-4 text-sm">
      {children}
    </div>
  );
}

export function StageLoading({ what }: { what: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <Loader2 className="size-8 animate-spin text-brand-500 dark:text-brand-600" aria-hidden />
      <p className="text-sm font-medium">AI 正在为你生成{what}</p>
      <p className="text-xs dim">内容按你的水平和今天的主题现做，大约十几秒</p>
    </div>
  );
}

export function DoneBanner({ text, onNext }: { text: string; onNext: () => void }) {
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-900 dark:bg-brand-900/25">
      <div className="flex items-center gap-2">
        <Badge tone="success">完成</Badge>
        <p className="text-sm">{text}</p>
      </div>
      <Button className="mt-3 w-full" onClick={onNext}>
        下一环节
      </Button>
    </div>
  );
}

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
        'inline-flex shrink-0 items-center justify-center rounded-md p-1.5 transition-colors',
        'text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-brand-600',
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--scrim)] p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`查词 ${term}`}
    >
      <div
        className={cn(
          'max-h-[80dvh] w-full max-w-md overflow-y-auto bg-[var(--surface)] p-5',
          // 手机上从底部升起（只圆上面两角），平板以上是居中卡片（四角都圆）
          'rounded-t-2xl sm:rounded-2xl',
          'border-[var(--border)] shadow-[var(--shadow-modal)] sm:border',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="en truncate text-xl text-[var(--text-title)]">{data?.term ?? term}</h3>
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
            className="shrink-0 rounded-md p-1.5 text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        {error && <p className="mt-4 text-sm text-[var(--danger)]">{error}</p>}
        {!data && !error && <div className="mt-4"><Spinner label="查词中" /></div>}

        {data && (
          <div className="mt-4 space-y-3 text-sm">
            <p className="font-medium">{data.meaning_zh}</p>
            <p className="en dim">{data.meaning_en}</p>

            <div className="space-y-2 rounded-xl border border-[var(--hairline)] bg-[var(--bg-sidebar)] p-3">
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
              <p className="rounded-xl border border-brand-200 bg-brand-50 p-3 text-xs leading-relaxed text-[var(--text-body)] dark:border-brand-800 dark:bg-brand-900/30">
                💡 {data.memory_hook_zh}
              </p>
            )}

            {data.confusable.length > 0 && (
              <div>
                <p className="section-label">容易混的词</p>
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
   * 同色，根本区分不出。四档各自一个色相，描边 + 极浅底 + 同族文字，
   * 纸感体系里的一组平级选项就该这么写 —— 靠描边分区，不靠色块压人。
   *
   * 底色用 color-mix 而不是 /12 透明度：这些颜色是 var()，Tailwind 的透明度
   * 修饰符对 var() 颜色不可靠（编译期不知道它是什么格式）。
   */
  const buttons = [
    {
      r: 1 as const,
      zh: '忘了',
      cls: 'border-[color-mix(in_srgb,var(--danger)_34%,transparent)] bg-[color-mix(in_srgb,var(--danger)_9%,var(--surface))] text-[var(--danger)]',
    },
    {
      r: 2 as const,
      zh: '有点难',
      cls: 'border-warm-300 bg-warm-50 text-warm-600 dark:border-warm-800 dark:bg-warm-900/25 dark:text-warm-300',
    },
    {
      r: 3 as const,
      zh: '记得',
      cls: 'border-brand-200 bg-brand-50 text-brand-600 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-300',
    },
    {
      r: 4 as const,
      zh: '很容易',
      cls: 'border-[color-mix(in_srgb,var(--success)_38%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,var(--surface))] text-[var(--success)]',
    },
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
            // 44px 高、去掉移动端双击缩放延迟、按下有位移反馈
            'flex min-h-11 touch-manipulation flex-col items-center justify-center gap-0.5',
            'rounded-lg border text-[13px] font-semibold',
            // 纸上的控件不缩放，只下沉一像素（和 Button 一致）
            'transition-all duration-200 [transition-timing-function:var(--ease-standard)] active:translate-y-px',
            'disabled:opacity-50 disabled:active:translate-y-0',
            b.cls,
          )}
        >
          {b.zh}
          {intervals?.[b.r] && (
            <span className="text-[10px] font-medium tabular-nums opacity-75">{intervals[b.r]}</span>
          )}
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
     * 分组列表：一个容器包住所有选项，内部靠分隔线切开。
     * 不能给每项各自描边 —— 那会变成四个割裂的方块，是这套体系里最扭的形态。
     *
     * 描边 + --bg-sidebar 底：纸感体系里嵌套不靠"越深越暗"，靠描边划定范围。
     * 底色比卡片略沉一档就够，再暗就变成挖了个洞。
     */
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-sidebar)]">
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
              i > 0 && 'border-t border-[var(--hairline)]',
              !revealed && 'hover:bg-[var(--surface-hover)] active:bg-[var(--surface-active)]',
              // 揭晓后：对的涂绿、选错的涂红、无关的变淡
              revealed &&
                isAnswer &&
                'bg-[color-mix(in_srgb,var(--success)_16%,var(--bg))] font-semibold text-[var(--text-title)]',
              revealed &&
                isPicked &&
                !isAnswer &&
                'bg-[color-mix(in_srgb,var(--danger)_14%,var(--bg))]',
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

/**
 * 环节开头的一句说明。
 *
 * 它只是句提示，不该抢题目的主角位置，所以没有底色，靠字号和行高自己站住。
 * tone 保留是因为调用处传了，但两档都走同一种弱化处理 —— 一句说明没必要有两种形态。
 */
export function StageIntro({
  children,
  tone = 'brand',
}: {
  children: React.ReactNode;
  tone?: 'brand' | 'neutral';
}) {
  void tone;
  return <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">{children}</p>;
}

/**
 * 答题后的讲解块。描边 + 侧边底色，比卡片沉一档，明确是"附在题目下面的注解"。
 */
export function Explain({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-xl border border-[var(--hairline)] bg-[var(--bg-sidebar)] p-4 text-sm leading-relaxed text-[var(--text-body)]">
      {children}
    </div>
  );
}

/**
 * 环节的左右分栏。
 *
 * 宽屏上一个环节其实有两种东西：要反复看的材料（原文、讲解、词卡）和要动手的部分
 * （题目、评分、对话）。塞成一列的结果是右边空一大片，而且做题时得来回滚回去看材料。
 * 分栏之后两边同时在视野里，滚动只发生在需要的那一列。
 *
 * 断点用 xl（1280px）而不是 lg：lg 时减掉 17rem 的侧栏只剩 ~750px，
 * 两列各 375px 装不下一行英文。xl 以下退回单列，顺序就是 aside 在前 ——
 * 手机上先看材料再做题，和原来的单列顺序一致。
 *
 * ratio='half' 两边等宽（听力、阅读：两边都是成段文字）；
 * ratio='wide-main' 右边宽、左边窄一条（新词、热身：左边只是个索引条）。
 */
export function Split({
  aside,
  children,
  ratio = 'half',
  className,
}: {
  aside: React.ReactNode;
  children: React.ReactNode;
  ratio?: 'half' | 'wide-main';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid items-start gap-6',
        ratio === 'half'
          ? 'xl:grid-cols-2'
          : 'xl:grid-cols-[minmax(0,1fr)_19rem] xl:gap-8',
        className,
      )}
    >
      {/* wide-main 时左窄栏在视觉上是附属物，DOM 里却要排在后面才能贴右边 */}
      <div className={cn('min-w-0 space-y-4', ratio === 'wide-main' && 'xl:order-1')}>
        {ratio === 'wide-main' ? children : aside}
      </div>
      <div className={cn('min-w-0 space-y-4', ratio === 'wide-main' && 'xl:order-2')}>
        {ratio === 'wide-main' ? aside : children}
      </div>
    </div>
  );
}

/**
 * 分栏里跟着滚动条一起走的那一列。
 *
 * 材料列比题目列短的时候，让它钉在视口上：右边翻到第 4 题，左边原文还在。
 * 只在 xl 生效 —— 单列布局下 sticky 会把材料压在题目上面，反而挡路。
 */
export function StickyColumn({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'xl:sticky xl:top-[calc(var(--topbar-h)+1.5rem)]',
        // 材料本身可能很长（阅读原文），超过一屏就自己滚，别顶掉 sticky
        'xl:max-h-[calc(100dvh-var(--topbar-h)-3rem)] xl:overflow-y-auto',
        'space-y-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 分栏里那一列的小标题。比 h2 轻，只是告诉你这一列是干什么的。 */
export function ColumnLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--text-faint)]">
      {children}
    </p>
  );
}

export function StageLoading({ what }: { what: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <Loader2 className="size-7 animate-spin text-brand-500 dark:text-brand-600" aria-hidden />
      <p className="text-sm font-semibold text-[var(--text-title)]">AI 正在为你生成{what}</p>
      <p className="text-xs dim">内容按你的水平和今天的主题现做，大约十几秒</p>
    </div>
  );
}

export function DoneBanner({ text, onNext }: { text: string; onNext: () => void }) {
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-800 dark:bg-brand-900/25">
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

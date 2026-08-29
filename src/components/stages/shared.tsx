'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, Loader2, Plus, Volume2, X } from 'lucide-react';
import { Badge, Button, Spinner, Toast } from '@/components/ui';
import { useSheetBehavior } from '@/components/sheet';
import { apiPost } from '@/lib/fetcher';
import { sentenceWindow } from '@/lib/sentence-window';
import { useTts } from '@/hooks/useSpeech';
import type { LookupData } from '@/lib/ai/schemas';
import { cn } from '@/lib/cn';

/** 朗读按钮。整站英文内容旁边都挂一个。 */
export function Speak({
  text,
  className,
  slow,
  label,
  onlineOnly,
}: {
  text: string;
  className?: string;
  slow?: boolean;
  label?: string;
  /**
   * 只用在线音色、不退回系统语音包，并在合成期间弹「语音生成中…」。
   * 听力和阅读传这个 —— 那两环节就是练听力，系统语音包读英文发闷，
   * 退过去等于把这一环的价值抹掉（2026-08-28 用户要求）。
   */
  onlineOnly?: boolean;
}) {
  const { speak, speaking, supported } = useTts();
  // onlineOnly 不依赖 speechSynthesis，浏览器不支持也照样能放在线音频
  if (!supported && !onlineOnly) return null;
  /*
   * 这里不再挂 SpeechTip（2026-08-29 改）。
   *
   * 原来每个 onlineOnly 的 Speak 内部各挂一份，于是阅读页 5 个 Speak
   * 就有 5 个 fixed 定位的提示容器叠在同一坐标 —— 它们共用同一个 useTts
   * 实例，synthesizing 一变就会同时显示同一句话。
   *
   * 提示是页面级的东西（整页同一时刻只该有一条），所以改由页面自己挂一次：
   * 听力页早就是这么做的（root 级一个 SpeechTip），阅读页照做。
   * 见 reading.tsx / listening.tsx 里的 <SpeechTip/>。
   */
  return (
    <button
      type="button"
      onClick={() => speak(text, { slow, onlineOnly })}
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

/**
 * 「语音生成中…」要等多久才肯露面。
 *
 * 命中缓存时整个合成只花几十毫秒（实测 0.06s），提示闪一下就消失 ——
 * 那种一闪而过的黄条比没有提示更烦人。压 500ms 之后：缓存命中的一律不出现，
 * 真需要现场合成的（实测 MiMo 3.3-3.7 秒）照样能在人以为按钮坏了之前出来。
 */
const TIP_DELAY_MS = 500;

/**
 * 在线朗读的状态提示（听力/阅读专用）。
 *
 * 合成中弹「语音生成中…」，失败弹原因。
 *
 * 三个刻意的选择：
 * ① 延迟 500ms —— 见 TIP_DELAY_MS。
 * ② 浅黄（warn）而不是绿 —— 这不是"成功了"，是"在等一件事"。
 * ③ 中上方而不是底部 —— 听力/阅读时视线在正文上，而且底部那条带子在手机上
 *    正好是拇指区，提示压在那儿容易被手挡住。
 *
 * 复用 Toast：动画、无障碍（role=status + aria-live=polite）都已经处理好了。
 */
export function SpeechTip({
  synthesizing,
  error,
}: {
  synthesizing: boolean;
  error: string | null;
}) {
  const [ripe, setRipe] = useState(false);

  useEffect(() => {
    if (!synthesizing) {
      // 合成结束（或压根没开始）：立刻收起，并且把计时器取消掉，
      // 否则快速连点两次时前一个的计时器会在第二次刚开始时就把提示弹出来
      setRipe(false);
      return;
    }
    const t = setTimeout(() => setRipe(true), TIP_DELAY_MS);
    return () => clearTimeout(t);
  }, [synthesizing]);

  // 失败信息优先且不延迟：出错时不该还挂着"生成中"，也不该让人再等半秒才知道
  if (error) return <Toast message={error} show tone="danger" place="top" />;
  return <Toast message="语音生成中…" show={synthesizing && ripe} tone="warn" place="top" />;
}

/*
 * 可点的词。连字符词整体算一个（well-known），撇号后缀交给下面的白名单判断。
 */
const WORD_RE = /[A-Za-z]+(?:['\u2019][A-Za-z]+)?(?:-[A-Za-z]+)*/g;

/**
 * 撇号后缀里，哪些该跟着词一起查。
 *
 * 光靠正则分不开 `don’t` 和 `tonight’s` —— 两者结构完全一样
 * （字母 + 撇号 + 字母）。但语义相反：
 *   don’t  是一个词的缩写，拆开就没意义了，要整体查；
 *   tonight’s 是 tonight + 所有格，该查 tonight。
 * 所以只有真·缩写的后缀才保留，其余（主要是所有格 ’s）一律剥掉。
 *
 * `’s` 刻意不在表里：它既可能是所有格（tonight’s）也可能是 is/has 的缩写
 * （that’s）。但两种情况都该查主词 —— that’s 查 that 完全合理，
 * 而把 tonight’s 整体拿去查会落到 AI 兜底。用户实锤：点 tonight’s 一直转圈，
 * 因为词典里只有 tonight，落到 AI 那条路又撞上中转站回自我介绍 → 502。
 */
const CONTRACTION_SUFFIX = /['\u2019](t|ll|re|ve|d|m|s?t)$/i;

/** 词尾是所有格之类的附着成分就剥掉，只留可查的主词。 */
function coreWord(w: string): string {
  const cut = w.match(/['\u2019][A-Za-z]+$/);
  if (!cut) return w;
  // n’t / ’ll / ’re / ’ve / ’d / ’m 是缩写，整体才有意义
  if (CONTRACTION_SUFFIX.test(w)) return w;
  return w.slice(0, cut.index);
}

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
  /*
   * 存的是「词 + 它在原文里的下标」，不只是词。
   *
   * 下标是为了截出所在句当 context（见 sentenceWindow）。原来这里把
   * **整篇 passage_en** 当 context 发出去，长文直接被后端 schema 挡成 422
   * （实测 16 篇阅读里 9 篇是 600-683 字符，超过一半的阅读点词就查不了）。
   */
  const [lookup, setLookup] = useState<{ term: string; at: number } | null>(null);
  const hi = new Set(highlight.map((h) => h.toLowerCase()));

  const parts: { s: string; word: boolean; at: number }[] = [];
  let last = 0;
  for (const m of text.matchAll(WORD_RE)) {
    const i = m.index ?? 0;
    if (i > last) parts.push({ s: text.slice(last, i), word: false, at: last });
    parts.push({ s: m[0], word: true, at: i });
    last = i + m[0].length;
  }
  if (last < text.length) parts.push({ s: text.slice(last), word: false, at: last });

  return (
    <>
      <span className={cn('en', className)}>
        {parts.map((p, i) =>
          p.word ? (
            <button
              key={i}
              type="button"
              /*
               * 显示保持原样（tonight’s），查的是主词（tonight）——
               * 把所有格一起拿去查会落到 AI 兜底，慢且可能 502。
               */
              onClick={() => setLookup({ term: coreWord(p.s), at: p.at })}
              className={cn('tappable-word', hi.has(p.s.toLowerCase()) && 'target-word')}
            >
              {p.s}
            </button>
          ) : (
            <span key={i}>{p.s}</span>
          ),
        )}
      </span>
      {lookup && (
        <LookupCard
          term={lookup.term}
          /*
           * 只发所在句，不发整篇。
           *
           * 两个好处，一个是修 bug 一个是白捡的：
           * ① 长文不再被后端 schema 挡成 422；
           * ② AI 兜底那条路（context 唯一的用途）拿到的上下文更准 ——
           *    整篇 683 字符里那个词只占一句，其余全是噪声，还多烧 token。
           */
          context={sentenceWindow(text, lookup.at)}
          onClose={() => setLookup(null)}
        />
      )}
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

/**
 * 打乱选项顺序。
 *
 * 模型给的 options 里正确答案几乎总在第一个 —— schema 里 options 排在 answer
 * 前面，模型是先写选项再写答案，于是顺手把想好的那个放在了开头。提示词里让它
 * "随机放"不可靠（模型对自己的输出位置没有概念），而且已经缓存的题目改不了，
 * 所以在渲染这一层打乱。
 *
 * 用内容做种子而不是 Math.random()：同一道题每次渲染、刷新、返回都是同一个顺序。
 * 真随机的话 React 每次重渲染都会重排，选项会在手指底下乱跳。
 */
function shuffled(options: string[]): string[] {
  // FNV-1a：短字符串够用，只要求同样的输入给同样的数
  let h = 0x811c9dc5;
  const seedText = options.join('');
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // mulberry32
  const rand = () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...options];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 选项题通用渲染：选完立刻显示对错和解释。 */
export function Choices({
  options: raw,
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
  /*
   * 依赖是拼出来的字符串而不是 raw 本身：好几个调用点写的是 `q.options ?? []`，
   * 每次渲染都是个新数组，按引用比会白打乱一遍。
   */
  const key = raw.join('');
  const options = useMemo(() => shuffled(raw), [key]); // eslint-disable-line react-hooks/exhaustive-deps

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
  asideFrom,
  className,
}: {
  aside: React.ReactNode;
  children: React.ReactNode;
  ratio?: 'half' | 'wide-main';
  /**
   * 'xl' = 窄屏干脆不出这一栏。
   *
   * 给那种"宽屏上顺手、窄屏上多余"的附属栏用：单列布局下它会整块落到主内容
   * 底下，把钉在底部的操作条顶走 —— 往下滚看它的时候按钮就跟着滚上去了。
   * 默认仍是两种宽度都出（材料栏在手机上是要看的）。
   */
  asideFrom?: 'xl';
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
      {/*
        wide-main 时左窄栏在视觉上是附属物，DOM 里却要排在后面才能贴右边。
        所以 aside 落在哪一格是随 ratio 变的 —— 隐藏那个类得跟着它走，
        不能写死在某一格上。整格一起隐藏（而不是只藏里面的内容）：空格子还占
        一行，grid 的 gap 会在主内容底下留出一道说不清来历的空白。
      */}
      <div
        className={cn(
          'min-w-0 space-y-4',
          ratio === 'wide-main' && 'xl:order-1',
          ratio === 'half' && asideFrom === 'xl' && 'max-xl:hidden',
        )}
      >
        {ratio === 'wide-main' ? children : aside}
      </div>
      <div
        className={cn(
          'min-w-0 space-y-4',
          ratio === 'wide-main' && 'xl:order-2',
          ratio === 'wide-main' && asideFrom === 'xl' && 'max-xl:hidden',
        )}
      >
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

/**
 * 材料弹窗的开关。
 *
 * 进环节默认弹出，手动关掉之后能再点开 —— 所以初始值是 true，
 * 关闭只是把它设回 false，不留"已经看过就不再弹"的记忆：同一个环节里
 * 反复开合是正常操作，记住状态反而会让「再打开」这个按钮时有时无。
 *
 * key 变了（换一批材料）要重新弹一次，交给调用处给组件换 key 来实现。
 */
export function useMaterialSheet() {
  const [open, setOpen] = useState(true);
  return {
    open,
    show: useCallback(() => setOpen(true), []),
    hide: useCallback(() => setOpen(false), []),
  };
}

/**
 * 材料弹窗。语法讲解 / 听力音频 / 阅读原文都装在这里。
 *
 * 手机上从底部升起、占八成屏高；平板以上是居中卡片。和 LookupCard 同一种形态 ——
 * 站里已经有这个模式了，再造一种只会让人多学一次。
 *
 * 里面的内容可能很长（阅读原文 + 生词表），所以内容区自己滚，
 * 标题栏和底部按钮钉住不动。
 */
export function MaterialSheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** 底部固定区，比如「听完了，开始答题」 */
  footer?: React.ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // 锁背景滚动 + Esc 关闭，和通话弹窗共用一份实现
  useSheetBehavior(open, onClose);

  // 打开时把焦点挪进来，键盘用户才能 Esc / Tab 到里面的控件
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--scrim)] sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={cn(
          'flex max-h-[86dvh] w-full flex-col overflow-hidden bg-[var(--surface)] sm:max-h-[88dvh] sm:max-w-2xl',
          'rounded-t-2xl sm:rounded-2xl',
          'border-[var(--border)] shadow-[var(--shadow-modal)] sm:border',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--hairline)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-[17px] font-semibold text-[var(--text-title)]">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-xs dim">{subtitle}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="shrink-0 rounded-lg p-1.5 text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="border-t border-[var(--hairline)] px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** 关掉材料弹窗之后，用它再打开。放在题目上方。 */
export function MaterialButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]',
        'px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)]',
        'transition-colors duration-200 [transition-timing-function:var(--ease-standard)]',
        'hover:bg-[var(--surface-hover)] hover:text-[var(--text-title)]',
      )}
    >
      <BookOpen className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}

/**
 * 做题时的那一列。
 *
 * 材料进了弹窗，题目就没有并排的邻居了，剩一列贴在左边看着很偏 ——
 * 所以收一个正文宽度并水平居中。/learn 的外层不套宽度上限（它原来自己排两列），
 * 所以这个上限得由这里给。
 */
export function CenterColumn({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mx-auto w-full max-w-[var(--content-w)] space-y-4', className)}>
      {children}
    </div>
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

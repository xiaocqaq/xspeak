'use client';

import { cn } from '@/lib/cn';

/**
 * 日历柱状图。
 *
 * 为什么需要这个组件而不是各页面各写一遍：这些图的数据天生是稀疏的 ——
 * 刚开始用的时候可能只有一两天有记录。如果直接把这几条数据丢给 flex 布局，
 * 每根柱子会被 `flex-1` 拉成半个屏幕宽，日期缺口也完全看不出来
 * （相邻的两根柱子实际可能隔了三天）。数据越少画面越荒谬。
 *
 * 所以这里的规则是：槽位数固定，没数据的日子画成一条浅浅的底线。
 * 空槽本身就是信息 —— 它告诉你那天没学。
 */

export type DayPoint = {
  /** YYYY-MM-DD */
  day: string;
  /** 柱子高度对应的值 */
  value: number;
  /** 悬停时显示的补充说明，可选 */
  note?: string;
};

export function DayBars({
  data,
  height = 96,
  /** 超过这个值的柱子染成暖色，用来提示"这天负担偏重" */
  warnAbove,
  /** 左右两端的轴标签 */
  leftLabel,
  rightLabel,
  className,
  ariaLabel,
}: {
  data: DayPoint[];
  height?: number;
  warnAbove?: number;
  leftLabel?: string;
  rightLabel?: string;
  className?: string;
  ariaLabel: string;
}) {
  // 全是 0 的时候不要让分母变成 0，也不要让空图看起来"满格"
  const max = Math.max(1, ...data.map((d) => d.value));
  const hasAny = data.some((d) => d.value > 0);

  return (
    <div className={className}>
      <div
        className="flex items-end gap-[3px]"
        style={{ height }}
        role="img"
        aria-label={ariaLabel}
      >
        {data.map((d) => {
          const empty = d.value <= 0;
          const warn = warnAbove != null && d.value > warnAbove;
          // 有值的柱子至少留 4px，否则小数值看起来和空槽一样
          const h = empty ? 2 : Math.max(4, (d.value / max) * (height - 4));
          return (
            <div key={d.day} className="group relative min-w-0 flex-1">
              <div
                className={cn(
                  'w-full rounded-t-[2px] transition-colors duration-200',
                  '[transition-timing-function:var(--ease-standard)]',
                  empty
                    ? 'bg-[var(--border)]'
                    : warn
                      ? 'bg-warm-400 group-hover:bg-warm-500'
                      : 'bg-[var(--accent-bar)] group-hover:bg-brand-600',
                )}
                style={{ height: `${h}px` }}
              />
              {/* 悬停气泡。空槽也要能看到日期，否则没法确认"哪天没学" */}
              <span
                className={cn(
                  'pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2',
                  'whitespace-nowrap rounded-md bg-[var(--text-title)] px-2 py-1',
                  'text-[11px] tabular-nums text-[var(--surface)] shadow-[var(--shadow-lifted)] group-hover:block',
                )}
              >
                {d.day.slice(5)}
                {empty ? ' · 没学' : ` · ${d.note ?? d.value}`}
              </span>
            </div>
          );
        })}
      </div>

      {(leftLabel || rightLabel) && (
        <div className="mt-2 flex justify-between text-[11px] tabular-nums dim">
          <span>{leftLabel}</span>
          <span>{rightLabel}</span>
        </div>
      )}

      {!hasAny && <p className="mt-2 text-xs dim">还没有数据，学一天就会出现第一根柱子。</p>}
    </div>
  );
}

/**
 * 单条占比条。词汇状态那种"一整条分几段"的图用它。
 * 段落之间留 1px 缝，比纯色拼接更容易看出边界。
 */
export function StackedBar({
  segments,
  className,
  ariaLabel,
}: {
  segments: { value: number; className: string; label: string }[];
  className?: string;
  ariaLabel: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <div
      className={cn(
        'flex h-2 w-full gap-px overflow-hidden rounded-sm bg-[var(--surface-2)]',
        className,
      )}
      role="img"
      aria-label={ariaLabel}
    >
      {total > 0 &&
        segments.map(
          (s) =>
            s.value > 0 && (
              <div
                key={s.label}
                className={cn('h-full first:rounded-l-sm last:rounded-r-sm', s.className)}
                style={{ width: `${(s.value / total) * 100}%` }}
              />
            ),
        )}
    </div>
  );
}

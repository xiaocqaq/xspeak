'use client';

import { cn } from '@/lib/cn';
import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'outline' | 'danger' | 'warm';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  /**
   * 按钮配色。
   *
   * 上一版按下用 scale(0.96)（iOS 手感），这一版换成颜色加深 + 极轻的下沉 ——
   * 纸面上的控件不该缩放，那是触屏原生控件的语言。
   * disabled 用 fill 底 + 灰字，不用半透明主色：淡绿看着还像个能点的按钮。
   */
  const variants = {
    primary: cn(
      'bg-brand-500 text-white shadow-[0_1px_2px_rgba(23,62,54,0.18)]',
      'hover:bg-brand-600 active:translate-y-px',
      'disabled:bg-[var(--surface-2)] disabled:text-[var(--text-faint)] disabled:shadow-none',
    ),
    warm: cn(
      'bg-warm-500 text-white shadow-[0_1px_2px_rgba(23,62,54,0.18)]',
      'hover:bg-warm-600 active:translate-y-px disabled:opacity-50',
    ),
    // 次级按钮：纸面 + 1px 描边。这是参照站里所有次级控件的形态。
    outline: cn(
      'border border-[var(--border-chrome)] bg-[var(--surface)] text-[var(--text-title)]',
      'hover:border-[var(--border)] hover:bg-[var(--surface-hover)] active:translate-y-px',
    ),
    ghost: 'text-brand-600 hover:bg-[var(--surface-hover)] active:translate-y-px',
    danger: 'bg-[var(--danger)] text-white hover:brightness-95 active:translate-y-px',
  };
  /**
   * 尺寸。
   * md 钉在 h-11（44px），触屏最小可点区。圆角统一走 rounded-xl（10px）。
   */
  const sizes = {
    sm: 'h-9 px-3.5 text-[13px] rounded-xl gap-1.5',
    md: 'h-11 px-5 text-sm rounded-xl gap-2',
    lg: 'h-12 px-7 text-[15px] rounded-xl gap-2',
  };
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-semibold',
        'transition-[background-color,border-color,color,transform,box-shadow] duration-200',
        '[transition-timing-function:var(--ease-standard)]',
        'disabled:cursor-not-allowed disabled:opacity-60 disabled:active:translate-y-0',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({
  className,
  children,
  lifted,
  interactive,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { lifted?: boolean; interactive?: boolean }) {
  return (
    <div
      className={cn(
        'card p-5 sm:p-6',
        lifted && 'card-lifted',
        interactive && 'card-interactive',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'brand' | 'warm' | 'danger' | 'success';
  className?: string;
}) {
  /**
   * 徽章：浅底 + 深色同族文字 + 1px 同色描边。
   * 纸面是实色的，所以这里可以放心用实色浅底，不必像玻璃那样怕遮住层次。
   */
  const tones = {
    neutral: 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border)]',
    brand: 'bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-900/50 dark:text-brand-300 dark:border-brand-800',
    warm: 'bg-warm-50 text-warm-700 border-warm-200 dark:bg-warm-900/40 dark:text-warm-300 dark:border-warm-800',
    danger: cn(
      'text-[var(--danger)]',
      'bg-[color-mix(in_srgb,var(--danger)_10%,var(--bg))]',
      'border-[color-mix(in_srgb,var(--danger)_28%,transparent)]',
    ),
    success: 'bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-900/50 dark:text-brand-300 dark:border-brand-800',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11.5px] font-semibold',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** 全大写小标签，用来分隔版块。比再来一个标题更轻。 */
export function SectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <p className={cn('section-label', className)}>{children}</p>;
}

/**
 * 每个页面顶部的标题区。
 *
 * 站里六个页面原来各写一遍 `text-2xl font-semibold tracking-tight`，字号还和
 * 首页不一致。抽成一个组件，页面标题的形态就只有一处定义：
 * 小标签 + 衬线大标题 + 一句说明。
 *
 * eyebrow 用英文单词而不是中文：它是装饰性的分区标记，中文放这儿会被当成正文读。
 */
export function PageHeader({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  /** 标题下面那句说明。 */
  children?: ReactNode;
  /** 右上角的操作区，比如"换一批"。 */
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="section-label">{eyebrow}</p>}
        <h1 className={cn('text-[26px] sm:text-[30px]', eyebrow && 'mt-1.5')}>{title}</h1>
        {children && (
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-[var(--text-secondary)]">
            {children}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 pt-1">{actions}</div>}
    </header>
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      // 进度条压成 6px 小圆角，和「数据」页、图表里的条同形（胶囊只留给徽标）
      className={cn('h-1.5 w-full overflow-hidden rounded-sm bg-[var(--surface-2)]', className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-sm bg-[var(--accent-bar)] transition-[width] duration-500 [transition-timing-function:var(--ease-standard)]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * 输入框。
 * 描边 + 略深的底，聚焦时描边染主色 —— 表单控件在纸面上需要边界，
 * 上一版那种"无框 fill 底"是玻璃体系的做法，放到纸上会分不清哪里能打字。
 */
const fieldBase = cn(
  'w-full rounded-xl border border-[var(--border-control)] bg-[var(--surface)]',
  'text-[var(--text-body)] placeholder:text-[var(--text-faint)]',
  'transition-[border-color,box-shadow] duration-150 focus:outline-none',
  'focus:border-brand-500 focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-brand-400)_22%,transparent)]',
);

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, 'p-3.5 text-base sm:text-sm', className)} {...rest} />;
}

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      // 手机上 16px 以下的字号会触发 Safari 自动放大，所以移动端保持 text-base
      className={cn(fieldBase, 'h-11 px-3.5 text-base sm:text-sm', className)}
      {...rest}
    />
  );
}

export function Spinner({ label = '加载中' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm dim" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      className={cn(
        // 底色和描边用 color-mix 明确算出来：对 var() 颜色用 /8 这种透明度修饰符
        // 在 Tailwind 里要靠 color-mix 兜底，写死更稳，也省得猜编译结果
        'rounded-2xl border p-4 text-sm text-[var(--danger)]',
        'border-[color-mix(in_srgb,var(--danger)_28%,transparent)]',
        'bg-[color-mix(in_srgb,var(--danger)_9%,var(--bg))]',
      )}
    >
      <p className="whitespace-pre-wrap">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  );
}

export function Empty({
  title,
  hint,
  icon,
  action,
}: {
  title: string;
  hint?: string;
  /** 可选图标，给空状态一个视觉落点，不然大片留白显得像出错了 */
  icon?: ReactNode;
  /** 空状态最该做的下一步动作 */
  action?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-2xl border border-dashed border-[var(--border)]',
        'bg-[var(--bg-sidebar)] px-6 py-10 text-center',
      )}
    >
      {icon && <div className="mb-3 text-[var(--text-faint)]">{icon}</div>}
      <p className="font-semibold text-[var(--text-title)]">{title}</p>
      {hint && <p className="mt-1.5 max-w-sm text-sm dim">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}


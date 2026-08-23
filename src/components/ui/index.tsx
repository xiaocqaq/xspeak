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
  const variants = {
    // 主按钮带一点投影，像盖下去的印章；hover 时轻微下沉
    primary:
      'bg-brand-600 text-white shadow-[0_1px_2px_rgb(35_76_58/0.25)] hover:bg-brand-700 active:translate-y-px disabled:bg-brand-300 disabled:shadow-none',
    warm: 'bg-warm-500 text-white shadow-[0_1px_2px_rgb(127_82_37/0.25)] hover:bg-warm-600 active:translate-y-px disabled:opacity-50',
    outline:
      'border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)] text-[var(--text)] active:translate-y-px',
    ghost: 'hover:bg-[var(--surface-2)] text-[var(--text)]',
    danger: 'bg-red-700 text-white hover:bg-red-800 active:translate-y-px',
  };
  // 手机上 44px 是可靠的点击高度下限，md 因此给到 h-11
  const sizes = {
    sm: 'h-9 px-3 text-sm rounded-lg gap-1.5',
    md: 'h-11 px-4 text-sm rounded-[0.625rem] gap-2',
    lg: 'h-12 px-6 text-base rounded-xl gap-2',
  };
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-medium transition-all duration-100',
        'disabled:cursor-not-allowed disabled:opacity-60',
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
  ...rest
}: HTMLAttributes<HTMLDivElement> & { lifted?: boolean }) {
  return (
    <div className={cn('card p-4 sm:p-5', lifted && 'card-lifted', className)} {...rest}>
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
  // 全部换成暖色系：amber/emerald 那套偏冷偏艳，和纸感不搭
  const tones = {
    neutral: 'bg-[var(--surface-2)] text-[var(--text-dim)]',
    brand: 'bg-brand-100 text-brand-700 dark:bg-brand-800/60 dark:text-brand-100',
    warm: 'bg-warm-100 text-warm-700 dark:bg-warm-800/50 dark:text-warm-200',
    danger: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
    success: 'bg-brand-100 text-brand-700 dark:bg-brand-800/60 dark:text-brand-100',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn(
        'h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)] inset-shadow-2xs',
        className,
      )}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-brand-500 transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-[0.625rem] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm',
        'placeholder:text-[var(--text-dim)] focus:border-brand-400 focus:outline-none',
        className,
      )}
      {...rest}
    />
  );
}

export function Input({
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        // 手机上 16px 以下的字号会触发 Safari 自动放大，所以移动端保持 text-base
        'h-11 w-full rounded-[0.625rem] border border-[var(--border)] bg-[var(--surface)] px-3 text-base sm:h-10 sm:text-sm',
        'placeholder:text-[var(--text-dim)] focus:border-brand-400 focus:outline-none',
        className,
      )}
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
    <div className="rounded-[0.625rem] border border-red-200 bg-red-50 p-3.5 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
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
    <div className="flex flex-col items-center rounded-[0.625rem] border border-dashed border-[var(--border)] px-6 py-9 text-center">
      {icon && <div className="mb-2.5 text-[var(--text-dim)]">{icon}</div>}
      <p className="font-medium">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-sm dim">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

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
    // 主按钮：实心蓝底。投影轻，按下靠缩放反馈而不是下沉 ——
    // scale(0.96) 是 iOS 的标准按压手感，translateY 那套是网页习惯。
    // disabled 用 fill 色而不是淡蓝：淡蓝看着还像个能点的蓝按钮，辨识度不够。
    primary:
      'bg-brand-500 text-white shadow-[0_4px_12px_rgba(0,0,0,0.1)] hover:bg-brand-700 active:scale-[0.96] disabled:bg-[var(--surface-2)] disabled:text-[var(--text-dim)] disabled:shadow-none dark:bg-brand-600',
    warm: 'bg-warm-500 text-white shadow-[0_4px_12px_rgba(0,0,0,0.1)] hover:bg-warm-600 active:scale-[0.96] disabled:opacity-50',
    // 次级按钮：用 Apple 的 fill 色打底，不描边。系统里这类按钮都是淡底色块。
    outline:
      'bg-[var(--surface-2)] text-[var(--text)] hover:brightness-95 active:scale-[0.96] dark:hover:brightness-110',
    ghost: 'text-brand-500 hover:bg-[var(--surface-2)] active:scale-[0.96] dark:text-brand-600',
    danger: 'bg-[var(--danger)] text-white hover:brightness-95 active:scale-[0.96]',
  };
  /**
   * 尺寸。
   * 44px 是 iOS 的最小可点区，md 因此钉在 h-11。
   * 圆角统一 12px（rounded-xl），sm 也不例外 —— 按钮只该有一种圆角。
   */
  const sizes = {
    sm: 'h-9 px-4 text-sm rounded-xl gap-2',
    md: 'h-11 px-6 text-sm rounded-xl gap-2',
    lg: 'h-12 px-8 text-base rounded-xl gap-2',
  };
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-medium',
        // 过渡用 Apple 的标准缓动，不用 Tailwind 默认的 ease
        'transition-all duration-300 [transition-timing-function:var(--ease-standard)]',
        'disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100',
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
    // 内边距对齐 8pt 网格：手机 16px，宽屏 24px
    <div className={cn('card p-4 sm:p-6', lifted && 'card-lifted', className)} {...rest}>
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
   * 徽章配色。
   * 用 Apple 的半透明 fill 而不是实心淡色：叠在玻璃卡片上时，
   * 实心色块会把下面透出来的层次遮掉。
   */
  const tones = {
    neutral: 'bg-[var(--surface-2)] text-[var(--text-dim)]',
    brand: 'bg-brand-500/12 text-brand-700 dark:text-brand-300',
    warm: 'bg-warm-500/14 text-warm-700 dark:text-warm-300',
    danger: 'bg-[var(--danger)]/12 text-[var(--danger)]',
    success: 'bg-[var(--success)]/14 text-[color-mix(in_srgb,var(--success)_80%,black)] dark:text-[var(--success)]',
  };
  return (
    <span
      className={cn(
        // 徽章圆角 8px（rounded-lg 已映射到 8px）
        'inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-medium',
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
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]', className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-brand-500 transition-[width] duration-500 [transition-timing-function:var(--ease-standard)] dark:bg-brand-600"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        // 输入框用 fill 色打底、不描边，这是 Apple 表单的默认形态
        'w-full rounded-xl bg-[var(--surface-2)] p-4 text-base sm:text-sm',
        'placeholder:text-[var(--text-dim)] focus:outline-none',
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
        'h-11 w-full rounded-xl bg-[var(--surface-2)] px-4 text-base sm:text-sm',
        'placeholder:text-[var(--text-dim)] focus:outline-none',
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
    // 错误用 systemRed 的半透明底，不描边 —— 系统里的提示块都是纯色底没有框
    <div className="rounded-2xl bg-[var(--danger)]/10 p-4 text-sm text-[var(--danger)]">
      <p className="whitespace-pre-wrap">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
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
    <div className="flex flex-col items-center rounded-2xl bg-[var(--surface-2)] px-6 py-8 text-center">
      {icon && <div className="mb-2 text-[var(--text-dim)]">{icon}</div>}
      <p className="font-medium">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-sm dim">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

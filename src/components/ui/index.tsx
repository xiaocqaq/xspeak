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
    primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-300',
    warm: 'bg-warm-500 text-white hover:brightness-95 disabled:opacity-50',
    outline:
      'border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)] text-[var(--text)]',
    ghost: 'hover:bg-[var(--surface-2)] text-[var(--text)]',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  };
  const sizes = {
    sm: 'h-8 px-3 text-sm rounded-lg gap-1.5',
    md: 'h-10 px-4 text-sm rounded-xl gap-2',
    lg: 'h-12 px-6 text-base rounded-xl gap-2',
  };
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-medium transition-colors',
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

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card p-5', className)} {...rest}>
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
  const tones = {
    neutral: 'bg-[var(--surface-2)] text-[var(--text-dim)]',
    brand: 'bg-brand-100 text-brand-700 dark:bg-brand-800 dark:text-brand-100',
    warm: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
    danger: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
    success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
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
      className={cn('h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]', className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-brand-500 transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm',
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
        'h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm',
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
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
      <p className="whitespace-pre-wrap">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm dim">{hint}</p>}
    </div>
  );
}

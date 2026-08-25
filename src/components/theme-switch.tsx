'use client';

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/cn';
import { applyTheme, readTheme, THEMES, type Theme } from '@/lib/theme';

const LABELS: Record<Theme, string> = {
  light: '浅色主题',
  dark: '深色主题',
  system: '跟随系统',
};

const ICONS: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

/**
 * 三态外观开关。
 *
 * 初值从 DOM 读（防闪脚本已经写好了 data-theme），不从 localStorage 读 ——
 * 服务端渲染时 localStorage 不存在，读它会导致首帧 hydration 不一致。
 */
export function ThemeSwitch({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => setTheme(readTheme()), []);

  // system 档要跟着系统实时切，不用刷新页面
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const pick = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
  };

  return (
    <div
      role="group"
      aria-label="主题外观"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-[var(--border)] p-0.5',
        'bg-[var(--surface)]',
        className,
      )}
    >
      {THEMES.map((t) => {
        const Icon = ICONS[t];
        const on = theme === t;
        return (
          <button
            key={t}
            type="button"
            title={LABELS[t]}
            aria-label={LABELS[t]}
            aria-pressed={on}
            onClick={() => pick(t)}
            className={cn(
              'grid size-7 place-items-center rounded-md transition-colors duration-150',
              on
                ? 'bg-[var(--surface-hover)] text-brand-600'
                : 'text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-title)]',
            )}
          >
            <Icon className="size-[15px]" strokeWidth={1.7} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

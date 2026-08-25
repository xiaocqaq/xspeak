'use client';

import { useEffect } from 'react';
import { Check, Flame, Headphones, PenLine, Mic, Ruler, Sparkles, X, BookOpen } from 'lucide-react';
import { STAGES, STAGE_META, type Stage } from '@/lib/types';
import { cn } from '@/lib/cn';

/**
 * 七个环节的导航。
 *
 * 宽屏是常驻侧栏，手机是从左侧滑出的抽屉 —— 375px 宽放不下侧栏，
 * 硬塞会把答题区压到没法读。两种形态共用同一份列表渲染，
 * 避免以后改了一处忘了另一处。
 *
 * 点击只切 state 不跳路由：以前从首页点环节是 <Link href="/learn?stage=x">，
 * 每次都整页重载一次，来回切几下就明显卡顿。
 */

const ICONS: Record<Stage, typeof Flame> = {
  warmup: Flame,
  newwords: Sparkles,
  grammar: Ruler,
  listening: Headphones,
  reading: BookOpen,
  speaking: Mic,
  writing: PenLine,
};

function StageList({
  current,
  done,
  onPick,
}: {
  current: Stage;
  done: Stage[];
  onPick: (s: Stage) => void;
}) {
  return (
    <ol className="space-y-1">
      {STAGES.map((s, i) => {
        const isDone = done.includes(s);
        const isCurrent = s === current;
        const Icon = ICONS[s];
        return (
          <li key={s}>
            <button
              type="button"
              onClick={() => onPick(s)}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left',
                'transition-colors duration-300 [transition-timing-function:var(--ease-standard)]',
                isCurrent
                  ? 'bg-brand-500/12 text-brand-700 dark:text-brand-300'
                  : 'text-[var(--text)] hover:bg-[var(--surface-2)]',
              )}
            >
              {/* 序号位在“已完成”时换成勾，不额外占一列 */}
              <span
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
                  isDone
                    ? 'bg-[var(--success)] text-white'
                    : isCurrent
                      ? 'bg-brand-500 text-white dark:bg-brand-600'
                      : 'bg-[var(--surface-2)] text-[var(--text-dim)]',
                )}
              >
                {isDone ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <Icon className={cn('size-4 shrink-0', !isCurrent && 'dim')} aria-hidden />
              <span className={cn('flex-1 truncate text-sm', isDone && !isCurrent && 'dim')}>
                {STAGE_META[s].zh}
              </span>
              <span className="text-[11px] tabular-nums dim">{STAGE_META[s].minutes}′</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * 宽屏常驻侧栏。手机上整个隐藏。
 *
 * 宽度取 12rem（192px）而不更宽：站内容器是 48rem，
 * 侧栏 12rem + 间距 2rem + 答题区 34rem 刚好塞得下，
 * 不必为了它去拉宽全站布局。
 */
export function StageSidebar(props: { current: Stage; done: Stage[]; onPick: (s: Stage) => void }) {
  return (
    <nav className="hidden w-48 shrink-0 md:block" aria-label="学习环节">
      <div className="sticky top-6">
        <p className="mb-3 px-3 text-[13px] font-semibold dim">今天这样走</p>
        <StageList {...props} />
      </div>
    </nav>
  );
}

/** 手机抽屉。从左侧滑出，点遮罩或选完自动关。 */
export function StageDrawer({
  open,
  onClose,
  ...props
}: {
  open: boolean;
  onClose: () => void;
  current: Stage;
  done: Stage[];
  onPick: (s: Stage) => void;
}) {
  // 抽屉开着时锁背景滚动，否则手指滑动会带着底下的页面一起动
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      {/* 遮罩也用模糊，和站里其他浮层一致 */}
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <div
        className="absolute inset-y-0 left-0 w-72 max-w-[80vw] overflow-y-auto p-4 chrome-material"
        role="dialog"
        aria-label="学习环节"
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[15px] font-semibold">今天这样走</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="-mr-2 rounded-lg p-2 text-[var(--text-dim)] hover:bg-[var(--surface-2)]"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <StageList
          {...props}
          onPick={(s) => {
            props.onPick(s);
            onClose();
          }}
        />
      </div>
    </div>
  );
}

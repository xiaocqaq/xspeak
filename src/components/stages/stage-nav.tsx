'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  BookOpen,
  Check,
  Flame,
  Headphones,
  Mic,
  Ruler,
  Sparkles,
} from 'lucide-react';
import { SidebarDrawer, SidebarFrame, SidebarGroup } from '@/components/shell/sidebar-frame';
import { STAGES, STAGE_META, type Stage } from '@/lib/types';
import { cn } from '@/lib/cn';

/**
 * 六个环节的导航。
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
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left',
                'transition-colors duration-150',
                isCurrent
                  ? 'bg-[var(--surface-active)] font-semibold text-brand-600'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-title)]',
              )}
            >
              {/* 序号位在“已完成”时换成勾，不额外占一列 */}
              <span
                className={cn(
                  // 序号章是方角小牌（圆形实心块站里只留给通话按钮），没走到的空心
                  'grid size-[22px] shrink-0 place-items-center rounded-md text-[11px] font-semibold tabular-nums',
                  isDone
                    ? 'bg-[var(--accent-bar)] text-white'
                    : isCurrent
                      ? 'bg-brand-600 text-white'
                      : 'border border-[var(--border)] bg-[var(--bg-sidebar)] text-[var(--text-faint)]',
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
 * 宽屏常驻侧栏。
 *
 * 用和全站导航同一个 SidebarFrame，所以从首页进到学习里，视觉上是
 * "同一条侧栏换了内容"（导航 → 六个环节），而不是两条不同的侧栏各占一边。
 * AppShell 在 /learn 下不渲染全站侧栏，位置留给这一条。
 */
export function StageSidebar(props: { current: Stage; done: Stage[]; onPick: (s: Stage) => void }) {
  return (
    <SidebarFrame label="学习环节">
      <SidebarGroup title="今天这样走">
        <StageList {...props} />
      </SidebarGroup>
      <Link
        href="/"
        className={cn(
          'flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]',
          'text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-title)]',
        )}
      >
        <ArrowLeft className="size-4" aria-hidden />
        回首页
      </Link>
    </SidebarFrame>
  );
}

/** 手机抽屉。和全站导航共用 SidebarDrawer，选完自动关。 */
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
  return (
    <SidebarDrawer open={open} onClose={onClose} label="今天这样走">
      <StageList
        {...props}
        onPick={(s) => {
          props.onPick(s);
          onClose();
        }}
      />
      <Link
        href="/"
        onClick={onClose}
        className={cn(
          'mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]',
          'text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-title)]',
        )}
      >
        <ArrowLeft className="size-4" aria-hidden />
        回首页
      </Link>
    </SidebarDrawer>
  );
}

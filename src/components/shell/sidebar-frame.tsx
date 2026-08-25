'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * 侧栏的外框。
 *
 * 站里有两种侧栏内容：全站导航（大多数页面）和六个环节（/learn）。
 * 两者共用这一套定位和尺寸，所以从首页进入学习时，视觉上是"同一条侧栏换了内容"，
 * 而不是"一条侧栏消失、另一条出现"。宽度和顶栏高度写在这里，改一处即可。
 */

/**
 * 宽屏常驻侧栏。lg 以下整个隐藏，改走抽屉。
 * 宽度和顶栏高度是 globals.css 里的 --sidebar-w / --topbar-h，
 * 主内容区的左偏移读同一个变量，不会各写一份数字然后对不上。
 */
export function SidebarFrame({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        'sidebar-surface fixed bottom-0 left-0 z-[15] hidden overflow-y-auto lg:block',
        'border-r border-[var(--border)] px-4 py-6',
        'top-[var(--topbar-h)] w-[var(--sidebar-w)]',
        // 侧栏自己滚到底时不要把整页带着滚
        '[overscroll-behavior:contain]',
      )}
    >
      {children}
    </nav>
  );
}

/**
 * 手机抽屉。从左侧滑出，点遮罩或按 Esc 关。
 * 内容和常驻侧栏是同一份，调用方传进来。
 */
export function SidebarDrawer({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
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
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-label={label}
        className={cn(
          'sidebar-surface absolute inset-y-0 left-0 w-[min(19rem,86vw)] overflow-y-auto',
          'px-4 py-5 shadow-[16px_0_32px_var(--drawer-shadow)]',
        )}
      >
        <div className="mb-4 flex items-center justify-between pl-2">
          <span className="section-label">{label}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-lg p-1.5 text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-title)]"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 侧栏里的分组标题 */
export function SidebarGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <p className="section-label mb-2 px-3">{title}</p>
      {children}
    </div>
  );
}

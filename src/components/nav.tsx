'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, BookMarked, GraduationCap, Home, MessagesSquare } from 'lucide-react';
import { cn } from '@/lib/cn';

const ITEMS = [
  { href: '/', label: '首页', Icon: Home },
  { href: '/learn', label: '今日学习', Icon: GraduationCap },
  { href: '/chat', label: 'AI 对话', Icon: MessagesSquare },
  { href: '/vocab', label: '词库', Icon: BookMarked },
  { href: '/stats', label: '数据', Icon: BarChart3 },
] as const;

export function Nav() {
  const pathname = usePathname();
  // 引导页专注填表，不要底栏干扰
  if (pathname?.startsWith('/onboarding')) return null;

  return (
    <nav
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)]',
        'bg-[var(--surface)]/90 backdrop-blur-md',
        'pb-[env(safe-area-inset-bottom)] sm:static sm:mx-auto sm:mb-6 sm:mt-2 sm:w-full sm:max-w-3xl',
        'sm:rounded-2xl sm:border sm:bg-[var(--surface)]',
      )}
      aria-label="主导航"
    >
      <ul className="mx-auto flex max-w-3xl items-stretch justify-between px-2 sm:px-3">
        {ITEMS.map(({ href, label, Icon }) => {
          const active = href === '/' ? pathname === '/' : Boolean(pathname?.startsWith(href));
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-[11px] font-medium transition-colors',
                  'sm:flex-row sm:justify-center sm:gap-2 sm:text-sm',
                  active
                    ? 'text-brand-600 dark:text-brand-300'
                    : 'text-[var(--text-dim)] hover:text-[var(--text)]',
                )}
              >
                <Icon className={cn('size-5 sm:size-4', active && 'stroke-[2.5]')} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

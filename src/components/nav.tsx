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
        'fixed inset-x-0 bottom-0 z-40',
        // 常驼 chrome 用玻璃材质：内容从下面滚过去时透出一点，这是 Apple 的层次语言。
        // 上边框用 0.5px 而不是 1px —— 1px 在高分屏上看起来是一条粗线。
        'chrome-material border-t-[0.5px] border-[var(--hairline)]',
        'pb-[env(safe-area-inset-bottom)] sm:static sm:mx-auto sm:mb-6 sm:mt-2 sm:w-full sm:max-w-3xl',
        'sm:rounded-2xl sm:border-[0.5px] sm:shadow-[var(--shadow-card)]',
      )}
      aria-label="主导航"
    >
      <ul className="mx-auto flex max-w-3xl items-stretch justify-between px-2 sm:px-4">
        {ITEMS.map(({ href, label, Icon }) => {
          const active = href === '/' ? pathname === '/' : Boolean(pathname?.startsWith(href));
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  // touch-manipulation 去掉移动端 300ms 双击缩放的点击延迟
                  'flex touch-manipulation flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium',
                  'transition-colors duration-300 [transition-timing-function:var(--ease-standard)]',
                  'sm:flex-row sm:justify-center sm:gap-2 sm:py-3 sm:text-sm',
                  // 选中态用主色文字，不加底色块 —— iOS TabBar 就是这么做的
                  active
                    ? 'text-brand-500 dark:text-brand-600'
                    : 'text-[var(--text-dim)] hover:text-[var(--text)]',
                )}
              >
                <Icon
                  className={cn('size-6 sm:size-4', active && 'stroke-[2.5]')}
                  aria-hidden
                />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

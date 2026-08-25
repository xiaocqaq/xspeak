'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Import, Ruler, Settings } from 'lucide-react';
import { cn } from '@/lib/cn';

/** 二级入口。底栏留给每天都点的五个页面，这三个放顶上。 */
const ITEMS = [
  { href: '/grammar', label: '语法', Icon: Ruler },
  { href: '/import', label: '导入', Icon: Import },
  { href: '/settings', label: '设置', Icon: Settings },
] as const;

export function TopBar() {
  const pathname = usePathname();
  if (pathname?.startsWith('/onboarding') || pathname?.startsWith('/learn')) return null;

  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <Link href="/" className="text-base font-semibold tracking-[-0.022em]">
        X<span className="text-brand-500 dark:text-brand-600">Learn</span>
      </Link>
      <nav className="flex items-center gap-1" aria-label="次级导航">
        {ITEMS.map(({ href, label, Icon }) => {
          const active = Boolean(pathname?.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-medium',
                'transition-colors duration-300 [transition-timing-function:var(--ease-standard)]',
                active
                  ? 'bg-[var(--surface-2)] text-brand-500 dark:text-brand-600'
                  : 'text-[var(--text-dim)] hover:bg-[var(--surface-2)]',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

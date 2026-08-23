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
    <div className="mb-2 flex items-center justify-between gap-2">
      <Link href="/" className="text-sm font-semibold tracking-tight">
        林习<span className="text-brand-600 dark:text-brand-300">英语</span>
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
                'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'bg-[var(--surface-2)] text-brand-600 dark:text-brand-300'
                  : 'text-[var(--text-dim)] hover:bg-[var(--surface-2)]',
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

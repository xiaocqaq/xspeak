'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PanelLeft } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ThemeSwitch } from '@/components/theme-switch';
import { SidebarDrawer, SidebarFrame } from './sidebar-frame';
import { SiteNav } from './site-nav';

/**
 * 全站骨架：固定顶栏 + 左侧栏 + 主内容区。
 *
 * ownsSidebar 由调用方（路由分组的 layout）传进来，不在这里按路径猜：
 * /learn 自己带一条环节侧栏（StageSidebar），全站侧栏就不能再渲染，
 * 否则一屏两条。顶栏两边都留着，它承担返回和主题切换。
 *
 * 完全不要 chrome 的页面（/onboarding）根本不会走到这个组件。
 */
export function AppShell({
  children,
  ownsSidebar = false,
}: {
  children: React.ReactNode;
  /** 页面自带侧栏时置 true：不渲染全站侧栏，内容区也不留侧栏的位置。 */
  ownsSidebar?: boolean;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 换页时把抽屉关掉，否则点完导航抽屉还盖在新页面上
  useEffect(() => setDrawerOpen(false), [pathname]);

  return (
    <>
      <header
        className={cn(
          'chrome-material fixed inset-x-0 top-0 z-20 flex items-center gap-3',
          'h-[var(--topbar-h)] border-b border-[var(--border-chrome)] px-4 sm:px-6',
        )}
      >
        {!ownsSidebar && (
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="打开导航"
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-lg lg:hidden',
              'border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]',
              'hover:bg-[var(--surface-hover)] hover:text-brand-600',
            )}
          >
            <PanelLeft className="size-[15px]" strokeWidth={1.8} aria-hidden />
          </button>
        )}

        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <span
            className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-500 text-[13px] font-bold text-white"
            aria-hidden
          >
            X
          </span>
          <span className="truncate font-serif text-[17px] font-bold tracking-[-0.02em] text-[var(--text-title)]">
            XLearn
          </span>
        </Link>

        <div className="flex-1" />
        <ThemeSwitch />
      </header>

      {!ownsSidebar && (
        <>
          <SidebarFrame label="主导航">
            <SiteNav />
          </SidebarFrame>
          <SidebarDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} label="主导航">
            <SiteNav onNavigate={() => setDrawerOpen(false)} />
          </SidebarDrawer>
        </>
      )}

      <main
        className={cn(
          'min-h-dvh pt-[var(--topbar-h)]',
          !ownsSidebar && 'lg:pl-[var(--sidebar-w)]',
        )}
      >
        {/*
          外层一律给到 --content-w-wide，单列正文的页面（导入、设置、语法）自己
          再收到 --content-w。反过来做过一版——在这里按路由白名单决定宽度——
          结果是 usePathname() 在服务端渲染时是 null，白名单一个都不匹配，
          HTML 先按窄的发出去，水合完再跳成宽的，每次进页面都闪一下。
          宽度是每个页面自己的静态属性，不该依赖只有浏览器才知道的路由。

          /learn 自己排两列，连这层上限都不套。
        */}
        <div
          className={cn(
            'mx-auto w-full px-4 pb-16 pt-6 sm:px-6 sm:pt-8',
            !ownsSidebar && 'max-w-[var(--content-w-wide)]',
          )}
        >
          {children}
        </div>
      </main>
    </>
  );
}

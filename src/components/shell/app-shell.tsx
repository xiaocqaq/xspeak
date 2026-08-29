'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PanelLeft } from 'lucide-react';
import { cn } from '@/lib/cn';
import { BrandMark } from '@/components/brand-mark';
import { ThemeSwitch } from '@/components/theme-switch';
import { apiGet } from '@/lib/fetcher';
import { writePace } from '@/lib/pace-store';
import { writeOfflineVoice, writeVoice } from '@/lib/voice-store';
import { PACE_KEYS } from '@/lib/voice-options';
import type { SpeechPace } from '@/lib/types';
import { SidebarDrawer, SidebarFrame } from './sidebar-frame';
import { SiteNav } from './site-nav';

/**
 * 音色/语速偏好的「换设备回填」。
 *
 * localStorage 只是缓存，真值在数据库。但原来只有设置页会往里写 ——
 * 用户在 A 浏览器选了 MiMo，换到 B 浏览器（或生产站这个 origin）第一次
 * 进来时 localStorage 是空的，所有朗读按钮全走浏览器语音包，库里存的
 * 在线音色等于没选。这就是「新词/语法/阅读在线 TTS 全落本地」的根因。
 *
 * 所以 AppShell（所有页面的共同外壳）挂载时拉一次 /api/profile：
 * DB 里有 voice/pace 且本地还没写过 → 写进 localStorage 并广播。
 * 本地已有值就不动 —— 设置页是「显式选择」，优先级高于这次静默回填；
 * 本地值与库不同的场景（在另一台设备上改过还没保存）以本地为准。
 * 请求失败静默忽略：读档失败不该挡住页面。
 */
function useSyncProfilePrefs() {
  useEffect(() => {
    let alive = true;
    apiGet<{ user: { voice: string | null; voice_offline: string | null; speech_pace: string | null } }>(
      '/api/profile',
    )
      .then((d) => {
        if (!alive || !d?.user) return;
        try {
          const local = localStorage.getItem('linxi.ttsVoice');
          if (d.user.voice) {
            // 库里选了在线音色：本地为空时回填（换设备场景）
            if (!local) writeVoice(d.user.voice);
          } else {
            /*
             * 库里没有在线偏好，但本地残留着一个「浏览器语音包名」（如 "Karen"）
             * —— 历史版本设置页写回的默认值，不代表用户刻意选择。清掉，
             * 让 alt 兜底用默认 MiMo 音色。
             */
            if (local && !local.startsWith('kokoro:') && !local.startsWith('mimo:')) writeVoice(null);
          }
          // 自建偏好（voice_offline）：本地为空时回填，脏值同样清掉
          const localOff = localStorage.getItem('linxi.ttsVoiceOffline');
          if (d.user.voice_offline && !localOff) writeOfflineVoice(d.user.voice_offline);
          if (!d.user.voice_offline && localOff && !localOff.startsWith('kokoro:')) {
            writeOfflineVoice(null);
          }
        } catch {
          /* 隐私模式 localStorage 会抛，忽略 —— 偏好缓存本来就是尽力而为 */
        }
        if (
          d.user.speech_pace &&
          PACE_KEYS.includes(d.user.speech_pace as SpeechPace) &&
          !localStorage.getItem('linxi.speechPace')
        ) {
          writePace(d.user.speech_pace as SpeechPace);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
}

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

  // 换设备/换浏览器时把库里的音色、语速偏好回填到本地（见 useSyncProfilePrefs）
  useSyncProfilePrefs();

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
          {/*
            标识压在绿底上而不是直接摆在顶栏里：气泡是描边形，
            透明底下深浅主题各要一套颜色，绿底白形两套主题都能用同一份。
            气泡尾巴在左下，形状比方形略高，所以给高度不给宽度。
          */}
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-500 text-white">
            <BrandMark className="h-[19px] w-auto" />
          </span>
          <span className="truncate font-serif text-[17px] font-bold tracking-[-0.02em] text-[var(--text-title)]">
            xSpeak
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

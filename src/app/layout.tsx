import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SwRegister } from '@/components/sw-register';
import { THEME_COLORS, THEME_INIT_SCRIPT } from '@/lib/theme';
import { withBase } from '@/lib/base-path';

export const metadata: Metadata = {
  title: { default: 'XLearn', template: '%s · XLearn' },
  description: '每天 30 分钟，AI 陪你把英语真正用出来：单词、语法、听力、阅读、口语一条线走完。',
  applicationName: 'XLearn',
  /*
   * metadata 里的路径 Next 不会自动加 basePath（只有 <Link>、_next 和 public 的直接引用会），
   * 所以这几个都得自己补。漏了的话子路径部署下 manifest 和图标会 404，PWA 直接装不上。
   */
  manifest: withBase('/manifest.webmanifest'),
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'XLearn' },
  icons: {
    icon: [
      { url: withBase('/icons/icon-192.png'), sizes: '192x192', type: 'image/png' },
      { url: withBase('/icons/icon-512.png'), sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: withBase('/icons/icon-192.png'), sizes: '192x192' }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  /**
   * 单值而不是 light/dark 两条媒体查询：深浅由 data-appearance 决定，
   * 系统偏好只是其中一个输入。真正的值由防闪脚本和 applyTheme 在运行时改写，
   * 这里给的是浅色初值。
   */
  themeColor: THEME_COLORS.light,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /**
     * data-appearance 给个浅色初值，防闪脚本会在首帧前改写它。
     * 不给初值的话，脚本被 CSP 挡掉时整站会退化成无主题（变量全部取不到）。
     */
    <html lang="zh-CN" data-appearance="light" data-theme="system" suppressHydrationWarning>
      <head>
        {/*
          Manrope 只覆盖拉丁字，中文走系统字体。
          preconnect 两个域名：CSS 在 googleapis，字体文件在 gstatic，
          少一个就有一次多余的握手。crossOrigin 对字体域是必需的。
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap"
        />
        {/*
          防闪脚本必须同步、必须在 body 之前跑完。
          用 dangerouslySetInnerHTML 而不是 next/script：后者最早也是 afterInteractive，
          那时首帧已经画完了，系统深色的访客会看到一帧浅色。
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      {/*
        这一层只管全站共有的东西（字体、主题、SW）。外壳（顶栏/侧栏）不在这里，
        由三个路由分组各自的 layout 决定：
        (app) 全套 chrome、(learn) 只要顶栏、(bare) 什么都不要。

        分组而不是在一个 client 外壳里按 usePathname() 判断：服务端渲染时
        usePathname() 是 null，判断全部落到默认分支，HTML 会先发错的 chrome
        再靠水合纠正——/onboarding 会闪一下顶栏和侧栏，/learn 会闪出两条侧栏。
      */}
      <body className="min-h-dvh antialiased">
        <SwRegister />
        {children}
      </body>
    </html>
  );
}

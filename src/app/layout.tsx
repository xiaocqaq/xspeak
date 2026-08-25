import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Nav } from '@/components/nav';
import { TopBar } from '@/components/topbar';
import { SwRegister } from '@/components/sw-register';

export const metadata: Metadata = {
  title: { default: 'XLearn', template: '%s · XLearn' },
  description: '每天 30 分钟，AI 陪你把英语真正用出来：单词、语法、听力、口语、写作批改一条线走完。',
  applicationName: 'XLearn',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'XLearn' },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-192.png', sizes: '192x192' }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    // 和 globals.css 的 --bg 保持一致，否则 PWA 状态栏会和页面顶端割裂
    { media: '(prefers-color-scheme: light)', color: '#f2f2f7' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-dvh antialiased">
        <SwRegister />
        {/* 容器内边距对齐 8pt 网格；底部给导航留 96px */}
        <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-24 pt-6 sm:pb-8">
          <TopBar />
          <main className="flex-1">{children}</main>
        </div>
        <Nav />
      </body>
    </html>
  );
}

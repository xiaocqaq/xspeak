import Link from 'next/link';

export const metadata = { title: '离线' };

/** Service Worker 在导航失败时回这个页面。纯静态，不能依赖任何接口。 */
export default function Offline() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center text-center">
      <p className="text-5xl" aria-hidden>
        📴
      </p>
      <h1 className="mt-4 text-xl font-semibold">连不上了</h1>
      <p className="mt-2 max-w-sm text-sm dim">
        学习内容要现场找 AI 生成，也要写回本机数据库，所以离线状态下没法继续。
        <br />
        网络回来后刷新就行，今天的进度都还在。
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex h-10 items-center rounded-xl bg-brand-600 px-4 text-sm font-medium text-white"
      >
        重试
      </Link>
    </div>
  );
}

import { AppShell } from '@/components/shell/app-shell';

/**
 * 今日学习：只要顶栏。
 *
 * 页面自己有一条环节侧栏（StageSidebar），全站侧栏让位，
 * 内容区也不套宽度上限——它自己排两列。
 */
export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return <AppShell ownsSidebar>{children}</AppShell>;
}

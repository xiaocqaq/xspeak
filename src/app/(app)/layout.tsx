import { AppShell } from '@/components/shell/app-shell';

/** 常规页面：顶栏 + 全站侧栏 + 居中内容区。 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

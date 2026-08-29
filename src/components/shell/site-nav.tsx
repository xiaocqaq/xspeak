'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  BookMarked,
  FileInput,
  GraduationCap,
  Home,
  MessagesSquare,
  Ruler,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { SidebarGroup } from './sidebar-frame';

/**
 * 全站导航。
 *
 * 分两组：每天都会点的五个入口，和偶尔才动的三个。
 * 上一版把前者放底部 TabBar、后者放顶栏，两处割裂；现在同一条侧栏里分组排下来，
 * 层级关系一眼看得见。
 */

const PRIMARY = [
  { href: '/', label: '首页', Icon: Home, hint: '今天的安排' },
  { href: '/learn', label: '今日学习', Icon: GraduationCap, hint: '六个环节' },
  { href: '/chat', label: 'AI 对话', Icon: MessagesSquare, hint: '挑场景打电话' },
  { href: '/vocab', label: '词库', Icon: BookMarked, hint: '生词本与复习' },
  { href: '/stats', label: '数据', Icon: BarChart3, hint: '进度与错误本' },
] as const;

const SECONDARY = [
  { href: '/grammar', label: '语法', Icon: Ruler },
  { href: '/import', label: '导入', Icon: FileInput },
  { href: '/settings', label: '设置', Icon: Settings },
] as const;

function isActive(pathname: string | null, href: string) {
  return href === '/' ? pathname === '/' : Boolean(pathname?.startsWith(href));
}

/** 侧栏里的一行。选中态用主色文字 + 浅主色底，不用实心色块。 */
function NavRow({
  href,
  label,
  hint,
  Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  hint?: string;
  Icon: typeof Home;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150',
        active
          ? 'bg-[var(--surface-active)] text-brand-600 font-semibold'
          : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-title)]',
      )}
    >
      <Icon
        className={cn('size-[18px] shrink-0', !active && 'text-[var(--text-dim)]')}
        strokeWidth={active ? 2.2 : 1.8}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-tight">{label}</span>
        {hint && (
          <span className="mt-0.5 block truncate text-[11.5px] font-normal text-[var(--text-faint)]">
            {hint}
          </span>
        )}
      </span>
    </Link>
  );
}

export function SiteNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <>
      <SidebarGroup title="每天">
        <ul className="space-y-0.5">
          {PRIMARY.map((it) => (
            <li key={it.href}>
              <NavRow {...it} active={isActive(pathname, it.href)} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </SidebarGroup>

      <SidebarGroup title="资料与设置">
        <ul className="space-y-0.5">
          {SECONDARY.map((it) => (
            <li key={it.href}>
              <NavRow {...it} active={isActive(pathname, it.href)} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </SidebarGroup>
    </>
  );
}

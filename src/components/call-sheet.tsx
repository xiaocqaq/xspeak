'use client';

import { useSheetBehavior } from '@/components/sheet';
import { cn } from '@/lib/cn';

/**
 * 通话弹窗的外壳。
 *
 * 和材料弹窗（MaterialSheet）刻意不一样的两点：
 *
 * 1. 没有右上角的关闭叉，点遮罩也不关。里面正开着麦克风和一条 WebSocket，
 *    误触关掉等于半句话说到一半被掐断 —— 挂断只能走那个红按钮，
 *    这也是真打电话的规矩。Esc 仍然接挂断：那是有意识的按键，不是滑一下手指。
 * 2. 高度写死一格而不是随内容长。字幕是一句句冒出来的，跟着内容长会让
 *    挂断按钮一直往下跑，人得追着点。
 */
export function CallSheet({
  open,
  onHangUp,
  label,
  children,
}: {
  open: boolean;
  /** Esc 也走这里，所以它必须是「挂断并关闭」而不只是「关闭」 */
  onHangUp: () => void;
  /** 给读屏用的弹窗名，比如「和 a friendly barista 通话」 */
  label: string;
  children: React.ReactNode;
}) {
  useSheetBehavior(open, onHangUp);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--scrim)] sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div
        className={cn(
          'flex h-[92dvh] w-full flex-col overflow-hidden bg-[var(--surface)]',
          'sm:h-[min(40rem,88dvh)] sm:max-w-lg',
          'rounded-t-2xl sm:rounded-2xl',
          'border-[var(--border)] shadow-[var(--shadow-modal)] sm:border',
        )}
      >
        {children}
      </div>
    </div>
  );
}

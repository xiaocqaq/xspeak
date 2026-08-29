'use client';

import { useEffect } from 'react';

/**
 * 弹窗的两件公共行为：开着时锁背景滚动、按 Esc 关掉。
 *
 * 抽出来是因为站里现在有两种弹窗（材料弹窗、通话弹窗），它们的版式差别很大
 * 但这两条必须一致 —— 各写一份的话，改了一处忘了另一处，就会出现
 * 「有的弹窗按 Esc 有反应有的没有」这种说不清的差异。
 */
export function useSheetBehavior(open: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onEscape]);
}

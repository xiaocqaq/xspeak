'use client';

import { useEffect, useRef } from 'react';
import { CheckCircle2, Loader2, Mic, MicOff, PhoneOff, Radio, Wand2 } from 'lucide-react';
import { Badge, Button, Card, ErrorNote } from '@/components/ui';
import { Speak } from '@/components/stages/shared';
import { useVoiceChat } from '@/hooks/useVoiceChat';
import { cn } from '@/lib/cn';

export type VoiceScenario = {
  conversationId: number;
  aiRole: string;
  scenarioZh: string;
  targetTerms: string[];
  level: string;
};

/**
 * 畅聊面板：语音进、语音出。
 *
 * 和文本对话面板（chat-panel.tsx）的分工是刻意的：
 * - 这里练"不被打断地把话说完"，纠正迟到一两秒，不影响说话节奏；
 * - 那里练"每句都被抠语法"，纠正即时、准确，但要打字等回复。
 *
 * 两边落库完全一致，所以错题本和掌握度判定共用一套。
 */
export function VoiceChatPanel({
  scenario,
  onHangUp,
}: {
  scenario: VoiceScenario;
  onHangUp?: () => void;
}) {
  const vc = useVoiceChat();
  const endRef = useRef<HTMLDivElement>(null);

  // 进来就连，不用再点一次"开始"。
  // 不能用 ref 挡"只跑一次"：严格模式下挂载会跑两遍（挂载→清理→再挂载），
  // 挡住第二次的话连接已经被第一次的清理关掉了，界面就停在"连接断了"。
  // 重连安全由 hook 内部的代次守卫保证。
  useEffect(() => {
    void vc.start(scenario);
    return () => vc.stop();
    // start / stop 是稳定引用，scenario 在这个面板的生命周期里不变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [vc.turns.length, vc.partial]);

  if (!vc.supported) {
    return (
      <Card>
        <p className="text-sm font-medium">这个浏览器用不了畅聊</p>
        <p className="mt-1.5 text-xs dim">
          畅聊需要麦克风和 Web Audio 支持。用 Chrome、Edge 或手机 Safari 打开，
          或者切到「逐句纠正」模式打字练。
        </p>
      </Card>
    );
  }

  // 通话式交互：不需要提示「怎么操作」，只需要让人知道现在是谁在说
  const statusLabel = vc.muted
    ? '已静音，AI 听不到你'
    : vc.status === 'connecting'
      ? '正在接通'
      : vc.status === 'listening'
        ? '在听你说…'
        : vc.status === 'thinking'
          ? '在想怎么回你'
          : vc.status === 'speaking'
            ? 'AI 在说话，你直接开口就能插话'
            : vc.status === 'error'
              ? '连接断了'
              : vc.status === 'idle'
                ? '通话已结束'
                : '在听，说话就行';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs dim">
        <Radio
          className={cn(
            'size-3.5',
            // 正在收音时闪一下，让人确认麦克风真的开着
            vc.status === 'listening' && !vc.muted && 'animate-pulse text-emerald-500',
            vc.status !== 'idle' && vc.status !== 'error' && !vc.muted && 'text-emerald-500',
            vc.muted && 'text-[var(--text-dim)]',
          )}
          aria-hidden
        />
        <span aria-live="polite">{statusLabel}</span>
      </div>

      <div className="min-h-[38dvh] space-y-3 overflow-y-auto">
        {vc.turns.map((t) =>
          t.role === 'user' ? (
            <div key={t.key} className="flex justify-end">
              <div className="max-w-[85%] space-y-1.5">
                <div className="rounded-2xl bg-brand-600 px-3.5 py-2.5 text-white">
                  <p className="en text-[15px] leading-relaxed">{t.text}</p>
                </div>

                {/* 纠正是异步补上来的，没到之前显示占位，避免界面跳动 */}
                {t.correction ? (
                  <div
                    className={cn(
                      'rounded-xl px-3 py-2 text-xs',
                      t.correction.has_issue
                        ? 'bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100'
                        : 'bg-emerald-50 text-emerald-900 dark:bg-emerald-900/25 dark:text-emerald-100',
                    )}
                  >
                    <div className="flex items-center gap-1.5 font-medium">
                      {t.correction.has_issue ? (
                        <>
                          <Wand2 className="size-3.5" aria-hidden /> 可以这么说
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="size-3.5" aria-hidden /> 说得对
                        </>
                      )}
                    </div>
                    {t.correction.has_issue && (
                      <p className="en mt-1 flex items-start gap-1">
                        <span className="flex-1">{t.correction.corrected_en}</span>
                        <Speak text={t.correction.corrected_en} className="p-0.5" />
                      </p>
                    )}
                    <p className="mt-1">{t.correction.note_zh}</p>
                  </div>
                ) : (
                  <p className="text-right text-[11px] dim">纠正稍后补上…</p>
                )}

                {t.usedTerms && t.usedTerms.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-1">
                    {t.usedTerms.map((w) => (
                      <Badge key={w} tone="success">
                        用上了 {w}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div key={t.key} className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl bg-[var(--surface-2)] px-3.5 py-2.5">
                <div className="flex items-start gap-1.5">
                  <p className="en flex-1 text-[15px] leading-relaxed">{t.text}</p>
                  <Speak text={t.text} className="-mr-1 -mt-1" />
                </div>
              </div>
            </div>
          ),
        )}

        {/* 正在说的这句边说边显示 */}
        {vc.partial && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl bg-[var(--surface-2)] px-3.5 py-2.5">
              <p className="en text-[15px] leading-relaxed opacity-70">{vc.partial}</p>
            </div>
          </div>
        )}

        {vc.status === 'thinking' && !vc.partial && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-[var(--surface-2)] px-3.5 py-2.5">
              <Loader2 className="size-4 animate-spin dim" aria-hidden />
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {vc.error && <ErrorNote message={vc.error} />}

      {/* 不需要按任何键说话 —— 这一条只显示当前通话状态，另给静音和挂断两个开关 */}
      <div className="sticky bottom-0 flex items-center gap-2 bg-[var(--bg)] pt-1">
        <div
          className={cn(
            'flex flex-1 items-center gap-2.5 rounded-xl border px-3.5 py-3 text-sm',
            vc.muted
              ? 'border-[var(--border)] text-[var(--text-dim)]'
              : vc.status === 'listening'
                ? 'border-emerald-400 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/25 dark:text-emerald-100'
                : 'border-[var(--border)]',
          )}
          aria-live="polite"
        >
          {vc.muted ? (
            <MicOff className="size-5 shrink-0" aria-hidden />
          ) : (
            <Mic
              className={cn('size-5 shrink-0', vc.status === 'listening' && 'text-emerald-600 dark:text-emerald-300')}
              aria-hidden
            />
          )}
          <span className="flex-1 font-medium">{statusLabel}</span>
          {/* 听到声音时给一个跳动的指示，让人知道麦克风真的在工作 */}
          {vc.status === 'listening' && !vc.muted && (
            <span className="flex items-end gap-0.5" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1 animate-pulse rounded-full bg-emerald-500"
                  style={{ height: `${8 + i * 4}px`, animationDelay: `${i * 140}ms` }}
                />
              ))}
            </span>
          )}
        </div>

        <Button
          variant="outline"
          size="lg"
          onClick={() => vc.setMuted(!vc.muted)}
          disabled={vc.status === 'connecting' || vc.status === 'error'}
          aria-label={vc.muted ? '取消静音' : '静音'}
          aria-pressed={vc.muted}
        >
          {vc.muted ? <MicOff className="size-4" aria-hidden /> : <Mic className="size-4" aria-hidden />}
        </Button>

        <Button
          variant="outline"
          size="lg"
          onClick={() => {
            vc.stop();
            onHangUp?.();
          }}
          aria-label="结束畅聊"
        >
          <PhoneOff className="size-4" aria-hidden />
        </Button>
      </div>

      <p className="text-center text-[11px] dim">
        像打电话一样，直接说就行，说完停一下 AI 就会接话。纠正随后补上，也会进错题本。
      </p>
    </div>
  );
}

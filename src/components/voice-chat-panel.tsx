'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, MessagesSquare, Mic, MicOff, Phone, PhoneOff, Radio, RefreshCw, Wand2 } from 'lucide-react';
import { Badge, Button, Card, Empty, ErrorNote } from '@/components/ui';
import { Speak } from '@/components/stages/shared';
import { useVoiceChat } from '@/hooks/useVoiceChat';
import { cn } from '@/lib/cn';
import type { SpeechPace } from '@/lib/types';

export type VoiceScenario = {
  conversationId: number;
  aiRole: string;
  scenarioZh: string;
  targetTerms: string[];
  level: string;
  /** StepFun realtime 的音色 id；不传走中转层默认值 */
  voice?: string;
  paceKey?: SpeechPace;
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
  /**
   * 是否已经“接通”。
   *
   * 以前是进页面就自动连接并开麦 —— 直接弹权限、直接开始录音，
   * 人还没准备好说话。现在改成打电话的节奏：先看到“要跟谁聊、聊什么”，
   * 自己点接通才开麦。
   */
  const [connected, setConnected] = useState(false);

  // 离开页面一定要挂断，否则麦克风和 WebSocket 会一直开着
  useEffect(() => () => vc.stop(), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps

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

  /**
   * 待机屏（还没接通）。
   *
   * 像打进来的电话：先告诉你对方是谁、要聊什么，再给一个接通按钮。
   * 权限弹窗和录音都发生在点下去之后，而不是一进页面就偷偷开麦。
   */
  if (!connected) {
    return (
      <div className="flex flex-col items-center gap-8 py-10 text-center">
        {/* 头像位：用角色首字母，不弄头像图片 */}
        <div className="grid size-24 place-items-center rounded-full bg-brand-500/12">
          <Radio className="size-10 text-brand-500 dark:text-brand-600" aria-hidden />
        </div>

        <div className="space-y-2">
          <p className="text-xl font-semibold">{scenario.aiRole}</p>
          <p className="mx-auto max-w-xs text-sm leading-relaxed dim">{scenario.scenarioZh}</p>
        </div>

        {scenario.targetTerms.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {scenario.targetTerms.map((t) => (
              <span
                key={t}
                className="en rounded-lg bg-[var(--surface-2)] px-2.5 py-1 text-[13px]"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setConnected(true);
              void vc.start(scenario);
            }}
            aria-label="接通"
            className={cn(
              'grid size-16 place-items-center rounded-full bg-[var(--success)] text-white',
              'shadow-[0_4px_16px_rgba(0,0,0,0.2)]',
              'transition-transform duration-300 [transition-timing-function:var(--ease-spring)]',
              'hover:scale-105 active:scale-95',
            )}
          >
            <Phone className="size-7" aria-hidden />
          </button>
          <p className="text-[13px] dim">点一下开始说话</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs dim">
        <Radio
          className={cn(
            'size-3.5',
            // 正在收音时闪一下，让人确认麦克风真的开着
            vc.status === 'listening' && !vc.muted && 'animate-pulse text-brand-500',
            vc.status !== 'idle' && vc.status !== 'error' && !vc.muted && 'text-brand-500',
            vc.muted && 'text-[var(--text-dim)]',
          )}
          aria-hidden
        />
        <span aria-live="polite">{statusLabel}</span>
      </div>

      <div className="min-h-[38dvh] space-y-3 overflow-y-auto">
        {/* 刚接通、还一句没说时给个落点。不然上下一片空白，人不知道该干什么 */}
        {vc.turns.length === 0 && !vc.partial && vc.status !== 'error' && (
          <Empty
            icon={<MessagesSquare className="size-7" aria-hidden />}
            title={vc.status === 'connecting' ? '正在接通…' : '接通了，说第一句吧'}
            hint={
              vc.status === 'connecting'
                ? '第一次会弹麦克风权限，允许之后就能开口。'
                : `${scenario.scenarioZh} 直接说英文，说完停一下就行。`
            }
          />
        )}

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
                        ? 'bg-warm-100/70 text-warm-800 dark:bg-warm-900/40 dark:text-warm-100'
                        : 'bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-100',
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

      {/*
        连接断了的时候，静音和挂断都没有意义 —— 前者操作的是不存在的通话，
        后者等于让人手动确认失败。这时只留一个「重新接通」，
        它同时会重新触发麦克风权限请求，被拒过的人也有路可走。

        兼底文案是必要的：重连时会先清掉 error，存在「状态已经是 error
        但文案还没写回来」的瞬间。那一瞬间不能只给用户一个光秃的按钮。
      */}
      {vc.status === 'error' ? (
        <div className="sticky bottom-0 space-y-2 bg-[var(--bg)] pt-1">
          <ErrorNote
            message={
              vc.error ??
              '语音通话没能接通。常见原因是麦克风权限被拒，浏览器地址栏左侧可以重新允许。'
            }
          />
          <div className="flex items-center gap-2">
            <Button size="lg" className="flex-1" onClick={() => void vc.start(scenario)}>
              <RefreshCw className="size-4" aria-hidden />
              重新接通
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                vc.stop();
                onHangUp?.();
              }}
              aria-label="退出畅聊"
            >
              <PhoneOff className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      ) : (
      /* 不需要按任何键说话 —— 这一条只显示当前通话状态，另给静音和挂断两个开关 */
      <div className="sticky bottom-0 flex items-center gap-2 bg-[var(--bg)] pt-1">
        <div
          className={cn(
            'flex flex-1 items-center gap-2.5 rounded-xl border px-3.5 py-3 text-sm',
            vc.muted
              ? 'border-[var(--border)] text-[var(--text-dim)]'
              : vc.status === 'listening'
                ? 'border-brand-400 bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-100'
                : 'border-[var(--border)]',
          )}
          aria-live="polite"
        >
          {vc.muted ? (
            <MicOff className="size-5 shrink-0" aria-hidden />
          ) : (
            <Mic
              className={cn('size-5 shrink-0', vc.status === 'listening' && 'text-brand-600 dark:text-brand-300')}
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
                  className="w-1 animate-pulse rounded-full bg-brand-500"
                  style={{ height: `${8 + i * 4}px`, animationDelay: `${i * 140}ms` }}
                />
              ))}
            </span>
          )}
        </div>

        {/*
          静音和挂断改成圆形图标按钮。
          以前是两个 size="lg" 的方形按钮，在状态条旁边显得特别重 ——
          它们是辅助操作，不应该比“正在聊什么”还抢眼。
          44px 仍然达到 iOS 的最小可点区。
        */}
        <button
          type="button"
          onClick={() => vc.setMuted(!vc.muted)}
          disabled={vc.status === 'connecting'}
          aria-label={vc.muted ? '取消静音' : '静音'}
          aria-pressed={vc.muted}
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-full',
            'transition-all duration-300 [transition-timing-function:var(--ease-standard)] active:scale-90',
            'disabled:opacity-40 disabled:active:scale-100',
            vc.muted
              ? 'bg-warm-500/16 text-warm-700 dark:text-warm-400'
              : 'bg-[var(--surface-2)] text-[var(--text)]',
          )}
        >
          {vc.muted ? <MicOff className="size-5" aria-hidden /> : <Mic className="size-5" aria-hidden />}
        </button>

        <button
          type="button"
          onClick={() => {
            vc.stop();
            onHangUp?.();
          }}
          aria-label="结束畅聊"
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-full bg-[var(--danger)] text-white',
            'transition-transform duration-300 [transition-timing-function:var(--ease-standard)] active:scale-90',
          )}
        >
          <PhoneOff className="size-5" aria-hidden />
        </button>
      </div>
      )}

      {/* 正常通话中才需要这条操作说明；出错时反而是噪音 */}
      {vc.status !== 'error' && (
        <>
          {vc.error && <ErrorNote message={vc.error} />}
          <p className="text-center text-[11px] dim">
            像打电话一样，直接说就行，说完停一下 AI 就会接话。纠正随后补上，也会进错题本。
          </p>
        </>
      )}
    </div>
  );
}

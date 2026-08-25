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
  /** 通话计时。真电话都有这个数字，它是「正在通话中」最直白的证据。 */
  const [seconds, setSeconds] = useState(0);

  // 离开页面一定要挂断，否则麦克风和 WebSocket 会一直开着
  useEffect(() => () => vc.stop(), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!connected) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [connected]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [vc.turns.length, vc.partial]);

  if (!vc.supported) {
    return (
      <Card>
        <h3 className="text-sm">这个浏览器用不了畅聊</h3>
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
        {/* 头像位：描边圆 + 浅底，不弄头像图片 */}
        <div className="grid size-24 place-items-center rounded-full border border-brand-200 bg-brand-50 dark:border-brand-800 dark:bg-brand-900/30">
          <Radio className="size-9 text-brand-600" strokeWidth={1.6} aria-hidden />
        </div>

        <div className="space-y-2">
          {/* 这屏只有一个主角，用衬线大字：像书里的一个人名，而不是一行 UI 文案 */}
          <p className="serif text-[22px] font-bold text-[var(--text-title)]">{scenario.aiRole}</p>
          <p className="mx-auto max-w-xs text-sm leading-relaxed text-[var(--text-secondary)]">
            {scenario.scenarioZh}
          </p>
        </div>

        {scenario.targetTerms.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {scenario.targetTerms.map((t) => (
              <span
                key={t}
                className="en rounded-md border border-[var(--border)] bg-[var(--bg-sidebar)] px-2.5 py-1 text-[13px] text-[var(--text-body)]"
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
            // 通话按钮保持圆形（这是电话的通用语言），但按下只下沉不缩放，跟站里其它控件一致
            className={cn(
              'grid size-16 place-items-center rounded-full bg-[var(--success)] text-white',
              'shadow-[0_2px_10px_color-mix(in_srgb,var(--success)_45%,transparent)]',
              'transition-[filter,transform,box-shadow] duration-200 [transition-timing-function:var(--ease-standard)]',
              'hover:brightness-105 active:translate-y-px',
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
    /*
      通话中的版式：左边是「通话面板」（跟谁在聊、聊了多久、静音和挂断），
      右边是逐句字幕。

      原来这些是竖着堆的 —— 状态一行、字幕一大块、底部再钉两条 sticky 控制条，
      加上页面自己的标题，屏幕上四层东西各占一条，看着就乱。
      真打电话的时候屏幕上只有两件事：对方是谁，和挂断在哪。
    */
    <div className="grid gap-5 xl:grid-cols-[19rem_minmax(0,1fr)] xl:items-start">
      <CallPanel
        scenario={scenario}
        vc={vc}
        seconds={seconds}
        statusLabel={statusLabel}
        onHangUp={onHangUp}
      />

      {/*
        字幕区自己滚，不跟着整页长。高度写死一段而不是 min-h：
        通话面板要一直在视野里，字幕无限长的话它会被顶走。
      */}
      <div className="max-h-[52dvh] space-y-3 overflow-y-auto xl:max-h-[calc(100dvh-var(--topbar-h)-8rem)]">
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
                <div className="rounded-2xl rounded-br-md bg-brand-500 px-3.5 py-2.5 text-white">
                  <p className="en text-[15px] leading-relaxed">{t.text}</p>
                </div>

                {/* 纠正是异步补上来的，没到之前显示占位，避免界面跳动 */}
                {t.correction ? (
                  <div
                    className={cn(
                      'rounded-xl border px-3 py-2 text-xs leading-relaxed',
                      t.correction.has_issue
                        ? 'border-warm-200 bg-warm-50 text-warm-900 dark:border-warm-800 dark:bg-warm-900/40 dark:text-warm-100'
                        : 'border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-800 dark:bg-brand-900/40 dark:text-brand-100',
                    )}
                  >
                    <div className="flex items-center gap-1.5 font-semibold">
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
              <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
                <div className="flex items-start gap-1.5">
                  <p className="en flex-1 text-[15px] leading-relaxed text-[var(--text-body)]">{t.text}</p>
                  <Speak text={t.text} className="-mr-1 -mt-1" />
                </div>
              </div>
            </div>
          ),
        )}

        {/* 正在说的这句边说边显示 */}
        {vc.partial && (
          <div className="flex justify-start">
            {/* 边说边出的字：虚线框表示"还没定稿" */}
            <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-dashed border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
              <p className="en text-[15px] leading-relaxed text-[var(--text-dim)]">{vc.partial}</p>
            </div>
          </div>
        )}

        {vc.status === 'thinking' && !vc.partial && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
              <Loader2 className="size-4 animate-spin dim" aria-hidden />
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>
    </div>
  );
}

/** mm:ss。通话时长不会到小时，多一位反而让人多读一眼。 */
function clock(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 通话面板：一通电话在屏幕上该有的全部信息 —— 跟谁、多久、听没听到、怎么挂。
 *
 * 单独抽出来是因为它在宽屏要 sticky 住，而字幕要能滚：两者不能是同一个盒子。
 * 挂断和静音也从原来钉在页面底部的 sticky 条搬到了这里 —— 底部横条会跟着
 * 页面走，人往上翻看字幕时它就悬在中间挡字。
 */
function CallPanel({
  scenario,
  vc,
  seconds,
  statusLabel,
  onHangUp,
}: {
  scenario: VoiceScenario;
  vc: ReturnType<typeof useVoiceChat>;
  seconds: number;
  statusLabel: string;
  onHangUp?: () => void;
}) {
  const live = vc.status !== 'idle' && vc.status !== 'error' && !vc.muted;

  return (
    <div className="space-y-3 xl:sticky xl:top-[calc(var(--topbar-h)+1.5rem)]">
      <Card className="flex flex-col items-center gap-4 text-center">
        {/* 头像位。接通中转圈，正常通话时呼吸，静音或断线就静止 —— 一眼能分出三种状态 */}
        <div
          className={cn(
            'grid size-16 place-items-center rounded-full border transition-colors duration-300',
            '[transition-timing-function:var(--ease-standard)]',
            vc.status === 'error'
              ? 'border-[var(--border)] bg-[var(--bg-sidebar)]'
              : 'border-brand-200 bg-brand-50 dark:border-brand-800 dark:bg-brand-900/30',
          )}
        >
          {vc.status === 'connecting' ? (
            <Loader2 className="size-6 animate-spin text-brand-600" aria-hidden />
          ) : (
            <Radio
              className={cn('size-6', live ? 'animate-pulse text-brand-600' : 'text-[var(--text-faint)]')}
              strokeWidth={1.6}
              aria-hidden
            />
          )}
        </div>

        <div className="space-y-1">
          <p className="serif text-[17px] font-bold leading-snug text-[var(--text-title)]">{scenario.aiRole}</p>
          {/* 计时用等宽数字，秒进位时整行不会左右抖 */}
          <p className="text-[13px] tabular-nums dim">{vc.status === 'error' ? '已断开' : clock(seconds)}</p>
        </div>

        {/* 状态条：文字 + 听到声音时跳动的电平。这是"AI 现在听得到我吗"的唯一答案 */}
        <div
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[13px]',
            'transition-colors duration-300 [transition-timing-function:var(--ease-standard)]',
            vc.muted
              ? 'border-[var(--border)] bg-[var(--bg-sidebar)] text-[var(--text-dim)]'
              : vc.status === 'listening'
                ? 'border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-700 dark:bg-brand-900/30 dark:text-brand-100'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-body)]',
          )}
          aria-live="polite"
        >
          {vc.muted ? (
            <MicOff className="size-4 shrink-0" aria-hidden />
          ) : (
            <Mic
              className={cn('size-4 shrink-0', vc.status === 'listening' && 'text-brand-600 dark:text-brand-300')}
              aria-hidden
            />
          )}
          <span className="font-semibold">{statusLabel}</span>
          {vc.status === 'listening' && !vc.muted && (
            <span className="flex items-end gap-0.5" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1 animate-pulse rounded-full bg-[var(--accent-bar)]"
                  style={{ height: `${6 + i * 3}px`, animationDelay: `${i * 140}ms` }}
                />
              ))}
            </span>
          )}
        </div>

        {/*
          断线时静音没有意义（操作的是不存在的通话），挂断也等于让人手动确认失败。
          所以这一格换成「重新接通」—— 它顺带会重新触发麦克风权限请求，被拒过的人也有路走。
        */}
        {vc.status === 'error' ? (
          <div className="w-full space-y-2">
            <Button className="w-full" onClick={() => void vc.start(scenario)}>
              <RefreshCw className="size-4" aria-hidden />
              重新接通
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                vc.stop();
                onHangUp?.();
              }}
            >
              <PhoneOff className="size-4" aria-hidden />
              退出畅聊
            </Button>
          </div>
        ) : (
          /* 静音是开关（描边 + 浅底表示按下了），挂断是破坏性动作（实心红）。都保持 44px 可点区 */
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => vc.setMuted(!vc.muted)}
              disabled={vc.status === 'connecting'}
              aria-label={vc.muted ? '取消静音' : '静音'}
              aria-pressed={vc.muted}
              className={cn(
                'grid size-11 place-items-center rounded-full border',
                'transition-all duration-200 [transition-timing-function:var(--ease-standard)] active:translate-y-px',
                'disabled:opacity-40 disabled:active:translate-y-0',
                vc.muted
                  ? 'border-warm-300 bg-warm-50 text-warm-600 dark:border-warm-800 dark:bg-warm-900/30 dark:text-warm-300'
                  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-title)] hover:bg-[var(--surface-hover)]',
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
                'grid size-11 place-items-center rounded-full bg-[var(--danger)] text-white',
                'transition-[filter,transform] duration-200 [transition-timing-function:var(--ease-standard)]',
                'hover:brightness-105 active:translate-y-px',
              )}
            >
              <PhoneOff className="size-5" aria-hidden />
            </button>
          </div>
        )}
      </Card>

      {/*
        错误文案。兼底是必要的：重连会先清掉 error，存在「状态已是 error 但文案还没写回来」
        的一瞬间，那时不能只给一个光秃的按钮。
      */}
      {vc.status === 'error' ? (
        <ErrorNote
          message={vc.error ?? '语音通话没能接通。常见原因是麦克风权限被拒，浏览器地址栏左侧可以重新允许。'}
        />
      ) : (
        vc.error && <ErrorNote message={vc.error} />
      )}

      {/* 要用上的词放在通话面板下面：说的时候瞟一眼就行，不用回上面找 */}
      {scenario.targetTerms.length > 0 && vc.status !== 'error' && (
        <Card className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--text-faint)]">
            试着用上
          </p>
          <div className="flex flex-wrap gap-1.5">
            {scenario.targetTerms.map((t) => (
              <span
                key={t}
                className="en rounded-md border border-[var(--border)] bg-[var(--bg-sidebar)] px-2 py-0.5 text-[13px] text-[var(--text-body)]"
              >
                {t}
              </span>
            ))}
          </div>
        </Card>
      )}

      {vc.status !== 'error' && (
        <p className="text-[11px] leading-relaxed dim">
          像打电话一样直接说，说完停一下 AI 就会接话。纠正随后补在字幕里，也会进错题本。
        </p>
      )}
    </div>
  );
}

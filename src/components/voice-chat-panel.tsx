'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  HelpCircle,
  Languages,
  Lightbulb,
  Loader2,
  MessagesSquare,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Radio,
  Wand2,
  X,
} from 'lucide-react';
import { Badge, Button, Card, Empty, ErrorNote } from '@/components/ui';
import { Speak } from '@/components/stages/shared';
import { useVoiceChat } from '@/hooks/useVoiceChat';
import { SPEAK_ENGLISH_HINT, type Correction } from '@/lib/realtime/protocol';
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

/** 每轮说完往外报一次：说了几轮、哪些目标词真的说出口了。 */
export type VoiceProgress = { turns: number; usedTerms: string[] };

/**
 * 通话面板。语音进、语音出，全站唯一的对话形态。
 *
 * 它只在弹窗里出现（CallSheet），所以这里不管遮罩、圆角和居中 ——
 * 只负责把「一通电话」画出来：跟谁在聊、聊了多久、听没听到、说了什么、怎么挂。
 *
 * 挂载即接通。以前它自己有一屏待机页（先看清对方是谁再点接通），
 * 现在那一屏搬到了页面上 —— 点「开始对话」才会挂载这个组件，
 * 所以进来时权限和录音已经是用户要的了，再让人点第二次就成了多余的一道门。
 */
export function VoiceChatPanel({
  scenario,
  onHangUp,
  onProgress,
}: {
  scenario: VoiceScenario;
  onHangUp?: () => void;
  onProgress?: (p: VoiceProgress) => void;
}) {
  const vc = useVoiceChat();
  /** hook 里的 tip 是快照，解构出来供 JSX 用 */
  const { tip } = vc;
  const endRef = useRef<HTMLDivElement>(null);
  /** 通话计时。真电话都有这个数字，它是「正在通话中」最直白的证据。 */
  const [seconds, setSeconds] = useState(0);
  /**
   * 提示的手动开关。用户关掉后 hook 层不再接收新提示；
   * 这里只管画（关掉后卡片消失）。挂断重拨会重置 —— 新的一通默认再看提示。
   */
  const [tipsOff, setTipsOffLocal] = useState(false);
  const setTipsOff = (next: boolean) => {
    setTipsOffLocal(next);
    vc.setTipsOff(next);
  };
  /*
    挂载即接通，卸载即挂断 —— 两件事必须写在同一个 effect 里成对出现。

    最初这里是「用一个 ref 挡住第二次执行」，那是错的：严格模式下 React 会
    挂载→清理→再挂载，清理那一下已经把连接停了，而 ref 让第二次不再接通，
    结果开发环境里进来就是「通话已结束」。改成成对写法后，第二次会正常重连，
    也不会漏一条连接 —— hook 里的 connect() 每次都先把上一条 ws 关掉，
    并用代次（genRef）把旧连接迟到的回调挡在外面。
  */
  useEffect(() => {
    if (!vc.supported) return;
    void vc.start(scenario);
    return () => vc.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 只在还通着的时候走表。断线后光看「点过接通」会出现
  // 「通话已结束」下面秒数还在涨，看着像连着其实早断了。
  const live = vc.status !== 'idle' && vc.status !== 'error';
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [live]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [vc.turns.length, vc.partial]);

  /**
   * 说出口的目标词。
   *
   * 从 turns 里现算而不是自己攒一份：usedTerms 是纠正结果异步补回来的，
   * 补上时那一轮的对象会换新，依赖它的 memo 自然会再算一次。
   */
  const { turnCount, usedTerms } = useMemo(() => {
    const s = new Set<string>();
    let n = 0;
    for (const t of vc.turns) {
      if (t.role !== 'user') continue;
      n++;
      for (const w of t.usedTerms ?? []) s.add(w.toLowerCase());
    }
    return { turnCount: n, usedTerms: s };
  }, [vc.turns]);

  /*
    回调走 ref。调用处基本都是写内联箭头函数的，直接进依赖数组的话
    每次父组件重渲染都是个新函数 → effect 重跑 → 父组件又 setState → 死循环。
  */
  const progressRef = useRef(onProgress);
  progressRef.current = onProgress;
  useEffect(() => {
    progressRef.current?.({ turns: turnCount, usedTerms: [...usedTerms] });
  }, [turnCount, usedTerms]);

  const hangUp = () => {
    vc.stop();
    onHangUp?.();
  };

  if (!vc.supported) {
    return (
      <div className="flex flex-1 flex-col justify-between gap-4 p-5">
        <Card>
          <h3 className="text-sm">这个浏览器用不了对话</h3>
          <p className="mt-1.5 text-xs dim">
            语音对话需要麦克风和 Web Audio 支持。用 Chrome、Edge 或手机 Safari 打开就能聊。
          </p>
        </Card>
        <Button variant="outline" className="w-full" onClick={hangUp}>
          挂断
        </Button>
      </div>
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
    <>
      <CallHeader scenario={scenario} vc={vc} seconds={seconds} statusLabel={statusLabel} usedTerms={usedTerms} />

      {/*
        「试试这样说」提示卡。挂在字幕区上方、控制栏下方 —— 学生卡住的时候
        眼睛往下一瞟就能看到，不用在滚动的历史里找。
        开关在卡片右上角（关掉后整块消失，这一通不再出）。
      */}
      {tip && !tipsOff && vc.status !== 'error' && (
        <div
          className={cn(
            'relative mx-5 mb-1 shrink-0 rounded-xl border border-dashed border-brand-300 bg-brand-50/60 px-3.5 py-2.5',
            'dark:border-brand-700 dark:bg-brand-900/25',
            // 为上一句准备的提示在学生开口后淡下去 —— 它已经完成使命
            vc.turns[vc.turns.length - 1]?.role === 'user' && 'opacity-50',
          )}
        >
          <button
            type="button"
            onClick={() => {
              setTipsOff(true);
            }}
            aria-label="关闭提示"
            className="absolute right-1.5 top-1.5 rounded-md p-1 text-[var(--text-faint)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-body)]"
          >
            <X className="size-3.5" aria-hidden />
          </button>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-700 dark:text-brand-300">
            <Lightbulb className="size-3.5" aria-hidden />
            试试这样说
          </div>
          <p className="en mt-1 flex items-start gap-1 pr-5 text-[14px] leading-relaxed text-[var(--text-title)]">
            <span className="flex-1">{tip.en}</span>
            <Speak text={tip.en} className="p-0.5" />
          </p>
          <p className="mt-0.5 pr-5 text-[11.5px] dim">{tip.zh}</p>
        </div>
      )}

      {/* 字幕自己滚。外壳高度是写死的，所以这里 min-h-0 才能让 flex 正确收缩 */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {vc.status === 'error' && (
          <ErrorNote
            message={vc.error ?? '语音通话没能接通。常见原因是麦克风权限被拒，浏览器地址栏左侧可以重新允许。'}
          />
        )}
        {vc.status !== 'error' && vc.error && <ErrorNote message={vc.error} />}

        {/*
          不是报错，所以不能用 ErrorNote 那个红框 —— 通话本身还好着，
          只是声音不是用户选的那个。用中性底色的一条，说清事实就够了。
        */}
        {vc.notice && (
          <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--bg-sidebar)] p-3.5 text-[13px] leading-relaxed dim">
            <p className="whitespace-pre-wrap">{vc.notice}</p>
          </div>
        )}

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

                {/*
                  转写成中文时的那条说明，是「附加」而不是「替代」。

                  早先它是三选一里的第一支，中文那句就没有纠正可看了 —— 那时中转层
                  确实会跳过分析。现在不跳了（见 lib/realtime/coaching.ts），因为有汉字
                  更可能是识别把英文听错了，那一轮的纠正正是学生要的。所以这条说明
                  单独一块，下面的纠正照常显示。

                  标题也不能写成「试着说英文」——那是在断言他说了中文。措辞见
                  protocol.mjs 的 SPEAK_ENGLISH_HINT。

                  提示放在气泡下面而不是走 notice：notice 那条是整屏一条、跟着列表滚，
                  说明不了是哪句话的问题；贴着气泡才对得上号。
                */}
                {t.zh && (
                  <div className="rounded-xl border border-warm-200 bg-warm-50 px-3 py-2 text-xs leading-relaxed text-warm-900 dark:border-warm-800 dark:bg-warm-900/40 dark:text-warm-100">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <Languages className="size-3.5" aria-hidden /> 这句识别成了中文
                    </div>
                    <p className="mt-1">{SPEAK_ENGLISH_HINT}</p>
                  </div>
                )}

                {t.correction ? (
                  <CorrectionCard c={t.correction} />
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

      {/*
        底部只有挂断。断线之后多一个「开始对话」重接 —— 它顺带会重新触发麦克风权限，
        被拒过的人也有路走；除此之外这一栏不放别的东西，
        整通电话里唯一要找的按钮就是它。

        判断条件是 !live 而不是 status === 'error'：上游把连接干净地关掉时状态回的是
        idle（「通话已结束」），那时候按钮也得出来，否则人只能挂断再从页面上重新拨。
      */}
      <div className="space-y-2 border-t border-[var(--hairline)] px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {!live && (
          <Button className="w-full" onClick={() => void vc.start(scenario)}>
            <Phone className="size-4" aria-hidden />
            开始对话
          </Button>
        )}
        <Button variant={live ? 'danger' : 'outline'} className="w-full" onClick={hangUp}>
          <PhoneOff className="size-4" aria-hidden />
          挂断
        </Button>
      </div>
    </>
  );
}

/** mm:ss。通话时长不会到小时，多一位反而让人多读一眼。 */
function clock(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 学生那句话下面的纠正卡片。三种状态：
 *
 * 1. 有问题 → 「可以这么说」+ 改后的英文 + 朗读；
 * 2. 没问题 → 「说得对」+ 一句鼓励；
 * 3. 没听清 → has_issue 为假但 corrected_en 是空的。
 *
 * 第 3 种是转写成中文那一路带出来的：提示词允许模型在还原不出英文原意时这么答
 * （见 lib/ai/prompts.ts 的 maybeMisheard 分支），它表示「这句我没听清」，不是
 * 「说得对」。按 has_issue 二选一会把它渲染成表扬 —— 学生一句没说明白的话被夸了，
 * 比不给反馈更糟。所以空的 corrected_en 单独算一种。
 */
function CorrectionCard({ c }: { c: Correction }) {
  const unclear = !c.has_issue && !c.corrected_en.trim();
  return (
    <div
      className={cn(
        'rounded-xl border px-3 py-2 text-xs leading-relaxed',
        c.has_issue || unclear
          ? 'border-warm-200 bg-warm-50 text-warm-900 dark:border-warm-800 dark:bg-warm-900/40 dark:text-warm-100'
          : 'border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-800 dark:bg-brand-900/40 dark:text-brand-100',
      )}
    >
      <div className="flex items-center gap-1.5 font-semibold">
        {unclear ? (
          <>
            <HelpCircle className="size-3.5" aria-hidden /> 这句没听清
          </>
        ) : c.has_issue ? (
          <>
            <Wand2 className="size-3.5" aria-hidden /> 可以这么说
          </>
        ) : (
          <>
            <CheckCircle2 className="size-3.5" aria-hidden /> 说得对
          </>
        )}
      </div>
      {c.has_issue && (
        <p className="en mt-1 flex items-start gap-1">
          <span className="flex-1">{c.corrected_en}</span>
          <Speak text={c.corrected_en} className="p-0.5" />
        </p>
      )}
      <p className="mt-1">{c.note_zh}</p>
    </div>
  );
}

/**
 * 通话弹窗的抬头：跟谁、多久、听没听到、要用上哪些词。
 *
 * 钉在弹窗顶部不跟字幕滚 —— 往上翻看前面说过的话时，
 * 「现在还通着吗」这个信息不该跟着滚走。
 */
function CallHeader({
  scenario,
  vc,
  seconds,
  statusLabel,
  usedTerms,
}: {
  scenario: VoiceScenario;
  vc: ReturnType<typeof useVoiceChat>;
  seconds: number;
  statusLabel: string;
  usedTerms: Set<string>;
}) {
  const live = vc.status !== 'idle' && vc.status !== 'error' && !vc.muted;

  return (
    <div className="shrink-0 space-y-3 border-b border-[var(--hairline)] px-5 py-4">
      <div className="flex items-center gap-3">
        {/* 头像位。接通中转圈，正常通话时呼吸，静音或断线就静止 —— 一眼能分出三种状态 */}
        <div
          className={cn(
            'grid size-12 shrink-0 place-items-center rounded-full border transition-colors duration-300',
            '[transition-timing-function:var(--ease-standard)]',
            vc.status === 'error'
              ? 'border-[var(--border)] bg-[var(--bg-sidebar)]'
              : 'border-brand-200 bg-brand-50 dark:border-brand-800 dark:bg-brand-900/30',
          )}
        >
          {vc.status === 'connecting' ? (
            <Loader2 className="size-5 animate-spin text-brand-600" aria-hidden />
          ) : (
            <Radio
              className={cn('size-5', live ? 'animate-pulse text-brand-600' : 'text-[var(--text-faint)]')}
              strokeWidth={1.6}
              aria-hidden
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          {/* 对方是谁用衬线字：像书里的一个人名，而不是一行 UI 文案 */}
          <p className="serif truncate text-[17px] font-bold leading-snug text-[var(--text-title)]">
            {scenario.aiRole}
          </p>
          {/* 计时用等宽数字，秒进位时整行不会左右抖 */}
          <p className="text-[13px] tabular-nums dim">{vc.status === 'error' ? '已断开' : clock(seconds)}</p>
        </div>
      </div>

      {/* 状态条：文字 + 听到声音时跳动的电平。这是"AI 现在听得到我吗"的唯一答案 */}
      <div
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[13px]',
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
        要用上的词。说出口的当场变绿 —— 这一屏是全屏弹窗，
        原来放在页面侧栏的目标词表被遮住了，得在这儿看得见。
      */}
      {scenario.targetTerms.length > 0 && vc.status !== 'error' && (
        <div className="flex flex-wrap gap-1.5">
          {scenario.targetTerms.map((t) => {
            const used = usedTerms.has(t.toLowerCase());
            return (
              <span
                key={t}
                className={cn(
                  'en rounded-md border px-2 py-0.5 text-[13px]',
                  'transition-colors duration-200 [transition-timing-function:var(--ease-standard)]',
                  used
                    ? 'border-[var(--success)] bg-[color-mix(in_srgb,var(--success)_12%,var(--surface))] font-semibold text-[var(--success)]'
                    : 'border-[var(--border)] bg-[var(--bg-sidebar)] text-[var(--text-body)]',
                )}
              >
                {used && '✓ '}
                {t}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

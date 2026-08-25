'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Lightbulb, Mic, Send, Square, Wand2 } from 'lucide-react';
import { Badge, Button, ErrorNote, Spinner } from '@/components/ui';
import { Speak } from '@/components/stages/shared';
import { useStt, useTts } from '@/hooks/useSpeech';
import { apiGet, apiPost } from '@/lib/fetcher';
import { cn } from '@/lib/cn';

type Correction = { has_issue: boolean; corrected_en: string; note_zh: string };

export type ChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  translationZh: string | null;
  feedback: { correction?: Correction; suggestion_en?: string } | null;
  usedWords: string[];
};

export type StartConfig = {
  title: string;
  themeSlug?: string | null;
  scenarioZh: string;
  aiRole: string;
  openingEn?: string | null;
  openingZh?: string | null;
  targetWordIds?: number[];
  /**
   * 目标词原文。
   *
   * 和 targetWordIds 并存不是冗余：id 用来落库和判定 produced_count，
   * 而畅聊的 instructions 需要的是词本身 —— 中转层不查库，拿不到 id 对应的词。
   */
  targetTerms?: string[];
  sessionId?: number | null;
};

/**
 * AI 对话面板。语音输入 + 打字兜底；AI 每次回话都顺手纠正你上一句，
 * 纠正结果会自动进错误本，之后几天的练习里会被重新考。
 */
export function ChatPanel({
  start,
  conversationId: initialId,
  autoSpeak = true,
  onTurn,
  compact,
}: {
  start?: StartConfig;
  conversationId?: number;
  autoSpeak?: boolean;
  onTurn?: (info: { userText: string; usedWords: string[] }) => void;
  compact?: boolean;
}) {
  const [convId, setConvId] = useState<number | null>(initialId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showZh, setShowZh] = useState<Set<number>>(new Set());
  const endRef = useRef<HTMLDivElement>(null);
  const { speak } = useTts();
  const startedRef = useRef(false);

  const stt = useStt({
    continuous: false,
    onFinal: (t) => {
      setText((prev) => (prev ? `${prev} ${t}` : t));
    },
  });

  // 开新对话或载入已有对话
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        if (initialId) {
          const r = await apiGet<{ messages: ChatMessage[] }>(`/api/chat?id=${initialId}`);
          setMessages(r.messages ?? []);
          setConvId(initialId);
        } else if (start) {
          const r = await apiPost<{ conversationId: number; messages: ChatMessage[] }>('/api/chat', {
            action: 'start',
            ...start,
          });
          setConvId(r.conversationId);
          setMessages(r.messages);
          const opening = r.messages.at(-1);
          if (autoSpeak && opening?.role === 'assistant') speak(opening.content);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBooting(false);
      }
    })();
  }, [initialId, start, autoSpeak, speak]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, sending]);

  const send = async () => {
    const t = text.trim();
    if (!t || !convId || sending) return;
    setSending(true);
    setError(null);
    setText('');
    stt.reset();
    // 乐观插入，等 AI 回来再用服务端的完整列表替换
    setMessages((m) => [
      ...m,
      { id: -Date.now(), role: 'user', content: t, translationZh: null, feedback: null, usedWords: [] },
    ]);
    try {
      const r = await apiPost<{ reply: { reply_en: string; used_target_words: string[] }; messages: ChatMessage[] }>(
        '/api/chat',
        { action: 'send', conversationId: convId, text: t },
      );
      setMessages(r.messages);
      if (autoSpeak) speak(r.reply.reply_en);
      onTurn?.({ userText: t, usedWords: r.reply.used_target_words });
    } catch (e) {
      setError((e as Error).message);
      setText(t);
      setMessages((m) => m.filter((x) => x.id > 0));
    } finally {
      setSending(false);
    }
  };

  if (booting) return <div className="py-10"><Spinner label="正在开场" /></div>;

  return (
    <div className="flex flex-col gap-3">
      <div className={cn('space-y-3 overflow-y-auto', compact ? 'max-h-[46dvh]' : 'min-h-[40dvh]')}>
        {messages.map((m) => {
          const corr = m.feedback?.correction;
          return (
            <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[85%] space-y-1.5', m.role === 'user' && 'items-end')}>
                {/**
                 * 气泡。自己说的话用实心主色，AI 说的用纸面 + 描边 ——
                 * AI 的话是要精读的学习材料，实色底会压住文字，纸面读起来更省力。
                 * 靠自己那侧的圆角收一档（rounded-br/bl-md），气泡就有了朝向。
                 */}
                <div
                  className={cn(
                    'rounded-2xl px-3.5 py-2.5',
                    m.role === 'user'
                      ? 'rounded-br-md bg-brand-500 text-white'
                      : 'rounded-bl-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-body)]',
                  )}
                >
                  <div className="flex items-start gap-1.5">
                    <p className="en flex-1 text-[15px] leading-relaxed">{m.content}</p>
                    {m.role === 'assistant' && <Speak text={m.content} className="-mr-1 -mt-1" />}
                  </div>
                  {m.role === 'assistant' && m.translationZh && (
                    <button
                      type="button"
                      onClick={() =>
                        setShowZh((s) => {
                          const n = new Set(s);
                          n.has(m.id) ? n.delete(m.id) : n.add(m.id);
                          return n;
                        })
                      }
                      className="mt-1.5 text-[11.5px] text-[var(--text-dim)] hover:text-[var(--link)] hover:underline"
                    >
                      {showZh.has(m.id) ? m.translationZh : '看中文'}
                    </button>
                  )}
                </div>

                {corr && (
                  <div
                    className={cn(
                      'rounded-xl border px-3 py-2 text-xs leading-relaxed',
                      corr.has_issue
                        ? 'border-warm-200 bg-warm-50 text-warm-900 dark:border-warm-800 dark:bg-warm-900/30 dark:text-warm-100'
                        : 'border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-800 dark:bg-brand-900/25 dark:text-brand-100',
                    )}
                  >
                    <div className="flex items-center gap-1.5 font-semibold">
                      {corr.has_issue ? (
                        <>
                          <Wand2 className="size-3.5" aria-hidden /> 可以这么说
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="size-3.5" aria-hidden /> 说得对
                        </>
                      )}
                    </div>
                    {corr.has_issue && (
                      <p className="en mt-1 flex items-start gap-1">
                        <span className="flex-1">{corr.corrected_en}</span>
                        <Speak text={corr.corrected_en} className="p-0.5" />
                      </p>
                    )}
                    <p className="mt-1">{corr.note_zh}</p>
                  </div>
                )}

                {m.usedWords.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-1">
                    {m.usedWords.map((w) => (
                      <Badge key={w} tone="success">
                        用上了 {w}
                      </Badge>
                    ))}
                  </div>
                )}

                {m.role === 'assistant' && m.feedback?.suggestion_en && (
                  <div className="flex items-start gap-1.5 rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-sidebar)] px-3 py-2 text-xs">
                    <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-warm-500" aria-hidden />
                    <span className="en flex-1 text-[var(--text-body)]">{m.feedback.suggestion_en}</span>
                    <button
                      type="button"
                      onClick={() => setText(m.feedback!.suggestion_en!)}
                      className="shrink-0 font-semibold text-[var(--link)] hover:underline"
                    >
                      照着说
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
              <Spinner label="在想怎么回你" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && <ErrorNote message={error} />}
      {stt.error && <p className="text-xs text-warm-600 dark:text-warm-300">{stt.error}</p>}

      {/* 输入区吸底。上边一条 hairline，否则上面的气泡会像是直接压在输入框上。 */}
      <form
        className="sticky bottom-0 flex items-end gap-2 border-t border-[var(--hairline)] bg-[var(--bg)] pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {stt.supported && (
          <Button
            type="button"
            variant={stt.listening ? 'danger' : 'outline'}
            onClick={() => (stt.listening ? stt.stop() : stt.start())}
            className={cn('shrink-0', stt.listening && 'recording')}
            aria-label={stt.listening ? '停止录音' : '开始说话'}
          >
            {stt.listening ? <Square className="size-4" aria-hidden /> : <Mic className="size-4" aria-hidden />}
          </Button>
        )}
        <textarea
          rows={1}
          value={stt.listening && stt.interim ? `${text} ${stt.interim}`.trim() : text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={stt.supported ? '说出来，或者打字' : '用英文打字回复'}
          aria-label="你的回复"
          // 这里不能直接用 <Textarea>：它要能自增高、有 max-h 上限，还要跟按钮同一行对齐。
          // 描边/聚焦环手抄一份 fieldBase，保持和表单里的输入框一致。
          className={cn(
            'en max-h-32 min-h-11 flex-1 resize-none rounded-xl px-3.5 py-3',
            'border border-[var(--border-control)] bg-[var(--surface)]',
            // 移动端保持 16px，否则 Safari 会自动放大页面
            'text-base sm:text-sm',
            'text-[var(--text-body)] placeholder:text-[var(--text-faint)]',
            'transition-[border-color,box-shadow] duration-150 focus:outline-none',
            'focus:border-brand-500 focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-brand-400)_22%,transparent)]',
          )}
        />
        <Button type="submit" disabled={!text.trim() || sending} className="shrink-0" aria-label="发送">
          <Send className="size-4" aria-hidden />
        </Button>
      </form>
    </div>
  );
}

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
                <div
                  className={cn(
                    'rounded-2xl px-3.5 py-2.5',
                    m.role === 'user'
                      ? 'bg-brand-600 text-white'
                      : 'bg-[var(--surface-2)] text-[var(--text)]',
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
                      className="mt-1 text-[11px] dim hover:underline"
                    >
                      {showZh.has(m.id) ? m.translationZh : '看中文'}
                    </button>
                  )}
                </div>

                {corr && (
                  <div
                    className={cn(
                      'rounded-xl px-3 py-2 text-xs',
                      corr.has_issue
                        ? 'bg-warm-50 text-warm-900 dark:bg-warm-900/30 dark:text-warm-100'
                        : 'bg-brand-50 text-brand-900 dark:bg-brand-900/25 dark:text-brand-100',
                    )}
                  >
                    <div className="flex items-center gap-1.5 font-medium">
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
                  <div className="flex items-start gap-1.5 rounded-xl border border-dashed border-[var(--border)] px-3 py-2 text-xs">
                    <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-warm-500" aria-hidden />
                    <span className="en flex-1">{m.feedback.suggestion_en}</span>
                    <button
                      type="button"
                      onClick={() => setText(m.feedback!.suggestion_en!)}
                      className="shrink-0 text-brand-600 hover:underline dark:text-brand-300"
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
            <div className="rounded-2xl bg-[var(--surface-2)] px-3.5 py-2.5">
              <Spinner label="在想怎么回你" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && <ErrorNote message={error} />}
      {stt.error && <p className="text-xs text-warm-600 dark:text-warm-400">{stt.error}</p>}

      <form
        className="sticky bottom-0 flex items-end gap-2 bg-[var(--bg)] pt-1"
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
          className="en max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm focus:border-brand-400 focus:outline-none"
        />
        <Button type="submit" disabled={!text.trim() || sending} className="shrink-0" aria-label="发送">
          <Send className="size-4" aria-hidden />
        </Button>
      </form>
    </div>
  );
}

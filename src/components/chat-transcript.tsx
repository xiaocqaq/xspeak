'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Wand2 } from 'lucide-react';
import { Badge, ErrorNote, Spinner } from '@/components/ui';
import { Speak } from '@/components/stages/shared';
import { apiGet } from '@/lib/fetcher';
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

/**
 * 聊过的记录，只读。
 *
 * 这个文件以前是 chat-panel.tsx —— 一个能打字发送的对话面板。现在对话只有
 * 「打电话」一种形态（说出口才是练口语，打字练的是打字），所以输入框、发送键、
 * 语音转文字全部去掉了，只剩回看：说过的话、AI 的回话、当时的纠正。
 *
 * 通话的每一轮同样落这张表，所以这里也能翻出畅聊记录。
 */
export function ChatTranscript({ conversationId }: { conversationId: number }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showZh, setShowZh] = useState<Set<number>>(new Set());

  useEffect(() => {
    let alive = true;
    apiGet<{ messages: ChatMessage[] }>(`/api/chat?id=${conversationId}`)
      .then((r) => alive && setMessages(r.messages ?? []))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [conversationId]);

  if (error) return <ErrorNote message={error} />;
  if (!messages) return <div className="py-10"><Spinner label="正在读记录" /></div>;
  if (messages.length === 0) return <p className="py-10 text-center text-sm dim">这段对话是空的。</p>;

  return (
    <div className="space-y-3">
      {messages.map((m) => {
        const corr = m.feedback?.correction;
        return (
          <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className="max-w-[85%] space-y-1.5">
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
                        if (n.has(m.id)) n.delete(m.id);
                        else n.add(m.id);
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
            </div>
          </div>
        );
      })}
    </div>
  );
}

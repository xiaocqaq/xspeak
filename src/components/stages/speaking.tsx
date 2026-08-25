'use client';

import { useMemo, useState } from 'react';
import { MessagesSquare, Target, Volume2 } from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { Speak, StageIntro } from './shared';
import { ChatPanel, type StartConfig } from '@/components/chat-panel';
import { ShadowCard } from '@/components/shadow-card';
import type { StageProps } from './types';
import type { SpeakingData } from '@/lib/ai/schemas';
import { cn } from '@/lib/cn';

/**
 * 口语。两块：跟读打分（把句型练顺）和真实对话（把词用出来）。
 * 只有在对话里主动用出目标词，才会记 produced —— 这是"学会了"的判据，
 * 认得出来不算。
 */
export function SpeakingStage({ payload, meta, onDone, onRegenerate, submitting }: StageProps<SpeakingData>) {
  const [tab, setTab] = useState<'shadow' | 'talk'>('shadow');
  const [usedTerms, setUsedTerms] = useState<Set<string>>(new Set());
  const [turns, setTurns] = useState(0);
  const startedAt = useMemo(() => Date.now(), []);

  const startConfig: StartConfig = useMemo(
    () => ({
      title: `${meta.themeZh} 口语`,
      themeSlug: null,
      scenarioZh: payload.scenario_zh,
      aiRole: payload.ai_role,
      openingEn: payload.opening_en,
      openingZh: payload.opening_zh,
      targetWordIds: meta.targetWords.map((w) => w.id),
      sessionId: meta.sessionId,
    }),
    [payload, meta],
  );

  const mustUse = payload.must_use ?? [];
  const finish = () => {
    const producedIds = meta.targetWords
      .filter((w) => usedTerms.has(w.term.toLowerCase()))
      .map((w) => w.id);
    onDone({
      produced: producedIds,
      spokenSeconds: Math.round((Date.now() - startedAt) / 1000),
    });
  };

  return (
    <div className="space-y-4">
      <StageIntro>{payload.scenario_zh}</StageIntro>

      <Card>
        <div className="flex items-center gap-2">
          <Target className="size-4 text-brand-500" aria-hidden />
          <p className="text-sm font-semibold">这几个词要真说出来</p>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {mustUse.map((t) => {
            const used = usedTerms.has(t.toLowerCase());
            return (
              <span
                key={t}
                className={cn(
                  'en inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
                  used
                    ? 'bg-brand-500 text-white'
                    : 'border border-dashed border-[var(--border)] text-[var(--text-dim)]',
                )}
              >
                {used && '✓ '}
                {t}
              </span>
            );
          })}
        </div>
        <p className="mt-2 text-xs dim">
          用出来的词才算掌握。只是"看着眼熟"不会推进进度。
        </p>
      </Card>

      <div className="flex gap-2 rounded-xl bg-[var(--surface-2)] p-1">
        {(
          [
            { k: 'shadow' as const, zh: '先跟读', Icon: Volume2 },
            { k: 'talk' as const, zh: '真实对话', Icon: MessagesSquare },
          ]
        ).map(({ k, zh, Icon }) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            aria-pressed={tab === k}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors',
              tab === k ? 'bg-[var(--surface)] shadow-sm' : 'text-[var(--text-dim)]',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {zh}
          </button>
        ))}
      </div>

      {tab === 'shadow' ? (
        <div className="space-y-3">
          <p className="text-xs dim">
            这些句型在对话里能直接用上。念一遍，看哪个词没被听清。
          </p>
          {(payload.useful_phrases ?? []).map((p, i) => (
            <ShadowCard key={i} target={p.en} zh={p.zh} sessionId={meta.sessionId} />
          ))}
          <Button variant="outline" className="w-full" onClick={() => setTab('talk')}>
            练顺了，去对话
          </Button>
        </div>
      ) : (
        <Card>
          <div className="flex items-start justify-between gap-2">
            <div>
              <Badge tone="brand">AI 扮演</Badge>
              <p className="en mt-1.5 text-sm">{payload.ai_role}</p>
            </div>
            <Speak text={payload.opening_en} />
          </div>
          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <ChatPanel
              start={startConfig}
              compact
              onTurn={({ usedWords }) => {
                setTurns((n) => n + 1);
                if (usedWords.length) {
                  setUsedTerms((s) => {
                    const n = new Set(s);
                    for (const w of usedWords) n.add(w.toLowerCase());
                    return n;
                  });
                }
              }}
            />
          </div>
        </Card>
      )}

      <Button className="w-full" onClick={finish} loading={submitting}>
        {turns === 0 ? '跳过对话，去写作' : `聊了 ${turns} 轮，去写作`}
      </Button>

      <button type="button" onClick={onRegenerate} className="w-full text-center text-xs dim hover:underline">
        换个场景
      </button>
    </div>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { Button, Card, Progress } from '@/components/ui';
import { Choices, Explain, RatingRow, Speak, StageIntro, TappableText } from './shared';
import type { StageProps, ReviewBody } from './types';
import type { WarmupData } from '@/lib/ai/schemas';

/**
 * 热身复习。核心设计：每个到期的词都出现在一个全新句子里 ——
 * 不是背过的那句。做对≠记牢，先答题，再自评记得牢不牢，两者一起喂给 FSRS。
 */
export function WarmupStage({ payload, meta, onDone, onRegenerate, submitting }: StageProps<WarmupData>) {
  const items = payload.items ?? [];
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const collected = useMemo(() => ({ words: [], mistakes: [] } as Required<Pick<ReviewBody, 'words' | 'mistakes'>>), []);

  const termToId = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of meta.targetWords) m.set(w.term.toLowerCase(), w.id);
    return m;
  }, [meta.targetWords]);

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <StageIntro tone="neutral">{payload.intro_zh}</StageIntro>
        <Button className="w-full" onClick={() => onDone()} loading={submitting}>
          进入新词环节
        </Button>
      </div>
    );
  }

  const item = items[idx];
  const wordId = termToId.get(item.term.toLowerCase());

  const rate = (rating: 1 | 2 | 3 | 4) => {
    if (wordId) {
      collected.words.push({
        wordId,
        rating,
        mode: 'cloze',
        elapsedMs: Date.now() - startedAt,
        context: item.sentence_en,
      });
    }
    if (picked !== item.answer) {
      collected.mistakes.push({
        kind: 'word_choice',
        stage: 'warmup',
        wordId: wordId ?? null,
        wrong: `${item.sentence_en.replace('___', picked ?? '?')}`,
        correct: item.sentence_en.replace('___', item.answer),
        note: item.why_zh,
      });
    }
    if (idx + 1 < items.length) {
      setIdx(idx + 1);
      setPicked(null);
      setStartedAt(Date.now());
    } else {
      onDone(collected);
    }
  };

  const filled = item.sentence_en.replace('___', item.answer);

  return (
    <div className="space-y-4">
      <StageIntro>{payload.intro_zh}</StageIntro>

      <div className="flex items-center gap-3">
        <Progress value={(idx / items.length) * 100} className="flex-1" />
        <span className="text-xs dim">
          {idx + 1}/{items.length}
        </span>
      </div>

      <Card>
        <p className="text-xs dim">把词填回句子里。这句话是新的，不是你背过的那句。</p>
        <p className="en mt-3 text-lg leading-relaxed">
          {item.sentence_en.split('___').map((seg, i, arr) => (
            <span key={i}>
              {seg}
              {i < arr.length - 1 && (
                <span className="mx-1 inline-block min-w-16 border-b-2 border-brand-400 align-baseline" />
              )}
            </span>
          ))}
        </p>
        <p className="mt-2 text-sm dim">{item.sentence_zh}</p>
        {picked === null && <p className="mt-2 text-xs dim">提示：{item.hint_zh}</p>}

        <div className="mt-4">
          <Choices options={item.options} answer={item.answer} picked={picked} onPick={setPicked} />
        </div>

        {picked !== null && (
          <>
            <Explain>
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <TappableText text={filled} highlight={[item.answer]} className="block text-sm" />
                  <p className="mt-2 text-xs dim">{item.why_zh}</p>
                </div>
                <Speak text={filled} />
              </div>
            </Explain>

            <div className="mt-4">
              <p className="mb-2 text-xs dim">刚才这个词，你记得有多牢？这决定它下次什么时候再来。</p>
              <RatingRow onRate={rate} busy={submitting} />
            </div>
          </>
        )}
      </Card>

      <button
        type="button"
        onClick={onRegenerate}
        className="w-full text-center text-xs dim hover:underline"
      >
        换一批题
      </button>
    </div>
  );
}

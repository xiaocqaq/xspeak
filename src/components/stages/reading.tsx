'use client';

import { useState } from 'react';
import { Languages } from 'lucide-react';
import { Badge, Button, Card, Textarea } from '@/components/ui';
import { Explain, Speak, StageIntro, TappableText } from './shared';
import type { StageProps } from './types';
import type { ReadingData } from '@/lib/ai/schemas';

/**
 * 阅读。短文里嵌了今天的目标词（高亮），任何词都能点开查。
 * 问题是开放式的 —— 用自己的话写，然后和参考答案对照，比选 ABCD 留得住。
 */
export function ReadingStage({ payload, meta, onDone, onRegenerate, submitting }: StageProps<ReadingData>) {
  const [showZh, setShowZh] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const targets = meta.targetWords.map((w) => w.term);
  const questions = payload.questions ?? [];

  return (
    <div className="space-y-4">
      <StageIntro>点任意一个词可以直接查，高亮的是今天学的词。</StageIntro>

      <Card>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="en text-lg font-semibold">{payload.title_en}</h2>
            <p className="text-sm dim">{payload.title_zh}</p>
          </div>
          <Speak text={`${payload.title_en}. ${payload.passage_en}`} label="朗读全文" />
        </div>

        <div className="mt-4 leading-loose">
          <TappableText text={payload.passage_en} highlight={targets} className="text-[15px]" />
        </div>

        <button
          type="button"
          onClick={() => setShowZh((s) => !s)}
          className="mt-4 inline-flex items-center gap-1.5 text-xs text-brand-600 hover:underline dark:text-brand-300"
        >
          <Languages className="size-3.5" aria-hidden />
          {showZh ? '收起译文' : '看中文译文'}
        </button>
        {showZh && (
          <p className="mt-2 whitespace-pre-wrap rounded-xl bg-[var(--surface-2)] p-3 text-sm">
            {payload.passage_zh}
          </p>
        )}
      </Card>

      {payload.glosses.length > 0 && (
        <Card>
          <p className="text-sm font-semibold">文中值得留意的表达</p>
          <ul className="mt-3 space-y-3">
            {payload.glosses.map((g, i) => (
              <li key={i}>
                <div className="flex items-center gap-1.5">
                  <span className="en text-sm font-medium">{g.term}</span>
                  <Speak text={g.term} className="p-0.5" />
                  <span className="text-sm dim">{g.meaning_zh}</span>
                </div>
                <p className="mt-0.5 text-xs dim">{g.note_zh}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {questions.map((q, i) => (
        <Card key={i}>
          <Badge>问题 {i + 1}</Badge>
          <p className="mt-2 text-sm">{q.q_zh}</p>
          <Textarea
            rows={2}
            className="en mt-3"
            value={answers[i] ?? ''}
            onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
            placeholder="用英文答，写不出来就先写关键词"
            aria-label={`第 ${i + 1} 题答案`}
          />
          {!revealed.has(i) ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => setRevealed((s) => new Set(s).add(i))}
            >
              看参考答案
            </Button>
          ) : (
            <Explain>
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <TappableText text={q.answer_en} className="block text-sm font-medium" />
                  <p className="mt-2 text-xs dim">{q.explain_zh}</p>
                </div>
                <Speak text={q.answer_en} />
              </div>
            </Explain>
          )}
        </Card>
      ))}

      <Button className="w-full" onClick={() => onDone()} loading={submitting}>
        读完了，去练口语
      </Button>

      <button type="button" onClick={onRegenerate} className="w-full text-center text-xs dim hover:underline">
        换一篇
      </button>
    </div>
  );
}

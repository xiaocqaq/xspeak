'use client';

import { useState } from 'react';
import { Languages } from 'lucide-react';
import { Badge, Button, Card, Textarea } from '@/components/ui';
import { ColumnLabel, Explain, Speak, Split, StickyColumn, TappableText } from './shared';
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
    /*
      删了「点任意一个词可以直接查」这句操作说明。
      点词查词是全站一致的交互，在每个阅读页都写一遍是噪音；
      高亮词本身的形态已经在提示它可点。

      宽屏分两列：原文钉在左边，右边答题。开放式问题本来就要求回看原文，
      单列的话每答一题都得滚上去找。
    */
    <Split
      aside={
        <StickyColumn>
          <Card>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="en serif text-[21px] font-bold leading-snug text-[var(--text-title)]">
                  {payload.title_en}
                </h2>
                <p className="mt-0.5 text-sm dim">{payload.title_zh}</p>
              </div>
              <Speak text={`${payload.title_en}. ${payload.passage_en}`} label="朗读全文" />
            </div>

            <div className="mt-4 leading-loose text-[var(--text-body)]">
              <TappableText text={payload.passage_en} highlight={targets} className="text-[15.5px]" />
            </div>

            <button
              type="button"
              onClick={() => setShowZh((s) => !s)}
              className="mt-4 inline-flex items-center gap-1.5 text-xs text-[var(--link)] hover:underline"
            >
              <Languages className="size-3.5" aria-hidden />
              {showZh ? '收起译文' : '看中文译文'}
            </button>
            {showZh && (
              <p className="mt-2.5 whitespace-pre-wrap rounded-lg border border-[var(--hairline)] bg-[var(--bg-sidebar)] p-3 text-sm leading-relaxed text-[var(--text-body)]">
                {payload.passage_zh}
              </p>
            )}
          </Card>

          {/* 可选链兜底：AI 偶尔漏字段，不该让整页白屏 */}
          {payload.glosses?.length ? (
            <Card>
              <p className="section-label">文中值得留意的表达</p>
              <ul className="mt-3 space-y-3">
                {payload.glosses.map((g, i) => (
                  <li key={i}>
                    <div className="flex items-center gap-1.5">
                      <span className="en text-sm font-semibold text-[var(--text-title)]">{g.term}</span>
                      <Speak text={g.term} className="p-0.5" />
                      <span className="text-sm dim">{g.meaning_zh}</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed dim">{g.note_zh}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </StickyColumn>
      }
    >
      <ColumnLabel>读完回答</ColumnLabel>
      {questions.map((q, i) => (
        <Card key={i}>
          <Badge>问题 {i + 1}</Badge>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-body)]">{q.q_zh}</p>
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
                  <TappableText text={q.answer_en} className="block text-sm font-semibold" />
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
    </Split>
  );
}

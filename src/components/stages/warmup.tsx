'use client';

import { useMemo, useState } from 'react';
import { Button, Card } from '@/components/ui';
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

  /**
   * 把题干拆成「文字 + 下划线」的片段序列。
   *
   * 下划线要和紧跟着的那个词（含句末标点）绑成不折行单元，否则折行时
   * 会出现下划线独占一行、句点掉到下一行的难看情况。
   * 在 render 前算完，不在 map 里改数组 —— 严格模式下会渲染两次，带副作用的写法会把文字吃掉。
   */
  const parts = useMemo(() => {
    const segs = item.sentence_en.split('___');
    const out: { text: string; blankThenGlue?: string }[] = [];
    for (let i = 0; i < segs.length; i++) {
      if (i === segs.length - 1) {
        out.push({ text: segs[i] });
        break;
      }
      const next = segs[i + 1] ?? '';
      const glue = next.match(/^\S*/)?.[0] ?? '';
      out.push({ text: segs[i], blankThenGlue: glue });
      segs[i + 1] = next.slice(glue.length);
    }
    return out;
  }, [item.sentence_en]);

  return (
    /**
     * 不用 min-h 去撑满屏：那只是把空白从卡片下方换到按钮上方，空白还在。
     * 答题内容本来就短，让它自然收在上方、靠阅读宽度上限稳住版面就行。
     */
    <div className="space-y-6">
      {/*
        题号单独成行。

        这里以前还摆着 payload.intro_zh —— AI 写的一整段「今天为什么这么安排」。
        删了：答题页的唯一任务是答题，三行教学设计说明摆在题目上方只会遮住主体，
        而且没人会读它。主题信息在 runner 顶部已经有了。
      */}
      <p className="en text-[13px] font-medium tabular-nums dim">
        {idx + 1} / {items.length}
      </p>

      <Card>
        {/*
          题目是主角：字号拉到 22px、收字距，和译文/提示拉开两个层级。
          片段的切分见上方 parts 的注释。
        */}
        <p className="en text-[22px] font-medium leading-snug tracking-[-0.022em]">
          {parts.map((p, i) => (
            <span key={i}>
              {p.text}
              {p.blankThenGlue !== undefined && (
                <span className="whitespace-nowrap">
                  <span className="mx-1.5 inline-block min-w-20 border-b-2 border-brand-500 align-baseline dark:border-brand-600" />
                  {p.blankThenGlue}
                </span>
              )}
            </span>
          ))}
        </p>
        <p className="mt-3 text-[15px] dim">{item.sentence_zh}</p>
        {picked === null && (
          <p className="mt-2 text-[13px] dim">提示：{item.hint_zh}</p>
        )}

        <div className="mt-6">
          <Choices options={item.options} answer={item.answer} picked={picked} onPick={setPicked} />
        </div>

        {picked !== null && (
          <>
            <Explain>
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <TappableText text={filled} highlight={[item.answer]} className="block text-sm" />
                  <p className="mt-2 text-xs dim">{item.why_zh}</p>
                </div>
                <Speak text={filled} />
              </div>
            </Explain>

            <div className="mt-6">
              <p className="mb-3 text-[13px] dim">刚才这个词，你记得有多牢？这决定它下次什么时候再来。</p>
              <RatingRow onRate={rate} busy={submitting} />
            </div>
          </>
        )}
      </Card>

      {/* 不再用 mt-auto 钉底：没了 flex 容器它也没意义了 */}
      <button
        type="button"
        onClick={onRegenerate}
        className="w-full py-2 text-center text-[13px] text-brand-500 dark:text-brand-600"
      >
        换一批题
      </button>
    </div>
  );
}

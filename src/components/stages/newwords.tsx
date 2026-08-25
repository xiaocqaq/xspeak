'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Lightbulb } from 'lucide-react';
import { Badge, Button, Card, Progress } from '@/components/ui';
import { ColumnLabel, Speak, Split, StageIntro, StickyColumn, TappableText } from './shared';
import type { StageProps } from './types';
import { cn } from '@/lib/cn';

type AiWord = {
  id: number;
  term: string;
  phonetic: string;
  pos: string;
  meaning_zh: string;
  meaning_en: string;
  example_en: string;
  example_zh: string;
  memory_hook_zh: string;
  collocations: string[];
};

type Payload = { intro_zh: string; words: AiWord[] };

/**
 * 新词。一次只看一个，先听再看意思 —— 顺序反了就会变成"用眼睛背中文"。
 * 每个词都带记忆抓手和搭配，学完统一入队进 FSRS。
 */
export function NewWordsStage({ payload, meta, onDone, onRegenerate, submitting }: StageProps<Payload>) {
  const words = payload.words ?? [];
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  if (words.length === 0) {
    return (
      <div className="space-y-4">
        <StageIntro tone="neutral">今天没有新词，直接进入语法。</StageIntro>
        <Button className="w-full" onClick={() => onDone()} loading={submitting}>
          下一环节
        </Button>
      </div>
    );
  }

  const w = words[idx];
  const isRevealed = revealed.has(idx);
  const last = idx === words.length - 1;

  const reveal = () => setRevealed((s) => new Set(s).add(idx));

  const next = () => {
    if (last) {
      onDone({ enroll: words.map((x) => x.id).filter(Boolean) });
    } else {
      setIdx(idx + 1);
    }
  };

  return (
    /*
      payload.intro_zh（AI 写的一整段「今天为什么选这些词」）删了。
      学新词页的主体是词本身，上面堆三四行教学说明只会把卡片挤到屏幕外。

      词卡是主角，所以用 wide-main：右边只留一条窄栏放今天这批词的索引。
      原来它横着躺在按钮下面，宽屏上词卡右边那一大片是空的。
    */
    <Split
      ratio="wide-main"
      aside={
        <StickyColumn>
          <ColumnLabel>今天这批（{words.length}）</ColumnLabel>
          <div className="flex flex-wrap gap-1.5">
            {words.map((x, i) => (
              <button
                key={x.term}
                type="button"
                onClick={() => setIdx(i)}
                className={cn(
                  // 三态：当前是实心，翻过的是描边实底，没翻的是虚线框
                  'en rounded-[4px] border px-2 py-1 text-xs transition-colors duration-200',
                  '[transition-timing-function:var(--ease-standard)]',
                  i === idx
                    ? 'border-[var(--accent-bar)] bg-[var(--accent-bar)] font-semibold text-white'
                    : revealed.has(i)
                      ? 'border-[var(--hairline)] bg-[var(--bg-sidebar)] text-[var(--text-secondary)]'
                      : 'border-dashed border-[var(--border)] text-[var(--text-faint)]',
                )}
              >
                {x.term}
              </button>
            ))}
          </div>

          <button type="button" onClick={onRegenerate} className="w-full text-center text-xs dim hover:underline">
            换一批词
          </button>
        </StickyColumn>
      }
    >
      <div className="flex items-center gap-3">
        <Progress value={((idx + (isRevealed ? 1 : 0)) / words.length) * 100} className="flex-1" />
        <span className="text-xs dim">
          {idx + 1}/{words.length}
        </span>
      </div>

      <Card className="min-h-72">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="en serif text-[34px] font-bold leading-tight text-[var(--text-title)]">{w.term}</h2>
              <Speak text={w.term} />
              <Speak text={w.term} slow label="慢速朗读" />
            </div>
            <p className="mt-1 text-sm dim">
              {w.phonetic && <span className="en">{w.phonetic}</span>}
              {w.pos && <span> · {w.pos}</span>}
            </p>
          </div>
          {meta.themeZh && <Badge tone="brand">{meta.themeZh}</Badge>}
        </div>

        {!isRevealed ? (
          <div className="mt-8 space-y-4 text-center">
            <p className="text-sm dim">先听一遍，猜猜是什么意思，再翻开。</p>
            <Button variant="outline" onClick={reveal}>
              看意思
            </Button>
          </div>
        ) : (
          <div className="mt-5 space-y-4 fade-up">
            <div>
              <p className="text-[17px] font-semibold text-[var(--text-title)]">{w.meaning_zh}</p>
              {w.meaning_en && <p className="en mt-0.5 text-sm dim">{w.meaning_en}</p>}
            </div>

            {w.example_en && (
              <div className="rounded-lg border border-[var(--hairline)] bg-[var(--bg-sidebar)] p-3">
                <div className="flex items-start gap-2">
                  <TappableText text={w.example_en} highlight={[w.term]} className="flex-1 text-sm" />
                  <Speak text={w.example_en} />
                </div>
                <p className="mt-1.5 text-xs dim">{w.example_zh}</p>
              </div>
            )}

            {w.memory_hook_zh && (
              <div className="flex items-start gap-2 rounded-lg border border-warm-200 bg-warm-50 p-3 dark:border-warm-800 dark:bg-warm-900/25">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-warm-500" aria-hidden />
                <p className="text-sm leading-relaxed text-[var(--text-body)]">{w.memory_hook_zh}</p>
              </div>
            )}

            {w.collocations.length > 0 && (
              <div>
                <p className="section-label">常用搭配</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {w.collocations.map((c) => (
                    <span
                      key={c}
                      className="en inline-flex items-center gap-1 rounded-[4px] border border-[var(--hairline)] bg-[var(--bg-sidebar)] px-2 py-1 text-xs text-[var(--text-body)]"
                    >
                      {c}
                      <Speak text={c} className="p-0.5" />
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={() => setIdx(Math.max(0, idx - 1))}
          disabled={idx === 0}
          aria-label="上一个"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <Button
          className="flex-1"
          onClick={isRevealed ? next : reveal}
          loading={submitting && last}
        >
          {!isRevealed ? '看意思' : last ? '这些词记下了，进入语法' : '下一个'}
          {isRevealed && !last && <ChevronRight className="size-4" aria-hidden />}
        </Button>
      </div>
    </Split>
  );
}

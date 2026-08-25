'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Badge, Button, Card, Progress, Textarea } from '@/components/ui';
import { Choices, Explain, Speak, TappableText } from './shared';
import type { StageProps, ReviewBody } from './types';
import type { GrammarData } from '@/lib/ai/schemas';

type Payload = GrammarData & {
  point: { id: number; title_zh: string; title_en: string; pattern: string | null; pitfalls: string[] } | null;
};

/**
 * 语法。先看 100 多字的讲解（重点讲和中文的差别），再做 3-5 题。
 * 改错和翻译题不判死对错 —— 自评之后错的进错误本，明天换个说法再考。
 */
export function GrammarStage({ payload, onDone, onRegenerate, submitting }: StageProps<Payload>) {
  const exercises = payload.exercises ?? [];
  const [phase, setPhase] = useState<'lesson' | 'practice'>('lesson');
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [checked, setChecked] = useState(false);
  // 跨题累计：错的题进错题本，wrong 的总数决定这个语法点的最终评分
  const collected = useMemo<{ mistakes: NonNullable<ReviewBody['mistakes']>; wrong: number }>(
    () => ({ mistakes: [], wrong: 0 }),
    [],
  );

  const point = payload.point;

  if (phase === 'lesson') {
    return (
      <div className="space-y-6">
        {/* focus_zh（AI 写的一整段「为什么今天讲这个」）删了，语法点本身就是主角 */}
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{point?.title_zh ?? '语法点'}</h2>
              <p className="en text-sm dim">{point?.title_en}</p>
            </div>
            {point?.pattern && <Badge tone="brand">{point.pattern}</Badge>}
          </div>

          {payload.mini_lesson_zh && (
            <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{payload.mini_lesson_zh}</div>
          )}

          {/* 可选链兜底：AI 偶尔漏字段，不该让整页白屏 */}
          {payload.examples?.length ? (
            <div className="mt-4 space-y-2">
              {payload.examples.map((ex, i) => (
                <div key={i} className="rounded-xl bg-[var(--surface-2)] p-3">
                  <div className="flex items-start gap-2">
                    <TappableText text={ex.en} className="flex-1 text-sm" />
                    <Speak text={ex.en} />
                  </div>
                  <p className="mt-1 text-xs dim">{ex.zh}</p>
                </div>
              ))}
            </div>
          ) : null}

          {point?.pitfalls && point.pitfalls.length > 0 && (
            <div className="mt-4 rounded-xl border border-warm-200 bg-warm-50 p-3 dark:border-warm-900 dark:bg-warm-900/25">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-warm-500" aria-hidden />
                <p className="text-sm font-semibold">中文母语者最容易错的地方</p>
              </div>
              <ul className="mt-2 space-y-1">
                {point.pitfalls.map((p, i) => (
                  <li key={i} className="text-sm">
                    · {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Button
          className="w-full"
          onClick={() => (exercises.length ? setPhase('practice') : onDone())}
          loading={submitting}
        >
          {exercises.length ? `做 ${exercises.length} 道题` : '下一环节'}
        </Button>
      </div>
    );
  }

  const ex = exercises[idx];
  const isChoice = ex.kind === 'choice' && ex.options.length > 0;
  const revealed = isChoice ? picked !== null : checked;
  const gotItWrong = isChoice
    ? picked !== ex.answer
    : normalize(typed) !== normalize(ex.answer);

  const advance = (selfWrong?: boolean) => {
    const wasWrong = selfWrong ?? gotItWrong;
    if (wasWrong) {
      collected.wrong = (collected.wrong ?? 0) + 1;
      collected.mistakes.push({
        kind: 'grammar',
        stage: 'grammar',
        grammarId: point?.id ?? null,
        wrong: isChoice ? (picked ?? '') : typed || '(没写)',
        correct: ex.answer,
        note: ex.explain_zh,
      });
    }
    if (idx + 1 < exercises.length) {
      setIdx(idx + 1);
      setPicked(null);
      setTyped('');
      setChecked(false);
    } else {
      const wrong = collected.wrong ?? 0;
      // 错得越多，这个语法点越快回来
      const rating: 1 | 2 | 3 | 4 =
        wrong === 0 ? 4 : wrong === 1 ? 3 : wrong === 2 ? 2 : 1;
      onDone({
        ...collected,
        grammar: point ? [{ grammarId: point.id, rating, wrongCount: wrong }] : [],
      });
    }
  };

  const kindLabel = { choice: '选择', fix: '改错', translate: '中译英' }[ex.kind];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Progress value={(idx / exercises.length) * 100} className="flex-1" />
        <span className="text-xs dim">
          {idx + 1}/{exercises.length}
        </span>
      </div>

      <Card>
        <Badge>{kindLabel}</Badge>
        <p className={ex.kind === 'translate' ? 'mt-3 text-base' : 'en mt-3 text-base'}>{ex.question}</p>
        {ex.kind === 'fix' && <p className="mt-1 text-xs dim">这句话有错，写出正确版本。</p>}

        {isChoice ? (
          <div className="mt-4">
            <Choices options={ex.options} answer={ex.answer} picked={picked} onPick={setPicked} />
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            <Textarea
              rows={2}
              className="en"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="用英文写在这里"
              disabled={checked}
              aria-label="你的答案"
            />
            {!checked && (
              <Button variant="outline" size="sm" onClick={() => setChecked(true)}>
                对答案
              </Button>
            )}
          </div>
        )}

        {revealed && (
          <>
            <Explain>
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <p className="text-xs dim">参考答案</p>
                  <TappableText text={ex.answer} className="block text-sm font-medium" />
                  <p className="mt-2 text-xs dim">{ex.explain_zh}</p>
                </div>
                <Speak text={ex.answer} />
              </div>
            </Explain>

            {isChoice ? (
              <Button className="mt-4 w-full" onClick={() => advance()} loading={submitting}>
                {idx + 1 < exercises.length ? '下一题' : '做完了'}
              </Button>
            ) : (
              <div className="mt-4">
                <p className="mb-2 text-xs dim">对照一下，你写的算对吗？</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => advance(true)} loading={submitting}>
                    写错了
                  </Button>
                  <Button onClick={() => advance(false)} loading={submitting}>
                    写对了
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <button type="button" onClick={onRegenerate} className="w-full text-center text-xs dim hover:underline">
        换一批题
      </button>
    </div>
  );
}

function normalize(s: string) {
  return s.toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ').trim();
}

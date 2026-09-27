'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Badge, Button, Card, Progress, Textarea } from '@/components/ui';
import {
  CenterColumn,
  Choices,
  ColumnLabel,
  Explain,
  MaterialButton,
  MaterialSheet,
  MobileActionBar,
  MOBILE_ACTION_BAR_PAD,
  Speak,
  TappableText,
  useMaterialSheet,
} from './shared';
import type { StageProps, ReviewBody } from './types';
import type { GrammarData, GrammarExerciseData } from '@/lib/ai/schemas';
import { cn } from '@/lib/cn';

/*
 * 新生成的题一律四选一（kind=choice 或 cloze），但库里还躺着老形状的：
 * kind=fix/translate、options 是空的。缓存的 payload 读出来是直接 as 成类型的
 * （见 repo/session.ts 的 getStageContent），不会重新过一遍 schema，
 * 所以今天之前生成的题照样会走到这儿来。老题继续按「自己写 + 自评」渲染，
 * 不清库 —— 它们只是明天就不会再出现了。
 */
type Exercise = Omit<GrammarExerciseData, 'kind' | 'options'> & {
  kind: GrammarExerciseData['kind'] | 'fix' | 'translate';
  options?: string[];
};

type Payload = Omit<GrammarData, 'exercises'> & {
  exercises: Exercise[];
  point: { id: number; title_zh: string; title_en: string; pattern: string | null; pitfalls: string[] } | null;
};

const KIND_LABEL: Record<string, string> = {
  choice: '单选',
  cloze: '完型填空',
  fix: '改错',
  translate: '中译英',
};

/**
 * 语法。先看 100 多字的讲解（重点讲和中文的差别），再做 3-5 题。
 * 题现在都是四选一，机器判对错；只有库里的老题还是自评。
 */
export function GrammarStage({ payload, onDone, submitting }: StageProps<Payload>) {
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
  const sheet = useMaterialSheet();

  const startPractice = () => {
    sheet.hide();
    if (exercises.length) setPhase('practice');
    else onDone();
  };

  /*
    讲解 + 例句 + 易错点 = 这一环节的「材料」，全装进弹窗。
    focus_zh（AI 写的一整段「为什么今天讲这个」）删了，语法点本身就是主角。

    两个 phase 共用这一个弹窗：lesson 阶段它自动弹出来当讲解页，
    practice 阶段关掉答题、忘了规则再点「看讲解」调回来。
    原来是切到 practice 就把讲解换成题目，想不起规则只能退回去。
  */
  const materialSheet = (
    <MaterialSheet
      open={sheet.open}
      onClose={phase === 'lesson' ? startPractice : sheet.hide}
      title={point?.title_zh ?? '语法点'}
      subtitle={point?.title_en}
      footer={
        <Button className="w-full" onClick={startPractice} loading={submitting}>
          {phase === 'practice' ? '回去做题' : exercises.length ? `做 ${exercises.length} 道题` : '下一环节'}
        </Button>
      }
    >
      {point?.pattern && (
        <div className="mb-3">
          <Badge tone="brand">{point.pattern}</Badge>
        </div>
      )}

      {payload.mini_lesson_zh && (
        <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--text-body)]">
          {payload.mini_lesson_zh}
        </div>
      )}

      {/* 可选链兜底：AI 偶尔漏字段，不该让整页白屏 */}
      {payload.examples?.length ? (
        <div className="mt-5 border-t border-[var(--hairline)] pt-4">
          <p className="section-label">例句</p>
          <div className="mt-3 space-y-2">
            {payload.examples.map((ex, i) => (
              <div key={i} className="rounded-lg border border-[var(--hairline)] bg-[var(--bg-sidebar)] p-3">
                <div className="flex items-start gap-2">
                  <TappableText text={ex.en} className="flex-1 text-sm" />
                  <Speak text={ex.en} />
                </div>
                <p className="mt-1.5 text-xs dim">{ex.zh}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {point?.pitfalls && point.pitfalls.length > 0 && (
        <div className="mt-5 rounded-xl border border-warm-200 bg-warm-50 p-4 dark:border-warm-800 dark:bg-warm-900/25">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-warm-500" aria-hidden />
            <p className="text-sm font-semibold text-warm-700 dark:text-warm-300">中文母语者最容易错的地方</p>
          </div>
          <ul className="mt-2 space-y-1">
            {point.pitfalls.map((p, i) => (
              <li key={i} className="text-sm leading-relaxed text-[var(--text-body)]">
                · {p}
              </li>
            ))}
          </ul>
        </div>
      )}
    </MaterialSheet>
  );

  if (phase === 'lesson') {
    /*
      讲解阶段弹窗底下留一份入口：手动关掉了也还有路往下走，
      不至于对着一片空白发愣。
    */
    return (
      <>
        {materialSheet}
        <CenterColumn>
          <ColumnLabel>今天的语法点</ColumnLabel>
          <Card>
            <h2 className="serif text-[21px] font-bold leading-snug text-[var(--text-title)]">
              {point?.title_zh ?? '语法点'}
            </h2>
            <p className="en mt-0.5 text-sm dim">{point?.title_en}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button onClick={startPractice} loading={submitting}>
                {exercises.length ? `做 ${exercises.length} 道题` : '下一环节'}
              </Button>
              <MaterialButton label="看讲解" onClick={sheet.show} />
            </div>
          </Card>
        </CenterColumn>
      </>
    );
  }

  const ex = exercises[idx];
  /*
   * 按「有没有选项」分支，不按 kind。
   * kind 是给标签用的，真正决定怎么答题的是有没有东西可选 —— 这样老题
   * （kind=fix、没选项）和新题（cloze、有选项）都不用在这儿列举一遍。
   */
  const options = ex.options ?? [];
  const isChoice = options.length >= 2;
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

  const kindLabel = KIND_LABEL[ex.kind] ?? '练习';

  return (
    <>
      {materialSheet}

      {/* 底部提交按钮钉屏幕，内容补留白 */}
      <CenterColumn className={MOBILE_ACTION_BAR_PAD}>
        <div className="flex items-center gap-3">
          <Progress value={(idx / exercises.length) * 100} className="flex-1" />
          <span className="text-xs tabular-nums dim">
            {idx + 1}/{exercises.length}
          </span>
          <MaterialButton label="看讲解" onClick={sheet.show} />
        </div>

        <Card>
          <Badge>{kindLabel}</Badge>
          <p
            className={cn(
              'mt-3 text-[17px] leading-relaxed text-[var(--text-title)]',
              ex.kind !== 'translate' && 'en',
            )}
          >
            {ex.question}
          </p>
          {ex.kind === 'fix' && <p className="mt-1 text-xs dim">这句话有错，写出正确版本。</p>}

          {isChoice ? (
            <div className="mt-4">
              <Choices options={options} answer={ex.answer} picked={picked} onPick={setPicked} />
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
                    {/* 选择题的答案已经在选项里涂绿了，再抄一遍是噪音，只讲为什么 */}
                    {!isChoice && (
                      <>
                        <p className="text-xs dim">参考答案</p>
                        <TappableText text={ex.answer} className="block text-sm font-semibold" />
                      </>
                    )}
                    <p className={cn('text-xs dim', !isChoice && 'mt-2')}>{ex.explain_zh}</p>
                  </div>
                  <Speak text={ex.answer} />
                </div>
              </Explain>

              {/* 答题后按钮钉底：原来在流里，41 题刷完滚到底才能点「做完了」 */}
              <MobileActionBar>
                {isChoice ? (
                  <Button className="w-full" onClick={() => advance()} loading={submitting}>
                    {idx + 1 < exercises.length ? '下一题' : '做完了'}
                  </Button>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" onClick={() => advance(true)} loading={submitting}>
                      写错了
                    </Button>
                    <Button onClick={() => advance(false)} loading={submitting}>
                      写对了
                    </Button>
                  </div>
                )}
              </MobileActionBar>
            </>
          )}
        </Card>
      </CenterColumn>
    </>
  );
}

function normalize(s: string) {
  return s.toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ').trim();
}

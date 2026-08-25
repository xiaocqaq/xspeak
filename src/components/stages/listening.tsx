'use client';

import { useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Pause, Play, Rabbit, Turtle } from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { Choices, ColumnLabel, Explain, Split, StageIntro, StickyColumn, TappableText } from './shared';
import { useTts } from '@/hooks/useSpeech';
import type { StageProps, ReviewBody } from './types';
import type { ListeningData } from '@/lib/ai/schemas';
import { cn } from '@/lib/cn';

/**
 * 听力。默认藏文本 —— 先靠耳朵。全篇连播会依次朗读每一行，
 * 单行也能反复听、能放慢。答完题才允许对照原文。
 */
export function ListeningStage({ payload, onDone, onRegenerate, submitting }: StageProps<ListeningData>) {
  const { speak, stop, speaking, supported } = useTts();
  const [showText, setShowText] = useState(false);
  const [playingAll, setPlayingAll] = useState(false);
  const [line, setLine] = useState<number | null>(null);
  const [slow, setSlow] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const cancelRef = useRef(false);
  const collected = useMemo(() => ({ mistakes: [] } as Required<Pick<ReviewBody, 'mistakes'>>), []);

  const dialogue = payload.dialogue ?? [];
  const questions = payload.questions ?? [];
  const allAnswered = questions.length > 0 && questions.every((_, i) => answers[i] !== undefined);

  const playAll = () => {
    if (playingAll) {
      cancelRef.current = true;
      stop();
      setPlayingAll(false);
      setLine(null);
      return;
    }
    cancelRef.current = false;
    setPlayingAll(true);
    const step = (i: number) => {
      if (cancelRef.current || i >= dialogue.length) {
        setPlayingAll(false);
        setLine(null);
        return;
      }
      setLine(i);
      // 不写死 rate：交给 useTts 按用户的语速档位算，slow 只表示「再慢一档」
      speak(dialogue[i].text_en, { slow, onEnd: () => step(i + 1) });
    };
    step(0);
  };

  const pick = (qi: number, opt: string) => {
    setAnswers((a) => ({ ...a, [qi]: opt }));
    const q = questions[qi];
    if (opt !== q.answer) {
      collected.mistakes.push({
        kind: 'listening',
        stage: 'listening',
        wrong: `${q.q_zh} → ${opt}`,
        correct: q.answer,
        note: q.explain_zh,
      });
    }
  };

  return (
    <div className="space-y-4">
      <StageIntro>{payload.scene_zh}</StageIntro>

      {!supported && (
        <p className="rounded-xl border border-warm-200 bg-warm-50 p-3 text-sm dark:border-warm-900 dark:bg-warm-900/25">
          这个浏览器不支持语音合成，听力环节只能看文本。换 Chrome / Edge / Safari 就能听。
        </p>
      )}

      {/* 左边听、右边答：宽屏上答题时不用滚回去重播某一句 */}
      <Split
        aside={
          <StickyColumn>
            <ColumnLabel>听这段</ColumnLabel>
            <Card>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={playAll} disabled={!supported}>
                  {playingAll ? (
                    <Pause className="size-4" aria-hidden />
                  ) : (
                    <Play className="size-4" aria-hidden />
                  )}
                  {playingAll ? '停止' : '播放对话'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSlow((s) => !s)}>
                  {slow ? <Turtle className="size-4" aria-hidden /> : <Rabbit className="size-4" aria-hidden />}
                  {slow ? '慢速' : '正常'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowText((s) => !s)}>
                  {showText ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  {showText ? '藏起原文' : '看原文'}
                </Button>
              </div>

              <div className="mt-4 space-y-2">
                {dialogue.map((d, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      cancelRef.current = true;
                      setPlayingAll(false);
                      setLine(i);
                      speak(d.text_en, { slow });
                    }}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-lg border-l-2 p-3 text-left',
                      'transition-colors duration-200 [transition-timing-function:var(--ease-standard)]',
                      line === i
                        ? 'border-[var(--accent-bar)] bg-brand-50 dark:bg-brand-900/25'
                        : 'border-transparent hover:bg-[var(--surface-hover)]',
                    )}
                  >
                    {/* 说话人名字：这是标签不是台词，压成小号次要色，别和台词抢 */}
                    <span className="mt-0.5 w-10 shrink-0 truncate text-xs font-semibold text-[var(--text-secondary)]">
                      {d.speaker}
                    </span>
                    <span className="flex-1">
                      {showText ? (
                        <>
                          <span className="en block text-[15px] leading-relaxed text-[var(--text-body)]">
                            {d.text_en}
                          </span>
                          <span className="mt-0.5 block text-xs dim">{d.text_zh}</span>
                        </>
                      ) : (
                        <span className="block text-sm dim">
                          {line === i && speaking ? '正在播…' : '点这里听这一句'}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </Card>

            {showText && (
              <Card>
                <p className="section-label">全文（可点词查）</p>
                <div className="mt-2 space-y-1.5">
                  {dialogue.map((d, i) => (
                    <p key={i} className="text-sm leading-relaxed text-[var(--text-body)]">
                      <span className="font-semibold text-[var(--text-title)]">{d.speaker}: </span>
                      <TappableText text={d.text_en} />
                    </p>
                  ))}
                </div>
              </Card>
            )}
          </StickyColumn>
        }
      >
        <ColumnLabel>回答问题</ColumnLabel>
        {questions.map((q, qi) => (
          <Card key={qi}>
            <div className="flex items-center gap-2">
              <Badge>问题 {qi + 1}</Badge>
            </div>
            <p className="mt-2 text-[15px] leading-relaxed text-[var(--text-body)]">{q.q_zh}</p>
            <div className="mt-3">
              <Choices
                options={q.options}
                answer={q.answer}
                picked={answers[qi] ?? null}
                onPick={(opt) => pick(qi, opt)}
              />
            </div>
            {answers[qi] !== undefined && (
              <Explain>
                <p className="text-xs dim">{q.explain_zh}</p>
              </Explain>
            )}
          </Card>
        ))}

        <Button
          className="w-full"
          onClick={() => onDone(collected)}
          loading={submitting}
          disabled={!allAnswered && questions.length > 0}
        >
          {allAnswered || questions.length === 0 ? '听懂了，进入阅读' : '把问题答完再继续'}
        </Button>

        <button type="button" onClick={onRegenerate} className="w-full text-center text-xs dim hover:underline">
          换一段对话
        </button>
      </Split>
    </div>
  );
}

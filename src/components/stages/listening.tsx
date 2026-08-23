'use client';

import { useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Pause, Play, Rabbit, Turtle } from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { Choices, Explain, StageIntro, TappableText } from './shared';
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
      speak(dialogue[i].text_en, { rate: slow ? 0.7 : 0.9, onEnd: () => step(i + 1) });
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
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-900/25">
          这个浏览器不支持语音合成，听力环节只能看文本。换 Chrome / Edge / Safari 就能听。
        </p>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={playAll} disabled={!supported}>
            {playingAll ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
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
                speak(d.text_en, { rate: slow ? 0.7 : 0.9 });
              }}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl p-3 text-left transition-colors',
                line === i ? 'bg-brand-50 dark:bg-brand-900/30' : 'hover:bg-[var(--surface-2)]',
              )}
            >
              <span className="mt-0.5 shrink-0 text-xs font-semibold text-brand-600 dark:text-brand-300">
                {d.speaker}
              </span>
              <span className="flex-1">
                {showText ? (
                  <>
                    <span className="en block text-sm">{d.text_en}</span>
                    <span className="block text-xs dim">{d.text_zh}</span>
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

      {questions.map((q, qi) => (
        <Card key={qi}>
          <div className="flex items-center gap-2">
            <Badge>问题 {qi + 1}</Badge>
          </div>
          <p className="mt-2 text-sm">{q.q_zh}</p>
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

      {showText && (
        <Card>
          <p className="text-xs font-semibold dim">全文（可点词查）</p>
          <div className="mt-2 space-y-1.5">
            {dialogue.map((d, i) => (
              <p key={i} className="text-sm">
                <span className="font-semibold">{d.speaker}: </span>
                <TappableText text={d.text_en} />
              </p>
            ))}
          </div>
        </Card>
      )}

      <Button className="w-full" onClick={() => onDone(collected)} loading={submitting} disabled={!allAnswered && questions.length > 0}>
        {allAnswered || questions.length === 0 ? '听懂了，进入阅读' : '把问题答完再继续'}
      </Button>

      <button type="button" onClick={onRegenerate} className="w-full text-center text-xs dim hover:underline">
        换一段对话
      </button>
    </div>
  );
}

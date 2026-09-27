'use client';

import { useMemo, useState } from 'react';
import { Languages } from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import {
  CenterColumn,
  Choices,
  ColumnLabel,
  Explain,
  MaterialButton,
  MaterialSheet,
  Speak,
  TappableText,
  useMaterialSheet,
} from './shared';
import type { StageProps, ReviewBody } from './types';
import type { ChoiceQuestionData, ReadingData } from '@/lib/ai/schemas';

/*
 * 老题是开放式问答：{q_zh, answer_en, explain_zh}，没有 options，
 * 学生自己写英文再跟参考答案对照。新题是四选一。
 * 缓存的 payload 不会重新过 schema（见 repo/session.ts 的 getStageContent），
 * 所以老题照样会渲染到这儿 —— 它们只显示参考答案，不再给输入框。
 */
type Question = Partial<ChoiceQuestionData> & { q_zh: string; answer_en?: string };

type Payload = Omit<ReadingData, 'questions'> & { questions: Question[] };

/**
 * 阅读。短文里嵌了今天的目标词（高亮），任何词都能点开查。
 * 题目是四选一，读完就判对错，错的进错题本。
 */
export function ReadingStage({ payload, meta, onDone, submitting }: StageProps<Payload>) {
  const [showZh, setShowZh] = useState(false);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const sheet = useMaterialSheet();
  const targets = meta.targetWords.map((w) => w.term);
  const questions = payload.questions ?? [];

  // 判完一起交：阅读是整页做完再走，不像语法那样一题一题推进
  const mistakes = useMemo<NonNullable<ReviewBody['mistakes']>>(() => [], []);

  const finish = () => {
    for (const [i, q] of questions.entries()) {
      const answer = q.answer;
      const mine = picked[i];
      // 老题（没选项）没法判对错，跳过
      if (!answer || !mine || mine === answer) continue;
      mistakes.push({
        kind: 'reading',
        stage: 'reading',
        wrong: mine,
        correct: answer,
        note: q.explain_zh ?? null,
      });
    }
    onDone(mistakes.length ? { mistakes } : undefined);
  };

  return (
    /*
      删了「点任意一个词可以直接查」这句操作说明。
      点词查词是全站一致的交互，在每个阅读页都写一遍是噪音；
      高亮词本身的形态已经在提示它可点。

      原文进弹窗：进环节先弹出来读，读完关掉答题，要回去核对再点「看原文」。
      原来是宽屏左右分栏 —— 那样窄屏上原文和题目还是上下堆着，而且原文很长时
      滚动位置一直在动。
    */
    <>
      <MaterialSheet
        open={sheet.open}
        onClose={sheet.hide}
        title={payload.title_zh || '阅读原文'}
        subtitle={payload.title_en}
        footer={
          <Button className="w-full" onClick={sheet.hide}>
            读完了，去答题
          </Button>
        }
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="en serif text-[21px] font-bold leading-snug text-[var(--text-title)]">
            {payload.title_en}
          </h3>
          {/*
            onlineOnly：阅读全文一律用在线音色，没预生成就现场合成并弹
            「语音生成中…」（2026-08-28 用户要求）。全文会被切成好几块，
            后面的块常常没预热到 —— 那种时候更不能偷偷换成系统语音包。
          */}
          <Speak
            text={`${payload.title_en}. ${payload.passage_en}`}
            label="朗读全文"
            onlineOnly
          />
        </div>

        <div className="mt-3 leading-loose text-[var(--text-body)]">
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

        {/* 可选链兜底：AI 偶尔漏字段，不该让整页白屏 */}
        {payload.glosses?.length ? (
          <div className="mt-5 border-t border-[var(--hairline)] pt-4">
            <p className="section-label">文中值得留意的表达</p>
            <ul className="mt-3 space-y-3">
              {payload.glosses.map((g, i) => (
                <li key={i}>
                  <div className="flex items-center gap-1.5">
                    <span className="en text-sm font-semibold text-[var(--text-title)]">{g.term}</span>
                    <Speak text={g.term} className="p-0.5" onlineOnly />
                    <span className="text-sm dim">{g.meaning_zh}</span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed dim">{g.note_zh}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </MaterialSheet>

      <CenterColumn>
        <div className="flex items-center justify-between gap-3">
          <ColumnLabel>读完回答</ColumnLabel>
          <MaterialButton label="看原文" onClick={sheet.show} />
        </div>
        {questions.map((q, i) => {
          const options = q.options ?? [];
          const isChoice = options.length >= 2 && Boolean(q.answer);
          return (
            <Card key={i}>
              <Badge>问题 {i + 1}</Badge>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-body)]">{q.q_zh}</p>

              {isChoice ? (
                <div className="mt-3">
                  <Choices
                    options={options}
                    answer={q.answer!}
                    picked={picked[i] ?? null}
                    onPick={(opt) => setPicked((p) => ({ ...p, [i]: opt }))}
                  />
                  {/* 选了才讲，讲的是「为什么」；答案本身选项里已经涂绿了 */}
                  {picked[i] && q.explain_zh && (
                    <Explain>
                      <p className="text-xs dim">{q.explain_zh}</p>
                    </Explain>
                  )}
                </div>
              ) : /* 老的开放题：不给输入框了，只能看参考答案 */
              !revealed.has(i) ? (
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
                      <TappableText text={q.answer_en ?? q.answer ?? ''} className="block text-sm font-semibold" />
                      {q.explain_zh && <p className="mt-2 text-xs dim">{q.explain_zh}</p>}
                    </div>
                    <Speak text={q.answer_en ?? q.answer ?? ''} onlineOnly />
                  </div>
                </Explain>
              )}
            </Card>
          );
        })}

        <Button className="w-full" onClick={finish} loading={submitting}>
          读完了，去练口语
        </Button>
      </CenterColumn>
    </>
  );
}

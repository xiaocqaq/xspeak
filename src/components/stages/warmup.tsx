'use client';

import { useMemo, useState } from 'react';
import { Button, Card } from '@/components/ui';
import {
  clearProgress,
  fingerprint as fpOf,
  loadProgress,
  saveProgress,
  type WarmupProgress,
} from '@/lib/stage-progress';
import { Choices, ColumnLabel, Explain, RatingRow, Speak, Split, StageIntro, StickyColumn, TappableText, MobileActionBar, MOBILE_ACTION_BAR_PAD } from './shared';
import { cn } from '@/lib/cn';
import type { StageProps, ReviewBody } from './types';
import type { WarmupData } from '@/lib/ai/schemas';

/**
 * 热身复习。核心设计：每个到期的词都出现在一个全新句子里 ——
 * 不是背过的那句。做对≠记牢，先答题，再自评记得牢不牢，两者一起喂给 FSRS。
 *
 * 2026-08-28 混合题型：AI 完形只覆盖前 WARMUP_AI_CLOZE_CAP 个到期词；
 * 剩下的词由「释义单选」补上 —— 干扰项从**本次复习词表**里挑同级的词，
 * 纯前端拼装，不调 AI（零 token 零等待）。两种题进同一个队列、同一个
 * FSRS 记账口（mode 分别是 cloze / meaning_choice）。
 */
export function WarmupStage({ payload, meta, onDone, submitting }: StageProps<WarmupData>) {
  const aiItems = payload.items ?? [];

  const termToId = useMemo(() => {
    const m = new Map<string, number>();
    // 2026-08-28：热身考的是**复习词**，以前只映射 meta.targetWords（新词）
    // → 到期词答完 wordId 是 undefined，FSRS 记账整个静默丢失。
    // 现在新词+复习词两份都收（重复 term 后者覆盖，无影响）。
    for (const w of meta.targetWords) m.set(w.term.toLowerCase(), w.id);
    for (const w of meta.reviewWords ?? []) m.set(w.term.toLowerCase(), w.id);
    return m;
  }, [meta.targetWords, meta.reviewWords]);

  /**
   * 零 AI 释义单选题：AI 完形没覆盖到的复习词，每词一题。
   * 题干 = 词本身（大字）；选项 = 中文释义；干扰项从本次复习词表里选
   * **释义不同**的词（同表词都是同级、语境相关，迷惑性比随机抓词好）。
   * 不足 3 个干扰项时（词表太小）降级补任意 targetWords，再不够就少于
   * 4 个选项 —— Choices 组件对选项数量没有硬性要求。
   */
  const quizItems = useMemo(() => {
    const covered = new Set(aiItems.map((it) => it.term.toLowerCase()));
    const rest = (meta.reviewWords ?? []).filter((w) => !covered.has(w.term.toLowerCase()));
    if (!rest.length) return [];
    const pool = [...(meta.reviewWords ?? []), ...meta.targetWords];
    /*
     * 选项文案统一剥掉词性前缀（2026-08-28 修）。
     *
     * 库里历史脏数据有的带词性（"interj. 喂, 嘿" 来自 ECDICT 原始格式，
     * AI 造词路径以前没清洗），有的不带（"账单"）。混在四个选项里，
     * 唯一带前缀的那个一眼就是答案 —— 等于送分，而且看着像 bug。
     * 入库侧已统一清洗（repo/words.ts upsertWordFromAi），这里再兜一层：
     * 老数据不用等重新入库也能显示干净。
     */
    const clean = (s: string) =>
      s
        .replace(/^\++\s*/, '')
        .replace(/^[a-zA-Z]{1,6}\.\s*/, '')
        .split('\n')[0]
        .trim();
    return rest.map((w) => {
      const answer = clean(w.meaning_zh);
      const distract = pool.filter((x) => x.id !== w.id && clean(x.meaning_zh) !== answer);
      const pickedDistract: string[] = [];
      for (const d of distract) {
        if (pickedDistract.length >= 3) break;
        const c = clean(d.meaning_zh);
        if (c && !pickedDistract.includes(c)) pickedDistract.push(c);
      }
      return {
        term: w.term,
        wordId: w.id,
        meaning: answer,
        /** 词性显示在题干旁（灰字），不混进选项 —— 混进去会泄题 */
        pos: w.pos ?? '',
        phonetic: w.phonetic ?? '',
        options: [answer, ...pickedDistract],
      };
    });
  }, [aiItems, meta.reviewWords, meta.targetWords]);

  /** 统一答题队列：先 AI 完形，后释义单选。 */
  const total = aiItems.length + quizItems.length;

  /*
   * 答题进度存本地（2026-08-29 修）。
   *
   * 这一屏原来全是内存 state，刷新/切环节/手机切后台被回收 → 从第一题重来。
   * 更糟的是 collected（FSRS 记账）也只在最后一次性提交：答到第 9 题退出，
   * 前 8 题的复习记录一起丢，那些到期词明天还会再排上来。
   *
   * 指纹用题面拼，题目换了（换主题/AI 重生成）旧进度自动失效，
   * 不会出现"接着第 5 题"却是另一批题的错位。
   */
  const fingerprint = useMemo(
    () => fpOf([...aiItems.map((it) => it.term), ...quizItems.map((q) => q.term)]),
    [aiItems, quizItems],
  );
  /** 只在挂载时读一次：之后的真值就是下面这几个 state。 */
  const restored = useMemo(
    () => loadProgress<WarmupProgress>(meta.sessionId, 'warmup', fingerprint),
    [meta.sessionId, fingerprint],
  );

  const [idx, setIdx] = useState(() => Math.min(restored?.idx ?? 0, Math.max(0, total - 1)));
  const [picked, setPicked] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  /**
   * 已答过的题的对错，只用来渲染右边那栏。
   * collected 是个 memo 出来的可变对象，改它不会触发重渲染，所以这里另开一份 state。
   */
  const [results, setResults] = useState<boolean[]>(() => restored?.results ?? []);
  /** 右栏战绩要显示词面。释义题没有 items[i].term，单独记一份。 */
  const [resultTerms, setResultTerms] = useState<string[]>(() => restored?.resultTerms ?? []);
  const collected = useMemo(
    () =>
      ({
        words: restored?.words ?? [],
        mistakes: restored?.mistakes ?? [],
      }) as Required<Pick<ReviewBody, 'words' | 'mistakes'>>,
    [restored],
  );

  /** 当前题的统一视图：两类题各取所需。 */
  const current = useMemo(() => {
    if (idx < aiItems.length) {
      const it = aiItems[idx];
      return {
        kind: 'cloze' as const,
        term: it.term,
        options: it.options,
        answer: it.answer,
        wordId: termToId.get(it.term.toLowerCase()),
        mode: 'cloze',
      };
    }
    const q = quizItems[idx - aiItems.length];
    if (!q) return null;
    return {
      kind: 'meaning' as const,
      term: q.term,
      options: q.options,
      answer: q.meaning,
      wordId: q.wordId,
      mode: 'meaning_choice',
      pos: q.pos,
      phonetic: q.phonetic,
    };
  }, [idx, aiItems, quizItems, termToId]);

  if (total === 0) {
    return (
      <div className="space-y-4">
        <StageIntro tone="neutral">{payload.intro_zh}</StageIntro>
        <Button className="w-full" onClick={() => onDone()} loading={submitting}>
          进入新词环节
        </Button>
      </div>
    );
  }

  if (!current) return null;
  const isCloze = current.kind === 'cloze';
  const correct = picked === current.answer;

  const rate = (rating: 1 | 2 | 3 | 4) => {
    setResults((r) => [...r, correct]);
    setResultTerms((t) => [...t, current.term]);
    if (current.wordId) {
      collected.words.push({
        wordId: current.wordId,
        rating,
        mode: current.mode,
        elapsedMs: Date.now() - startedAt,
        context: isCloze && idx < aiItems.length ? aiItems[idx].sentence_en : current.term,
      });
    }
    if (!correct) {
      collected.mistakes.push({
        kind: 'word_choice',
        stage: 'warmup',
        wordId: current.wordId ?? null,
        wrong: isCloze
          ? aiItems[idx].sentence_en.replace('___', picked ?? '?')
          : `${current.term} → 误选「${picked}」`,
        correct: isCloze
          ? aiItems[idx].sentence_en.replace('___', current.answer)
          : `${current.term} → ${current.answer}`,
        note: isCloze && idx < aiItems.length ? aiItems[idx].why_zh : null,
      });
    }
    if (idx + 1 < total) {
      /*
       * 存档在推进之前写，存的是「下一题的下标」+ 到此刻为止的全部记账。
       * 每答一题写一次 localStorage（一次 JSON.stringify，几十微秒），
       * 换来的是中途退出不丢已答的题。
       */
      saveProgress(meta.sessionId, 'warmup', fingerprint, {
        idx: idx + 1,
        results: [...results, correct],
        resultTerms: [...resultTerms, current.term],
        words: collected.words,
        mistakes: collected.mistakes,
      } satisfies WarmupProgress);
      setIdx(idx + 1);
      setPicked(null);
      setStartedAt(Date.now());
    } else {
      // 这一环结束：进度存档没用了，留着会让「重做热身」一进来就跳到最后一题
      clearProgress(meta.sessionId, 'warmup');
      onDone(collected);
    }
  };

  /** 释义单选没有句子可填，显示正确答案的构成方式不同。 */
  const clozeItem = isCloze ? aiItems[idx] : null;
  const filled = clozeItem
    ? clozeItem.sentence_en.replace('___', clozeItem.answer)
    : `${current.term} = ${current.answer}`;

  /**
   * 把题干拆成「文字 + 下划线」的片段序列。
   *
   * 下划线要和紧跟着的那个词（含句末标点）绑成不折行单元，否则折行时
   * 会出现下划线独占一行、句点掉到下一行的难看情况。
   * 在 render 前算完，不在 map 里改数组 —— 严格模式下会渲染两次，带副作用的写法会把文字吃掉。
   */
  const parts = useMemo(() => {
    // 释义题没有句子，切分逻辑只对完形题有意义
    if (!clozeItem) return [];
    const segs = clozeItem.sentence_en.split('___');
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
  }, [clozeItem?.sentence_en]);

  return (
    /**
     * 不用 min-h 去撑满屏：那只是把空白从卡片下方换到按钮上方，空白还在。
     * 答题内容本来就短，让它自然收在上方、靠阅读宽度上限稳住版面就行。
     *
     * 宽屏上右边窄栏放这一轮的战绩。热身没有「材料」可以摊在旁边
     * （题干就是全部），但答过的词值得留在视野里 —— 顺手就能看出今天哪几个还虚。
     * 只列答过的：没答的题里那个词就是答案，提前列出来等于送分。
     */
    <Split
      ratio="wide-main"
      // 底部评分条在窄屏是 fixed 的，脱离文档流，得自己给内容让出这块高度
      className={MOBILE_ACTION_BAR_PAD}
      aside={
        <StickyColumn>
          <ColumnLabel>
            这一轮（{results.length}/{total}）
          </ColumnLabel>
          {results.length === 0 ? (
            <p className="text-xs dim">答过的词会记在这里。</p>
          ) : (
            <ul className="space-y-1.5">
              {results.map((ok, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span
                    className={cn(
                      'grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white',
                      ok ? 'bg-[var(--success)]' : 'bg-warm-500',
                    )}
                    aria-hidden
                  >
                    {ok ? '✓' : '!'}
                  </span>
                  <span className="en truncate text-[var(--text-body)]">{resultTerms[i]}</span>
                </li>
              ))}
            </ul>
          )}
        </StickyColumn>
      }
    >
      {/*
        题号单独成行。

        这里以前还摆着 payload.intro_zh —— AI 写的一整段「今天为什么这么安排」。
        删了：答题页的唯一任务是答题，三行教学设计说明摆在题目上方只会遮住主体，
        而且没人会读它。主题信息在 runner 顶部已经有了。
      */}
      <p className="en mb-3 text-[13px] font-medium tabular-nums dim">
        {idx + 1} / {total}
        {!isCloze && <span className="ml-2 dim">释义</span>}
      </p>

      <Card>
        {isCloze ? (
          <>
            {/*
              题目是主角：字号拉到 22px、用衬线，和译文/提示拉开两个层级 ——
              这是"书里的一句话"，不是一行界面文案。片段的切分见上方 parts 的注释。
            */}
            <p className="en serif text-[23px] font-semibold leading-snug text-[var(--text-title)]">
              {parts.map((p, i) => (
                <span key={i}>
                  {p.text}
                  {p.blankThenGlue !== undefined && (
                    <span className="whitespace-nowrap">
                      <span className="mx-1.5 inline-block min-w-20 border-b-2 border-[var(--accent-bar)] align-baseline" />
                      {p.blankThenGlue}
                    </span>
                  )}
                </span>
              ))}
            </p>
            <p className="mt-3 text-[15px] leading-relaxed dim">{clozeItem!.sentence_zh}</p>
            {picked === null && (
              <p className="mt-2 text-[13px] dim">提示：{clozeItem!.hint_zh}</p>
            )}
          </>
        ) : (
          <>
            {/*
              释义单选（零 AI）：题干就是词本身，大字衬线 + 朗读键。
              选项是中文释义，考「看见这个词能不能反应出意思」。
            */}
            <div className="flex items-center justify-between gap-3">
              <p className="en serif text-[30px] font-bold text-[var(--text-title)]">{current.term}</p>
              <Speak text={current.term} />
            </div>
            {/* 音标 + 词性放题干下方灰字：给判断依据，但不进选项（进选项就泄题） */}
            {(current.phonetic || current.pos) && (
              <p className="mt-1 text-sm dim">
                {current.phonetic && <span className="en">{current.phonetic}</span>}
                {current.phonetic && current.pos ? ' · ' : ''}
                {current.pos}
              </p>
            )}
            <p className="mt-1 text-[13px] dim">选出这个词的中文意思</p>
          </>
        )}

        <div className="mt-6">
          <Choices options={current.options} answer={current.answer} picked={picked} onPick={setPicked} />
        </div>

        {picked !== null && (
          <>
            <Explain>
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <TappableText text={filled} highlight={[current.answer]} className="block text-sm" />
                  {isCloze && <p className="mt-2 text-xs dim">{clozeItem!.why_zh}</p>}
                </div>
                <Speak text={filled} />
              </div>
            </Explain>

            {/*
              评分条钉在底部：原来在文档流里，402×874 的屏上题号行到卡片顶
              就已经到 188px，评分条顶在 802px 干脆滚出可视区。
              钉到底部后无论滚到哪里，四档按钮永远在手指底下。
            */}
            <MobileActionBar>
              <p className="mb-2 text-[13px] dim max-xl:text-center">
                刚才这个词，你记得有多牢？这决定它下次什么时候再来。
              </p>
              <RatingRow onRate={rate} busy={submitting} />
            </MobileActionBar>
          </>
        )}
      </Card>
    </Split>
  );
}

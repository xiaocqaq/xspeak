'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  clearProgress,
  fingerprint as fpOf,
  loadProgress,
  saveProgress,
  type NewWordsProgress,
} from '@/lib/stage-progress';
import { Check, ChevronLeft, ChevronRight, Lightbulb } from 'lucide-react';
import { Badge, Button, Card, Progress } from '@/components/ui';
import { ColumnLabel, Speak, Split, StageIntro, StickyColumn, TappableText } from './shared';
import type { StageProps } from './types';
import { probeServerSpeech, useTts } from '@/hooks/useSpeech';
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

/*
 * 「已学过」的本地记忆：真正见过卡片的词（点过「看意思」）记进 localStorage。
 * 同一个词隔几天又在复习/重学队列里出现时，不再让人重演"猜意思"那一步 ——
 * 卡片直接展开。库里知道的是"在学"（user_words），本地知道的是"在浏览器上
 * 完整看过一遍"，两回事：换设备/清缓存会退回默认行为，无害。
 */
const SEEN_WORDS_KEY = 'xlearn.seen-words';

function loadSeenWordIds(): Set<number> {
  try {
    const raw = localStorage.getItem(SEEN_WORDS_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(arr) ? new Set(arr.filter((x): x is number => Number.isInteger(x))) : new Set();
  } catch {
    return new Set();
  }
}

function persistSeenWordIds(ids: Set<number>): void {
  try {
    // 只留最近 2000 个，防无限膨胀
    const trimmed = ids.size > 2000 ? Array.from(ids).slice(-2000) : Array.from(ids);
    localStorage.setItem(SEEN_WORDS_KEY, JSON.stringify(trimmed));
  } catch {
    // 存不进去就算了（隐私模式/配额满），功能退化为本次会话内生效
  }
}
export function NewWordsStage({ payload, meta, onDone, onRegenerate, submitting }: StageProps<Payload>) {
  const words = payload.words ?? [];

  /*
   * 翻牌进度存本地（2026-08-29 修）。
   *
   * 原来 idx 是纯内存 state：刷新、切到语法再切回来、手机切后台被回收，
   * 一律回到第 1 张卡。用户实测「新词的进度本地也没有存储，每次也是只会
   * 从第一个开始」。
   *
   * 指纹用词 id 拼，所以「换一批词」后旧存档自动失效 —— 不会出现停在
   * 第 8 张、而新的一批只有 5 个词的错位。
   */
  const fingerprint = useMemo(() => fpOf(words.map((x) => x.id)), [words]);
  const restored = useMemo(
    () => loadProgress<NewWordsProgress>(meta.sessionId, 'newwords', fingerprint),
    [meta.sessionId, fingerprint],
  );

  const [idx, setIdx] = useState(() =>
    Math.min(Math.max(0, restored?.idx ?? 0), Math.max(0, words.length - 1)),
  );
  /*
   * 初始就翻开"本地已学过"的词：这些词在之前的会话里完整看过卡片，
   * 再猜一次意思没有教学价值，直接展示解释。新词还是先猜再看。
   * useState 初始化器只在挂载时跑一次，SSR 下 localStorage 不可访问，
   * 所以放到 typeof 检查里 —— 客户端首帧就是正确状态，不闪"猜意思"。
   */
  const [revealed, setRevealed] = useState<Set<number>>(() => {
    if (typeof window === 'undefined') return new Set<number>();
    const seen = loadSeenWordIds();
    /*
     * 两个来源都要认：
     *  - seen：历史上完整看过这个词（跨 session，按词 id）
     *  - 存档 revealedIds：这一轮翻开过（同 session，也按词 id）
     * 存 id 而不是下标 —— 换一批词后下标会指到别的词上。
     */
    const restoredIds = new Set(restored?.revealedIds ?? []);
    return new Set(
      words.map((w, i) => (seen.has(w.id) || restoredIds.has(w.id) ? i : -1)).filter((i) => i >= 0),
    );
  });
  // 搭配 chip 整块可点朗读，所以这里直接用 speak，不再往 chip 里塞 Speak 按钮
  const { speak, supported: ttsOk } = useTts();
  /*
   * 这些 chip 是直接调 speak() 的，没走 Speak 组件，所以要自己探一次缓存：
   * 探过之后点下去才能同步决定「真嗓音」还是「先出声、再后台热身」。
   * 依赖用内容指纹而不是 words 数组 —— 数组每次渲染都可能是新对象，
   * 那样会把已经探过的句子反复重探（服务端挂掉时尤其明显）。
   */
  const collocationsKey = words.map((w) => w.collocations.join('|')).join('||');
  useEffect(() => {
    probeServerSpeech(words.flatMap((w) => w.collocations));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collocationsKey]);

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

  /** 把当前进度落盘。翻牌和翻页都要调 —— 两者都是「做到哪了」。 */
  const persist = (nextIdx: number, revealedIdx: Set<number>) => {
    saveProgress(meta.sessionId, 'newwords', fingerprint, {
      idx: nextIdx,
      revealedIds: [...revealedIdx].map((i) => words[i]?.id).filter((id): id is number => !!id),
    } satisfies NewWordsProgress);
  };

  const reveal = () => {
    setRevealed((s) => {
      const next = new Set(s).add(idx);
      // 翻开 = 完整看过这张卡：记进本地，下次这个字再出现就直接展开
      const w = words[idx];
      if (w?.id) {
        const seen = loadSeenWordIds();
        if (!seen.has(w.id)) {
          seen.add(w.id);
          persistSeenWordIds(seen);
        }
      }
      // 翻开也算进度：翻开第 3 张后退出，回来应该还站在第 3 张、且是翻开的
      persist(idx, next);
      return next;
    });
  };

  const next = () => {
    if (last) {
      // 这一环做完了，存档没用了（留着会让「重新学一遍」直接跳到最后一张）
      clearProgress(meta.sessionId, 'newwords');
      onDone({ enroll: words.map((x) => x.id).filter(Boolean) });
    } else {
      persist(idx + 1, revealed);
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
      /*
        今天这批词的索引栏：手机上不出。
        单列布局下它整块落在词卡底下，而底部那条操作条钉不住 —— 往下滚看列表，
        按钮就跟着滚上去了（sticky 只在自己那一格里有效）。手机上要换词，
        标题旁边的刷新图标就是同一个动作，列表本身也只是个索引。
      */
      asideFrom="xl"
      // 底部操作条在窄屏是 fixed 的，脱离了文档流，得自己给内容让出这块高度
      className="max-xl:pb-[calc(6rem+env(safe-area-inset-bottom))]"
      aside={
        <StickyColumn>
          <ColumnLabel>今天这批（{words.length}）</ColumnLabel>
          {/*
            竖排一列，不再横着 flex-wrap。
            词长短差得多（a / luggage / check in），横排换行后每行个数不一样，
            看着就是一堆碎块；竖排一行一个，左边缘对齐，扫一眼就知道到哪了。

            用分组列表的形态（一个容器 + 内部分隔线），和 Choices 一致 ——
            这套体系里的平级列表都不给每项单独描边。
          */}
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-sidebar)]">
            {words.map((x, i) => (
              <button
                key={x.term}
                type="button"
                onClick={() => {
                  persist(i, revealed);
                  setIdx(i);
                }}
                aria-current={i === idx ? 'true' : undefined}
                className={cn(
                  'flex w-full touch-manipulation items-center gap-2 px-3 py-2 text-left',
                  'transition-colors duration-200 [transition-timing-function:var(--ease-standard)]',
                  i > 0 && 'border-t border-[var(--hairline)]',
                  i === idx
                    ? 'bg-[color-mix(in_srgb,var(--accent-bar)_12%,var(--surface))]'
                    : 'hover:bg-[var(--surface-hover)]',
                )}
              >
                {/* 序号占固定宽度，词才能左对齐 */}
                <span className="w-4 shrink-0 text-[11px] tabular-nums text-[var(--text-faint)]">{i + 1}</span>
                <span
                  className={cn(
                    'en flex-1 truncate text-[13px]',
                    i === idx
                      ? 'font-semibold text-[var(--text-title)]'
                      : revealed.has(i)
                        ? 'text-[var(--text-secondary)]'
                        : 'text-[var(--text-faint)]',
                  )}
                >
                  {x.term}
                </span>
                {/* 翻过的打勾；当前那个不打（它在最前面，用底色和字重表示） */}
                {revealed.has(i) && i !== idx && (
                  <Check className="size-3.5 shrink-0 text-[var(--success)]" aria-hidden />
                )}
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

      {/*
        卡片高度写死一档（min-h-[26rem]）：翻开前后内容差好几行，不定高的话
        下面那排按钮会上下跳，点「看意思」时手指刚好落在移动后的位置上。
      */}
      <Card className="min-h-[26rem]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="en serif text-[34px] font-bold leading-tight text-[var(--text-title)]">{w.term}</h2>
              <Speak text={w.term} />
            </div>
            <p className="mt-1 text-sm dim">
              {w.phonetic && <span className="en">{w.phonetic}</span>}
              {w.pos && <span> · {w.pos}</span>}
            </p>
          </div>
          {meta.themeZh && <Badge tone="brand">{meta.themeZh}</Badge>}
        </div>

        {!isRevealed ? (
          // 翻开前只留一句提示。原来这里还有个「看意思」按钮，和下面那排的
          // 主按钮是同一个动作 —— 一个动作给两个入口，只会让人犹豫点哪个。
          <p className="mt-10 text-center text-sm dim">先听一遍，猜猜是什么意思，再翻开。</p>
        ) : (
          /*
            翻开后四块内容：释义、例句、记忆抓手、搭配。
            原来四块各是一种形态（裸文字 / 灰框 / 黄框 / 一堆小方块），看着散。
            现在统一成「小标题 + 内容」，块之间靠分隔线切开，只有记忆抓手保留
            黄底 —— 它是唯一一个"提示"性质的东西，值得跳出来。
          */
          <div className="mt-6 divide-y divide-[var(--hairline)] fade-up">
            <section className="pb-4">
              <p className="section-label">意思</p>
              <p className="mt-1.5 text-[19px] font-semibold leading-snug text-[var(--text-title)]">
                {w.meaning_zh}
              </p>
              {w.meaning_en && <p className="en mt-1 text-sm leading-relaxed dim">{w.meaning_en}</p>}
            </section>

            {w.example_en && (
              <section className="py-4">
                <p className="section-label">例句</p>
                <div className="mt-1.5 flex items-start gap-2">
                  <TappableText
                    text={w.example_en}
                    highlight={[w.term]}
                    className="flex-1 text-[15px] leading-relaxed"
                  />
                  <Speak text={w.example_en} />
                </div>
                <p className="mt-1 text-[13px] dim">{w.example_zh}</p>
              </section>
            )}

            {w.memory_hook_zh && (
              <section className="py-4">
                <p className="section-label">怎么记</p>
                <div className="mt-1.5 flex items-start gap-2 rounded-lg border border-warm-200 bg-warm-50 p-3 dark:border-warm-800 dark:bg-warm-900/25">
                  <Lightbulb className="mt-0.5 size-4 shrink-0 text-warm-500" aria-hidden />
                  <p className="text-sm leading-relaxed text-[var(--text-body)]">{w.memory_hook_zh}</p>
                </div>
              </section>
            )}

            {w.collocations.length > 0 && (
              <section className="pt-4">
                <p className="section-label">常用搭配</p>
                {/*
                  chip 里原来嵌了个喇叭按钮，chip 被撑成小方块，三个一排就很碎。
                  现在整个 chip 自己就是朗读按钮 —— 少三个图标，宽度也正常了。
                */}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {w.collocations.map((c) =>
                    // 不支持 TTS 时退回纯展示，别挂个点了没反应的按钮
                    ttsOk ? (
                      <button
                        key={c}
                        type="button"
                        onClick={() => speak(c)}
                        aria-label={`朗读：${c}`}
                        className={cn(
                          'en rounded-lg border border-[var(--hairline)] bg-[var(--bg-sidebar)] px-2.5 py-1.5',
                          'text-[13px] text-[var(--text-body)] transition-colors duration-200',
                          '[transition-timing-function:var(--ease-standard)] hover:bg-[var(--surface-hover)]',
                        )}
                      >
                        {c}
                      </button>
                    ) : (
                      <span
                        key={c}
                        className="en rounded-lg border border-[var(--hairline)] bg-[var(--bg-sidebar)] px-2.5 py-1.5 text-[13px] text-[var(--text-body)]"
                      >
                        {c}
                      </span>
                    ),
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </Card>

      {/*
        窄屏上这条操作条固定在视口底部，永远在拇指够得到的位置。

        为什么是 fixed 而不是 sticky：sticky 只在自己那一格里生效，还要求页面
        比视口高才会贴住。这一页两头都不满足 —— 词卡收起时整页就一屏多一点，
        sticky 的元素只会停在它本来的位置（卡片正下方，屏幕中间），翻开后页面
        变长才忽然跑到底下去。同一个按钮位置飘忽不定，比一直不贴底更难用。

        fixed 脱离文档流，所以三件事要自己处理：
        - 左边让开常驻侧栏（lg 起 17rem），不然底条从侧栏底下穿过去；
        - 里面套一层和内容区同宽的容器（max-w-[36rem]，跟 runner 一致），
          否则平板上按钮会横着拉满一整屏；
        - 内容底部留出这条的高度，见 Split 上的 max-xl:pb-*。

        xl 起整组样式都不生成：宽屏是两列，页面基本不滚，钉住只会凭空多一条
        分隔线。所以全用 max-xl: 单向加，不做覆盖。

        pb 带 safe-area：iPhone 底部那根横条会压住按钮下沿。
      */}
      <div
        className={cn(
          'max-xl:fixed max-xl:inset-x-0 max-xl:bottom-0 max-xl:z-20',
          'max-xl:border-t max-xl:border-[var(--hairline)] max-xl:bg-[var(--bg)]',
          'max-xl:px-4 max-xl:pt-3 sm:max-xl:px-6',
          'max-xl:pb-[calc(0.75rem+env(safe-area-inset-bottom))]',
          'lg:max-xl:pl-[calc(var(--sidebar-w)+1.5rem)]',
        )}
      >
        <div className="mx-auto flex max-w-[36rem] items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              const prev = Math.max(0, idx - 1);
              persist(prev, revealed);
              setIdx(prev);
            }}
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
      </div>
    </Split>
  );
}

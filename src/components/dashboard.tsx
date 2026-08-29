'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Flame,
  Phone,
  Ruler,
  Sparkles,
} from 'lucide-react';
import { Badge, Button, Card, ErrorNote, Progress, Spinner } from '@/components/ui';
import { CallSheet } from '@/components/call-sheet';
import { DayBars } from '@/components/charts';
import { VoiceChatLauncher } from '@/components/voice-chat-launcher';
import { apiGet, apiPost } from '@/lib/fetcher';
import { STAGE_META, STAGES, type Stage, type StartConfig, type StatsSummary } from '@/lib/types';
import { cn } from '@/lib/cn';

type TodayData = {
  session: {
    id: number;
    day: string;
    themeSlug: string | null;
    themeZh: string;
    themeEn: string;
    stagesDone: Stage[];
    minutesSpent: number;
    completedAt: string | null;
  };
  reviewWords: { id: number; term: string; meaning_zh: string }[];
  targetWords: {
    id: number;
    term: string;
    meaning_zh: string;
    phonetic: string | null;
  }[];
  grammar: {
    id: number;
    title_zh: string;
    title_en: string;
    cefr: string;
  } | null;
  stats: StatsSummary;
  user: { name: string; onboarded: boolean; dailyMinutes: number };
};

export function Dashboard() {
  const router = useRouter();
  const [data, setData] = useState<TodayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 正在通话的配置。null = 弹窗关着 */
  const [call, setCall] = useState<StartConfig | null>(null);
  /** 第几通。只在拨号时 +1，用来换 key，让每通都从头接通 */
  const [callSeq, setCallSeq] = useState(0);
  /** 正在切换到下一个主题（POST /api/session/today 进行中） */
  const [switching, setSwitching] = useState(false);
  /** 上一条 session 已入历史、等 learning 页拉到新主题后的短暂过渡态 */
  const [finishing, setFinishing] = useState(false);

  const load = () => {
    setError(null);
    apiGet<TodayData>('/api/session/today')
      .then((d) => {
        if (!d.user.onboarded) {
          router.replace('/onboarding');
          return;
        }
        setData(d);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(load, []);

  if (error) return <ErrorNote message={error} onRetry={load} />;
  if (!data)
    return (
      <div className="pt-20">
        <Spinner label="正在准备今天的内容" />
      </div>
    );

  const { session, stats, reviewWords, targetWords, grammar } = data;
  const done = session.stagesDone.length;
  const finished = Boolean(session.completedAt);
  /*
   * 「继续」指向哪一环：从**做过的最后一环之后**接着走，不是「第一个没做的」。
   *
   * 2026-08-29 修：这里原来是 `STAGES.find((s) => !stagesDone.includes(s))`，
   * 从头扫第一个不在 stagesDone 里的。但 stagesDone 不保证是前缀 ——
   * 空态环节（第一天没有到期复习，热身直接跳过）和从侧栏跳着做都会留下空洞。
   * 生产实锤：session 17 的 stages_done = ["newwords","grammar"]，用户已经学到
   * 语法了，find 却扫回 warmup，首页按钮一直写着「继续热身复习」。
   *
   * runner.tsx 早就修成「往后走不回头」了（见那边 onDone 里的注释），
   * 但首页这条路漏了 —— 同一个规则要两处一致，否则首页送人回头、
   * 环节页又往前跳，两边打架。
   *
   * 规则：取 stagesDone 里下标最大的那一环，从它后面找第一个没做的；
   * 后面都做完了就回头补前面的空洞（跳着做的人还得有路回去），
   * 全做完了给 null（此时 finished 为真，按钮走「已完成」分支）。
   */
  const nextStage = (() => {
    const doneIdx = session.stagesDone
      .map((s) => STAGES.indexOf(s))
      .filter((i) => i >= 0);
    const from = doneIdx.length ? Math.max(...doneIdx) + 1 : 0;
    return (
      STAGES.slice(from).find((s) => !session.stagesDone.includes(s)) ??
      STAGES.find((s) => !session.stagesDone.includes(s))
    );
  })();

  /*
    首页这通电话不挑场景 —— 挑场景是「AI 对话」页的事，首页要的是"点一下就能说话"。
    所以话题直接取今天的主题，目标词也带上今天的新词：说出口就算 produced，
    和从对话页拨过去是同一套记账。
  */
  const dial = () => {
    setCallSeq((n) => n + 1);
    setCall({
      title: session.themeZh ? `随聊 · ${session.themeZh}` : '随聊',
      themeSlug: session.themeSlug,
      scenarioZh: session.themeZh
        ? `随意聊天，话题围绕「${session.themeZh}」，不用固定成某个具体场合。`
        : '随意聊天，什么都可以聊。',
      aiRole: 'a warm, patient English conversation partner',
      targetWordIds: targetWords.map((w) => w.id),
      // 只带前六个：一通闲聊里能自然塞进去的词就这么多，给一长串反而
      // 让 AI 谁都带不到；剩下的词在各个环节里本来就会练到
      targetTerms: targetWords.slice(0, 6).map((w) => w.term),
      sessionId: session.id,
    });
  };

  return (
    <div className="space-y-4 fade-up">
      {/*
        导入/设置两个入口挪到侧栏了，这里不再放图标按钮 ——
        首屏留给"今天要做什么"，越干净越好。
      */}
      <header>
        <p className="section-label">{formatDay(session.day)}</p>
        <h1 className="mt-2 text-[30px] sm:text-[34px]">
          {greeting()}，{data.user.name}
        </h1>
        <p className="mt-2 max-w-[52ch] text-[15px] text-[var(--text-secondary)]">
          {finished
            ? '今天的六个环节都走完了，想再练一轮随时可以。'
            : `今天围绕「${session.themeZh}」走六个环节，大约 ${data.user.dailyMinutes} 分钟。`}
        </p>
      </header>

      {/*
        宽屏分两列：左边"今天要做什么"（主题卡 + 环节清单），右边是参考信息
        （新词、到期词、语法点、错题、两周曲线）。

        原来这些是一条竖流，首页要滚三屏才能看完，而"今天学什么词"这种
        瞟一眼的东西被埋在最下面。xl 以下仍然是原来的顺序。
      */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] xl:items-start">
        {/*
          min-w-0 是必需的，不是保险（2026-08-29 实测定位「首页被撑宽」）：

          网格项的 min-width 默认是 auto —— 也就是"不许缩到内容最小宽以下"。
          而下面新词卡里的释义用了 `truncate`，它含 `white-space: nowrap`，
          **nowrap 文本的 min-content 等于整行不折行的宽度**。补多义项之后
          释义从「教练」变成「n. 四轮大马车，教练；vt. 训练，指导；vi. 坐马车
          旅行，作指导」，实测这一个 span 的 min-content 就是 386px，把这个
          网格项顶到 476px（视口只有 402），整页横向溢出 90px、右边被裁。

          min-w-0 把这条"不许缩"解除，列宽才真正由视口决定，truncate 也才
          有机会生效（否则它永远拿到足够宽度，不会出省略号）。
        */}
        <div className="min-w-0 space-y-4">
          {/*
            今日主线。
            原来这里有一团模糊的主色光斑做装饰，纸感体系里不用那个 ——
            改成左侧一条主色竖边，靠结构而不是光效把"这是主卡片"说清楚。
          */}
          <Card className="relative overflow-hidden">
            <span className="absolute inset-y-0 left-0 w-[3px] bg-[var(--accent-bar)]" aria-hidden />
            <div className="relative">
              <div className="flex items-center justify-between gap-3">
                <Badge tone="brand">今日主题</Badge>
                <span className="text-xs tabular-nums dim">
                  {done}/{STAGES.length} 环节
                </span>
              </div>
              <h2 className="serif mt-3 text-[22px] font-bold">{session.themeZh}</h2>
              <p className="en mt-1 text-sm dim">{session.themeEn}</p>

              <Progress value={(done / STAGES.length) * 100} className="mt-5" />

              <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <Stat label="待复习" value={String(stats.dueToday)} />
                <Stat label="新词" value={String(targetWords.length)} />
                <Stat label="连续天数" value={`${stats.streak} 天`} />
                <Stat label="今日用时" value={`${Math.round(session.minutesSpent)} 分`} />
              </div>

              {/*
                双按钮（2026-08-28）：左边继续当前主题（原有行为）；右边进入
                下一个主题 —— 当前没学完的标记完成入历史，开一个新主题。
                两个动作互斥，点哪个都先置全局 loading。

                布局（2026-08-29 修「首页被撑宽」）：两列等宽、所有屏幕都同一行。
                上一版是 `grid-cols-1 sm:grid-cols-[1fr_auto]`，有两个毛病：
                1. `auto` 列按内容取宽，而 grid 项默认 `min-width:auto` 不肯
                   收缩到内容宽以下 —— 两列内容宽相加超过卡片就把整页撑出
                   横向滚动（用户报的「首页为啥这么大」）。
                2. 窄屏堆成两行，和右边这颗按钮的份量不匹配。
                所以：`grid-cols-2` 从窄屏起就同一行、`min-w-0` 允许收缩、
                按钮内文字 `truncate`，宽度再紧也只是省略号，不会顶破容器。
                px 也跟着降一档（size=lg 的 px-7 在半幅宽里只剩不到 110px 放字）。
              */}
              <div className="mt-5 grid grid-cols-2 gap-2">
                <Button
                  size="lg"
                  className="min-w-0 px-3 sm:px-7"
                  loading={switching || finishing}
                  onClick={() =>
                    router.push(finished ? '/learn' : `/learn?stage=${nextStage ?? 'warmup'}`)
                  }
                >
                  {finished ? (
                    <>
                      <CheckCircle2 className="size-5 shrink-0" aria-hidden />
                      <span className="truncate">今天已完成，再练一轮</span>
                    </>
                  ) : done > 0 ? (
                    <>
                      <span className="truncate">继续「{STAGE_META[nextStage!].zh}」</span>
                      <ArrowRight className="size-5 shrink-0" aria-hidden />
                    </>
                  ) : (
                    <>
                      <span className="truncate">开始今天的 30 分钟</span>
                      <ArrowRight className="size-5 shrink-0" aria-hidden />
                    </>
                  )}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="min-w-0 px-3 sm:px-7"
                  loading={switching || finishing}
                  disabled={switching || finishing}
                  onClick={() => {
                    setError(null);
                    setSwitching(true);
                    apiPost<TodayData>('/api/session/today')
                      .then((d) => {
                        // 先渲染新主题再跳走（旧 session 已入历史，不刷就会看到上一条）
                        setData(d);
                        setSwitching(false);
                        setFinishing(true);
                        router.push('/learn?stage=warmup');
                      })
                      .catch((e) => {
                        setError(e.message);
                        setSwitching(false);
                      });
                  }}
                >
                  <Sparkles className="size-5 shrink-0" aria-hidden />
                  <span className="truncate">进入下一个主题</span>
                </Button>
              </div>
            </div>
          </Card>

          {/*
            环节清单。
            改成一个容器 + 分隔线的列表，而不是六个各带底色的圆角块 ——
            后者在纸面上会显得碎，分隔线才是读物的分组方式。
          */}
          <Card className="p-0 sm:p-0">
            <h2 className="border-b border-[var(--hairline)] px-5 py-3.5 text-sm">今天这样走</h2>
            <ol className="divide-y divide-[var(--hairline)]">
              {STAGES.map((s, i) => {
                const isDone = session.stagesDone.includes(s);
                const isNext = s === nextStage;
                return (
                  <li key={s}>
                    <Link
                      href={`/learn?stage=${s}`}
                      className={cn(
                        'flex items-center gap-3 px-5 py-3 transition-colors',
                        'hover:bg-[var(--surface-hover)]',
                        isNext && 'bg-[var(--surface-active)]',
                      )}
                    >
                      <span
                        className={cn(
                          // 序号章是方角小牌（圆形实心块站里只留给通话按钮），没走到的空心
                          'grid size-[22px] shrink-0 place-items-center rounded-md text-[11px] font-semibold tabular-nums',
                          isDone
                            ? 'bg-[var(--accent-bar)] text-white'
                            : isNext
                              ? 'bg-brand-600 text-white'
                              : 'border border-[var(--border)] bg-[var(--bg-sidebar)] text-[var(--text-faint)]',
                        )}
                      >
                        {isDone ? '✓' : i + 1}
                      </span>
                      <span
                        className={cn(
                          'flex-1 text-sm',
                          isNext && 'font-semibold text-brand-600',
                          isDone && !isNext && 'dim',
                        )}
                      >
                        {STAGE_META[s].zh}
                      </span>
                      <span className="text-[11.5px] tabular-nums dim">{STAGE_META[s].minutes}′</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </Card>

          {/*
            首页的口语入口。以前首页没有这一块，练口语得先进"AI 对话"页挑个场景 ——
            多两步，而"想说两句"这个念头经不起两步。这里点一下就直接接通。
          */}
          <Card>
            <div className="flex items-center gap-2">
              <Phone className="size-4 text-brand-600" strokeWidth={1.8} aria-hidden />
              <h2 className="text-sm">跟 AI 说两句</h2>
            </div>
            <p className="mt-3 text-sm dim">
              {targetWords.length > 0
                ? `像打电话一样直接开口，AI 用语音回你。它会把话往今天的 ${targetWords.length} 个新词上带，说错了在字幕里顺手改。`
                : '像打电话一样直接开口，AI 用语音回你。说错了它会在字幕里顺手改，也会进错误本。'}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button onClick={dial}>
                <Phone className="size-4" aria-hidden />
                开始对话
              </Button>
              {/* 想练特定场合（点单、问路…）的还是走对话页，那里能生成场景 */}
              <Button variant="ghost" onClick={() => router.push('/chat')}>
                挑个场景
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>
          </Card>
        </div>

        {/* min-w-0 同上：这一列装的就是那些长释义，缺了它整页被顶宽 */}
        <div className="min-w-0 space-y-4">
          {/* 今天会碰到什么。分栏之后右列本身就窄，这里不再套第二层两列 */}
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <Card>
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-brand-600" strokeWidth={1.8} aria-hidden />
                <h3 className="text-sm">今天的新词</h3>
              </div>
              {targetWords.length === 0 ? (
                <p className="mt-3 text-sm dim">
                  内置词库这个主题的词已经学完了，进入环节时会用 AI 补新词。
                </p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {targetWords.map((w) => (
                    // min-w-0：flex 项同样默认"不许缩到内容最小宽以下"，
                    // 而释义是 nowrap 的长文本。不放开的话 truncate 永远拿到
                    // 足够宽度、不出省略号，反而把外层顶宽（见上方长注释）。
                    <li key={w.id} className="flex min-w-0 items-baseline gap-2 text-sm">
                      <span className="en shrink-0 font-medium">{w.term}</span>
                      <span className="truncate dim">{w.meaning_zh}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <div className="flex items-center gap-2">
                <Flame className="size-4 text-warm-500" strokeWidth={1.8} aria-hidden />
                <h3 className="text-sm">到期要复习</h3>
              </div>
              {reviewWords.length === 0 ? (
                <p className="mt-3 text-sm dim">今天没有到期的词。热身环节会直接跳过。</p>
              ) : (
                <>
                  <p className="mt-3 text-sm dim">
                    共 {reviewWords.length} 个，会放进全新句子里考你，不是原来那句。
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {reviewWords.slice(0, 12).map((w) => (
                      <span
                        key={w.id}
                        className="en rounded-md border border-[var(--border)] bg-[var(--bg-sidebar)] px-2 py-0.5 text-xs"
                      >
                        {w.term}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </Card>
          </div>

          {grammar && (
            <Card>
              <div className="flex items-center gap-2">
                <Ruler className="size-4 text-brand-600" strokeWidth={1.8} aria-hidden />
                <h3 className="text-sm">今天的语法点</h3>
                <Badge>{grammar.cefr}</Badge>
              </div>
              <p className="mt-2.5 text-sm text-[var(--text-body)]">{grammar.title_zh}</p>
              <p className="en text-sm dim">{grammar.title_en}</p>
              <Link
                href="/grammar"
                className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--link)] hover:underline"
              >
                看全部语法进度 <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </Card>
          )}

          {/* 提示卡：底色染一点赭黄，比只换描边颜色更容易被注意到 */}
          {stats.openMistakes > 0 && (
            <Card className="border-warm-200 bg-warm-50 dark:border-warm-800 dark:bg-warm-900/20">
              <div className="flex items-start gap-3">
                <AlertCircle
                  className="mt-0.5 size-5 shrink-0 text-warm-500"
                  strokeWidth={1.8}
                  aria-hidden
                />
                <div>
                  <h3 className="text-sm">有 {stats.openMistakes} 个错误还没消掉</h3>
                  <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
                    这些会被塞进接下来几天的练习里重新考你 —— 不会提前告诉你是哪个。
                  </p>
                  <Link
                    href="/stats"
                    className="mt-2.5 inline-flex items-center gap-1 text-sm font-semibold text-[var(--link)] hover:underline"
                  >
                    查看错误本 <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                </div>
              </div>
            </Card>
          )}

          <Card>
            <div className="flex items-center gap-2">
              <Clock className="size-4 dim" strokeWidth={1.8} aria-hidden />
              <h3 className="text-sm">最近两周</h3>
            </div>
            <DayBars
              className="mt-3"
              height={64}
              ariaLabel="最近 14 天每天的复习次数"
              data={stats.last14.map((x) => ({
                day: x.day,
                value: x.reviews,
                tip: `${x.reviews} 次 · ${Math.round(x.minutes)} 分`,
              }))}
            />
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs dim">
              <span>已掌握 {stats.matureWords} 词</span>
              <span>学习中 {stats.learningWords} 词</span>
              <span>主动用出 {stats.producedToday} 次（今天）</span>
              {stats.retention30 != null && <span>30 天记牢率 {stats.retention30}%</span>}
            </div>
          </Card>
        </div>
      </div>

      {/*
        通话弹窗。首页留在底下不卸载，挂断之后人还在首页原地。
        key 让每次重新拨号都彻底重建：会话、计时、字幕都从头开始。
      */}
      <CallSheet
        open={Boolean(call)}
        onHangUp={() => setCall(null)}
        label={call ? `和 ${call.aiRole} 通话` : '通话'}
      >
        {call && (
          <VoiceChatLauncher key={`call-${callSeq}`} start={call} onHangUp={() => setCall(null)} />
        )}
      </CallSheet>
    </div>
  );
}

/** 四个小数字。描边 + 纸底，不用 fill 色块 —— 和卡片同族但比它浅一层。 */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-sidebar)] px-3 py-2.5">
      <p className="text-[11.5px] dim">{label}</p>
      <p className="mt-1 font-serif text-[17px] font-bold tabular-nums text-[var(--text-title)]">
        {value}
      </p>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 19) return '下午好';
  return '晚上好';
}

function formatDay(day: string) {
  const [, m, d] = day.split('-');
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(day).getDay()];
  return `${Number(m)} 月 ${Number(d)} 日 ${week ?? ''}`;
}

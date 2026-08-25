'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, ChevronLeft, ChevronRight, History, Keyboard, Loader2, RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import { Badge, Button, Card, Empty, ErrorNote, Input, PageHeader, Spinner } from '@/components/ui';
import { ChatPanel, type StartConfig } from '@/components/chat-panel';
import { VoiceChatLauncher } from '@/components/voice-chat-launcher';
import { apiGet, apiPost } from '@/lib/fetcher';
import { cn } from '@/lib/cn';

/**
 * 兜底场景。只在 AI 生成失败时用 —— 有网络问题或没配 key 的时候，
 * 页面也不该变成一个死胡同。
 *
 * 这些不带 targetWordIds，所以说出口的词不会计进 produced_count。
 * AI 生成的场景才会绑今天的目标词，那是主路径。
 */
const FALLBACK: Scenario[] = [
  {
    zh: '咖啡店点单',
    hint: '点单、加奶、改单、结账',
    aiRole: 'a friendly barista at a busy coffee shop',
    openingEn: 'Hi there! What can I get for you today?',
    openingZh: '你好！今天想喝什么？',
    targetTerms: [],
    targetWordIds: [],
  },
  {
    zh: '和同事闲聊',
    hint: '周末干了什么、天气、随口寒暄',
    aiRole: 'a friendly coworker chatting in the office kitchen',
    openingEn: 'Morning! Did you do anything fun over the weekend?',
    openingZh: '早啊！周末干了什么好玩的吗？',
    targetTerms: [],
    targetWordIds: [],
  },
  {
    zh: '问路',
    hint: '在陌生城市找地方',
    aiRole: 'a helpful local on a street corner',
    openingEn: 'You look a little lost — do you need help finding something?',
    openingZh: '你看着有点迷路，需要帮忙找地方吗？',
    targetTerms: [],
    targetWordIds: [],
  },
  {
    zh: '自由聊天',
    hint: '想聊什么就聊什么',
    aiRole: 'a warm, patient English conversation partner',
    openingEn: "Hey! What's on your mind today? We can talk about anything.",
    openingZh: '嘿！今天想聊点什么？什么都行。',
    targetTerms: [],
    targetWordIds: [],
  },
];

type Scenario = {
  zh: string;
  hint: string;
  aiRole: string;
  openingEn: string;
  openingZh: string;
  /** 这个场景绑定的今日目标词，展示用 */
  targetTerms: string[];
  /** 对应的词 id，开对话时带上，说出口才算 produced */
  targetWordIds: number[];
};

type ScenariosResponse = {
  scenarios: Scenario[];
  themeZh: string;
  sessionId: number | null;
  themeSlug: string | null;
};

type ConvSummary = { id: number; title: string; created_at: string; msgs: number };

/**
 * 两种练法，刻意分开：
 *
 * - 打字模式（text）：每说一句，AI 当场给出更自然的说法。反馈准、不漏，适合抠语法。
 * - 畅聊模式（voice）：直接说话，AI 用语音回你，中间不打断。练的是把话说出口的流利度，
 *   纠正在回合结束后异步补上。
 *
 * 不把两者揉在一个界面里 —— 「每句都被纠」和「不被打断地说完」本质冲突，混在一起会互相削弱。
 */
type Mode = 'text' | 'voice';

export function ChatPage() {
  const [mode, setMode] = useState<Mode>('text');
  const [config, setConfig] = useState<StartConfig | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [history, setHistory] = useState<ConvSummary[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [meta, setMeta] = useState<{ themeZh: string; sessionId: number | null; themeSlug: string | null }>({
    themeZh: '',
    sessionId: null,
    themeSlug: null,
  });
  const [loadingScenarios, setLoadingScenarios] = useState(false);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [wish, setWish] = useState('');
  /** 最近用过的场景名，「换一批」时告诉后端别再出这些 */
  const seenRef = useRef<string[]>([]);
  const bootedRef = useRef(false);

  const loadScenarios = useCallback(async (topic: string) => {
    setLoadingScenarios(true);
    setScenarioError(null);
    try {
      const d = await apiPost<ScenariosResponse>('/api/chat/scenarios', {
        wish: topic,
        // 只避开最近 12 个，太多会让 prompt 变长且限制过头
        avoid: seenRef.current.slice(-12),
        count: 4,
      });
      setScenarios(d.scenarios);
      setMeta({ themeZh: d.themeZh, sessionId: d.sessionId, themeSlug: d.themeSlug });
      seenRef.current = [...seenRef.current, ...d.scenarios.map((s) => s.zh)].slice(-24);
    } catch (e) {
      setScenarioError((e as Error).message);
      // 生成失败时给兜底场景，不要让页面空着
      setScenarios((prev) => prev ?? FALLBACK);
    } finally {
      setLoadingScenarios(false);
    }
  }, []);

  useEffect(() => {
    apiGet<{ conversations: ConvSummary[] }>('/api/chat')
      .then((d) => setHistory(d.conversations))
      .catch(() => setHistory([]));
  }, []);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void loadScenarios('');
  }, [loadScenarios]);

  if (config || openId) {
    const back = () => {
      setConfig(null);
      setOpenId(null);
    };

    const voice = mode === 'voice' && config;

    return (
      /* 通话模式要两列（面板 + 字幕）所以吃满容器；打字模式是气泡流，收回正文宽度 */
      <div className={cn('space-y-3', !voice && 'mx-auto w-full max-w-[var(--content-w)]')}>
        {/*
          进了对话就只留一条返回。原来这里是「大标题 + 场景中文 + 换场景」三行一坨，
          而通话面板本身已经写着跟谁在聊、聊什么 —— 同一件事说两遍，还把对话挤到屏幕下半截。
          文字模式没有那个面板，所以标题只在文字模式补一行小字。
        */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={back}
            className="-ml-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-title)]"
          >
            <ChevronLeft className="size-4" aria-hidden />
            换场景
          </button>
          {!voice && (
            <span className="truncate text-[13px] font-semibold text-[var(--text-title)]">
              {config?.title ?? '继续对话'}
            </span>
          )}
        </div>
        {/* key 保证换场景时面板彻底重建 */}
        {voice ? (
          <VoiceChatLauncher
            key={`v-${config.title}`}
            start={config}
            onHangUp={() => setConfig(null)}
          />
        ) : (
          <ChatPanel
            key={openId ?? config?.title}
            start={config ?? undefined}
            conversationId={openId ?? undefined}
          />
        )}
      </div>
    );
  }

  const pick = (s: Scenario) =>
    setConfig({
      title: s.zh,
      scenarioZh: `场景：${s.zh}。${s.hint}。`,
      aiRole: s.aiRole,
      openingEn: s.openingEn,
      openingZh: s.openingZh,
      targetTerms: s.targetTerms,
      targetWordIds: s.targetWordIds,
      sessionId: meta.sessionId,
      themeSlug: meta.themeSlug,
    });

  return (
    /*
      挑场景这一屏是"读四段文字然后选一个"，把它拉到 76rem 只会让每张卡的
      文字横跨太远。所以它自己收回正文宽度 —— 页面容器放宽是为了通话那一屏。
    */
    <div className="mx-auto w-full max-w-[var(--content-w)] space-y-6 fade-up">
      <PageHeader eyebrow="Practice" title="AI 对话">
        {mode === 'text'
          ? '说错也没关系，AI 每次回话都会顺手告诉你更自然的说法，错的会自动进错误本。'
          : '直接开口说，AI 用语音回你，中间不打断。纠正在你说完之后补上来。'}
      </PageHeader>

      {/* 二选一：一个描边容器包住两半，选中的那半是纸面（浮起来），另一半是凹底 */}
      <div className="flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg-sidebar)] p-1">
        {(
          [
            { k: 'text' as const, zh: '打字练', hint: '每句都纠', Icon: Keyboard },
            { k: 'voice' as const, zh: '开口聊', hint: '不打断', Icon: AudioLines },
          ]
        ).map(({ k, zh, hint, Icon }) => (
          <button
            key={k}
            type="button"
            onClick={() => setMode(k)}
            aria-pressed={mode === k}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold',
              'transition-all duration-200 [transition-timing-function:var(--ease-standard)]',
              mode === k
                ? 'bg-[var(--surface)] text-[var(--text-title)] shadow-[0_1px_2px_rgba(23,62,54,0.10)]'
                : 'text-[var(--text-dim)] hover:text-[var(--text-secondary)]',
            )}
          >
            <Icon className="size-4" strokeWidth={1.8} aria-hidden />
            {zh}
            <span className="text-[11px] font-normal opacity-70">{hint}</span>
          </button>
        ))}
      </div>

      {/* 自定义话题。填了就按它生成，空着点「换一批」就按今天的词自由发挥 */}
      <Card className="space-y-4">
        <div className="flex items-center gap-2">
          <Wand2 className="size-4 text-brand-600" strokeWidth={1.8} aria-hidden />
          <h2 className="text-sm">想练什么</h2>
        </div>
        <div className="flex gap-2">
          <Input
            value={wish}
            maxLength={120}
            placeholder="比如：跟房东抱怨暖气不热"
            onChange={(e) => setWish(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && wish.trim() && !loadingScenarios) {
                void loadScenarios(wish.trim());
              }
            }}
            aria-label="自定义话题"
          />
          <Button
            onClick={() => void loadScenarios(wish.trim())}
            loading={loadingScenarios}
            disabled={!wish.trim()}
            // shrink-0：不加的话输入框会把按钮挤窄，「生成」两个字被拆成竖排
            className="shrink-0"
          >
            生成
          </Button>
        </div>
        <p className="text-xs dim">
          {meta.themeZh
            ? `会结合今天的主题「${meta.themeZh}」和今天要练的词来编。`
            : '会结合今天要练的词来编场景。'}
        </p>
      </Card>

      {scenarioError && <ErrorNote message={scenarioError} onRetry={() => void loadScenarios(wish.trim())} />}

      <div className="flex items-center justify-between">
        <p className="section-label">
          {loadingScenarios && scenarios !== null ? (
            // 换一批时旧卡片还在（只是压暗），光靠按钮转圈看不出要等多久。
            // 把预期耗时说出来，才不会被当成点了没反应。
            <>正在换一批，大约半分钟</>
          ) : (
            '挑一个开始'
          )}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void loadScenarios(wish.trim())}
          disabled={loadingScenarios}
        >
          <RefreshCw className={cn('size-4', loadingScenarios && 'animate-spin')} aria-hidden />
          换一批
        </Button>
      </div>

      {scenarios === null ? (
        // 等待期得给足信息。生成一批场景真实要 20~30 秒（每个场景都要配角色、
        // 开场句和目标词），只放一个转圈的话，人会以为页面挂了。
        // 预先占位的骨架卡能说清「马上会有四张卡」，并把预期耗时写出来。
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm dim">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            <span>
              {wish.trim() ? `正在围绕「${wish.trim()}」编场景` : '正在按今天的内容编场景'}
              <span className="ml-1 opacity-70">大约要等半分钟</span>
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card space-y-4 p-4">
                <div className="h-4 w-2/5 animate-pulse rounded-md bg-[var(--surface-2)]" />
                <div className="h-3 w-3/4 animate-pulse rounded-md bg-[var(--surface-2)]" />
                <div className="h-3 w-full animate-pulse rounded-md bg-[var(--surface-2)]" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div
          className={cn(
            // stagger 让四张卡逐项入场（每张差 50ms），比整块闪现更像原生列表
            'grid gap-4 sm:grid-cols-2',
            !loadingScenarios && 'stagger',
            // 换一批时压暗旧内容，明确"这批要被替换了"，但不整块闪走
            loadingScenarios && 'pointer-events-none opacity-40',
          )}
        >
          {scenarios.map((s) => (
            <button
              key={`${s.zh}-${s.openingEn.slice(0, 12)}`}
              type="button"
              onClick={() => pick(s)}
              // card-interactive 是全站统一的"可点卡片"：悬停抬起 3px，不缩放
              className="card card-interactive p-4 text-left"
            >
              <p className="font-semibold text-[var(--text-title)]">{s.zh}</p>
              <p className="mt-1 text-xs dim">{s.hint}</p>
              {/* 开场句是这张卡的"引文"，用衬线斜体，读起来像书里引的一句话 */}
              <p className="en serif mt-4 text-[13px] italic text-[var(--text-secondary)]">
                “{s.openingEn}”
              </p>
              {/* 标出这个场景会考哪些今日词 —— 说出口它们才算 produced */}
              {s.targetTerms.length > 0 && (
                <p className="mt-4 flex flex-wrap items-center gap-2">
                  <Sparkles className="size-3 shrink-0 text-brand-500 dark:text-brand-600" aria-hidden />
                  {s.targetTerms.map((t) => (
                    <span
                      key={t}
                      className="en rounded-md border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-600 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-300"
                    >
                      {t}
                    </span>
                  ))}
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowHistory((s) => !s)}
        className="flex w-full items-center justify-center gap-2 text-sm font-semibold text-[var(--link)] hover:underline"
        hidden={mode === 'voice'}
      >
        <History className="size-4" aria-hidden />
        {showHistory ? '收起' : '看以前聊过的'}
      </button>

      {showHistory && (
        <Card>
          {history === null ? (
            <Spinner />
          ) : history.length === 0 ? (
            <Empty title="还没有聊过" hint="上面挑个场景开始就行" />
          ) : (
            // -mx 把行的悬停底色铺满卡片内边距，否则色块两侧会各留一条缝
            <ul className="-mx-5 divide-y divide-[var(--hairline)] sm:-mx-6">
              {history.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(c.id)}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors duration-200 [transition-timing-function:var(--ease-standard)] hover:bg-[var(--surface-hover)] sm:px-6"
                  >
                    <ChevronRight className="size-4 shrink-0 dim" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-[var(--text-title)]">{c.title}</span>
                      <span className="block text-xs dim">{c.created_at?.slice(0, 16)}</span>
                    </span>
                    <Badge>{c.msgs} 条</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

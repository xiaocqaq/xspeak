'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, History, Loader2, Phone, RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import { Badge, Button, Card, Empty, ErrorNote, Input, PageHeader, Spinner } from '@/components/ui';
import { CallSheet } from '@/components/call-sheet';
import { ChatTranscript } from '@/components/chat-transcript';
import { MaterialSheet } from '@/components/stages/shared';
import { VoiceChatLauncher } from '@/components/voice-chat-launcher';
import { apiGet, apiPost } from '@/lib/fetcher';
import { cn } from '@/lib/cn';
import { readScenarios, writeScenarios } from '@/lib/scenario-store';
import type { ChatScenario, StartConfig } from '@/lib/types';

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

/** 缓存模块要用同一个形状，类型放在 lib/types 里共用 */
type Scenario = ChatScenario;

type ScenariosResponse = {
  scenarios: Scenario[];
  themeZh: string;
  sessionId: number | null;
  themeSlug: string | null;
};

type ConvSummary = { id: number; title: string; created_at: string; msgs: number };

/**
 * AI 对话页。
 *
 * 只有一种练法：打电话。挑个场景，弹窗接通，直接开口说 ——
 * 以前这里还有个「打字练」模式（每句都被抠语法，但要打字等回复），
 * 现在整条去掉了：口语练的是把话说出口，打字练出来的是打字。
 * 纠正没丢，它跟着字幕一句句补在通话弹窗里，也照旧进错题本。
 */
export function ChatPage() {
  const [config, setConfig] = useState<StartConfig | null>(null);
  /** 在看的那段旧记录。只读，和通话是两个不同的弹窗 */
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
      // 存一份，切走再回来就不用再等一次生成。兜底场景不存 —— 那是失败路径
      writeScenarios({
        scenarios: d.scenarios,
        themeZh: d.themeZh,
        sessionId: d.sessionId,
        themeSlug: d.themeSlug,
        seen: seenRef.current,
      });
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
    // 先看缓存。命中就直接显示，一次 AI 都不用调。
    // 放在 effect 里而不是 useState 初值里：服务端读不到 localStorage，
    // 拿它当初值会让首屏和 hydration 对不上。
    const cached = readScenarios();
    if (cached) {
      setScenarios(cached.scenarios);
      setMeta({ themeZh: cached.themeZh, sessionId: cached.sessionId, themeSlug: cached.themeSlug });
      seenRef.current = cached.seen;
      return;
    }
    void loadScenarios('');
  }, [loadScenarios]);

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
      文字横跨太远。通话不再占页面（它在弹窗里），所以这一页从头到尾就是正文宽度。
    */
    <div className="mx-auto w-full max-w-[var(--content-w)] space-y-6 fade-up">
      <PageHeader eyebrow="Practice" title="AI 对话">
        像打电话一样直接开口说，AI 用语音回你，中间不打断。说错的地方它会在字幕里顺手改，也会进错误本。
      </PageHeader>

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
              {/* 点整张卡就是拨过去，所以底下写清楚点了会发生什么 */}
              <span className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400">
                <Phone className="size-3.5" aria-hidden />
                开始对话
              </span>
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowHistory((s) => !s)}
        className="flex w-full items-center justify-center gap-2 text-sm font-semibold text-[var(--link)] hover:underline"
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

      {/*
        通话弹窗。挑场景那一屏留在底下不卸载 —— 挂断之后人还在原地，
        想换一个直接点下一张卡，不用先"返回"一次。
        key 保证换场景时会话、计时、字幕全部重建。
      */}
      <CallSheet
        open={Boolean(config)}
        onHangUp={() => setConfig(null)}
        label={config ? `和 ${config.aiRole} 通话` : '通话'}
      >
        {config && (
          <VoiceChatLauncher key={`call-${config.title}`} start={config} onHangUp={() => setConfig(null)} />
        )}
      </CallSheet>

      {/* 旧记录是只读的，用材料弹窗那一套（可关、可滚），不是通话那一套 */}
      <MaterialSheet
        open={openId !== null}
        onClose={() => setOpenId(null)}
        title="聊过的记录"
        subtitle={history?.find((c) => c.id === openId)?.title}
      >
        {openId !== null && <ChatTranscript conversationId={openId} />}
      </MaterialSheet>
    </div>
  );
}

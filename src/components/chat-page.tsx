'use client';

import { useEffect, useState } from 'react';
import { AudioLines, History, Keyboard, Plus } from 'lucide-react';
import { Badge, Button, Card, Empty, Spinner } from '@/components/ui';
import { ChatPanel, type StartConfig } from '@/components/chat-panel';
import { VoiceChatLauncher } from '@/components/voice-chat-launcher';
import { apiGet } from '@/lib/fetcher';
import { cn } from '@/lib/cn';

/** 预设场景。都是日常真会碰到的，不是课本对话。 */
const SCENARIOS: { key: string; zh: string; hint: string; role: string; opening: string; openingZh: string }[] = [
  {
    key: 'cafe',
    zh: '咖啡店点单',
    hint: '点单、加奶、改单、结账',
    role: 'a friendly barista at a busy coffee shop',
    opening: "Hi there! What can I get for you today?",
    openingZh: '你好！今天想喝什么？',
  },
  {
    key: 'smalltalk',
    zh: '和同事闲聊',
    hint: '周末干了什么、天气、随口寒暄',
    role: 'a friendly coworker chatting in the office kitchen',
    opening: "Morning! Did you do anything fun over the weekend?",
    openingZh: '早啊！周末干了什么好玩的吗？',
  },
  {
    key: 'directions',
    zh: '问路',
    hint: '在陌生城市找地方',
    role: 'a helpful local on a street corner',
    opening: "You look a little lost — do you need help finding something?",
    openingZh: '你看着有点迷路，需要帮忙找地方吗？',
  },
  {
    key: 'restaurant',
    zh: '餐厅吃饭',
    hint: '订位、点菜、问推荐、买单',
    role: 'a waiter at a casual restaurant',
    opening: "Good evening! Table for one? Here's the menu.",
    openingZh: '晚上好！一位吗？菜单给你。',
  },
  {
    key: 'doctor',
    zh: '看医生',
    hint: '描述症状、听医生建议',
    role: 'a calm doctor at a walk-in clinic',
    opening: "Hello, please take a seat. What brings you in today?",
    openingZh: '你好，请坐。今天怎么不舒服？',
  },
  {
    key: 'interview',
    zh: '英文面试',
    hint: '自我介绍、讲经历、答提问',
    role: 'a friendly hiring manager doing a first-round interview',
    opening: "Thanks for coming in. Could you start by telling me a bit about yourself?",
    openingZh: '感谢过来。先简单介绍一下你自己吧？',
  },
  {
    key: 'phone',
    zh: '打电话办事',
    hint: '改预约、问信息、投诉',
    role: 'a customer service agent on the phone',
    opening: "Thank you for calling. How can I help you today?",
    openingZh: '感谢来电，请问需要什么帮助？',
  },
  {
    key: 'free',
    zh: '自由聊天',
    hint: '想聊什么就聊什么',
    role: 'a warm, patient English conversation partner',
    opening: "Hey! What's on your mind today? We can talk about anything.",
    openingZh: '嘿！今天想聊点什么？什么都行。',
  },
];

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

  useEffect(() => {
    apiGet<{ conversations: ConvSummary[] }>('/api/chat')
      .then((d) => setHistory(d.conversations))
      .catch(() => setHistory([]));
  }, []);

  if (config || openId) {
    return (
      <div className="space-y-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">{config?.title ?? '继续对话'}</h1>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setConfig(null);
              setOpenId(null);
            }}
          >
            换场景
          </Button>
        </div>
        {config?.scenarioZh && <p className="text-xs dim">{config.scenarioZh}</p>}
        {/* key 保证换场景时面板彻底重建 */}
        {mode === 'voice' && config ? (
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

  return (
    <div className="space-y-4 py-2 fade-up">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">AI 对话</h1>
        <p className="mt-1.5 text-sm dim">
          {mode === 'text'
            ? '说错也没关系，AI 每次回话都会顺手告诉你更自然的说法，错的会自动进错误本。'
            : '直接开口说，AI 用语音回你，中间不打断。纠正在你说完之后补上来。'}
        </p>
      </header>

      <div className="flex gap-2 rounded-xl bg-[var(--surface-2)] p-1">
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
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors',
              mode === k ? 'bg-[var(--surface)] shadow-sm' : 'text-[var(--text-dim)]',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {zh}
            <span className="text-[11px] font-normal dim">{hint}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        {SCENARIOS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() =>
              setConfig({
                title: s.zh,
                scenarioZh: `场景：${s.zh}。${s.hint}。`,
                aiRole: s.role,
                openingEn: s.opening,
                openingZh: s.openingZh,
              })
            }
            className={cn(
              'card p-4 text-left transition-colors hover:border-brand-400',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500',
            )}
          >
            <p className="font-medium">{s.zh}</p>
            <p className="mt-0.5 text-xs dim">{s.hint}</p>
            <p className="en mt-2 text-xs dim">“{s.opening}”</p>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setShowHistory((s) => !s)}
        className="flex w-full items-center justify-center gap-1.5 text-sm dim hover:underline"
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
            <ul className="divide-y divide-[var(--border)]">
              {history.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(c.id)}
                    className="flex w-full items-center gap-3 py-2.5 text-left hover:opacity-80"
                  >
                    <Plus className="size-4 shrink-0 dim" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{c.title}</span>
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

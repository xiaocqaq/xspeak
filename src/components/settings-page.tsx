'use client';

import { useEffect, useState } from 'react';
import { Play, Volume2 } from 'lucide-react';
import { Badge, Button, Card, ErrorNote, Input, Spinner } from '@/components/ui';
import { apiGet, apiPatch } from '@/lib/fetcher';
import { useTts } from '@/hooks/useSpeech';
import type { UserProfile } from '@/lib/types';
import { cn } from '@/lib/cn';

const LEVELS = [
  { v: 'A1', zh: '入门 · 只认得常见词' },
  { v: 'A2', zh: '基础 · 能拼简单句子' },
  { v: 'B1', zh: '中级 · 日常话题能聊' },
  { v: 'B2', zh: '中高 · 能表达细节观点' },
] as const;

const GOALS = [
  { v: 'daily_talk', zh: '日常口语交流' },
  { v: 'reading', zh: '阅读' },
  { v: 'work', zh: '工作沟通' },
  { v: 'exam', zh: '考试' },
  { v: 'travel', zh: '旅行' },
] as const;

const INTERESTS = ['科技', '游戏', '电影美剧', '音乐', '旅行', '美食', '运动', '编程', '职场', '新闻', '动物', '心理'];

/** 设置页。改了立刻影响明天 AI 出题的口味。 */
export function SettingsPage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { speak, voices, supported } = useTts(user?.voice ?? undefined);

  const load = () => {
    setError(null);
    apiGet<{ user: UserProfile }>('/api/profile')
      .then((d) => setUser(d.user))
      .catch((e) => setError(e.message));
  };

  useEffect(load, []);

  const patch = (p: Partial<UserProfile>) => setUser((u) => (u ? { ...u, ...p } : u));

  const save = async () => {
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      const d = await apiPatch<{ user: UserProfile }>('/api/profile', {
        name: user.name,
        level: user.level,
        goal: user.goal,
        interests: user.interests,
        dailyMinutes: user.daily_minutes,
        newWordsPerDay: user.new_words_per_day,
        voice: user.voice,
      });
      setUser(d.user);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (error && !user) return <ErrorNote message={error} onRetry={load} />;
  if (!user) return <div className="py-10"><Spinner /></div>;

  const toggleInterest = (t: string) =>
    patch({
      interests: user.interests.includes(t)
        ? user.interests.filter((x) => x !== t)
        : [...user.interests, t].slice(0, 8),
    });

  const enVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));

  return (
    <div className="space-y-4 py-2 fade-up">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
        <p className="mt-1.5 text-sm dim">这些直接决定 AI 明天给你出什么内容。</p>
      </header>

      {error && <ErrorNote message={error} />}

      <Card className="space-y-4">
        <div>
          <label htmlFor="name" className="text-sm font-medium">
            怎么称呼你
          </label>
          <Input
            id="name"
            value={user.name}
            maxLength={30}
            onChange={(e) => patch({ name: e.target.value })}
            className="mt-1.5"
          />
        </div>

        <Group label="现在的水平">
          {LEVELS.map((l) => (
            <Chip key={l.v} active={user.level === l.v} onClick={() => patch({ level: l.v })}>
              <span className="font-medium">{l.v}</span>
              <span className="ml-1.5 text-xs opacity-70">{l.zh}</span>
            </Chip>
          ))}
        </Group>

        <Group label="主要目标">
          {GOALS.map((g) => (
            <Chip key={g.v} active={user.goal === g.v} onClick={() => patch({ goal: g.v })}>
              {g.zh}
            </Chip>
          ))}
        </Group>

        <Group label={`兴趣（选 1-8 个，AI 会用这些编场景）`}>
          {INTERESTS.map((t) => (
            <Chip key={t} active={user.interests.includes(t)} onClick={() => toggleInterest(t)}>
              {t}
            </Chip>
          ))}
        </Group>

        <Slider
          label="每天时长"
          unit="分钟"
          value={user.daily_minutes}
          min={10}
          max={90}
          step={5}
          onChange={(v) => patch({ daily_minutes: v })}
        />
        <Slider
          label="每天新词"
          unit="个"
          value={user.new_words_per_day}
          min={3}
          max={20}
          step={1}
          onChange={(v) => patch({ new_words_per_day: v })}
          hint="加得越多，几天后的复习量越大。看数据页的未来 14 天再决定。"
        />
      </Card>

      <Card>
        <div className="flex items-center gap-1.5">
          <Volume2 className="size-4 dim" aria-hidden />
          <h2 className="text-sm font-semibold">朗读声音</h2>
        </div>
        {!supported ? (
          <p className="mt-2 text-sm dim">这个浏览器不支持语音合成。Chrome、Edge、Safari 都可以。</p>
        ) : enVoices.length === 0 ? (
          <p className="mt-2 text-sm dim">没找到英文语音包，可能还在加载，刷新一下试试。</p>
        ) : (
          <>
            <div className="mt-3 space-y-1.5">
              <VoiceRow
                name={null}
                active={!user.voice}
                onPick={() => patch({ voice: null })}
                onPlay={() => speak('Nice to meet you. What do you usually do on weekends?')}
              />
              {enVoices.map((v) => (
                <VoiceRow
                  key={v.name}
                  name={v.name}
                  lang={v.lang}
                  local={v.localService}
                  active={user.voice === v.name}
                  onPick={() => patch({ voice: v.name })}
                  onPlay={() => speak('Nice to meet you. What do you usually do on weekends?', { voice: v })}
                />
              ))}
            </div>
            <p className="mt-2.5 text-xs dim">本地语音离线可用，云端语音音质更好但要联网。</p>
          </>
        )}
      </Card>

      <div className="sticky bottom-20 z-10 flex items-center gap-3 sm:bottom-4">
        <Button onClick={save} loading={saving} size="lg" className="flex-1 shadow-lg">
          保存
        </Button>
        {saved && <Badge tone="success">已保存</Badge>}
      </div>

      <Card>
        <h2 className="text-sm font-semibold">关于数据</h2>
        <p className="mt-2 text-sm leading-relaxed dim">
          所有学习记录都在本机的 SQLite 文件里（<code className="en">data/linxi.db</code>），没有账号系统，也不上云。
          换电脑的话把这个文件拷过去就行。
        </p>
        <p className="mt-2 text-sm leading-relaxed dim">
          也就是说：这个站默认只监听本机、不带登录。要放到公网必须先加一层认证。
        </p>
      </Card>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1.5 text-sm transition-colors',
        active
          ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-100'
          : 'border-[var(--border)] hover:bg-[var(--surface-2)]',
      )}
    >
      {children}
    </button>
  );
}

function Slider({
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  const id = `s-${label}`;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <span className="text-sm tabular-nums dim">
          {value} {unit}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-[var(--brand-600)]"
      />
      {hint && <p className="mt-1 text-xs dim">{hint}</p>}
    </div>
  );
}

function VoiceRow({
  name,
  lang,
  local,
  active,
  onPick,
  onPlay,
}: {
  name: string | null;
  lang?: string;
  local?: boolean;
  active: boolean;
  onPick: () => void;
  onPlay: () => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2',
        active ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30' : 'border-[var(--border)]',
      )}
    >
      <button type="button" onClick={onPick} aria-pressed={active} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm">{name ?? '自动选择'}</span>
        <span className="text-[11px] dim">
          {name ? `${lang}${local ? ' · 本地' : ' · 云端'}` : '按系统可用的英文语音挑一个'}
        </span>
      </button>
      <Button variant="ghost" size="sm" onClick={onPlay} aria-label="试听">
        <Play className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

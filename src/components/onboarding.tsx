'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button, Card, ErrorNote, Input } from '@/components/ui';
import { apiPost } from '@/lib/fetcher';
import { cn } from '@/lib/cn';

const LEVELS = [
  { v: 'A1', zh: '只认识常见词', hint: 'hello / eat / good 这种，句子还组不利索' },
  { v: 'A2', zh: '能说简单句', hint: '能自我介绍、点菜，但一长就卡' },
  { v: 'B1', zh: '日常够用', hint: '能聊起来，语法还常错' },
  { v: 'B2', zh: '比较流利', hint: '想练精准表达和地道说法' },
] as const;

const GOALS = [
  { v: 'daily_talk', zh: '日常口语交流' },
  { v: 'reading', zh: '阅读' },
  { v: 'work', zh: '工作场景' },
  { v: 'travel', zh: '出国旅行' },
  { v: 'exam', zh: '应试' },
] as const;

const INTERESTS = [
  '电影', '音乐', '美食', '旅行', '科技', '游戏', '运动健身',
  '读书', '职场', '宠物', '摄影', '新闻时事',
];

export function Onboarding() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [level, setLevel] = useState<string>('A1');
  const [goal, setGoal] = useState<string>('daily_talk');
  const [interests, setInterests] = useState<string[]>([]);
  const [dailyMinutes, setDailyMinutes] = useState(30);
  const [newWordsPerDay, setNewWordsPerDay] = useState(8);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (i: string) =>
    setInterests((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiPost('/api/onboarding', {
        name: name.trim() || '学习者',
        level,
        goal,
        interests,
        dailyMinutes,
        newWordsPerDay,
      });
      router.replace('/');
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 py-6 fade-up">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">先认识一下</h1>
        <p className="mt-2 text-sm dim">
          这几项决定 AI 每天给你出什么内容。后面在设置里随时能改。
        </p>
      </div>

      <Card className="space-y-2">
        <label htmlFor="name" className="text-sm font-semibold">
          怎么称呼你
        </label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="随便写，只用来打招呼"
          maxLength={30}
        />
      </Card>

      <Card>
        <h2 className="text-sm font-semibold">现在大概什么水平</h2>
        <div className="mt-3 space-y-2">
          {LEVELS.map((l) => (
            <button
              key={l.v}
              type="button"
              onClick={() => setLevel(l.v)}
              aria-pressed={level === l.v}
              className={cn(
                'w-full rounded-xl border p-3 text-left transition-colors',
                level === l.v
                  ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30'
                  : 'border-[var(--border)] hover:bg-[var(--surface-2)]',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="en text-xs font-semibold text-brand-600 dark:text-brand-300">
                  {l.v}
                </span>
                <span className="text-sm font-medium">{l.zh}</span>
              </div>
              <p className="mt-0.5 text-xs dim">{l.hint}</p>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold">最想解决什么</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {GOALS.map((g) => (
            <Chip key={g.v} active={goal === g.v} onClick={() => setGoal(g.v)}>
              {g.zh}
            </Chip>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold">平时对什么感兴趣</h2>
        <p className="mt-1 text-xs dim">选几个，AI 会把练习放到你真在意的场景里，不然背着容易走神。</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {INTERESTS.map((i) => (
            <Chip key={i} active={interests.includes(i)} onClick={() => toggle(i)}>
              {i}
            </Chip>
          ))}
        </div>
      </Card>

      <Card className="space-y-5">
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="minutes" className="text-sm font-semibold">
              每天学多久
            </label>
            <span className="text-sm dim">{dailyMinutes} 分钟</span>
          </div>
          <input
            id="minutes"
            type="range"
            min={10}
            max={90}
            step={5}
            value={dailyMinutes}
            onChange={(e) => setDailyMinutes(Number(e.target.value))}
            className="mt-3 w-full accent-brand-600"
          />
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="nwpd" className="text-sm font-semibold">
              每天几个新词
            </label>
            <span className="text-sm dim">{newWordsPerDay} 个</span>
          </div>
          <input
            id="nwpd"
            type="range"
            min={3}
            max={20}
            value={newWordsPerDay}
            onChange={(e) => setNewWordsPerDay(Number(e.target.value))}
            className="mt-3 w-full accent-brand-600"
          />
          <p className="mt-2 text-xs dim">
            少而牢比多而忘划算。8 个左右，配上复习，一天正好 30 分钟。
          </p>
        </div>
      </Card>

      {error && <ErrorNote message={error} />}

      <Button size="lg" className="w-full" onClick={submit} loading={saving}>
        开始 <ArrowRight className="size-5" aria-hidden />
      </Button>
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
        'rounded-full border px-3.5 py-1.5 text-sm transition-colors',
        active
          ? 'border-brand-500 bg-brand-600 text-white'
          : 'border-[var(--border)] hover:bg-[var(--surface-2)]',
      )}
    >
      {children}
    </button>
  );
}

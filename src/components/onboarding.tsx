'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button, Card, ErrorNote, Input, PageHeader } from '@/components/ui';
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
  const [newWordsPerDay, setNewWordsPerDay] = useState(10);
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
    /*
       (bare) 布局只给一个 min-h-dvh 的 main，不限宽也不加左右留白——页面自己排。
       这里原来是个裸 div，宽屏上就铺满整个视口：水平选项被拉成一条条横贯屏幕的长条，
       右边大片空白，读起来要来回扫。收到 34rem 单列。

       为什么不是 --content-w(52rem)：那是正文页的宽度，给表格和两列内容用的。
       这一页全是短标签和滑块，行长超过 35em 之后每行的信息密度反而在掉。
       也不用登录页的 max-w-md(28rem)——兴趣那 12 个 chip 会挤成很多行。
    */
    <div className="mx-auto w-full max-w-[34rem] space-y-5 px-4 py-6 sm:px-6 fade-up">
      <PageHeader title="先认识一下">
        这几项决定 AI 每天给你出什么内容。后面在设置里随时能改。
      </PageHeader>

      <Card className="space-y-2">
        <label htmlFor="name" className="text-sm font-semibold text-[var(--text-title)]">
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
        <h2 className="text-sm">现在大概什么水平</h2>
        <div className="mt-3 space-y-2">
          {LEVELS.map((l) => (
            <button
              key={l.v}
              type="button"
              onClick={() => setLevel(l.v)}
              aria-pressed={level === l.v}
              className={cn(
                'w-full rounded-lg border p-3 text-left',
                'transition-colors duration-200 [transition-timing-function:var(--ease-standard)]',
                level === l.v
                  ? 'border-brand-500 bg-brand-50 dark:border-brand-700 dark:bg-brand-900/30'
                  : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)]',
              )}
            >
              <div className="flex items-center gap-2">
                {/* CEFR 等级号是标签而不是正文，压成小号等宽感的一小块 */}
                <span className="en rounded-[3px] bg-[var(--bg-sidebar)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--text-secondary)]">
                  {l.v}
                </span>
                <span className="text-sm font-semibold text-[var(--text-title)]">{l.zh}</span>
              </div>
              <p className="mt-0.5 text-xs dim">{l.hint}</p>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="text-sm">最想解决什么</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {GOALS.map((g) => (
            <Chip key={g.v} active={goal === g.v} onClick={() => setGoal(g.v)}>
              {g.zh}
            </Chip>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="text-sm">平时对什么感兴趣</h2>
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
            <label htmlFor="minutes" className="text-sm font-semibold text-[var(--text-title)]">
              每天学多久
            </label>
            <span className="serif text-[17px] font-bold tabular-nums text-[var(--text-title)]">
              {dailyMinutes} 分钟
            </span>
          </div>
          <input
            id="minutes"
            type="range"
            min={10}
            max={90}
            step={5}
            value={dailyMinutes}
            onChange={(e) => setDailyMinutes(Number(e.target.value))}
            className="mt-3 w-full accent-[var(--accent-bar)]"
          />
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="nwpd" className="text-sm font-semibold text-[var(--text-title)]">
              每天几个新词
            </label>
            <span className="serif text-[17px] font-bold tabular-nums text-[var(--text-title)]">
              {newWordsPerDay} 个
            </span>
          </div>
          <input
            id="nwpd"
            type="range"
            min={3}
            max={100}
            value={newWordsPerDay}
            onChange={(e) => setNewWordsPerDay(Number(e.target.value))}
            className="mt-3 w-full accent-[var(--accent-bar)]"
          />
          <p className="mt-2 text-xs dim">
            默认 10，最多 100。少而牢比多而忘划算 —— 10 个左右配上复习，一天正好 30 分钟。
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
        'rounded-md border px-3 py-1.5 text-[13px]',
        'transition-colors duration-200 [transition-timing-function:var(--ease-standard)]',
        active
          ? 'border-[var(--accent-bar)] bg-[var(--accent-bar)] font-semibold text-white'
          : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-title)]',
      )}
    >
      {children}
    </button>
  );
}

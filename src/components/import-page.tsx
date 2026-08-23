'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Badge, Button, Card, ErrorNote, Input, Textarea } from '@/components/ui';
import { Speak, TappableText } from '@/components/stages/shared';
import { apiGet, apiPost } from '@/lib/fetcher';
import type { ExtractData } from '@/lib/ai/schemas';
import { cn } from '@/lib/cn';

type Kind = 'article' | 'subtitle' | 'doc' | 'lyrics';

const KINDS: { v: Kind; zh: string }[] = [
  { v: 'article', zh: '文章' },
  { v: 'subtitle', zh: '美剧字幕' },
  { v: 'doc', zh: '技术文档' },
  { v: 'lyrics', zh: '歌词' },
];

/** 对应 /api/import 的返回，字段名是 camelCase 化过的 */
type Result = {
  materialId: number;
  title: string;
  summaryZh: string;
  words: (ExtractData['words'][number] & { id: number })[];
  grammarNotes: ExtractData['grammar_notes'];
  enrolled: boolean;
};

type Material = {
  id: number;
  title: string;
  kind: string;
  summary_zh: string;
  word_count: number;
  created_at: string;
};

const MIN = 20;

/** 导入你自己想看的东西。内置词表之外的第二个内容来源 —— 学自己感兴趣的材料才投入得进去。 */
export function ImportPage() {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<Kind>('article');
  const [raw, setRaw] = useState('');
  const [enroll, setEnroll] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [history, setHistory] = useState<Material[]>([]);

  const loadHistory = () => {
    apiGet<{ materials: Material[] }>('/api/import')
      .then((d) => setHistory(d.materials))
      .catch(() => void 0);
  };

  useEffect(loadHistory, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const d = await apiPost<Result>('/api/import', {
        title: title.trim() || '我的素材',
        kind,
        raw: raw.trim(),
        enroll,
      });
      setResult(d);
      setRaw('');
      setTitle('');
      loadHistory();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chars = raw.trim().length;

  return (
    <div className="space-y-4 py-2 fade-up">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">导入素材</h1>
        <p className="mt-1.5 text-sm dim">
          扔一段你真的想看懂的东西进来 —— 美剧台词、技术文档、歌词都行。AI 按你的水平挑词，词直接进复习队列。
        </p>
      </header>

      <Card className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <button
              key={k.v}
              type="button"
              onClick={() => setKind(k.v)}
              aria-pressed={kind === k.v}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition-colors',
                kind === k.v
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-100'
                  : 'border-[var(--border)] hover:bg-[var(--surface-2)]',
              )}
            >
              {k.zh}
            </button>
          ))}
        </div>

        <div>
          <label htmlFor="mtitle" className="text-sm font-medium">
            起个名字（可以留空）
          </label>
          <Input
            id="mtitle"
            value={title}
            maxLength={120}
            placeholder="比如：Friends S01E02"
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1.5"
          />
        </div>

        <div>
          <label htmlFor="mraw" className="text-sm font-medium">
            正文
          </label>
          <Textarea
            id="mraw"
            value={raw}
            rows={10}
            maxLength={40_000}
            placeholder="粘贴英文原文…"
            onChange={(e) => setRaw(e.target.value)}
            className="en mt-1.5"
          />
          <div className="mt-1 flex items-center justify-between text-xs dim">
            <span>{chars < MIN ? `还需要 ${MIN - chars} 个字符` : `${chars} 字符`}</span>
            <span>最多 40000 字符</span>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enroll}
            onChange={(e) => setEnroll(e.target.checked)}
            className="size-4 accent-[var(--brand-600)]"
          />
          抽出来的词直接加入学习队列
        </label>

        <Button onClick={submit} loading={busy} disabled={chars < MIN} size="lg" className="w-full">
          <Sparkles className="size-4" aria-hidden />
          {busy ? 'AI 正在读…' : '交给 AI 处理'}
        </Button>
        {busy && <p className="text-center text-xs dim">长一点的素材要十几秒，别关页面。</p>}
      </Card>

      {error && <ErrorNote message={error} onRetry={submit} />}

      {result && (
        <Card className="space-y-4 fade-up">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{result.title}</h2>
              {result.enrolled && <Badge tone="success">{result.words.length} 个词已入队</Badge>}
            </div>
            <p className="mt-1.5 text-sm leading-relaxed dim">{result.summaryZh}</p>
          </div>

          <div>
            <h3 className="text-sm font-semibold">挑出来的词</h3>
            <ul className="mt-2 space-y-2">
              {result.words.map((w) => (
                <li key={w.id} className="rounded-lg bg-[var(--surface-2)] p-3">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="en text-base font-semibold">{w.term}</span>
                    {w.phonetic && <span className="en text-xs dim">{w.phonetic}</span>}
                    {w.pos && <Badge>{w.pos}</Badge>}
                    <Speak text={w.term} className="ml-auto" />
                  </div>
                  <p className="mt-1 text-sm">{w.meaning_zh}</p>
                  {w.example_en && (
                    <div className="mt-1.5">
                      <TappableText text={w.example_en} className="text-sm" />
                      {w.example_zh && <p className="text-xs dim">{w.example_zh}</p>}
                    </div>
                  )}
                  {w.memory_hook_zh && (
                    <p className="mt-1.5 text-xs text-warm-600 dark:text-warm-300">💡 {w.memory_hook_zh}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {result.grammarNotes.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">值得记的句式</h3>
              <ul className="mt-2 space-y-2">
                {result.grammarNotes.map((g, i) => (
                  <li key={i} className="rounded-lg border border-[var(--border)] p-3">
                    <p className="text-sm font-medium">{g.title_zh}</p>
                    <p className="mt-1 text-sm dim">{g.explain_zh}</p>
                    <div className="mt-1.5 flex items-start gap-1.5">
                      <TappableText text={g.example_en} className="flex-1 en text-sm" />
                      <Speak text={g.example_en} className="p-0.5" />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs dim">这些词从明天起会出现在热身复习里，而且每次都换新句子。</p>
        </Card>
      )}

      {history.length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold">导入过的</h2>
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {history.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.title}</p>
                  <p className="truncate text-xs dim">{m.summary_zh}</p>
                </div>
                <span className="shrink-0 text-xs dim">{m.created_at.slice(5, 10)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

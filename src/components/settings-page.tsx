'use client';

import { useEffect, useRef, useState } from 'react';
import { AudioLines, Cpu, Gauge, Loader2, LogOut, Play, Volume2 } from 'lucide-react';
import { Button, Card, ErrorNote, Input, PageHeader, Spinner, Toast } from '@/components/ui';
import { apiGet, apiPatch, apiPost } from '@/lib/fetcher';
import { withBase } from '@/lib/base-path';
import { previewServerVoice, serverVoicesAvailable, useTts, voiceTier } from '@/hooks/useSpeech';
import type { SpeechPace, UserProfile } from '@/lib/types';
import { AI_VOICES, AI_VOICE_GROUPS, DEFAULT_AI_VOICE, PACES, PACE_KEYS, pace } from '@/lib/voice-options';
import { SERVER_VOICE_GROUPS } from '@/lib/tts/server-voice-list';
import { writePace } from '@/lib/pace-store';
import { writeVoice } from '@/lib/voice-store';
import { cn } from '@/lib/cn';

/** 试听用的句子。短、含常见音、能听出语速差别。 */
const PREVIEW_TEXT = 'Hi! Nice to meet you. What do you usually do on weekends?';

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
  /**
   * 鉴权状态。两张卡都要用它，所以放在这一层只请求一次：
   * 账号卡靠它说清「登录的是谁」，模型卡靠 admin 决定要不要渲染。
   */
  const [session, setSession] = useState<AuthSession | null>(null);
  /** 正在试听的 AI 音色 id，同时充当节流锁 */
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  /** 正在写库的 AI 音色 id，同时当节流锁 */
  const [savingVoice, setSavingVoice] = useState<string | null>(null);
  /**
   * 逐句朗读那张卡的试听状态。和上面 AI 音色的 previewing 分开：
   * 两张卡的 id 空间不同（mimo 的 Mia vs 上游的 zhixingjiejie），
   * 共用一个锁会出现「点了这边、那边转圈」。
   */
  const [ttsPreviewing, setTtsPreviewing] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);
  /**
   * 服务端音色可不可用。先当不可用，探到了再画那半张卡 ——
   * 反过来会让没配 MIMO_TTS_KEY 的部署闪一下一排点了没反应的音色。
   */
  const [serverTts, setServerTts] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsPreviewAbort = useRef<AbortController | null>(null);
  useEffect(() => () => ttsPreviewAbort.current?.abort(), []);
  const { speak, voices, supported } = useTts(user?.voice ?? undefined);

  const load = () => {
    setError(null);
    apiGet<{ user: UserProfile }>('/api/profile')
      .then((d) => {
        setUser(d.user);
        // 数据库是真值，进页面就把本地缓存对齐一次（换设备后第一次打开会用到）
        writePace(d.user.speech_pace);
        writeVoice(d.user.voice);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(load, []);

  useEffect(() => {
    apiGet<AuthSession>('/api/auth/session')
      .then(setSession)
      /*
       * 问不到就按「已登录、非管理员」处理：这两张卡都是附加信息，
       * 不该因为它把设置页搞崩。admin 取假是因为模型卡真正的门在服务端
       * （/api/models 的 requireAdmin），这里画出来也只会点一下拿个 403。
       */
      .catch(() => setSession({ authEnabled: false, signedIn: true, admin: false, user: null }));
  }, []);

  useEffect(() => {
    void serverVoicesAvailable().then(setServerTts);
  }, []);

  const patch = (p: Partial<UserProfile>) => {
    // 语速和音色都要立刻生效：朗读按钮散在各页，读的是 localStorage 缓存而不是
    // 这里的 state。不等"保存"再写，否则用户点完马上试听，听到的还是旧设置。
    if (p.speech_pace) writePace(p.speech_pace);
    // 音色比语速多一层：null 是"跟随系统默认"，是个有效选择，不能被真值判断吃掉
    if (p.voice !== undefined) writeVoice(p.voice);
    setUser((u) => (u ? { ...u, ...p } : u));
  };

  /**
   * 选 AI 音色 —— 点一下立刻写库，不跟底下那个「保存」。
   *
   * 这里必须即时落库，原因和别的设置不一样：这个值只在服务端有用。
   * 通话开始前是 voice-chat-launcher 去 /api/profile 读 ai_voice 再发给中转层的，
   * 攒在组件 state 里对通话没有任何影响。而旁边的试听按钮是把 voiceId 直接
   * 发给 TTS 接口、根本不读库 —— 于是点完卡片亮起来、试听也是新音色，
   * 看着完全像已经生效，人就不会再去按保存，进了通话还是默认音色。
   * 这就是「换了女声但通话没变」的原因，不是音色本身没传下去。
   */
  const pickAiVoice = async (voiceId: string) => {
    if (savingVoice || !user) return;
    const prev = user.ai_voice;
    if (prev === voiceId) return;
    setSavingVoice(voiceId);
    setError(null);
    // 先乐观改：选中态要立刻跟手，不能等一个往返
    setUser((u) => (u ? { ...u, ai_voice: voiceId } : u));
    try {
      const d = await apiPatch<{ user: UserProfile }>('/api/profile', { aiVoice: voiceId });
      setUser(d.user);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      // 存不上就把选中态退回去，否则界面在骗人
      setUser((u) => (u ? { ...u, ai_voice: prev } : u));
      setError((e as Error).message);
    } finally {
      setSavingVoice(null);
    }
  };

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
        aiVoice: user.ai_voice,
        speechPace: user.speech_pace,
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
  const paceSpec = pace(user.speech_pace);
  /**
   * 系统语音包只列 12 个（4×3 格）。enVoices 已按 rankEnglishVoices 排好
   * （音质档位优先，见 useSpeech），排后面的多半是精简版/机器音。
   * 用户存过的选择若不在前 12，单独补进来 —— 已选的音色不能在列表里消失。
   */
  const shownEnVoices = (() => {
    const top = enVoices.slice(0, 12);
    if (user.voice && !top.some((v) => v.name === user.voice)) {
      const picked = enVoices.find((v) => v.name === user.voice);
      if (picked) return [...top.slice(0, 11), picked];
    }
    return top;
  })();
  const hiddenCount = Math.max(0, enVoices.length - shownEnVoices.length);
  /**
   * 设备上一个体面的英文语音包都没有（全是精简版 / 机器音）。
   * iOS 默认就是这个状态，所以要在下面把「去哪儿下载」写清楚。
   * 阈值取 4：voiceTier 里 4 及以上是 Siri / 高音质 / 超高音质。
   */
  const lowTierOnly = enVoices.length > 0 && enVoices.every((v) => voiceTier(v).tier < 4);

  /** 试听本站音色（MiMo）。不设超时兜底，所以要自己转圈，见 previewServerVoice。 */
  const previewTts = async (voiceId: string) => {
    if (ttsPreviewing) return;
    setTtsPreviewing(voiceId);
    setTtsError(null);
    audioRef.current?.pause();
    try {
      ttsPreviewAbort.current?.abort();
      ttsPreviewAbort.current = new AbortController();
      await previewServerVoice(PREVIEW_TEXT, voiceId, user.speech_pace, ttsPreviewAbort.current.signal);
    } catch (e) {
      setTtsError((e as Error).message);
    } finally {
      setTtsPreviewing(null);
    }
  };

  /**
   * 试听 AI 音色。走服务端的 TTS 代理而不是 realtime —— realtime 连续快速建连
   * 会被上游限流，用户连点几个音色就会连锁失败。同时这里用 previewing 做单飞锁，
   * 上一段还没播完就不发新请求。
   */
  const previewAiVoice = async (voiceId: string) => {
    if (previewing) return;
    setPreviewing(voiceId);
    setPreviewError(null);
    audioRef.current?.pause();
    try {
      // 这里要拿 blob 不走 fetcher 的 JSON 解包，所以得自己补部署前缀
      const res = await fetch(withBase('/api/voice/preview'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ voice: voiceId, paceKey: user.speech_pace, text: PREVIEW_TEXT }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? `试听失败（${res.status}）`);
      }
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audioRef.current = audio;
      // 播完再解锁，顺手回收 blob url
      const done = () => {
        URL.revokeObjectURL(url);
        setPreviewing((c) => (c === voiceId ? null : c));
      };
      audio.onended = done;
      audio.onerror = done;
      await audio.play();
    } catch (e) {
      setPreviewError((e as Error).message);
      setPreviewing(null);
    }
  };

  return (
    // 单列设置项，自己收窄 —— 一行拉太长，标签和右边的选项会离得太远
    <div className="mx-auto max-w-[var(--content-w)] space-y-4 py-2 fade-up">
      <PageHeader eyebrow="Settings" title="设置">
        这些直接决定 AI 明天给你出什么内容。
      </PageHeader>

      {error && <ErrorNote message={error} />}

      <Card className="space-y-4">
        <div>
          <label htmlFor="name" className="text-sm font-medium text-[var(--text-title)]">
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
              <span className="en font-semibold">{l.v}</span>
              <span className="ml-1.5 text-xs opacity-75">{l.zh}</span>
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
          max={100}
          step={1}
          onChange={(v) => patch({ new_words_per_day: v })}
          hint="默认 10，最多 100。加得越多，几天后的复习量越大。看数据页的未来 14 天再决定。"
        />
      </Card>

      <Card>
        <div className="flex items-center gap-1.5">
          <Volume2 className="size-4 dim" aria-hidden />
          <h2 className="text-sm">逐句朗读的声音</h2>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed dim">
          点单词、例句旁边的喇叭时用的声音，和打电话那套是两回事。
          {serverTts && '下面这些是云端在线音色（MiMo），点朗读即点即响，慢速照常可用。'}
          {'「系统语音包」用你设备自带的，离线可用。'}
        </p>

        {serverTts && (
          <div className="mt-3 space-y-3">
            {ttsError && <p className="text-xs text-[var(--danger)]">{ttsError}</p>}
            {SERVER_VOICE_GROUPS.map((g) => {
              // 2026-09-09 起只有 MiMo 一组，全存 users.voice（点朗读时出声的音色）。
              // 没选过时高亮默认 Mia。老值 'kokoro:xx' 不算选中，落回默认。
              const pref = user.voice ?? 'mimo:Mia';
              const active = (id: string) => pref === `mimo:${id}`;
              const onPick = (id: string) => patch({ voice: `mimo:${id}` });
              return (
                <div key={g.key}>
                  <p className="mb-1.5 text-[11px] dim">
                    {g.zh}（点朗读用这个）
                  </p>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {g.voices.map((v) => (
                      <VoiceCell
                        key={v.id}
                        name={v.zh}
                        note={v.hint}
                        active={active(v.id)}
                        loading={ttsPreviewing === v.id}
                        disabled={Boolean(ttsPreviewing)}
                        onPick={() => onPick(v.id)}
                        onPlay={() => void previewTts(v.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-3 text-[11px] font-medium uppercase tracking-wide dim">系统语音包</p>
        {!supported ? (
          <p className="mt-1.5 text-sm dim">这个浏览器不支持语音合成。Chrome、Edge、Safari 都可以。</p>
        ) : enVoices.length === 0 ? (
          <p className="mt-1.5 text-sm dim">没找到英文语音包，可能还在加载，刷新一下试试。</p>
        ) : (
          <>
            {/*
              只展示排前 12 的包（4×3 格）。系统里十几个英文包是常态，全摆出来
              用户根本扫不动；rankEnglishVoices 的排序已经是「最好的在前」，
              12 名开外的多半是精简版/机器音，藏着它们反而是帮忙。
              用户存过的选择不在前 12 时仍然补进来 —— 不能让已选的音色消失。
            */}
            <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <VoiceCell
                name={null}
                active={!user.voice}
                onPick={() => patch({ voice: null })}
                onPlay={() => speak(PREVIEW_TEXT, { rate: paceSpec.webSpeechRate })}
              />
              {shownEnVoices.map((v) => (
                <VoiceCell
                  // 不能用 name 当 key：iOS 上精简版和高音质版同名（都叫 Samantha），
                  // voiceURI 才是唯一的。
                  key={v.voiceURI || v.name}
                  name={v.name}
                  note={voiceTier(v).zh}
                  active={user.voice === v.name}
                  onPick={() => patch({ voice: v.name })}
                  onPlay={() => speak(PREVIEW_TEXT, { voice: v, rate: paceSpec.webSpeechRate })}
                />
              ))}
            </div>
            {hiddenCount > 0 && (
              <p className="mt-1.5 text-[11px] dim">还有 {hiddenCount} 个系统语音没列出，上面 12 个是音质最好的。</p>
            )}
            {lowTierOnly && (
              <p className="mt-2.5 text-xs leading-relaxed dim">
                你设备上自带的都是精简版语音，听着发闷。iPhone 可以去
                「设置 → 辅助功能 → 朗读内容 → 声音 → 英语」下载 Enhanced 或 Premium 版本，
                下完回来这里就能选到。
                {serverTts && '不想装的话，用上面的本站音色。'}
              </p>
            )}
          </>
        )}
      </Card>

      <Card>
        <div className="flex items-center gap-1.5">
          <Gauge className="size-4 dim" aria-hidden />
          <h2 className="text-sm">说话速度</h2>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {PACE_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => patch({ speech_pace: k as SpeechPace })}
              aria-pressed={user.speech_pace === k}
              className={cn(
                'touch-manipulation rounded-lg border px-3 py-2.5 text-center',
                'transition-colors duration-200 [transition-timing-function:var(--ease-standard)] active:translate-y-px',
                user.speech_pace === k
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                  : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)]',
              )}
            >
              <span className="block text-sm font-semibold">{PACES[k].zh}</span>
              <span className="block text-[11px] opacity-75">{PACES[k].hint}</span>
            </button>
          ))}
        </div>
        <p className="mt-2.5 text-xs leading-relaxed dim">
          逐句朗读是精确按这个速度念的。通话里只能做到近似 —— 语音模型没有语速参数，
          我们一边要求它慢点说、一边微调播放倍速，所以每次快慢会略有出入。
        </p>
      </Card>

      <Card>
        <div className="flex items-center gap-1.5">
          <AudioLines className="size-4 dim" aria-hidden />
          <h2 className="text-sm">通话时 AI 的声音</h2>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed dim">
          这些是中文音色在说英文，口音都会偏中式，这是上游的能力边界。
          排在前面的语速偏快、听着更利落；越往后越拖。原来的默认「经典女声」是最拖的那个，
          所以现在默认换成了第一个。点右边的播放键能先试听再定。
        </p>
        {previewError && <p className="mt-2 text-xs text-[var(--danger)]">{previewError}</p>}
        <div className="mt-3 space-y-3">
          {AI_VOICE_GROUPS.map((g) => (
            <div key={g.key}>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide dim">{g.zh}</p>
              {/* 2026-08-28：一音色一行改格子（和上面本站音色同一套 VoiceCell），扫起来快 */}
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {AI_VOICES.filter((v) => v.group === g.key).map((v) => {
                  const current = (user.ai_voice ?? DEFAULT_AI_VOICE) === v.id;
                  return (
                    <VoiceCell
                      key={v.id}
                      name={v.zh}
                      note={v.hint}
                      active={current}
                      loading={previewing === v.id}
                      disabled={Boolean(savingVoice) || Boolean(previewing)}
                      onPick={() => void pickAiVoice(v.id)}
                      onPlay={() => void previewAiVoice(v.id)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-xs dim">
          试听按当前语速档位（{paceSpec.zh}）合成，每次只播一条。
          选了就存了，不用按底下的保存；下一通电话生效，正在通话中的那一通不会中途换声。
        </p>
      </Card>

      {/*
        模型卡只给管理员。改的是全站设置，普通用户看见了也点不动 ——
        而且清单里带服务商和地址，没必要让每个人都知道这台机器接了谁。
        session 还没回来时先不渲染，免得闪一下再消失。
      */}
      {session?.admin && <ModelsCard />}

      <AccountCard session={session} />

      <CreditsCard />

      {/*
        悬浮的保存条。托盘本身带纸面底 + 描边 + 抬起投影，按钮就不用自己扛
        shadow-lg —— 这套体系里"浮起来"是容器的属性，不是控件的属性。

        位置必须是这一列的**最后一个**。sticky 只在自己往后的那段流里生效：
        原先它排在模型卡前面，往下滚过它的原始位置就脱开了，停在页面中间 ——
        看着像个悬空的按钮。放到末尾，整页滚动全程它都贴在底边。
      */}
      <div className="sticky bottom-4 z-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-[var(--shadow-lifted)]">
        <Button onClick={save} loading={saving} size="lg" className="w-full">
          保存
        </Button>
      </div>

      {/*
        「已保存」以前是保存按钮的 flex 兄弟，一出现就把按钮挤窄、两秒后又弹回来，
        一次保存要看两次跳动。改成浮在保存条上方的小提示，不参与布局。
      */}
      <Toast message="已保存" show={saved} />
    </div>
  );
}

type ModelChoice = {
  id: string;
  label: string;
  provider: string;
  model: string;
  baseURL?: string;
  ready: boolean;
  error?: string;
};

type RoleSetting = {
  role: 'content' | 'chat' | 'fast';
  zh: string;
  hint: string;
  selected: string | null;
  fromEnv: string | null;
  effective: { id: string | null; label: string; provider: string; model: string } | null;
  error: string | null;
};

type ModelsResponse = {
  catalog: ModelChoice[];
  roles: RoleSetting[];
  voice: {
    provider: string;
    realtimeModel: string;
    ttsModel: string;
    asrModel: string;
    ready: boolean;
  };
};

/**
 * 模型卡。
 *
 * 三个角色的分工是固定的（出题 / 对话 / 纠错），能改的是每个角色用清单里的哪个模型。
 * 清单来自 .env.local 的 AI_MODELS —— 地址和密钥只在服务端，这里挑不到清单外的东西。
 *
 * 改完立刻写库（不跟上面那个「保存」）：这是全站设置，和个人档案不是一批东西，
 * 混进同一个保存按钮会让人以为它也只影响自己。
 */
function ModelsCard() {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 正在改的角色，同时当节流锁 */
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    setError(null);
    apiGet<ModelsResponse>('/api/models').then(setData).catch((e) => setError(e.message));
  };

  useEffect(load, []);

  const pickModel = async (role: string, modelId: string | null) => {
    if (busy) return;
    setBusy(role);
    setError(null);
    try {
      setData(await apiPatch<ModelsResponse>('/api/models', { role, modelId }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (error && !data) return <Card><ErrorNote message={error} onRetry={load} /></Card>;
  if (!data) return null;

  return (
    <Card>
      <div className="flex items-center gap-1.5">
        <Cpu className="size-4 dim" aria-hidden />
        <h2 className="text-sm">用哪个模型</h2>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed dim">
        三件事对模型的要求不一样，所以分开配。改这里<strong className="font-semibold text-[var(--text-title)]">对所有账号生效</strong>，
        不是个人设置 —— 它跟着的是服务器上配的那份密钥。点一下就存了，不用按底下的保存。
      </p>

      {error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}

      {data.catalog.length === 0 ? (
        <p className="mt-3 text-sm leading-relaxed dim">
          还没列可选模型。在 <code className="en">.env.local</code> 里写一行{' '}
          <code className="en">AI_MODELS=claude-opus-5,gpt-5.6-sol</code>，
          再给每个模型配上地址和 key，重启后就能在这里换。
          现在每个角色用的是配置文件里各自写死的那个：
        </p>
      ) : null}

      <div className="mt-3 space-y-3">
        {data.roles.map((r) => (
          <RoleRow
            key={r.role}
            role={r}
            catalog={data.catalog}
            busy={busy === r.role}
            disabled={Boolean(busy)}
            onPick={(id) => void pickModel(r.role, id)}
          />
        ))}
      </div>

      <div className="mt-4 border-t border-[var(--hairline)] pt-3">
        <p className="text-xs font-medium text-[var(--text-title)]">语音（通话和试听）</p>
        <p className="mt-1 text-xs leading-relaxed dim">
          {data.voice.ready ? (
            <>
              走 <span className="en">{data.voice.provider}</span>，实时对话{' '}
              <span className="en">{data.voice.realtimeModel}</span>、合成{' '}
              <span className="en">{data.voice.ttsModel}</span>、转写{' '}
              <span className="en">{data.voice.asrModel}</span>。
            </>
          ) : (
            <>还没配语音密钥（<code className="en">VOICE_API_KEY</code>），通话和音色试听用不了。</>
          )}
        </p>
        <p className="mt-1 text-xs leading-relaxed dim">
          语音这条线只跟 <code className="en">.env.local</code>（<code className="en">VOICE_*</code>）：
          一次通话中途换模型没有意义，所以不放在这里改。
        </p>
      </div>
    </Card>
  );
}

/** 一个角色一行：说明 + 可选模型。 */
function RoleRow({
  role,
  catalog,
  busy,
  disabled,
  onPick,
}: {
  role: RoleSetting;
  catalog: ModelChoice[];
  busy: boolean;
  disabled: boolean;
  onPick: (modelId: string | null) => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--hairline)] bg-[var(--bg-sidebar)] px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-[var(--text-title)]">
          {role.zh}
          {busy && <Loader2 className="ml-1.5 inline size-3.5 animate-spin" aria-hidden />}
        </p>
        <span className="en shrink-0 text-[11px] dim">{role.role}</span>
      </div>
      <p className="mt-0.5 text-[11px] leading-relaxed dim">{role.hint}</p>

      {role.error ? (
        <p className="mt-1.5 text-[11px] text-[var(--danger)]">{role.error}</p>
      ) : role.effective ? (
        <p className="mt-1.5 text-[11px] dim">
          当前：<span className="en">{role.effective.provider}/{role.effective.model}</span>
          {!role.effective.id && '（按配置文件）'}
        </p>
      ) : null}

      {catalog.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {/*
            「跟配置文件」这一项要一直在：清单配了之后仍然可能想回到
            .env.local 里那套角色变量，没有这个选项就只能去改库。
          */}
          <ModelChip
            active={role.selected === null}
            disabled={disabled}
            onClick={() => onPick(null)}
            title={role.fromEnv ? `配置文件指定 ${role.fromEnv}` : '按 .env.local 里的角色变量'}
          >
            跟配置文件
          </ModelChip>
          {catalog.map((m) => (
            <ModelChip
              key={m.id}
              active={role.selected === m.id}
              disabled={disabled || !m.ready}
              onClick={() => onPick(m.id)}
              title={
                m.error
                  ? m.error
                  : m.ready
                    ? `${m.provider}/${m.model}${m.baseURL ? ` @ ${m.baseURL}` : ''}`
                    : '这个模型还没配密钥'
              }
            >
              {m.label}
              {!m.ready && <span className="ml-1 text-[10px]">缺 key</span>}
            </ModelChip>
          ))}
        </div>
      )}
    </div>
  );
}

function ModelChip({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={title}
      className={cn(
        'en rounded-md border px-2.5 py-1 text-[12px]',
        'transition-colors duration-200 [transition-timing-function:var(--ease-standard)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700 dark:border-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
          : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-title)]',
      )}
    >
      {children}
    </button>
  );
}

/**
 * 账号卡。
 *
 * 开了鉴权就显示「当前登录的是谁 + 退出」，没开就照旧说明这是单人模式 ——
 * 同一份代码要能跑在「本机自己用」和「挂公网多人用」两种形态下，
 * 所以这里按 /api/auth/session 的回答决定说什么，不写死。
 *
 * session 从外面传进来：模型卡也要看同一份答案（admin），
 * 两张卡各请求一次就多了一趟。
 */
function AccountCard({ session: state }: { session: AuthSession | null }) {
  const [leaving, setLeaving] = useState(false);

  const signOut = async () => {
    setLeaving(true);
    try {
      await apiPost('/api/auth/logout');
    } catch {
      // 退出失败也照样回登录页：本地 cookie 已经没用了，留在站内只会一直 401
    }
    location.assign(withBase('/login'));
  };

  if (!state) return null;

  if (!state.authEnabled) {
    return (
      <Card>
        <h2 className="text-sm">关于数据</h2>
        <p className="mt-2 text-sm leading-relaxed dim">
          所有学习记录都存在你自己配置的 PostgreSQL 库里（连接信息在 <code className="en">.env.local</code>），
          当前是单人模式，不需要登录。换电脑只要连同一个库就能接着学。
        </p>
        <p className="mt-2 text-sm leading-relaxed dim">
          要放到公网给多个人用，在 <code className="en">.env.local</code> 里配上{' '}
          <code className="en">AUTH_UPSTREAM_URL</code>，账号就交给它管。
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-sm">账号</h2>
      <p className="mt-2 text-sm leading-relaxed dim">
        {state.user
          ? <>当前登录：<span className="font-semibold text-[var(--text-title)]">{state.user.displayName || state.user.username}</span>。学习记录跟着这个账号走。</>
          : '当前未登录。'}
      </p>
      <p className="mt-2 text-sm leading-relaxed dim">
        密码和两步验证都在登录服务那边改，这里不重复管一套。
      </p>
      <Button variant="outline" size="sm" className="mt-3" onClick={signOut} loading={leaving}>
        <LogOut className="size-4" aria-hidden />
        退出登录
      </Button>
    </Card>
  );
}

type AuthSession = {
  authEnabled: boolean;
  signedIn: boolean;
  /** 能不能改全站的模型设置。鉴权没开时（单人模式）恒为真 */
  admin: boolean;
  user: { username: string; displayName: string } | null;
};

/**
 * 词表来源署名。
 *
 * 这张卡不是装饰，是授权义务：CEFR-J 的条款允许商用但要求原样保留那句引用，
 * Octanove 走 CC BY-SA 4.0 也要署名。改文案时别把这两条删了。
 * ECDICT 是 MIT，严格说不必列在界面上，但既然写了来源就一起写全。
 */
function CreditsCard() {
  return (
    <Card>
      <h2 className="text-sm">词表来源</h2>
      <p className="mt-2 text-sm leading-relaxed dim">
        中文释义、音标和词频来自{' '}
        <a
          href="https://github.com/skywind3000/ECDICT"
          target="_blank"
          rel="noopener noreferrer"
          className="en font-semibold text-brand-600 hover:underline"
        >
          ECDICT
        </a>
        （MIT）。CEFR 等级来自下面两份人工标注的词表。
      </p>
      <p className="mt-2 text-sm leading-relaxed dim en">
        The CEFR-J Wordlist Version 1.5. Compiled by Yukio Tono, Tokyo University of
        Foreign Studies.
      </p>
      <p className="mt-2 text-sm leading-relaxed dim">
        C1/C2 部分来自 Octanove Vocabulary Profile C1/C2 v1.0（Octanove Labs），
        授权{' '}
        <a
          href="https://creativecommons.org/licenses/by-sa/4.0/"
          target="_blank"
          rel="noopener noreferrer"
          className="en font-semibold text-brand-600 hover:underline"
        >
          CC BY-SA 4.0
        </a>
        。
      </p>
    </Card>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-medium text-[var(--text-title)]">{label}</p>
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
        'rounded-md border px-3 py-1.5 text-[13px]',
        'transition-colors duration-200 [transition-timing-function:var(--ease-standard)]',
        active
          ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700 dark:border-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
          : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-title)]',
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
        <label htmlFor={id} className="text-sm font-medium text-[var(--text-title)]">
          {label}
        </label>
        <span className="serif text-[17px] font-bold tabular-nums text-[var(--text-title)]">
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
        className="mt-2.5 w-full accent-[var(--accent-bar)]"
      />
      {hint && <p className="mt-1.5 text-xs leading-relaxed dim">{hint}</p>}
    </div>
  );
}

/**
 * 格子版音色卡。设置页「本站音色」和「系统语音包」都用它 —— 每行 4 个
 * （手机 2 个），比一长条列表扫起来快得多。点卡片选中，右下角小播放键试听。
 */
function VoiceCell({
  name,
  note,
  active,
  loading,
  disabled,
  onPick,
  onPlay,
}: {
  name: string | null;
  note?: string;
  active: boolean;
  loading?: boolean;
  disabled?: boolean;
  onPick: () => void;
  onPlay: () => void;
}) {
  return (
    <div
      className={cn(
        'flex min-h-[64px] flex-col justify-between gap-1 rounded-lg border p-2',
        'transition-colors duration-200 [transition-timing-function:var(--ease-standard)]',
        active
          ? 'border-brand-500 bg-brand-50 dark:border-brand-700 dark:bg-brand-900/30'
          : 'border-[var(--hairline)] bg-[var(--bg-sidebar)]',
      )}
    >
      <button
        type="button"
        onClick={onPick}
        aria-pressed={active}
        className="min-w-0 flex-1 text-left"
      >
        <span className="flex items-center gap-1 text-sm font-medium text-[var(--text-title)]">
          <span className="truncate">{name ?? '自动'}</span>
          {active && <span className="shrink-0 text-[10px] dim">当前</span>}
        </span>
        {note && (
          <span className="mt-0.5 line-clamp-2 block text-[11px] leading-tight dim">
            {name ? note : '按系统里最好的英文语音挑一个'}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onPlay}
        disabled={disabled}
        aria-label={name ? `试听${name}` : '试听'}
        className="flex items-center justify-end text-[var(--text-secondary)] hover:text-[var(--text-title)] disabled:opacity-40"
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Play className="size-3.5" aria-hidden />
        )}
      </button>
    </div>
  );
}

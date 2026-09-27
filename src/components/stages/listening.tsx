'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Loader2, Pause, Play, Rabbit, Turtle } from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import {
  CenterColumn,
  Choices,
  ColumnLabel,
  Explain,
  MaterialButton,
  MaterialSheet,
  MobileActionBar,
  MOBILE_ACTION_BAR_PAD,
  SpeechTip,
  TappableText,
  useMaterialSheet,
} from './shared';
import { buildServerVoiceCast, buildVoiceCast, useTts, warmServerSpeech } from '@/hooks/useSpeech';
import { readPace } from '@/lib/pace-store';
import { readVoice } from '@/lib/voice-store';
import type { StageProps, ReviewBody } from './types';
import type { ListeningData } from '@/lib/ai/schemas';
import { cn } from '@/lib/cn';

/**
 * 说话人名字的配色。站里只有两个强调色（brand 绿、warm 琥珀），
 * 第三个人往后退回次要文字色 —— 对话一般两三个人，够分。
 */
const SPEAKER_COLORS = [
  'text-brand-600 dark:text-brand-400',
  'text-warm-600 dark:text-warm-400',
  'text-[var(--text-secondary)]',
];

/**
 * 听力。默认藏文本 —— 先靠耳朵。全篇连播会依次朗读每一行，
 * 单行也能反复听、能放慢。答完题才允许对照原文。
 */
export function ListeningStage({ payload, onDone, submitting }: StageProps<ListeningData>) {
  const { speak, stop, speaking, synthesizing, speechError, supported, voices } = useTts();
  const [showText, setShowText] = useState(false);
  const [playingAll, setPlayingAll] = useState(false);
  const [line, setLine] = useState<number | null>(null);
  const [slow, setSlow] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const sheet = useMaterialSheet();
  const cancelRef = useRef(false);
  const collected = useMemo(() => ({ mistakes: [] } as Required<Pick<ReviewBody, 'mistakes'>>), []);

  const dialogue = payload.dialogue ?? [];
  const questions = payload.questions ?? [];
  const allAnswered = questions.length > 0 && questions.every((_, i) => answers[i] !== undefined);

  // 播放失败或被另一个朗读按钮接管后，同步复位连播按钮；重试只需点一次。
  useEffect(() => {
    if (speaking) return;
    cancelRef.current = true;
    setPlayingAll(false);
    setLine(null);
  }, [speaking, playingAll, line]);

  /*
    一人一个嗓音。两条路：
    - 服务端音色（优先）：buildServerVoiceCast 从 MiMo 的真嗓音里按性别分派，
      speak() 收到 serverVoiceId 就走服务端合成，不用等 voiceschanged。
    - 浏览器语音包（兜底）：服务端没配/连续失败时自动退到这条，cast 照旧备着。
    readVoice() 在服务端返回 null，但这里不影响首帧。
  */
  /*
    内容指纹。原来的依赖是"说话人名字拼起来"，模型重出材料时名字可能不变、
    台词却换了 —— 那样预热会命中错的缓存键，等于没热。带上台词本身才稳。
  */
  const dialogueKey = dialogue.map((d) => `${d.speaker}\u0000${d.text_en}`).join('|');
  const serverCast = useMemo(
    () => buildServerVoiceCast(dialogue, readVoice()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dialogueKey],
  );
  const cast = useMemo(
    () => buildVoiceCast(dialogue, voices, readVoice()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dialogueKey, voices],
  );

  /*
    进环节就把整段对话的台词送去服务端预热（限流并发 2，写盘缓存）。
    不等用户点「播放」—— 材料弹窗弹出的这几秒正好够后台把 4-8 句全部
    合成完；真播的时候每句都命中磁盘缓存（几十毫秒），一句接一句不卡顿。
    预热静默失败无所谓：播放链路自带的兜底会接住没热起来的那句。
  */
  useEffect(() => {
    if (!dialogue.length) return;
    warmServerSpeech(
      dialogue.map((d) => ({ text: d.text_en, voice: serverCast.get(d.speaker) })),
      readPace(),
    );
    // pace 变化不重热 —— 播放时若档位不同会自然 miss，走现有超时+兜底。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogueKey, serverCast]);

  /*
    说话人 → 颜色。名字换了嗓音也换，但光靠听不容易马上对上是谁，
    给名字上个色，眼睛和耳朵能对起来。按出场顺序发色，不按名字哈希 ——
    两人对话永远是"第一个绿、第二个橙"，跨题目也一致。
  */
  const speakerColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of dialogue) {
      const k = d.speaker.trim().toLowerCase();
      if (k && !m.has(k)) m.set(k, SPEAKER_COLORS[m.size % SPEAKER_COLORS.length]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return (s: string) => m.get(s.trim().toLowerCase()) ?? 'text-[var(--text-secondary)]';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogueKey]);

  /**
   * 从第 i 句开始连播。
   * 抽成独立函数是为了「重试」能接着出错那句往下读，而不是从头再听一遍 ——
   * 一句合成失败时把整段打回起点，用户会丢掉已经听完的部分。
   */
  const playFrom = (i: number) => {
    cancelRef.current = false;
    setPlayingAll(true);
    const step = (n: number) => {
      if (cancelRef.current || n >= dialogue.length) {
        setPlayingAll(false);
        setLine(null);
        return;
      }
      setLine(n);
      // 服务端音色优先（真嗓音、不用等 voices 包加载）；speak() 内部在服务端
      // 不可用/超时时会自动退回浏览器语音包那条路（cast 里备着的）。
      // 不写死 rate：交给 useTts 按用户的语速档位算，slow 只表示「再慢一档」
      speak(dialogue[n].text_en, {
        slow,
        serverVoiceId: serverCast.get(dialogue[n].speaker),
        ...cast.get(dialogue[n].speaker),
        // 听力全篇连播只用在线音色（2026-08-28 用户要求）：这一环就是练耳朵，
        // 混进系统语音包等于把训练材料换掉了。某句没预生成就现场合成、
        // 弹「语音生成中…」，播完照常接力下一句。
        onlineOnly: true,
        onEnd: () => step(n + 1),
      });
    };
    step(i);
  };

  const playAll = () => {
    if (playingAll) {
      cancelRef.current = true;
      stop();
      setPlayingAll(false);
      setLine(null);
      return;
    }
    playFrom(0);
  };

  const pick = (qi: number, opt: string) => {
    setAnswers((a) => ({ ...a, [qi]: opt }));
    const q = questions[qi];
    if (opt !== q.answer) {
      collected.mistakes.push({
        kind: 'listening',
        stage: 'listening',
        wrong: `${q.q_zh} → ${opt}`,
        correct: q.answer,
        note: q.explain_zh,
      });
    }
  };

  return (
    /*
      材料进弹窗：进环节先自动弹出来听，听完关掉答题，要回去重播某一句再点「再听一遍」。
      场景说明和「不支持语音合成」的提示都跟着材料走 —— 它们是听的时候要看的，
      答题时留在页面上只是占地方。
    */
    <>
      <MaterialSheet
        open={sheet.open}
        onClose={sheet.hide}
        title="听这段"
        subtitle={payload.scene_zh}
        footer={
          <Button className="w-full" onClick={sheet.hide}>
            听完了，去答题
          </Button>
        }
      >
        {!supported && (
          <p className="mb-4 rounded-xl border border-warm-200 bg-warm-50 p-3 text-sm dark:border-warm-900 dark:bg-warm-900/25">
            这个浏览器不支持语音合成，听力环节只能看文本。换 Chrome / Edge / Safari 就能听。
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={playAll} disabled={!supported} aria-busy={playingAll && synthesizing}>
            {playingAll && synthesizing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : playingAll ? (
              <Pause className="size-4" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}
            {/*
              定宽标签：三态「播放对话 / 生成中… / 停止」字数不同，不定宽的话
              连播每合成一句按钮就宽窄跳一下，右边的「正常 / 看原文 / 进度」跟着
              横移 —— 用户看到的就是每往下一句整行抖一下。宽度按最长的四字留，
              短的居中，播放全程按钮纹丝不动。
            */}
            <span className="inline-block w-16 whitespace-nowrap text-center">
              {playingAll ? (synthesizing ? '生成中…' : '停止') : '播放对话'}
            </span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSlow((s) => !s)}>
            {slow ? <Turtle className="size-4" aria-hidden /> : <Rabbit className="size-4" aria-hidden />}
            {slow ? '慢速' : '正常'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowText((s) => !s)}>
            {showText ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            {showText ? '藏起原文' : '看原文'}
          </Button>
          {/*
            连播进度。整段对话没有"第几句"的话，人听到第三句就不知道还剩几句，
            也没法判断刚才那句为什么跳过 —— 合成失败时进度停住是最直接的线索。
            不加 aria-live：材料正在被朗读，再让读屏软件每句念一次"第 N 句"
            会盖住朗读本身；需要时导航到它即可。
          */}
          {playingAll && line !== null && (
            <span className="text-xs tabular-nums dim">
              第 {line + 1} / {dialogue.length} 句
            </span>
          )}
        </div>

        {supported && cast.count > 1 && (
          <p className="mt-2 text-xs dim">
            {cast.count} 个人各用一个嗓音，名字的颜色就是他的声音。
          </p>
        )}

        <div className="mt-4 space-y-2">
          {dialogue.map((d, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                cancelRef.current = true;
                setPlayingAll(false);
                setLine(i);
                speak(d.text_en, {
                  slow,
                  serverVoiceId: serverCast.get(d.speaker),
                  ...cast.get(d.speaker),
                  onlineOnly: true, // 同上：单句重听也只用在线音色
                });
              }}
              className={cn(
                'flex w-full items-start gap-3 rounded-lg border-l-2 p-3 text-left',
                'transition-colors duration-200 [transition-timing-function:var(--ease-standard)]',
                line === i
                  ? 'border-[var(--accent-bar)] bg-brand-50 dark:bg-brand-900/25'
                  : 'border-transparent hover:bg-[var(--surface-hover)]',
              )}
            >
              {/* 说话人名字：这是标签不是台词，压成小号，颜色跟着嗓音走 */}
              <span
                className={cn(
                  'mt-0.5 w-10 shrink-0 truncate text-xs font-semibold',
                  speakerColor(d.speaker),
                )}
              >
                {d.speaker}
              </span>
              <span className="flex-1">
                {showText ? (
                  <>
                    <span className="en block text-[15px] leading-relaxed text-[var(--text-body)]">
                      {d.text_en}
                    </span>
                    <span className="mt-0.5 block text-xs dim">{d.text_zh}</span>
                  </>
                ) : (
                  <span className="block text-sm dim">
                    {line === i && speaking ? '正在播…' : '点这里听这一句'}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>

        {showText && (
          <div className="mt-5 border-t border-[var(--hairline)] pt-4">
            <p className="section-label">全文（可点词查）</p>
            <div className="mt-2 space-y-1.5">
              {dialogue.map((d, i) => (
                <p key={i} className="text-sm leading-relaxed text-[var(--text-body)]">
                  <span className={cn('font-semibold', speakerColor(d.speaker))}>{d.speaker}: </span>
                  <TappableText text={d.text_en} />
                </p>
              ))}
            </div>
          </div>
        )}
      </MaterialSheet>

      <CenterColumn className={MOBILE_ACTION_BAR_PAD}>
        <div className="flex items-center justify-between gap-3">
          <ColumnLabel>回答问题</ColumnLabel>
          <MaterialButton label="再听一遍" onClick={sheet.show} />
        </div>
        {questions.map((q, qi) => (
          <Card key={qi}>
            <div className="flex items-center gap-2">
              <Badge>问题 {qi + 1}</Badge>
            </div>
            <p className="mt-2 text-[15px] leading-relaxed text-[var(--text-body)]">{q.q_zh}</p>
            <div className="mt-3">
              <Choices
                options={q.options}
                answer={q.answer}
                picked={answers[qi] ?? null}
                onPick={(opt) => pick(qi, opt)}
              />
            </div>
            {answers[qi] !== undefined && (
              <Explain>
                <p className="text-xs dim">{q.explain_zh}</p>
              </Explain>
            )}
          </Card>
        ))}

        {/* 提交按钮钉底，不然滚动到页末才看见它 */}
        <MobileActionBar>
          <Button
            className="w-full"
            onClick={() => onDone(collected)}
            loading={submitting}
            disabled={!allAnswered && questions.length > 0}
          >
            {allAnswered || questions.length === 0 ? '听懂了，进入阅读' : '把问题答完再继续'}
          </Button>
        </MobileActionBar>
      </CenterColumn>

      {/*
        在线合成的状态提示（onlineOnly 模式）。听力里所有播放入口 —— 全篇连播、
        单句重听 —— 都共用这一个 tip，因为它们共用同一个 useTts 实例。

        2026-08-29：这里原来自己拼了两个 Toast，和 shared.tsx 里 Speak 用的那份
        是两套代码。加「延迟 500ms / 浅黄 / 中上方」时两处必须一模一样，
        否则同一个提示在阅读里是黄的、在听力里是绿的。所以改成共用 SpeechTip。
      */}
      <SpeechTip
        synthesizing={synthesizing}
        error={speechError}
        // 接着出错那句重来，不把整段打回起点
        onRetry={() => playFrom(line ?? 0)}
      />
    </>
  );
}

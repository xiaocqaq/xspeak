'use client';

import { useMemo, useState } from 'react';
import { Phone, Target } from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { ColumnLabel, MobileActionBar, MOBILE_ACTION_BAR_PAD, Speak, Split, StageIntro, StickyColumn } from './shared';
import { CallSheet } from '@/components/call-sheet';
import { VoiceChatLauncher } from '@/components/voice-chat-launcher';
import { ShadowCard } from '@/components/shadow-card';
import type { StageProps } from './types';
import type { SpeakingData } from '@/lib/ai/schemas';
import type { StartConfig } from '@/lib/types';
import { cn } from '@/lib/cn';

/**
 * 口语。两块：跟读打分（把句型练顺）和真实对话（把词用出来）。
 * 只有在对话里主动用出目标词，才会记 produced —— 这是"学会了"的判据，
 * 认得出来不算。
 */
export function SpeakingStage({ payload, meta, onDone, submitting }: StageProps<SpeakingData>) {
  /**
   * 通话是懒启动的：面板一挂载就会建会话、开麦、连上语音模型，
   * 所以不能和跟读一起常驻 —— 那样每个路过的人都会白开一通电话。
   */
  const [talking, setTalking] = useState(false);
  /**
   * 说出口的目标词，跨多通电话累加 —— 只增不减。
   * 挂掉重拨是常见操作（没听清、想换个开头），第一通里说对的词不该被清掉。
   */
  const [usedTerms, setUsedTerms] = useState<Set<string>>(new Set());
  /** 已挂断的那些电话一共聊了几轮 */
  const [pastTurns, setPastTurns] = useState(0);
  /** 正在通的这一通聊了几轮 */
  const [callTurns, setCallTurns] = useState(0);
  /** 第几通电话。只在拨号时 +1，用来给通话组件换 key，让每通都从头开始 */
  const [callSeq, setCallSeq] = useState(0);
  const turns = pastTurns + callTurns;
  const startedAt = useMemo(() => Date.now(), []);

  const hangUp = () => {
    setTalking(false);
    setPastTurns((n) => n + callTurns);
    setCallTurns(0);
  };

  const mustUse = payload.must_use ?? [];

  const startConfig: StartConfig = useMemo(
    () => ({
      title: `${meta.themeZh} 口语`,
      themeSlug: null,
      scenarioZh: payload.scenario_zh,
      aiRole: payload.ai_role,
      openingEn: payload.opening_en,
      openingZh: payload.opening_zh,
      targetWordIds: meta.targetWords.map((w) => w.id),
      // 中转层拿不到 id 对应的词，得把词本身给它，AI 才知道该把话题往哪带
      targetTerms: mustUse.length ? mustUse : meta.targetWords.map((w) => w.term),
      sessionId: meta.sessionId,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payload, meta],
  );

  const finish = () => {
    const producedIds = meta.targetWords
      .filter((w) => usedTerms.has(w.term.toLowerCase()))
      .map((w) => w.id);
    onDone({
      produced: producedIds,
      spokenSeconds: Math.round((Date.now() - startedAt) / 1000),
    });
  };

  return (
    <div className="space-y-4">
      <StageIntro>{payload.scenario_zh}</StageIntro>

      {/*
        原来这里是个「先跟读 / 真实对话」分段控件，一次只能看一边。
        但跟读句型本来就是对话时的参考材料 —— 分栏之后左边常驻句型和目标词，
        右边聊，说不出来抬眼就能抄一句，不用切回去。
      */}
      <Split
        ratio="wide-main"
        className={MOBILE_ACTION_BAR_PAD}
        aside={
          <StickyColumn>
            <ColumnLabel>先练顺这些</ColumnLabel>
            <Card>
              <div className="flex items-center gap-2">
                <Target className="size-4 text-brand-500" aria-hidden />
                <p className="text-sm font-semibold text-[var(--text-title)]">这几个词要真说出来</p>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {mustUse.map((t) => {
                  const used = usedTerms.has(t.toLowerCase());
                  return (
                    <span
                      key={t}
                      className={cn(
                        'en inline-flex items-center gap-1 rounded-[4px] border px-2 py-1 text-xs',
                        'transition-colors duration-200 [transition-timing-function:var(--ease-standard)]',
                        used
                          ? 'border-[var(--success)] bg-[color-mix(in_srgb,var(--success)_12%,var(--surface))] font-semibold text-[var(--success)]'
                          : 'border-dashed border-[var(--border)] text-[var(--text-faint)]',
                      )}
                    >
                      {used && '✓ '}
                      {t}
                    </span>
                  );
                })}
              </div>
              <p className="mt-2 text-xs dim">
                用出来的词才算掌握。只是"看着眼熟"不会推进进度。
              </p>
            </Card>

            <p className="text-xs dim">这些句型在对话里能直接用上。念一遍，看哪个词没被听清。</p>
            {(payload.useful_phrases ?? []).map((p, i) => (
              <ShadowCard key={i} target={p.en} zh={p.zh} sessionId={meta.sessionId} />
            ))}
          </StickyColumn>
        }
      >
        <ColumnLabel>和 AI 对话</ColumnLabel>
        {/*
          这张卡是「拨号页」：对方是谁、开场会听到什么，然后一个开始对话。
          真的聊起来是在弹窗里 —— 通话中屏幕上只该有这通电话，
          底下的句型和目标词这时候反而是干扰（要用的词弹窗自己带一份）。
        */}
        <Card>
          <div className="flex items-start justify-between gap-2">
            <div>
              <Badge tone="brand">AI 扮演</Badge>
              <p className="en mt-1.5 text-sm font-medium text-[var(--text-title)]">{payload.ai_role}</p>
            </div>
            <Speak text={payload.opening_en} />
          </div>
          <div className="mt-3 border-t border-[var(--hairline)] pt-3">
            <p className="text-sm dim">
              左边的句型念顺了就可以打过去。像打电话一样直接说，说完停一下 AI 就会接话，
              说错了它会在字幕里顺手改。
            </p>
            <Button
              className="mt-3"
              onClick={() => {
                setCallSeq((n) => n + 1);
                setTalking(true);
              }}
            >
              <Phone className="size-4" aria-hidden />
              开始对话
            </Button>
            {turns > 0 && !talking && (
              <p className="mt-2 text-xs dim">上一通聊了 {turns} 轮。再点一次可以接着练。</p>
            )}
          </div>
        </Card>

        {/* key 让每次重新拨号都彻底重建：会话、计时、字幕都从头开始 */}
        <CallSheet open={talking} onHangUp={hangUp} label={`和 ${payload.ai_role} 通话`}>
          <VoiceChatLauncher
            key={`call-${callSeq}`}
            start={startConfig}
            onHangUp={hangUp}
            onProgress={({ turns: n, usedTerms: used }) => {
              setCallTurns(n);
              setUsedTerms((s) => {
                if (used.every((w) => s.has(w))) return s;
                const next = new Set(s);
                for (const w of used) next.add(w);
                return next;
              });
            }}
          />
        </CallSheet>

        {/*
          口语是今天最后一个环节，所以这个按钮是"收工"，不再是"去写作"。
          没聊过就压成次要样式：真正该点的是上面的开始对话，不能让跳过的按钮更显眼。
        */}
        <MobileActionBar>
          <Button
            className="w-full"
            variant={turns === 0 ? 'outline' : 'primary'}
            onClick={finish}
            loading={submitting}
          >
            {turns === 0 ? '跳过对话，完成今天' : `聊了 ${turns} 轮，完成今天`}
          </Button>
        </MobileActionBar>
      </Split>
    </div>
  );
}

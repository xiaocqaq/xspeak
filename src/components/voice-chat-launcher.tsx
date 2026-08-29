'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, ErrorNote, Spinner } from '@/components/ui';
import { VoiceChatPanel, type VoiceProgress } from '@/components/voice-chat-panel';
import { apiGet, apiPost } from '@/lib/fetcher';
import type { SpeechPace, StartConfig, UserProfile } from '@/lib/types';

/**
 * 通话的启动器。
 *
 * 语音面板需要一个已经存在的 conversationId（中转层要用它落库），
 * 但场景配置里只有场景本身。所以这里先走 /api/chat 建好会话、顺带读一次档案
 * 拿到水平和语音偏好，再把面板放出来。
 *
 * 建会话时故意不带 openingEn —— 开场白由语音模型自己说，
 * 不需要先写一条固定的文本开场。
 */
export function VoiceChatLauncher({
  start,
  onHangUp,
  onProgress,
}: {
  start: StartConfig;
  onHangUp?: () => void;
  onProgress?: (p: VoiceProgress) => void;
}) {
  const [ready, setReady] = useState<{
    conversationId: number;
    level: string;
    voice: string | null;
    paceKey: SpeechPace;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bootedRef = useRef(false);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    (async () => {
      try {
        const [conv, profile] = await Promise.all([
          apiPost<{ conversationId: number }>('/api/chat', {
            action: 'start',
            title: start.title,
            themeSlug: start.themeSlug ?? null,
            scenarioZh: start.scenarioZh,
            aiRole: start.aiRole,
            targetWordIds: start.targetWordIds ?? [],
            sessionId: start.sessionId ?? null,
          }),
          apiGet<{ user: UserProfile }>('/api/profile'),
        ]);
        setReady({
          conversationId: conv.conversationId,
          level: profile.user?.level ?? 'A1',
          voice: profile.user?.ai_voice ?? null,
          paceKey: profile.user?.speech_pace ?? 'normal',
        });
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [start]);

  /*
    建会话失败 / 还没建好这两屏也长在通话弹窗里，所以要自己撑满并留一个出口 ——
    弹窗右上角没有关闭叉（通话中误触会掐断话），这里不给按钮人就出不去了。
  */
  if (error)
    return (
      <div className="flex flex-1 flex-col justify-between gap-4 p-5">
        <ErrorNote message={error} />
        <Button variant="outline" className="w-full" onClick={onHangUp}>
          挂断
        </Button>
      </div>
    );

  if (!ready)
    return (
      <div className="flex flex-1 flex-col justify-between gap-4 p-5">
        <div className="flex flex-1 items-center justify-center">
          <Spinner label="正在接通" />
        </div>
        <Button variant="outline" className="w-full" onClick={onHangUp}>
          挂断
        </Button>
      </div>
    );

  return (
    <VoiceChatPanel
      scenario={{
        conversationId: ready.conversationId,
        aiRole: start.aiRole,
        scenarioZh: start.scenarioZh,
        // 之前这里写死空数组，等于目标词引导一直没生效 ——
        // AI 不知道该把话题往哪带，说出口的词也就进不了 produced_count。
        targetTerms: start.targetTerms ?? [],
        level: ready.level,
        voice: ready.voice ?? undefined,
        paceKey: ready.paceKey,
      }}
      onHangUp={onHangUp}
      onProgress={onProgress}
    />
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { ErrorNote, Spinner } from '@/components/ui';
import { VoiceChatPanel } from '@/components/voice-chat-panel';
import type { StartConfig } from '@/components/chat-panel';
import { apiGet, apiPost } from '@/lib/fetcher';
import type { SpeechPace, UserProfile } from '@/lib/types';

/**
 * 畅聊模式的启动器。
 *
 * 语音面板需要一个已经存在的 conversationId（中转层要用它落库），
 * 但场景配置里只有场景本身。所以这里先走 /api/chat 建好会话、顺带读一次档案
 * 拿到水平和语音偏好，再把面板放出来。
 *
 * 建会话时故意不带 openingEn —— 畅聊模式的开场白由语音模型自己说，
 * 不需要先写一条固定的文本开场。
 */
export function VoiceChatLauncher({ start, onHangUp }: { start: StartConfig; onHangUp?: () => void }) {
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

  if (error) return <ErrorNote message={error} />;
  if (!ready) return <div className="py-10"><Spinner label="正在接通" /></div>;

  return (
    <VoiceChatPanel
      scenario={{
        conversationId: ready.conversationId,
        aiRole: start.aiRole,
        scenarioZh: start.scenarioZh,
        // 之前这里写死空数组，等于畅聊的目标词引导一直没生效 ——
        // AI 不知道该把话题往哪带，说出口的词也就进不了 produced_count。
        targetTerms: start.targetTerms ?? [],
        level: ready.level,
        voice: ready.voice ?? undefined,
        paceKey: ready.paceKey,
      }}
      onHangUp={onHangUp}
    />
  );
}

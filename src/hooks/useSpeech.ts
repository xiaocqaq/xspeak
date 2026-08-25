'use client';

/**
 * 浏览器原生语音能力封装。
 * - 朗读用 SpeechSynthesis（免费、离线可用、桌面和手机都支持）。
 * - 识别用 SpeechRecognition / webkitSpeechRecognition。Chrome / Edge / 手机 Safari 支持，
 *   Firefox 不支持 —— 所以每个用到识别的地方都必须提供打字兜底，见 supported 字段。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { readPace, subscribePace } from '@/lib/pace-store';
import { pace } from '@/lib/voice-options';
import type { SpeechPace } from '@/lib/types';

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/* ---------------------------------- 朗读 ---------------------------------- */

export function useTts(preferredVoice?: string) {
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  /**
   * 语速档位。朗读按钮散布在十几个纯展示组件里，都拿不到用户档案，
   * 所以从 localStorage 缓存同步读（真值在数据库，由 /api/profile 回填）。
   * 放 ref 而不是 state：speak 是回调，只在触发那一刻需要最新值，
   * 档位变化不该让所有挂了朗读按钮的组件重渲染。
   */
  const paceRef = useRef<SpeechPace>(readPace());
  useEffect(() => subscribePace((p) => (paceRef.current = p)), []);

  useEffect(() => {
    if (!supported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, [supported]);

  const pickVoice = useCallback(() => {
    if (!voices.length) return undefined;
    if (preferredVoice) {
      const exact = voices.find((v) => v.name === preferredVoice);
      if (exact) return exact;
    }
    const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
    // 优先本地合成（更快，且断网也能用）
    return en.find((v) => v.localService) ?? en[0];
  }, [voices, preferredVoice]);

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  const speak = useCallback(
    // voice 用于设置页试听某个具体嗓音，其余场景交给 pickVoice
    (
      text: string,
      opts?: {
        rate?: number;
        /** 在当前语速档位上再放慢一档，用于「慢速朗读」按钮 */
        slow?: boolean;
        onEnd?: () => void;
        voice?: SpeechSynthesisVoice;
      },
    ) => {
      if (!supported || !text.trim()) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = opts?.voice ?? pickVoice();
      if (v) u.voice = v;
      u.lang = v?.lang ?? 'en-US';
      // slow 做成相对的：把「慢速」写死成 0.7 的话，用户已经选了慢档时
      // 这个按钮就没有区分度了，选了快档时又会一下掉两档。
      const base = pace(paceRef.current).webSpeechRate;
      u.rate = opts?.rate ?? (opts?.slow ? Math.max(0.5, base - 0.22) : base);
      u.onstart = () => setSpeaking(true);
      u.onend = () => {
        setSpeaking(false);
        opts?.onEnd?.();
      };
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    },
    [supported, pickVoice],
  );

  useEffect(() => stop, [stop]);

  return { speak, stop, speaking, supported, voices };
}

/* ---------------------------------- 识别 ---------------------------------- */

export type SttState = {
  listening: boolean;
  transcript: string;
  interim: string;
  error: string | null;
  supported: boolean;
};

export function useStt(opts?: { continuous?: boolean; onFinal?: (text: string) => void }) {
  const [state, setState] = useState<SttState>({
    listening: false,
    transcript: '',
    interim: '',
    error: null,
    supported: false,
  });
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef('');
  const onFinalRef = useRef(opts?.onFinal);
  onFinalRef.current = opts?.onFinal;
  const continuous = opts?.continuous ?? true;

  useEffect(() => {
    setState((s) => ({ ...s, supported: getRecognitionCtor() !== null }));
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setState((s) => ({
        ...s,
        error: '当前浏览器不支持语音识别（可用 Chrome / Edge / 手机 Safari），可以直接打字。',
      }));
      return;
    }
    recRef.current?.abort();
    finalRef.current = '';
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = continuous;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => setState((s) => ({ ...s, listening: true, error: null, transcript: '', interim: '' }));
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? '';
        if (r.isFinal) finalRef.current += (finalRef.current ? ' ' : '') + text.trim();
        else interim += text;
      }
      setState((s) => ({ ...s, transcript: finalRef.current, interim }));
    };
    rec.onerror = (e: any) => {
      const map: Record<string, string> = {
        'not-allowed': '麦克风权限被拒绝了。浏览器地址栏左侧可以重新允许。',
        'service-not-allowed': '浏览器阻止了语音服务，可能需要 HTTPS 或 localhost 环境。',
        'no-speech': '没听到声音，再试一次？',
        network: '语音识别需要联网（这一步用的是浏览器自带的在线识别）。',
        aborted: '',
      };
      const msg = map[e.error] ?? `语音识别出错：${e.error}`;
      setState((s) => ({ ...s, listening: false, error: msg || null }));
    };
    rec.onend = () => {
      setState((s) => ({ ...s, listening: false, interim: '' }));
      if (finalRef.current.trim()) onFinalRef.current?.(finalRef.current.trim());
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      setState((s) => ({ ...s, error: '无法启动麦克风，请检查设备。' }));
    }
  }, [continuous]);

  const stop = useCallback(() => recRef.current?.stop(), []);
  const reset = useCallback(() => {
    finalRef.current = '';
    setState((s) => ({ ...s, transcript: '', interim: '', error: null }));
  }, []);

  useEffect(() => () => recRef.current?.abort(), []);

  return { ...state, start, stop, reset };
}

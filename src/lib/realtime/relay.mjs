/**
 * 浏览器 ↔ 中转层 ↔ StepFun 的 WebSocket 桥。
 *
 * 为什么需要这一层：
 * 1. Next 的 Route Handler 拿不住 WebSocket（连接会在响应生成后关掉），
 *    所以必须挂在自定义 server 的 upgrade 事件上。
 * 2. 浏览器的 WebSocket 不能设自定义请求头。StepFun 唯一支持的浏览器侧鉴权
 *    是子协议，那会把 API key 明文发给客户端。走中转就能把 key 留在服务端。
 *
 * 这个文件是纯 JS：server.mjs 不经过 Next 编译，用不了 TS 路径别名。
 * 所以它只做协议转发，教学分析回调 Next 的 /api/realtime/coach 完成 ——
 * 数据库和 AI 逻辑仍然留在 TS 侧一份，不重复实现。
 */

import { WebSocket as WsClient } from 'ws';
import {
  REALTIME_MODEL,
  REALTIME_PATH,
  DEFAULT_VOICE,
  UPSTREAM_AUDIO,
  ASR_MODEL,
  buildInstructions,
} from './protocol.mjs';

const UPSTREAM_BASE =
  process.env.STEP_REALTIME_URL?.trim() || 'wss://api.stepfun.com/step_plan/v1/realtime';

let seq = 0;
const eid = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * 把 ws 的 WebSocketServer 接到 upgrade 流程上。
 * @param {import('ws').WebSocketServer} wss
 * @param {{ localOrigin: string }} opts localOrigin 用于回调自家 coach 接口
 */
export function attachRelay(wss, opts) {
  wss.on('connection', (client, req) => {
    if (!req.url || !req.url.startsWith(REALTIME_PATH)) {
      client.close(1008, 'unexpected path');
      return;
    }

    /** @type {import('ws').WebSocket | null} */
    let up = null;
    let closed = false;
    let readySent = false;
    /** 本回合 AI 文本增量的累积 */
    let turnText = '';
    /** 最近一句学生原话，等 AI 回完再一起送去分析 */
    let pendingUser = null;
    /** start 时记下的上下文，coach 回调要用 */
    let ctx = null;

    const send = (msg) => {
      if (client.readyState === client.OPEN) client.send(JSON.stringify(msg));
    };

    const shutdown = () => {
      if (closed) return;
      closed = true;
      try {
        up?.close();
      } catch {
        // 已经断了
      }
      up = null;
      try {
        client.close();
      } catch {
        // 同上
      }
    };

    /** 一个回合结束：把学生原话 + AI 回复交给 Next 侧落库并分析。 */
    const coach = async (userText, assistantText) => {
      if (!ctx || !userText) return;
      try {
        const res = await fetch(`${opts.localOrigin}/api/realtime/coach`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            conversationId: ctx.conversationId,
            userText,
            assistantText,
          }),
        });
        const body = await res.json();
        if (!res.ok || body?.ok === false) return;
        const data = body.data;
        if (data?.correction) {
          send({
            type: 'coaching',
            userText,
            correction: data.correction,
            usedTerms: data.usedTerms ?? [],
          });
        }
      } catch {
        // 分析失败不影响对话继续，静默跳过
      }
    };

    client.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.type === 'start') {
        if (up) return; // 一条连接只开一次上游会话
        const apiKey = process.env.STEP_API_KEY?.trim();
        if (!apiKey) {
          send({ type: 'error', message: '服务端缺少 STEP_API_KEY，请在 .env.local 里配置。' });
          shutdown();
          return;
        }

        ctx = { conversationId: msg.conversationId };

        up = new WsClient(`${UPSTREAM_BASE}?model=${encodeURIComponent(REALTIME_MODEL)}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });

        up.on('open', () => {
          up.send(
            JSON.stringify({
              event_id: eid(),
              type: 'session.update',
              session: {
                modalities: ['text', 'audio'],
                instructions: buildInstructions({
                  aiRole: msg.aiRole,
                  targetTerms: msg.targetTerms ?? [],
                  level: msg.level ?? 'A1',
                }),
                voice: msg.voice || DEFAULT_VOICE,
                ...UPSTREAM_AUDIO,
                // 必须显式要求转写，否则拿不到学生说了什么。
                // 注意：加上 turn_detection: server_vad 会让服务端丢掉这个配置。
                input_audio_transcription: { model: ASR_MODEL },
              },
            }),
          );
        });

        up.on('message', (buf) => {
          let ev;
          try {
            ev = JSON.parse(String(buf));
          } catch {
            return;
          }

          switch (ev.type) {
            case 'session.updated':
              // 等配置确认再放行，避免第一片音频丢在配置生效之前
              if (!readySent) {
                readySent = true;
                send({ type: 'ready' });
              }
              break;

            case 'conversation.item.input_audio_transcription.completed': {
              const text = String(ev.transcript ?? '').trim();
              if (text) {
                pendingUser = text;
                send({ type: 'user_transcript', text });
              }
              break;
            }

            case 'response.audio_transcript.delta': {
              const d = String(ev.delta ?? '');
              if (d) {
                turnText += d;
                send({ type: 'assistant_delta', text: d });
              }
              break;
            }

            case 'response.audio.delta': {
              const d = String(ev.delta ?? '');
              if (d) send({ type: 'audio_delta', audio: d });
              break;
            }

            case 'response.done': {
              const text = turnText.trim();
              turnText = '';
              send({ type: 'turn_done', text });
              const said = pendingUser;
              pendingUser = null;
              // 教学分析在回合结束后异步跑，不挡下一句
              void coach(said, text);
              break;
            }

            case 'error':
              send({ type: 'error', message: ev.error?.message ?? '上游语音服务出错' });
              break;
          }
        });

        up.on('error', (err) => send({ type: 'error', message: err.message }));
        up.on('close', shutdown);
        return;
      }

      // 其余消息都要求上游已就绪
      if (!up || up.readyState !== WsClient.OPEN) return;

      switch (msg.type) {
        case 'audio':
          up.send(JSON.stringify({ event_id: eid(), type: 'input_audio_buffer.append', audio: msg.audio }));
          break;

        case 'commit':
          // 手动模式：提交缓冲区后显式请求回应。
          // server_vad 下发 commit 会被上游拒绝（commit when server vad）。
          up.send(JSON.stringify({ event_id: eid(), type: 'input_audio_buffer.commit' }));
          up.send(JSON.stringify({ event_id: eid(), type: 'response.create' }));
          break;

        case 'cancel':
          up.send(JSON.stringify({ event_id: eid(), type: 'response.cancel' }));
          break;
      }
    });

    client.on('close', shutdown);
    client.on('error', shutdown);
  });
}

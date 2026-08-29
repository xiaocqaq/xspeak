/**
 * 浏览器 ↔ 中转层 ↔ 上游语音服务的 WebSocket 桥。
 *
 * 为什么需要这一层：
 * 1. Next 的 Route Handler 拿不住 WebSocket（连接会在响应生成后关掉），
 *    所以必须挂在自定义 server 的 upgrade 事件上。
 * 2. 浏览器的 WebSocket 不能设自定义请求头。这类服务唯一支持的浏览器侧鉴权
 *    是子协议，那会把 API key 明文发给客户端。走中转就能把 key 留在服务端。
 *
 * 这个文件是纯 JS：server.mjs 不经过 Next 编译，用不了 TS 路径别名。
 * 所以它只做协议转发，教学分析回调 Next 的 /api/realtime/coach 完成 ——
 * 数据库和 AI 逻辑仍然留在 TS 侧一份，不重复实现。
 *
 * 上游是谁由 ../voice/config.mjs 决定（VOICE_* 环境变量），这里不写死。
 * 前提是对方也说 OpenAI Realtime 那套事件协议 —— 下面收发的事件名就是那套。
 */

import { WebSocket as WsClient } from 'ws';
import { REALTIME_PATH, UPSTREAM_AUDIO, buildInstructions, hasChinese } from './protocol.mjs';
import { AI_VOICE_IDS, pace } from '../voice-options.mjs';
import { voiceConfig, MISSING_KEY_MESSAGE } from '../voice/config.mjs';
import { authConfig } from '../auth/config.mjs';
import { identityFromToken, tokenFromCookieHeader } from '../auth/session.mjs';

let seq = 0;
const eid = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * 把 ws 的 WebSocketServer 接到 upgrade 流程上。
 * @param {import('ws').WebSocketServer} wss
 * @param {{ localOrigin: string, path?: string }} opts
 *   localOrigin 用于回调自家 coach 接口；
 *   path 是中转层实际挂载的路径。子路径部署时它是 `<前缀>/api/realtime`，
 *   跟裸的 REALTIME_PATH 不是同一个字符串 —— 这里不带前缀去比，
 *   会把每一个正常连接都当成走错门的关掉（1008），畅聊在子路径下直接不可用。
 */
export function attachRelay(wss, opts) {
  const mountPath = opts.path || REALTIME_PATH;
  wss.on('connection', async (client, req) => {
    if (!req.url || !req.url.startsWith(mountPath)) {
      client.close(1008, 'unexpected path');
      return;
    }

    /*
     * 握手鉴权。
     *
     * 浏览器的 WebSocket 不能给握手加请求头，所以票据只能走 cookie ——
     * 这也是 session cookie 用 sameSite=lax 而不是 strict 的原因之一。
     * 不接受 ?token= 那种写法：URL 会进 nginx 的 access log。
     *
     * 校验要 await，而 ws 在没人监听 message 时会把消息丢掉 ——
     * 前端是 onopen 里立刻发 start 的，不按住就会丢掉整个会话的开场。
     * 所以先 pause()，验完再 resume()。实测：不 pause 收到 0 条，pause 收到 1 条。
     *
     * 注意 pause() 期间 close() 的关闭帧发不出去（客户端收不到，要等 30 秒
     * 关闭超时才断）。所以下面拒绝的那条路径必须先 resume() 再 close()。
     */
    const authCfg = authConfig();
    /** 转发给自家 coach 接口用的 cookie，只带我们自己那一个，不把整个 jar 递过去 */
    let cookieHeader = null;
    if (authCfg.enabled) {
      client.pause();
      const token = tokenFromCookieHeader(req.headers.cookie);
      let identity = null;
      try {
        identity = await identityFromToken(token);
      } catch {
        identity = null;
      }
      // 校验这段时间里人可能已经关掉页面了
      if (client.readyState !== client.OPEN) return;
      if (!identity) {
        // 4401 是私有区间的自定义码：1008 已经用在「走错路径」上，
        // 前端得能分出「没登录」和「连错地方」，前者要跳登录页。
        try {
          client.resume(); // 见上：paused 状态下关闭帧发不出去
          client.close(4401, 'unauthenticated');
        } catch {
          // 已经断了
        }
        return;
      }
      cookieHeader = `${authCfg.sessionCookie}=${encodeURIComponent(token)}`;
      client.resume();
    }

    /** @type {import('ws').WebSocket | null} */
    let up = null;
    let closed = false;
    let readySent = false;
    /** 本回合 AI 文本增量的累积 */
    let turnText = '';
    /** 最近一句学生原话，等 AI 回完再一起送去分析 */
    let pendingUser = null;
    /**
     * 语音回合序号。「试试这样说」按它对版本：提示请求发出时记下当时的回合数，
     * 结果回来时回合已经往前走了（学生已经接话/新回合已开始）就丢掉，
     * 不让过时的提示盖住新鲜的 —— 这条请求和落库分析并行跑，返回有早有晚。
     * 回合从 AI 的第一片转写开始计数，被抢话打断的回合也占一个号。
     */
    let turnNo = 0;
    /** 本回合已经发过提示请求了（提前发过就不在回合结束时再发一遍） */
    let tipFired = false;
    /** start 时记下的上下文，coach 回调要用 */
    let ctx = null;
    /** 本次会话最后一次发出去的 session 配置，音色被拒时要原样重发一遍 */
    let sessionPayload = null;
    /** 音色回落只做一次，避免和上游来回拉锯 */
    let voiceFellBack = false;

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
          // 带上握手时那份 cookie：coach 接口和其它接口一样要过 currentUser()，
          // 不转发的话开了鉴权后这里每次都是 401，纠错功能静默消失。
          headers: {
            'content-type': 'application/json',
            ...(cookieHeader ? { cookie: cookieHeader } : {}),
          },
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

    /**
     * 「试试这样说」：赶在学生开口之前把提示送到。
     *
     * 独立于 coach 那条路 —— 那边要落库加完整分析，天然晚一两秒；
     * 提示恰恰要在那一两秒里送到。所以这里单独打 /api/realtime/tip：
     * 不写库，fast 模型只产一句话。回合序号记在发出那一刻，
     * 回来时对不上就丢，绝不倒退。
     *
     * 触发时机有两档，谁先到算谁的（tipFired 保证一回合只发一次）：
     * - AI 的转写攒出一句完整的话就提前发 —— 提示生成的这几秒和语音播放
     *   重叠进行，等音频播完结果已经在路上，学生开口前看到提示才有戏；
     * - 全程没凑出完整句（很短的回应），回合结束时拿全文补发。
     */
    const fetchTip = (assistantText, turn) => {
      if (!ctx || !assistantText) return;
      void (async () => {
        try {
          const res = await fetch(`${opts.localOrigin}/api/realtime/tip`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(cookieHeader ? { cookie: cookieHeader } : {}),
            },
            body: JSON.stringify({
              conversationId: ctx.conversationId,
              assistantText,
            }),
          });
          const body = await res.json();
          if (!res.ok || body?.ok === false) return;
          // 学生已经说了下一句、AI 又回过一轮：这条提示是给已经过去的回合准备的
          if (turn !== turnNo) return;
          send({ type: 'tip', turn, tip: body.data?.tip ?? null });
        } catch {
          // 提示失败无所谓，下一回合还会再要
        }
      })();
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
        // 每次建会话时读配置：改完 .env.local 重启就生效，不用管模块缓存
        const cfg = voiceConfig();
        if (!cfg.apiKey) {
          send({ type: 'error', message: MISSING_KEY_MESSAGE });
          shutdown();
          return;
        }

        ctx = { conversationId: msg.conversationId };

        up = new WsClient(`${cfg.realtimeUrl}?model=${encodeURIComponent(cfg.realtimeModel)}`, {
          headers: { Authorization: `Bearer ${cfg.apiKey}` },
        });

        // 音色先过一遍白名单（scripts/probe-voices.mjs 实测过 realtime 认哪些）。
        // 不认的 id 上游会明确报 "voice xxx is not valid"，所以本地能挡就先挡掉。
        // 但白名单只是本地快照，上游哪天下线一个音色它就过期了 —— 真被拒的兜底
        // 在下面 error 分支里：带默认音色重发一次，而不是让整通电话死掉。
        const wanted = AI_VOICE_IDS.includes(msg.voice) ? msg.voice : cfg.defaultVoice;
        sessionPayload = {
          modalities: ['text', 'audio'],
          instructions: buildInstructions({
            aiRole: msg.aiRole,
            targetTerms: msg.targetTerms ?? [],
            level: msg.level ?? 'A1',
            paceInstruction: pace(msg.paceKey).instruction,
          }),
          voice: wanted,
          ...UPSTREAM_AUDIO,
          // 必须显式要求转写，否则拿不到学生说了什么。
          // 注意：加上 turn_detection: server_vad 会让服务端丢掉这个配置。
          input_audio_transcription: { model: cfg.asrModel },
        };

        up.on('open', () => {
          up.send(JSON.stringify({ event_id: eid(), type: 'session.update', session: sessionPayload }));
        });

        up.on('message', (buf) => {
          let ev;
          try {
            ev = JSON.parse(String(buf));
          } catch {
            return;
          }

          switch (ev.type) {
            case 'session.updated': {
              // 上游偶尔会收下请求但回显另一个音色（静默降级）。这种最坑 ——
              // 用户选了 A 听到的是 B，界面上一切正常，只能靠回显对一遍才发现。
              const echo = ev.session?.voice;
              if (echo != null && sessionPayload && echo !== sessionPayload.voice) {
                send({
                  type: 'notice',
                  message: `上游把音色换成了「${echo}」，这一通不是你选的那个声音。`,
                });
                sessionPayload.voice = echo; // 别再为同一次降级重复提示
              }
              // 等配置确认再放行，避免第一片音频丢在配置生效之前
              if (!readySent) {
                readySent = true;
                send({ type: 'ready' });
              }
              break;
            }

            case 'conversation.item.input_audio_transcription.completed': {
              const text = String(ev.transcript ?? '').trim();
              if (text) {
                pendingUser = text;
                // 转写里有汉字就打标：前端据此在那句气泡下面加一条说明。
                // 注意这个标不代表「学生说了中文」，纠错分析照跑（见 protocol.mjs 的 hasChinese）。
                send({ type: 'user_transcript', text, zh: hasChinese(text) || undefined });
              }
              break;
            }

            case 'response.audio_transcript.delta': {
              const d = String(ev.delta ?? '');
              if (d) {
                // 新回合的第一片转写：回合号在这里往前走，打断的回合也占一个号
                if (!turnText) {
                  turnNo++;
                  tipFired = false;
                }
                turnText += d;
                const trimmed = turnText.trim();
                /*
                 * 转写凑出一句完整的话（30 字符以上 + 句末标点）就提前去要提示。
                 * 这通常发生在 AI 刚开口一两秒 —— 提示的生成时间和接下来好几秒的
                 * 语音播放完全重叠，学生听完、还没想好怎么接的时候，提示已经到了。
                 */
                if (!tipFired && trimmed.length >= 30 && /[.!?]["')\]]?$/.test(trimmed)) {
                  tipFired = true;
                  void fetchTip(trimmed, turnNo);
                }
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
              // 两条旁路并行跑：coach 落库+纠错（晚一两秒），fetchTip 出一句提示
              //（大概率在转写阶段就已经提前发出去了，这里只补漏）。
              // 互不等待，谁也不挡谁。
              void coach(said, text);
              if (text && !tipFired) {
                tipFired = true;
                void fetchTip(text, turnNo);
              }
              break;
            }

            case 'error': {
              const detail = String(ev.error?.message ?? '');
              // 音色被拒（"voice xxx is not valid"）：本地白名单过期了。
              // 上游这时还没产出音频，voice 仍可改 —— 带默认音色重发一次配置，
              // 通话就能继续，代价只是这一通用的不是选的那个声音。
              // 这比整通电话直接死掉好，也比静默换声好：下面会明确告诉用户。
              if (
                !voiceFellBack &&
                sessionPayload &&
                /voice/i.test(detail) &&
                sessionPayload.voice !== cfg.defaultVoice
              ) {
                voiceFellBack = true;
                const rejected = sessionPayload.voice;
                sessionPayload = { ...sessionPayload, voice: cfg.defaultVoice };
                up.send(JSON.stringify({ event_id: eid(), type: 'session.update', session: sessionPayload }));
                send({
                  type: 'notice',
                  message: `上游不认音色「${rejected}」，这一通先用默认声音。去设置里换一个再打。`,
                });
                break;
              }

              /*
               * 提交了一段没有人声的音频（"no speech found"）。
               *
               * 本地 VAD 会被咳嗽、桌子响、外放尾音触发，开一个回合再提交上去，
               * 上游对不到 1 秒的音频就回这个错（实测 400/680/700ms 报错，1000ms 起正常）。
               * 这不是通话出了问题，可原来走下面那条 error，前端 case 'error' 会把状态
               * 打成 error —— 那是个终态，没有恢复路径，一次杂音就把整通电话弄死了。
               *
               * 除了 notice 还要补一条空的 turn_done：这一回合上游不会再有
               * response.done 了，而前端提交时已经把状态置成 thinking、麦也关了，
               * 只发 notice 的话会一直卡在「思考中」。空文本的 turn_done 不入列，
               * 正好把状态收回 ready 并重新开麦（见 hooks/useVoiceChat.ts）。
               */
              if (/no speech found/i.test(detail)) {
                pendingUser = null;
                turnText = '';
                send({ type: 'notice', message: '刚才那段没听到人声，再说一次就行。' });
                send({ type: 'turn_done', text: '' });
                break;
              }

              send({ type: 'error', message: detail || '上游语音服务出错' });
              break;
            }
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

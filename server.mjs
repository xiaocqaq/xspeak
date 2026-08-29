/**
 * 自定义 server：Next 的请求处理 + 一个 WebSocket 中转。
 *
 * 为什么不用 Route Handler 做 WebSocket：Next 的文档明确说了连接会在响应生成后关掉
 * （node_modules/next/dist/docs/01-app/02-guides/backend-for-frontend.md），
 * 拿不住长连接。而端到端语音必须是长连接，所以只能挂在 upgrade 事件上。
 *
 * 这个文件不经过 Next 编译，所以：
 * - 不能用 `@/` 路径别名，只能用相对路径导入 .mjs；
 * - 语法要和当前 Node 版本直接兼容（不转译）。
 *
 * `next dev` / `next start` 都被它替代了，见 package.json 的 dev / start 脚本。
 */

import { createServer } from 'node:http';
import next from 'next';
import { WebSocketServer } from 'ws';
// @next/env 是 CommonJS，只能默认导入后再取属性
import nextEnv from '@next/env';
import { REALTIME_PATH } from './src/lib/realtime/protocol.mjs';
import { attachRelay } from './src/lib/realtime/relay.mjs';
import { voiceConfig } from './src/lib/voice/config.mjs';
import { describeModels } from './src/lib/ai/config.mjs';

// 生产模式用 `--prod` 标志而不是 NODE_ENV=xxx —— Windows 的 cmd 不认前置环境变量赋值，
// 用标志能让 npm start 在三个平台上都一样跑。
const dev = !process.argv.includes('--prod');
process.env.NODE_ENV ??= dev ? 'development' : 'production';

// 中转层是普通 Node 代码，不走 Next 的环境变量注入，所以这里显式加载一次 .env.local，
// 保证 relay 能读到语音服务的 key。
nextEnv.loadEnvConfig(process.cwd(), dev);

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const hostname = process.env.HOST ?? '127.0.0.1';

// 子路径部署时 nginx 会原样把 /<前缀>/api/realtime 转过来。
// upgrade 事件拿到的是没经过 Next 处理的原始 url，basePath 帮不上忙，得自己拼。
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');
const realtimePath = `${basePath}${REALTIME_PATH}`;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((req, res) => handle(req, res));

// noServer 模式：自己判断 upgrade 请求要不要接，避免和 Next 的 HMR socket 抢连接
const wss = new WebSocketServer({ noServer: true });
// realtimePath 已经带上了 basePath，中转层要用同一个值校验，否则子路径下会自己把连接关掉
attachRelay(wss, { localOrigin: `http://${hostname}:${port}${basePath}`, path: realtimePath });

server.on('upgrade', (req, socket, head) => {
  let pathname;
  try {
    pathname = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`).pathname;
  } catch {
    socket.destroy();
    return;
  }

  // 只接自己的路径，其余（Next dev 的 HMR）交给 Next 自己处理
  if (pathname !== realtimePath) return;

  wss.handleUpgrade(req, socket, head, (client) => {
    wss.emit('connection', client, req);
  });
});

server.listen(port, hostname, () => {
  const voice = voiceConfig();
  console.log(`▲ xSpeak  http://${hostname}:${port}${basePath}`);
  console.log(`  语音中转  ws://${hostname}:${port}${realtimePath}`);
  // 启动时把「实际会用哪家」打出来：这几个值全来自环境变量，
  // 配错了最容易在这里被看见，比等到用户点开畅聊再报错便宜得多。
  console.log(`  语音服务  ${voice.provider} · ${voice.realtimeModel} · 音色 ${voice.defaultVoice}`);
  if (!voice.apiKey) {
    console.warn('  ⚠ 没配 VOICE_API_KEY / STEP_API_KEY，畅聊模式会连不上。在 .env.local 里补上。');
  }
  // 同理，模型也是纯环境变量决定的。缺 key 的角色会在这里显示「未配置」，
  // 不抛错 —— 只用查词不用畅聊的人不该被启动失败挡住。
  for (const line of describeModels()) {
    console.log(`  模型      ${line}`);
  }

  startDailyPrefresh(basePath);
});

/*
 * 每天凌晨 4 点预生成当日学习任务（48h 内活跃用户）。
 *
 * 为什么长在 server.mjs 而不是系统 crontab：逻辑跟着应用走 —— 代码里
 * 就是这一个部署单元，测试站/生产站各自跑各自的，不用在宿主机上再维护
 * 一份"哪台机器、哪个端口、哪个前缀"的 crontab。
 *
 * 为什么用 HTTP 自调用而不是直接 import：今日任务的组装逻辑（getOrCreateToday、
 * prewarmNewWords）在 Next 编译侧的 TS 里，server.mjs 是纯 JS 进不去那些模块。
 * 回环请求是最诚实的路 —— 也顺带验证了整条 HTTP 链路可用。
 *
 * 时区：Date 按服务器本地时区（Asia/Shanghai）算"明天 4 点"，和
 * sessions.day 的 localDay() 同一口径，不会错位。
 */
function startDailyPrefresh(basePath) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('  ⚠ 没配 CRON_SECRET，凌晨 4 点的每日任务预生成不会跑（/api/internal/prefresh 禁用）');
    return;
  }

  const runPrefresh = async () => {
    const url = `http://${hostname}:${port}${basePath}/api/internal/prefresh`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.ok === false) {
        console.warn(`[prefresh] 预生成失败：HTTP ${res.status}`, body?.error ?? '');
        return;
      }
      const okCount = (body?.data?.results ?? []).filter((r) => r.ok).length;
      console.log(`[prefresh] 每日任务预生成完成：${okCount}/${body?.data?.users ?? 0} 个用户`);
    } catch (err) {
      console.warn('[prefresh] 预生成请求出错：', err?.message ?? err);
    }
  };

  // 下一次 04:00 的本地时间点
  const nextAt = () => {
    const t = new Date();
    t.setHours(4, 0, 0, 0);
    if (t.getTime() <= Date.now()) t.setDate(t.getDate() + 1);
    return t;
  };

  const schedule = () => {
    const when = nextAt();
    const delay = when.getTime() - Date.now();
    setTimeout(async () => {
      await runPrefresh();
      schedule(); // 跑完排明天的，不依赖 setInterval 的固定间隔
    }, delay);
    console.log(`[prefresh] 每日任务预生成已排程：${when.toLocaleString('zh-CN')}`);
  };
  schedule();
}

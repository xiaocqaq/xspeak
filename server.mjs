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
  console.log(`▲ XLearn  http://${hostname}:${port}${basePath}`);
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
});

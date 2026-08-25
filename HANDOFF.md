# 交接：XLearn 界面改造 + 离线词典

> 2026-08-25 更新。已提交到 `feat/shell-layout-and-provider-config`（`e463706`、`3f7ad96`），
> 未 push。`npm run typecheck`、`npm run build`、`npm run smoke -- --fast`（8/8）均通过。

## 用户提的 6 条，完成情况

| # | 需求 | 状态 |
|---|------|------|
| 1 | 改名 XLearn | ✅ 完成 |
| 2 | 用数据库存词，不要每次查词都走 AI | ✅ 完成 |
| 3 | 畅聊改成打电话界面，不自动开麦，按钮收小 | ✅ 完成，**已浏览器实测**（见下） |
| 4 | 各阶段顶部去掉那段提示 | ✅ 完成 |
| 5 | 「今天这样走」做成侧栏，点击原地切换 | ✅ 完成，**已浏览器实测**（390 / 1440 两档）|
| 6 | 每个界面保持干净 | 🔄 进行中，warmup 已排，其余只继承配色 |

## 下一步（按优先级）

1. 跟用户确认 warmup 下半屏空白的解法（卡片居中 vs 卡片栈）—— 挡着第 6 条。
2. 按第 6 条继续排剩下 5 个环节（newwords / grammar / listening / reading / speaking）
   和 5 个页面（vocab / stats / settings / grammar / import）。
   八个页面在 390 / 1440 两档都已确认无横向溢出、无 console 报错、内容真实渲染，
   剩下的是版面疏密，不是坏。
3. 改动后跟一遍 `npm run smoke -- --fast`。

## 两个待用户拍板的问题

- **`/api/writing` 和 writing 环节被删了**（`git status` 里的 `D`），是有意的还是误删？
  第 6 条原文写的是 6 个环节，现在只剩 5 个。
- **这个站没有任何鉴权**：`currentUser()` 写死 `users.id = 1`，
  所有公网访客共用一个账号、同一份学习记录。设置页文案也写着「要放到公网必须先加一层认证」，
  但它现在就在公网上（见部署一节）。

## 第 2 条做了什么（离线词典）

**新增 `dictionary` 表**（`src/lib/db/schema.ts`），已导入 **768,739 条** ECDICT 词条。
和 `words` 表刻意分开：`words` 是"你在学的词"（百千量级，带主题/来源/例句），
`dictionary` 是"查得到的词"（七十万量级，只读）。混在一张表会拖慢学习相关查询。

**`npm run dict:import`**（`scripts/import-dict.mjs`）：
- 数据源 `raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv`
  （**注意**：release 的 zip 在这台机器上下不通，raw 可以）
- 下载缓存在项目根 `ecdict.csv`（52.8MB，已进 `.gitignore`）
- 支持 `--top N` 只导高频词、`--force` 重建
- 全量导入实测 179 秒
- `dictionary` 刻意不在 `ALL_TABLES` 里，`db:reset` 不会删它

**查词顺序改成 words 表 → dictionary → AI**（`src/app/api/words/lookup/route.ts`）。
修掉了一个一直存在的浪费：原来查了 `words` 表却只用结果判断"见过没"，然后照样调一次 AI。

实测（`source` 字段标明命中层）：
```
commute    218ms  library
walked     346ms  dict     ← 过去式还原
cities     331ms  dict     ← 复数还原
running    266ms  dict     ← 进行式还原
Zelenskyy  24015ms  ai     ← 词典没有才走 AI
```
词形还原在 `src/lib/repo/dictionary.ts` 的 `stems()`，规则粗糙但猜错只是回落 AI。

## 第 3 条做了什么（打电话式畅聊）

`voice-chat-panel.tsx`：
- 加了 `connected` 状态和待机屏。以前是 `useEffect` 里直接 `vc.start()`，
  一进页面就弹权限、就开始录音。现在先显示"对方是谁 + 聊什么 + 目标词"，点绿色接通键才连。
- 静音/挂断从 `size="lg"` 的方形 Button 换成 44px 圆形图标按钮，挂断用 systemRed。

**浏览器实测结果（2026-08-25）**：待机屏 → 点接通 → 连上并稳定 40 秒，音频持续上行，
AI 开场白正常出声（`"Hello! Welcome to the hotel. May I have your name, please?"`）。
过程中挖出两个真 bug，都已修（`3f7ad96`）：

1. **子路径下畅聊根本连不上。** `relay.mjs` 拿 `req.url` 和裸的 `REALTIME_PATH`
   （`/api/realtime`）比，而浏览器连的是 `/xlearn/api/realtime`，于是每一个正常连接
   握手完就被自己 1008 关掉。UI 上表现为「通话已结束」。改成由 `server.mjs`
   把已带前缀的 `realtimePath` 传进去比。
2. **纠错回调静默 404。** `attachRelay` 的 `localOrigin` 没带 basePath，
   `${localOrigin}/api/realtime/coach` 落到不带前缀的路径上。已补 `${basePath}`。
3. 顺手修了计时器：原来 effect 盯的是 `connected`（只记录「点过接通」），
   断线后仍为 true，出现「通话已结束」下面秒数还在涨。改成盯派生的 `live`。

自动化用的是直接打 CDP 的小驱动（`/tmp/xlearn-shots/drive.mjs`，无 MCP、无 playwright driver），
配 `--use-fake-device-for-media-stream` 喂假麦克风。要复现看 `ws-trace.mjs`，
它把 `Network.webSocketFrame*` 打出来，1008 那次就是这么定位的。

## 第 4 条做了什么

删掉的是 AI 生成的长段解释和纯操作说明：
- `warmup` 的 `intro_zh`（三行教学设计说明）
- `newwords` 的 `intro_zh`
- `grammar` 的 `focus_zh`
- `reading` 写死的"点任意一个词可以直接查"

保留的是内容本身：`listening.scene_zh`（场景）、`speaking.scenario_zh`、`writing.prompt_zh`（题目）。
`warmup`/`newwords` 里剩的两处 `StageIntro` 是空状态文案，保留合理。

## 界面改造的既有约定（Apple 风）

`globals.css` 顶部有完整说明，改之前先读。要点：
- 间距一律 8 的倍数；圆角只有 8/12/20px 三档（已覆盖 Tailwind 的 `--radius-*`，
  写 `rounded-lg/xl/2xl` 自动落到新档位）
- 浮起表面用毛玻璃（`.card` / `.chrome-material`），不用大投影
- **`backdrop-filter` 不要手写 `-webkit-` 前缀** —— Lightning CSS 见到两者共存会
  把标准属性折叠掉只留前缀版，而 Electron 内嵌浏览器只认标准属性，结果模糊整个失效。
  这个坑踩过一次，注释已写在 CSS 里。
- 标题收字距 `-0.022em`；按钮 44px 高、按下 `scale(0.96)`

## 第 6 条剩下的工作

只重排了 `warmup`。剩下 5 个环节（newwords / grammar / listening / reading / speaking
—— writing 已被删，见上面待拍板的问题）和 5 个页面（vocab / stats / settings / grammar / import）
只继承了新配色，版面还没逐个排。

**已经量过的部分**（2026-08-25，CDP 实测 8 个页面 × 390/1440 两档 = 16 组）：
横向溢出 0、console 报错 0、内容真实渲染（不是骨架屏）。所以剩下的确实只是版面疏密的活，
没有"坏掉"的页面。各页文档高度供排版时参考：

| 页面 | 390 宽 | 1440 宽 |
|------|-------:|--------:|
| `/` | 1946 | 1238 |
| `/learn` | 844 | 900 |
| `/chat` | 1392 | 906 |
| `/vocab` | 990 | 900 |
| `/stats` | 1630 | 1028 |
| `/settings` | 2602 | 2272 |
| `/grammar` | 2484 | 3574 |
| `/import` | 906 | 900 |

`/learn` 两档都正好等于一屏（不产生滚动），这跟 warmup 下半屏空白是同一件事。
量的脚本是 `/tmp/xlearn-shots/audit.mjs`，它排除了带 `overflow-x` 祖先的元素，
所以横向滚动容器（比如设置页的音色列表）不会误报。

共享件已经改好了，所以这些页面的选项列表、评分按钮、讲解块已经跟着变对：
- `Choices` → iOS 分组列表（一个容器 + 分隔线，不是四个独立方框）
- `RatingRow` → 半透明 fill 底 + 彩色文字，四档颜色各不相同
- `Explain` → fill 底无边框，去掉左侧彩色竖线
- `StageIntro` → 降成次级正文，无底色

**warmup 还剩一个没解决的问题**：下半屏大片空白。
试过用 `min-h` 撑满，那是错的（只是把空白从卡片下方挪到按钮上方），已撤掉。
根因是信息密度低（一屏一道题）。两个候选解法：卡片垂直居中（改动小），
或做成可滑动的卡片栈（更像原生，改动大）。等用户定。

## 部署与环境状态

线上是 **`https://test.xlingo.fun/xlearn`**，nginx 反代到本机 `127.0.0.1:3021`，
生产模式跑（`node server.mjs --prod`），不是 `npm run dev`。

**子路径部署有个必须记住的点**：`NEXT_PUBLIC_BASE_PATH` 会在 `next build` 时
内联进客户端包，所以它**必须写在 `.env.local` 里**，不能只放在启动命令的环境变量里。
之前就是这么错的 —— 构建出的是根路径产物（`basePath = ""`），运行时却挂在 `/xlearn`，
React 的 bootstrap script 带着不加前缀的地址被发出去、全部 404，
于是**整站从未 hydrate**：每个页面永远停在骨架屏，点什么都没反应，一个 `/api` 请求都不发。
这次重新构建后才真正可用。`.env.local` 里现在有：

```
NEXT_PUBLIC_BASE_PATH=/xlearn
PORT=3021
HOST=127.0.0.1
```

注意本机 shell 自带 `PORT=8648`，而 `@next/env` 的 `loadEnvConfig` **不会覆盖**
已存在的 `process.env`，所以手动起服务要显式写端口：

```bash
env -u NODE_OPTIONS PORT=3021 HOST=127.0.0.1 NEXT_PUBLIC_BASE_PATH=/xlearn \
  node server.mjs --prod
```

**没有进程管理**：现在这个服务是手起的孤儿进程，没有 systemd unit 也没有 pm2，
机器一重启站点就没了。要长期挂着得补一个。

其余：
- 数据库远程 PG `115.159.206.76:54321`，`dictionary` 表已有 768,739 条，重启不影响
- `ecdict.csv` 缓存在项目根，重跑 `dict:import` 会复用它不重新下载
- 出题慢（28–45 秒）是环境问题不是 bug：本机代理 `127.0.0.1:8648` 只供得起
  `claude-opus-5`，`claude-sonnet-5` 和 `claude-haiku-4-5-20251001` 都返回 503
  `model_not_found`，所以 `fast` 角色在这台机器上快不起来
- `earlyoom` 会挑 node 杀，`next build` 被杀过一次；已给构建进程设 `oom_score_adj = -800`

## 验证命令

```bash
npm run typecheck               # 通过
npm run build                   # 通过（改 NEXT_PUBLIC_BASE_PATH 后必须重跑）
npm run smoke -- --fast         # 8/8 通过
BASE=http://127.0.0.1:3021/xlearn npm run smoke -- --fast   # 子路径下要带 BASE
npm run probe:voice             # 三项全过，上游语音是好的
npm run db:check
```

`npm run lint` 已经失效（Next 16 拿掉了 `next lint`），别拿它当门槛。

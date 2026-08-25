# XLearn

每天 30 分钟，一个主题串起七个环节：热身复习 → 新词 → 语法 → 听力 → 阅读 → 口语 → 写作批改。
内容全部由 AI 按你的水平和兴趣现场生成，进度存在 PostgreSQL。

## 为什么和多邻国 / 墨墨不一样

针对"背了就忘"和"投入不进去"两个具体问题设计：

1. **每次复习都换新句子。** 同一个词第二次出现时，例句是重新生成的。数据库里 `user_words.seen_contexts`
   记着这个词你已经在哪些句子里见过，生成时明确避开。背的是词，不是那一句话。
2. **只有"用出来"才算掌握。** `produced_count` 只在你把这个词**说出口或写进句子**时才 +1。
   认得不算会 —— 词库页把"认得，还没用过"和"已掌握"分成两种状态显示。
3. **错题会被悄悄重考。** 写作批改和对话纠正出的问题进 `mistakes` 表，
   之后几天的题目会围着它出，但不会拎出来告诉你"这是你的错题"。
4. **七个环节同一个主题。** 早上学的 `refill`，听力里在咖啡店听到，口语里要用它跟 AI 点单，
   写作里必须用上。一天下来这个词被动认过、主动说过、主动写过。

## 技术栈

| | |
|---|---|
| 框架 | Next.js 16 App Router + React 19 |
| 语言 | TypeScript 5.9 |
| 样式 | Tailwind CSS 4（CSS-first `@theme`，没有 config 文件） |
| 数据库 | PostgreSQL（pg），手写 SQL + 薄仓储层 |
| 记忆算法 | FSRS（ts-fsrs），单词和语法点共用 |
| AI | Anthropic SDK，结构化输出用 tool-forcing + zod 校验 |
| 语音 | 浏览器原生 Web Speech API（朗读 + 识别，零成本）+ StepFun 端到端实时语音（畅聊模式） |
| 服务器 | 自定义 `server.mjs`：Next 请求处理 + WebSocket 中转 |
| PWA | 手写 manifest + service worker |

没用 ORM，没用 next-pwa —— SQL 和缓存策略都不复杂，自己写一遍反而说得清。

## 跑起来

```bash
npm install
cp .env.local.example .env.local   # 填 ANTHROPIC_API_KEY、PG 连接信息、STEP_API_KEY
npm run icons                      # 生成 PWA 图标（零依赖，手写 PNG 编码）
npm run dev                        # http://localhost:3000
```

首次访问会自动建表、播种内置词表（85 个 A1/A2 口语高频词）、24 个语法点和 30 个主题，
然后走引导页填水平/目标/兴趣。

播种做的是「补齐」而不是「只在空库跑一次」：往 `src/data/` 里加词或语法点之后重启即可，
已有的按 `term` / `slug` 跳过，AI 生成过的同名词不会被内置版本覆盖。

生产：

```bash
npm run build && npm start
```

> **构建内存**：Next 16 构建峰值大概要 2G 以上。内存小的机器上加
> `NODE_OPTIONS="--max-old-space-size=3072"`。

## 脚本

| 命令 | 作用 |
|---|---|
| `npm run typecheck` | tsc --noEmit |
| `npm run icons` | 生成 `public/icons/*.png` |
| `npm run db:check` | 数据库体检：连通性、缺表、各表行数、jsonb 列类型 |
| `npm run db:reset` | 清空数据库（不带 `-- --yes` 只打印将删的表；`--dump out.sql` 先备份） |
| `npm run smoke` | 端到端冒烟测试，打真实接口走真实 AI（`-- --fast` 跳过 AI 环节） |
| `npm run probe:voice` | 探测实时语音接口，验证 README 里那两条硬约束还成不成立（`-- --quick` 只测连通性） |

`smoke` 需要另一个终端先 `npm run dev`。它会往数据库写真实数据，也会花 token。

## 结构

```
src/
├── app/
│   ├── api/              # 路由：session、review、chat、writing、pronounce、import…
│   ├── learn/            # 七环节跑道
│   ├── chat/ vocab/ grammar/ stats/ settings/ import/
│   └── offline/          # SW 导航失败的兜底页
├── components/
│   ├── stages/           # 七个环节各一个组件 + shared（查词卡、朗读、评分条）
│   ├── chat-panel.tsx    # 逐句纠正的文本对话，口语环节和对话页共用
│   ├── voice-chat-panel.tsx / voice-chat-launcher.tsx   # 畅聊（端到端语音）
│   └── shadow-card.tsx   # 跟读打分
├── hooks/
│   ├── useSpeech.ts      # 浏览器原生朗读 / 识别
│   └── useVoiceChat.ts   # 畅聊：录音降采样、流式播放、连接管理
├── lib/
│   ├── ai/               # client（tool-forcing + 重试）、schemas（zod）、prompts
│   ├── db/               # 连接、DDL、播种
│   ├── realtime/         # protocol.mjs（共享常量）、relay.mjs（中转）、coaching.ts（教学旁路）
│   ├── repo/             # words / grammar / session / stats / mistakes
│   ├── scheduler.ts      # FSRS 封装
│   └── pronounce.ts      # 发音一致度打分
└── data/                 # 内置词表和语法点
```

`server.mjs` 在项目根：它替代了 `next dev` / `next start`，因为 Next 的 Route Handler
拿不住 WebSocket 长连接（连接会在响应生成后关掉），畅聊的中转只能挂在 `upgrade` 事件上。

## 对话有两种模式

两种模式刻意分开，不揉在一个界面里 —— 「每句都被纠」和「不被打断地把话说完」本质冲突，
混在一起会互相削弱。两边落库完全一致，所以错题本、`produced_count`、每日统计共用一套。

| | 逐句纠正（打字练） | 畅聊（开口聊） |
|---|---|---|
| 输入 | 打字，或浏览器语音识别 | 像打电话一样连续说，麦克风直接进模型 |
| 回复 | 文本，可点朗读 | 语音，首个音频包约 1.4 秒 |
| 纠正 | 和回复同时给出 | 说完之后异步补上，迟一两秒 |
| 用的模型 | Claude（tool-forcing 出结构化纠正） | StepFun `stepaudio-2.5-realtime` + Claude 旁路分析 |

畅聊的成本按音频时长计，和纯文本不是一个量级。跑起来后建议先盯几天用量。

## 首次生成会慢

每个环节的内容是当天第一次进入时用 AI 现生成的，实测冷启动耗时（本地代理 + claude-opus-5-max）：

| 环节 | 冷启动 | 命中缓存 |
|---|---|---|
| 新词 | ~60s | <10ms |
| 语法 | ~85s | <10ms |
| 听力 | ~35s | <10ms |
| 阅读 | ~100s | <10ms |
| 口语 / 写作 | ~30s | <10ms |

生成结果按「当天 + 环节」缓存，所以刷新页面、来回切环节都不会重复花钱。跑道还会在你做当前环节时
**提前生成下一个环节**，正常顺着做下来基本感觉不到等待；只有第一个环节要真等一会儿。

## 两件要知道的事

**没有登录。** 单人本地使用，用户固定 `id=1`，接口不做任何鉴权。默认只监听本机是安全的，
**放到公网之前必须先加一层认证**，否则任何人都能读写你的学习数据、并用你的 API key 调 AI。

**发音打分是"一致度"，不是声学分析。** Web Speech API 只返回识别出的文本，
所以打的分是"机器听到的词和目标句子有多接近"（LCS 对齐 + 编辑距离）。
它能可靠告诉你哪个词没被听清，但没法诊断"th 的舌位不对"。
另外 Firefox 不支持语音识别 —— 所有用到麦克风的地方都有打字兜底。

**畅聊有两条实测出来的硬约束**，和 StepFun 官方文档不一致，改之前先跑 `npm run probe:voice`：

1. 服务地址是 `/step_plan/v1/realtime`，不是文档写的 `/v1/realtime`（后者连不上）。
2. 不能开 `server_vad`。带上它之后服务端会静默丢弃 `input_audio_transcription`，
   拿不到学生原话的转写，教学闭环就断了。所以上游只能用手动 commit —— 但断句本身
   放在浏览器端做（`src/hooks/useVoiceChat.ts` 里的 VAD），交互上仍然是连续通话，
   不需要按住任何按钮。

约束写在 `src/lib/realtime/protocol.mjs` 的头注释里。`probe:voice` 用真实回合验证 ——
只测连通性说明不了转写还在不在。

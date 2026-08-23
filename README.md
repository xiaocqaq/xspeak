# 林习英语

每天 30 分钟，一个主题串起七个环节：热身复习 → 新词 → 语法 → 听力 → 阅读 → 口语 → 写作批改。
内容全部由 AI 按你的水平和兴趣现场生成，进度存在本机 SQLite。

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
| 数据库 | SQLite（better-sqlite3），手写 SQL + 薄仓储层 |
| 记忆算法 | FSRS（ts-fsrs），单词和语法点共用 |
| AI | Anthropic SDK，结构化输出用 tool-forcing + zod 校验 |
| 语音 | 浏览器原生 Web Speech API（朗读 + 识别），零成本 |
| PWA | 手写 manifest + service worker |

没用 ORM，没用 next-pwa —— SQL 和缓存策略都不复杂，自己写一遍反而说得清。

## 跑起来

```bash
npm install
cp .env.local.example .env.local   # 填 ANTHROPIC_API_KEY
npm run icons                      # 生成 PWA 图标（零依赖，手写 PNG 编码）
npm run dev                        # http://localhost:3000
```

首次访问会自动建表、播种内置词表（约 130 个 A1/A2 口语高频词）和 24 个语法点，
然后走引导页填水平/目标/兴趣。

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
| `npm run db:reset` | 备份并清空数据库（`-- --hard` 跳过备份） |
| `npm run smoke` | 端到端冒烟测试，打真实接口走真实 AI（`-- --fast` 跳过 AI 环节） |

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
│   ├── chat-panel.tsx    # 对话面板，口语环节和对话页共用
│   └── shadow-card.tsx   # 跟读打分
├── lib/
│   ├── ai/               # client（tool-forcing + 重试）、schemas（zod）、prompts
│   ├── db/               # 连接、DDL、播种
│   ├── repo/             # words / grammar / session / stats / mistakes
│   ├── scheduler.ts      # FSRS 封装
│   └── pronounce.ts      # 发音一致度打分
└── data/                 # 内置词表和语法点
```

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

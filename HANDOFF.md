# 交接：XLearn 界面改造 + 离线词典

> 2026-08-24 深夜因关机中断。`npx tsc --noEmit` 和 `npx next build` 均通过，代码处于可运行状态。
> 所有改动都未提交（`git status` 约 45 个文件）。

## 用户提的 6 条，完成情况

| # | 需求 | 状态 |
|---|------|------|
| 1 | 改名 XLearn | ✅ 完成 |
| 2 | 用数据库存词，不要每次查词都走 AI | ✅ 完成 |
| 3 | 畅聊改成打电话界面，不自动开麦，按钮收小 | ✅ 完成，未在浏览器验证 |
| 4 | 各阶段顶部去掉那段提示 | ✅ 完成 |
| 5 | 「今天这样走」做成侧栏，点击原地切换 | ✅ 完成（断点已调到 md）|
| 6 | 每个界面保持干净 | 🔄 进行中，只过了 warmup |

## 下一步（按优先级）

1. **在浏览器里验证第 3 条和第 5 条** —— 两者都只过了类型和构建，没看过实际效果。
   特别是打电话式待机屏、点接通后能否正常连上、宽屏下侧栏是否出现。
2. 跟用户确认 warmup 下半屏空白的解法（卡片居中 vs 卡片栈）。
3. 按第 6 条继续排剩下 6 个环节和 5 个页面。
4. 改动后跟一遍 `npm run smoke -- --fast`。

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
- **还没在浏览器里验证过**，这是下一步第一件事。

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

只重排了 `warmup`。剩下 6 个环节（newwords / grammar / listening / reading / speaking / writing）
和 5 个页面（vocab / stats / settings / grammar / import）只继承了新配色，版面还没逐个排。

共享件已经改好了，所以这些页面的选项列表、评分按钮、讲解块已经跟着变对：
- `Choices` → iOS 分组列表（一个容器 + 分隔线，不是四个独立方框）
- `RatingRow` → 半透明 fill 底 + 彩色文字，四档颜色各不相同
- `Explain` → fill 底无边框，去掉左侧彩色竖线
- `StageIntro` → 降成次级正文，无底色

**warmup 还剩一个没解决的问题**：下半屏大片空白。
试过用 `min-h` 撑满，那是错的（只是把空白从卡片下方挪到按钮上方），已撤掉。
根因是信息密度低（一屏一道题）。两个候选解法：卡片垂直居中（改动小），
或做成可滑动的卡片栈（更像原生，改动大）。等用户定。

## 环境状态

- 服务在 `http://127.0.0.1:3000`（`npm run dev` = `node server.mjs`），关机后需重启
- 数据库远程 PG `115.159.206.76:54321`，`dictionary` 表已有 768,739 条，重启不影响
- `ecdict.csv` 缓存在项目根，重跑 `dict:import` 会复用它不重新下载

## 验证命令

```bash
npx tsc --noEmit          # 通过
npx next build            # 通过
npm run smoke -- --fast   # 8 项通过（改动后还没重跑，建议先跑一次）
npm run db:check
```

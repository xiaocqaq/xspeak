# 交接：xspeak 界面改造 + 离线词典

> **2026-08-26 已上生产：`https://speak.xlingo.fun`**（项目改名 xspeak，跑
> `/opt/xspeak` + `127.0.0.1:3022`，全量 smoke 29/29）。测试站
> `test.xlingo.fun/xlearn`（:3021）并存。详见「生产部署：speak.xlingo.fun」。
>
> 2026-08-27 晚更新：**逐句朗读接入小米 MiMo TTS（第二路上游）**，设置页
> 音色改格子布局、系统语音包只留 12 个。见「MiMo TTS：第二路上游」。
> 分支 `feat/shell-layout-and-provider-config`，未 push。
> `npm run typecheck`、`npm run build` 通过（32 个路由）；
> **全量 smoke 29/29（218 秒，开着鉴权跑的）**，本地和公网入口各跑过一遍。
> 2026-08-27 加了逐句朗读的服务端音色（自建 Kokoro），smoke 多一条，
> `--fast` 现在 **12/12**（测试站 12.9 秒、生产站 12.4 秒）——
> 见「逐句朗读换成服务端音色」。
> **第二轮、第三轮各 6 条都已完成。** 线上 :3021 跑的就是含全部十二条的构建，
> 7 个页面 × 390/1440 两档实测无横向溢出、无 console 报错，
> 真实出题、真实查词、真实通话都验过。
>
> **鉴权 2026-08-26 已在线上打开**（接 `ai.xlingo.fun`，`xiaoxiao` 是管理员，
> 落在 `users.id=3`）—— 所以第三轮第 5 条的模型卡现在只有管理员看得见，
> 非管理员拿 403、未登录拿 401，两边都实测过。
> 用户放弃了 `users.id=1` 上的旧数据（原话「丢了也无所谓 没什么价值」），
> 所以没做档案接管。**线上也配好了三个模型**（content/chat/fast 各一个，见
> 「部署与环境状态」）。

## 第一轮 6 条，完成情况

> 下面这张表是**第一轮**需求。用户后来又给了一份 `要求.docx`（第二轮，带截图批注），
> 两轮的编号各自从 1 开始、内容不同，看的时候注意别混。第二轮见下一节。

| # | 需求 | 状态 |
|---|------|------|
| 1 | 改名 xspeak | ✅ 完成 |
| 2 | 用数据库存词，不要每次查词都走 AI | ✅ 完成 |
| 3 | 畅聊改成打电话界面，不自动开麦，按钮收小 | ✅ 完成，**已浏览器实测**（见下） |
| 4 | 各阶段顶部去掉那段提示 | ✅ 完成 |
| 5 | 「今天这样走」做成侧栏，点击原地切换 | ✅ 完成，**已浏览器实测**（390 / 1440 两档）|
| 6 | 每个界面保持干净 | 🔄 进行中，warmup 已排，其余只继承配色 |
| + | 鉴权（后加的） | ✅ 完成，**2026-08-26 已在线上启用**（xiaoxiao 是管理员，落在 `users.id=3`）|

## 第二轮 6 条（`要求.docx`，带截图批注）

原件在 `/root/.hermes-web-ui/upload/xiao/0cf0ca3f248e7402.docx`。

| # | 需求 | 状态 |
|---|------|------|
| 1 | 按截图改 newwords：加重复发音按钮、候选词竖排、中间栏排版、按钮固定在下方 | ✅ 完成，见下 |
| 2 | 语法/听力/阅读的材料做成弹窗，进入时默认弹出、手动关掉能再开；做题时题卡居中 | ✅ 完成，**已浏览器实测** |
| 3 | 去掉纠错与写作题型，改成单选或完型填空 | ✅ 完成，见下 |
| 4 | 口语与 AI 对话做成打电话式弹窗，只留「开始对话 / 挂断」，去掉文字输入与发送 | ✅ 完成，**已浏览器实测** |
| 5 | 首页的 AI 对话也换成同一个打电话弹窗 | ✅ 完成，**已浏览器实测** |
| 6 | 配置文件里配语音模型和多个普通对话模型的 baseurl/apikey/model | ✅ 完成，见下 |

用户拍板过的两点，实现时按这个来：

- **第 3 条只管新出的题**。原话「只要但新出的题只有单选/完型」—— 老库里的
  `fix` / 开放题不用清，渲染层继续容错就行。
- **第 6 条保留角色分工**。原话「保留角色分工，但每个角色可以从你配的那几个模型里挑一个，
  设置页能改」—— 所以不是「一个全局模型」，是 content/chat/fast 各挑一个。

**第 1 条那个「字段是不是真的缺」的疑点，答案是不缺。** 截图批注写「中间内容太少,
缺失词性, 单词理解, 辅助记忆等,并且排版杂乱」，但 `newwords.tsx` 当时已经在渲染
`pos`、`meaning_en`、`memory_hook_zh`、`collocations`。截图拍的是 hydrate 失败那阵的
旧构建（见「部署与环境状态」里子路径那段）。所以第 1 条实际做的是版面活儿，
没补任何字段。用户另外说过「我不需要2个喇叭 都换成正常的就行」，双喇叭已经删掉一个。

## 第三轮 6 条（口头报的 bug）

| # | 需求 | 状态 |
|---|------|------|
| 1 | 阅读做完点「去练口语」却跳到第一个复习 | ✅ 完成 |
| 2 | 复习/听力的正确选项总是第一个 | ✅ 完成 |
| 3 | 设置页的保存悬在中间，不在底部 | ✅ 完成，**已浏览器实测** |
| 4 | 听力是对话时能不能多音色 | ✅ 完成 |
| 5 | 设置页的模型展示只给管理员 | ✅ 完成，**已浏览器实测** |
| 6 | 兼容 OpenAI 协议的模型 | ✅ 完成 |

### 第 1 条：跳转找的是「第一个没做的」，不是「下一个」

`runner.tsx` 的 `onDone` 以前写的是 `STAGES.find((s) => !stagesDone.includes(s))`。
第一天没有到期复习，热身是空态、走过去也不算 done，于是阅读做完提交，`find`
从头扫又扫回热身 —— 按钮上写着「去练口语」，人被送回复习。

改成只在自己后面找：

```js
const rest = STAGES.slice(STAGES.indexOf(stage) + 1);
const next = rest.find((s) => !r.stagesDone.includes(s));
```

顺带修掉的：最后一环做完时，老写法也会回到热身而不是结束页。漏掉的环节留到
结束页统一提示（`setAllDone`），不在这里悄悄插队；侧栏和首页照旧能直接跳任意一环。

用逻辑复现过，四种情形：

| 情形 | 修好后 | 以前 |
|------|--------|------|
| 阅读做完、热身没做（用户报的） | speaking | warmup |
| 正常顺序走到阅读 | speaking | speaking |
| 只做了阅读 | speaking | warmup |
| 最后一环做完 | 结束页 | warmup |

### 第 2 条：在 `Choices` 里统一打乱

不是让 AI 换位置（提示词管不住，而且每次生成都得赌），而是渲染时打乱。
四个做题环节（warmup / grammar / listening / reading）都用 `shared.tsx` 的
`Choices`，所以只改这一处就全好了。

`answer` 存的是**选项原文**而不是下标（见 `schemas.ts`），所以打乱顺序不用同步改答案，
判对错仍然是 `opt === answer`。这也是当初把 answer 定成字符串的好处。

种子取选项拼起来的字符串（FNV-1a → mulberry32 → Fisher-Yates），所以：

- 同一道题每次渲染顺序一样 —— 重渲染、返回上一题、刷新都不会跳；
- 不同题目顺序不同。

`useMemo` 的依赖是 `raw.join('')` 而不是 `raw`：好几个调用点写的是 `q.options ?? []`，
每次渲染都是新数组，按引用比会白打乱一遍。

实测 4000 道「答案永远在第 0 位」的题，打乱后落点 24.6% / 24.6% / 25.2% / 25.5%；
两个选项的退化情形也不崩。

### 第 3 条：sticky 要当最后一个孩子

保存条本来就是 `sticky bottom-4`，但它上面还有兄弟节点跟在后面，
`sticky` 只在元素的流位置还在视口下方时才吸底 —— 位置被顶到中间，看着就是「悬在中间」。
把它挪成滚动列的**最后一个**子节点就好了。

实测（430×900 视口）：`position: sticky`、`bottom: 16px`、`是不是最后一个孩子: true`、
按钮落在 827–875px，文档高 3158px。

### 第 4 条：按说话人分嗓音

`schemas.ts` 的对话行加了个可选 `gender`（`'male' | 'female'`），让模型报每个角色的性别；
可选是为了老缓存 —— 它只会从 `required` 里掉出去，旧数据照样能读。

`useSpeech.ts` 新增 `buildVoiceCast(lines, voices)`：按出场顺序给说话人派系统语音包。
挑法分两步，先让报了性别的人各自去自己那一桶领，剩下的按女/男/不确定轮着发。
包不够分时**只动音高不换性别** —— 两个女生共用一个女声包、第二个换个音高，
听着像另一个女的，比给她派个男声对。`PITCH_TIERS = [1, 1.28, 0.78, 1.14]`，
第一个用某个包的人保持原样（好嗓音拉到 1.3 会又尖又假）。

`count` 只有 >1 才值得在界面上说「多音色」。实测五种情形：

| 情形 | 结果 |
|------|------|
| 两男两女、包够用 | 四个人四个包，都不动音高 |
| 两个女生、只有一个女声包 | 共用 Zira，第二个 pitch=1.28 |
| 老缓存没有 gender | 按女/男/不确定轮着发，三个人三个包 |
| 系统一个英文包都没有 | 都走默认嗓音，第二个靠音高区分 |
| 独白 | count=1，不声称多音色 |

### 第 5 条：模型卡只给管理员

真正的门在服务端：`/api/models` 的 GET 和 PATCH 都过 `requireAdmin()`。
前端 `session?.admin && <ModelsCard />` 只是不画出来，不算权限。

`AUTH_ADMIN_USERS` 认用户名或邮箱，不配就退回 `AUTH_ALLOW_USERS`（白名单本身就是自己人名单），
两个都空则**没有管理员**，谁都改不了，只能来 `.env.local` 改。
这里和白名单**相反**，空不等于全放行 —— 上游 ai.xlingo.fun 是邮箱自助注册，
「空=所有人」等于把全站模型设置交给任何注册用户。

顺带把 session 请求提到了 `SettingsPage` 这一层：账号卡和模型卡都要看同一份答案，
各自请求就多跑一趟。问不到时按「已登录、非管理员」兜（`admin: false`），
因为真正的门在服务端，画出来也只是点一下拿个 403。

鉴权没开时（单人模式）`admin` 恒为真，模型卡照常显示。

**线上开了鉴权之后 2026-08-26 实测过两边**：`AUTH_ADMIN_USERS=xiaoxiao` 时
session 回 `"admin":true`、`GET /api/models` 200；把它换成别的名字（白名单仍留
xiaoxiao）后 session 回 `"admin":false`、GET 和 PATCH 都是
`403 {"error":"只有管理员能改模型设置。","code":"forbidden"}`，未登录仍是 401，
而 `/learn`、`/settings`、`/api/words` 一切照常 —— 门只挡模型设置，不影响学习。

### 第 6 条：OpenAI 协议的兼容性

底子本来就有（`providers.ts` 的 `openaiProvider`、`AI_MODEL_*_PROVIDER=openai`），
这轮是拿一个假端点把它验了一遍，然后修了三个真问题。

**验的办法**：`scripts/mock-openai.mjs` —— 一个假的 OpenAI 协议端点。
拿真厂商验不了这件事（要钱、要 key，而且过了也可能是运气），
所以让假端点照请求里的 schema 现编合规数据，并且能装出各种兼容实现的毛病：

```
tool（默认）/ text-instead（声称支持 tools 却回纯文本）/ fenced（裹 ```json）
stringified（嵌套数组序列化成字符串）/ bad-json / http-401 / http-429 / http-500
newmodel（不认 max_tokens、只收默认温度）/ no-json-mode（不认 response_format）
not-openai（回一坨别的结构）/ picky（上面三样一起犯）
```

`GET /_calls` 能取回它收到的请求形状，`POST /_reset` 清空。
路径不以 `/chat/completions` 结尾一律 404 —— 故意严的，baseURL 拼错了要能看出来。

**结果**：4 种正常行为 × 2 种 `structured` × 11 个 schema，88 组全过；
16 个 schema 全部序列化成扁的（没有 `$ref`/`$defs`/`anyOf`），
这条重要 —— 兼容端点常常直接拒 `$ref`。重试策略也对：
401/404 打 1 次上游，429/500/坏 JSON 打 2 次（终态 4xx 不重试）。

**修的三个**：

1. **地址写坏了被报成「连不上」。** 少个 `http://` 时 fetch 抛 `ERR_INVALID_URL`，
   被按网络错误报出去，会把人送去查防火墙。现在 `openaiUrl()` 先解一遍，
   报「地址不像个网址：xxx（BASE_URL 要带上 http:// 或 https://，写到 /v1 为止）」。
2. **参数不兼容自适应**（真正的兼容性缺口）。「OpenAI 协议」不是固定的东西 ——
   OpenAI 自己的新模型（o 系列、gpt-5 往后）把 `max_tokens` 改成了
   `max_completion_tokens`、只收默认温度；llama.cpp 和不少中转没实现
   `response_format: json_object`。现在挨一个 400 就从错误里认出是哪个字段
   （只按**明确点名**的字段改，宽泛地"删几个再试"会把「模型不存在」「余额不足」
   掩盖成一串莫名重试），记进进程级 `quirks` 缓存，之后同一个模型直接按改过的形状发。
   配置里不用为每个模型写开关。
3. **报错能看懂了。** `fetch failed` → 「连不上 https://xxx：ECONNREFUSED」（只留 origin，
   有的网关把凭证编在路径里）；JS 原生的 `Expected ',' or ']' ... at position 11`
   → 「模型返回的不是合法 JSON（…）：<前 160 字>」；回复里没有 `choices`
   → 「可能不是 OpenAI 协议的端点」，指向配置而不是让人怀疑模型。

自适应实测（`picky` 三样毛病一起犯）：第 1 次生成打 4 次上游就成了，
第 2 次只打 1 次（缓存生效）。循环上限是 `QUIRKS.length`，加新毛病要同时改
`applyQuirks` 和 `sniffQuirk`，别写死数字。

**没动的**：`catalogEntry` 里 `AI_API_KEY` / `AI_BASE_URL` 的跨协议回落。
一个网关同时供两种协议（xlingo.fun 就是）确实想让 anthropic 和 openai 两个条目
共用一份 key 和地址；启动日志会打印每个角色解析后的 origin，配错了看得见。

**只说 Chat Completions，不碰 Responses API**（用户 2026-08-26 问过
「deepseek-v4-flash 应该用 chat/completion 协议，response 协议可能不通」）。
`openaiUrl()`（`providers.ts:163`）是唯一拼 URL 的地方，`BASE_URL` 写到 `/v1`
或直接写到 `/chat/completions` 都收；全仓库没有 `/responses`、`responses.create`、
`input_text`、`output_text`，也没装 `openai` 这个包。
不止是读代码 —— 用一个记录端点抓过真实出站请求，纯文本是
`POST /v1/chat/completions` 带 `[max_tokens, messages, model]`，
结构化多 `tools`+`tool_choice` 且不带 `response_format`。
真端点上 `deepseek-v4-flash` 结构化回 `{"word":"hello","ok":true}`、纯文本回 `"OK"`，
`quirks` 一次都没触发，说明它的实现是标准的。

**`deepseek-v4-flash` 是推理模型**，token 先花在 `reasoning_content` 上再出正文。
预算给太小（试过 16）会 `finish_reason: "length"` 而正文为空，看着像端点坏了。
app 实际给 4096（结构化）/ 1024（纯文本），够用；以后想收紧预算要记得它比非推理模型吃 token。

### 顺手修的：`shared.tsx` 里有两个 NUL 字节

在一句 JSX 注释里（删双喇叭那次留下的）。构建和 `tsc` 都不报错 —— 它在注释里 ——
但 `file` 把这个文件认成 `data`，于是 **grep 整个文件永远返回空**。
找第 2 条的打乱逻辑时被这个卡了几轮。已经去掉，现在是正常的 UTF-8。
以后 grep 某个文件一无所获又不合理时，先 `file` 一下。

### 第 1 条做了什么（newwords 版面）

纯版面，一个字段都没加（原因见上）。`stages/newwords.tsx`：

- **候选词竖排一列**（:76）。原来是横着 `flex-wrap`，长短不齐的词挤成一堆碎块，
  换行位置还跟着窗宽跳。改成一行一个、左边缘对齐。
- **卡片高度写死一档** `min-h-[26rem]`（:138）。翻开前后内容差好几行，不定高的话
  按钮排会往下窜。
- **喇叭只留正常的那个**（:143 词头、:182 例句）。用户原话「我不需要2个喇叭
  都换成正常的就行」—— 原来词头旁边有慢速和正常两个，删了慢速那个。
  搭配 chip 是整块可点朗读（:34），不再往 chip 里塞按钮。
- **按钮排固定在下方**：`max-xl:sticky max-xl:bottom-0`（:253）。只在窄屏钉住，
  宽屏本来就一屏看得见，钉住反而多一道横线。

一个已知残留：宽屏上翻开卡片时高度 416px → 558px，按钮排往下挪约 142px。
`min-h-[26rem]` 吃掉了一部分。彻底修得把卡片定高 + 内部滚动，还没做。

### 第 2 条做了什么（材料进弹窗，题卡居中）

新增两个共用件，语法/听力/阅读三个环节都换过去了：

| 文件 | 作用 |
|------|------|
| `components/sheet.tsx` | `useSheetBehavior(open, onEscape)` —— 锁背景滚动 + Esc 关闭。两种弹窗共用，避免「有的弹窗按 Esc 有反应有的没有」 |
| `stages/shared.tsx` | `useMaterialSheet()`（初始 `true` = 进来默认弹）、`MaterialSheet`（带关闭叉）、`MaterialButton`（关掉后再打开）、`CenterColumn`（题卡居中） |

要点：

- **默认弹出、关掉能再开、不记住状态**。`useMaterialSheet` 的初始值就是 `true`，
  关闭只是设回 `false`，故意不留「看过就不再弹」的记忆 —— 记住状态会让
  「再打开」这个按钮时有时无。换一批材料要重新弹，靠调用处换 `key`。
- **`MaterialSheet` 关着时 `return null`**。所以把 `fixed inset-0` 的弹窗放进
  `space-y-*` 容器里是安全的：Tailwind v4 的 `space-y-*` 用 `:not(:last-child)`，
  开着的弹窗永远是最后一个子节点，不会给自己加外边距。
- **题卡居中由 `CenterColumn` 给宽度上限**（`--content-w`）。`/learn` 外层原来自己排
  两列、不套上限，材料搬走之后剩一列会贴在左边。

### 第 3 条做了什么（全部改成四选一）

语法原来有改错（`fix`）和中译英（`translate`），阅读原来是开放式问答 —— 都要自己写
英文再跟参考答案对照、**自评**对错。现在这三样全没了，语法/听力/阅读一律四选一，
**机器判**对错，错题本记的是真选错的那一项。

| 文件 | 改了什么 |
|------|----------|
| `src/lib/ai/schemas.ts` | 提了个共享的 `CHOICE_FIELDS`（`options` 定长 4、`answer`、`explain_zh`）和 `ChoiceQuestion`；`GrammarExercise.kind` 从 `choice/fix/translate` 收成 `choice/cloze`；`ReadingPayload.questions` 从开放问答换成 `ChoiceQuestion` |
| `src/lib/ai/prompts.ts` | 语法规则 2–4、阅读规则 3–5 重写。**干扰项那条是关键** —— 不写死的话模型会给三个明显不可能的选项，题就废了 |
| `src/components/stages/grammar.tsx` | 按 `options.length >= 2` 分支，不按 `kind` |
| `src/components/stages/reading.tsx` | 去掉 `Textarea`，改 `Choices` + 交卷时统一判分 |
| 4 处错题类型枚举 | 加了 `'reading'`：`stages/types.ts`、`api/review/route.ts`、`repo/mistakes.ts`、`stats-page.tsx` |

几个当时的判断：

- **老题不清库，靠渲染层容错**（用户拍板「只管新出的题」）。`getStageContent` 是
  `r.payload as T`，**不重新过 schema**，所以今天之前生成的老形状照样会渲染到组件里。
  两个组件都把类型放宽了（`Omit<…> &` 加回老的 union 成员、`options` 改可选）。
  语法老题继续走「自己写 + 自评」；阅读老题只能看参考答案、**不给输入框**了 ——
  这样不迁移数据也满足了「不再保留文字输入」。
- **为什么分支看 `options.length` 而不是 `kind`**：`kind` 只用来显示标签，
  真正决定怎么答的是有没有东西可选。这样新题（`cloze`）和老题（`fix`）都不用在
  控制流里列举一遍，以后再删 kind 也不牵动这里。
- **为什么约束写在 `.describe()` 里而不是 `.refine()`**：`generateJson` 重试两次，
  但**不会把校验错误喂回 prompt**，只是重新摇一次。这台机器出题要 28–45 秒，
  硬校验失败等于整个环节废掉。听力一直是这个形状、没加硬校验、线上没出过问题，
  所以照它写。
- **`mistakes.kind` 是 `TEXT`**，加枚举值不用迁移。加 `'reading'` 是因为阅读现在能
  判对错了，不记就跟听力（一样的机制、一直在记）不对称。

实测（2026-08-25，真实出题各一次）：语法 5 题全四选一、`choice`/`cloze` 都有、
答案都在选项里、`cloze` 题干都带 `___`；阅读 3 题、听力 4 题同样全部合规；
**三次都是一次过，零重试**。干扰项也确实是「文里像说过其实没说」那种。

### 第 4、5 条做了什么（打电话式弹窗，首页也一样）

**文字聊天整条路没了。** `components/chat-panel.tsx` 已删（`git status` 里是 `D`），
输入框、发送键、`Textarea` 那一套都跟着走。历史记录还想看，所以另起了一个
`components/chat-transcript.tsx`，只读，装在材料弹窗里。

| 文件 | 作用 |
|------|------|
| `components/call-sheet.tsx` | 通话弹窗外壳。**没有关闭叉、点遮罩不关**，Esc 接挂断 |
| `components/voice-chat-panel.tsx` | 通话里面：状态行 + 字幕 + 底部一个挂断 |
| `components/voice-chat-launcher.tsx` | 拉配置、报错/加载态，每种态都自带一个挂断的出口 |
| `components/chat-page.tsx` | 场景卡改成 `card-interactive` 的按钮，点一下直接拨；历史走 `ChatTranscript` |
| `components/dashboard.tsx` | 首页新增「跟 AI 说两句」，同一套 `CallSheet` + `VoiceChatLauncher` |

`CallSheet` 和 `MaterialSheet` 刻意不一样的两点，注释里也记着：

1. **没有关闭叉、点遮罩不关**。里面正开着麦克风和一条 WebSocket，误触关掉等于
   半句话被掐断。挂断只能走那个红按钮。Esc 例外 —— 那是有意识的按键，不是滑一下手指。
2. **高度写死一格**（`h-[92dvh]` / `sm:h-[min(40rem,88dvh)]`）而不是随内容长。
   字幕一句句冒出来，跟着内容长会让挂断按钮一直往下跑，人得追着点。

**第 5 条其实是"加"不是"改"** —— 首页原来没有 AI 对话入口，练口语得先进「AI 对话」页
挑个场景，多两步。首页这个入口不挑场景：话题直接取今天的主题、目标词带今天的新词，
`dial()` 拼出的 `StartConfig` 和从对话页拨过去是同一套记账（说出口就算 produced）。
想练特定场合的走 ghost 的「挑个场景」跳到 `/chat`。目标词只带前六个 ——
带满 11 个会把头部撑到 205px，而且一通闲聊里 AI 谁都带不到。

实测过程中挖出两个真 bug，都已修：

1. **严格模式下自动接通根本没连上**（会带到线上）。`voice-chat-panel.tsx` 原来用
   `startedRef` 挡住第二次 effect，但第一次的 cleanup 已经 `vc.stop()` 了 ——
   开发环境一进弹窗就是「通话已结束」+ 0:00。**start / stop 必须写在同一个 effect 里
   成对出现**，让第二次正常重连。不漏连接是因为 hook 里 `connect()` 每次都先关掉上一条
   ws，并用代次（`genRef`）把旧连接迟到的回调挡在外面。
2. **`idle` 是个死胡同**（线上可达）。底部那个重接按钮原来 gate 在 `status === 'error'`，
   但上游把连接干净地关掉时状态回的是 `idle`（`useVoiceChat.ts:584`），那时候只剩挂断
   一个按钮，人得挂断再从页面重新拨。改成 gate 在 `!live`，且不在通话中时挂断按钮变
   `outline`。

**浏览器实测结果**（开发预览 :3064 和重新构建后的线上 :3021 各跑一遍，1440 / 390 两档）：
弹窗无关闭叉、`bodyLocked: true`、通话中按钮恰好只有 `["挂断"]`（断线后是
`["开始对话","挂断"]`）、**整个文档 `textInputs: 0` / `sendBtns: 0`**、Esc 和挂断键都能
挂断并解锁滚动、重拨正常、计时器 0:01→0:13 且状态走到「在听你说…」。
只读历史弹窗是另一个 `MaterialSheet`，有关闭叉、按钮是 `["关闭"]`。
首页拨出去的通话事后在 `/chat` 历史里显示为 `随聊 · 描述一道你会做的菜`，
说明首页拼的配置真的到了 `/api/chat`。

顺手统一了口径：用户能看见的「畅聊」全改成「通话 / 打电话」
（`settings-page.tsx` 5 处、`ai/config.ts` 的角色说明、`site-nav.tsx` 的 hint）。
代码注释和标识符里的「畅聊」保留。`/api/chat` 里回文字的那条分支（`role: 'chat'`）
服务端还在，只是 UI 上到不了了，**故意留着**。

### 第 6 条做了什么（可配置的模型清单）

思路：`.env.local` 里列一份**可选清单**，设置页只能在清单里挑。
地址和密钥**始终留在服务端**，前端拿不到也换不了。

```
AI_MODELS=claude-opus-5,gpt-5.6-sol,deepseek-v4-flash
AI_MODEL_GPT_5_6_SOL_PROVIDER=openai
AI_MODEL_GPT_5_6_SOL_BASE_URL=https://…
AI_MODEL_GPT_5_6_SOL_API_KEY=…
AI_MODEL_GPT_5_6_SOL_MODEL=gpt-5.6-sol      # 真正发给上游的名字，默认等于 id
AI_CONTENT_MODEL_ID=claude-opus-5           # 角色默认挑哪个
```

`{ID}` 是 id 里非字母数字换成下划线再转大写：`gpt-5.6-sol` → `GPT_5_6_SOL`。
优先级：**设置页存的选择 > `AI_{角色}_MODEL_ID` > 老的角色变量 > 内置默认**。
完整变量表在 `.env.local.example` 的「用法 D」。

新增的文件和表：

| 位置 | 作用 |
|------|------|
| `src/lib/ai/config.mjs` | 加了 `modelCatalog()` / `resolveModel(role, id)` / `defaultModelId()`。**同步、只读 env** |
| `src/lib/ai/selection.ts` | 异步那一层：读库拿选择，再交给 `resolveModel`。应用代码走 `modelForRole(role)` |
| `src/lib/repo/settings.ts` | `app_settings` 的读写，故意不缓存 |
| `src/app/api/models/route.ts` | GET 返回清单 + 三个角色 + 语音现状；PATCH 换某个角色的模型 |
| `app_settings` 表 | 键值对，现在只存 `model.content` / `model.chat` / `model.fast` |

几个当时的判断，改之前先看一眼：

- **为什么 `config.mjs` 必须保持同步**：`server.mjs` 启动时调 `describeModels()`，
  它在 Next 编译管线外边，没法 await 一次查库。所以配置解析留在同步层，
  查库那一层单独放 `selection.ts`。`describeModels()` 也因此**故意不读库** ——
  它回答的是「`.env.local` 写对了吗」，混进库里的选择就说不清了。
- **`AI_MODELS` 是白名单，不只是清单**。模型 id 是从浏览器传上来的，
  所以清单外的 id 一律不当模型名用：警告一次然后回落角色变量。
  `setRoleModel` 还会拒掉「清单里有但没配 key」的。smoke 里有这条负例。
- **这是全站设置，不是个人设置**。存在 `app_settings` 而不是 `users` 上，
  因为它跟着的是运维配的那份清单和密钥 —— 换模型影响所有人的账单和出题质量。
  代价是「一个人改，所有账号都变」，界面上写了「对所有账号生效」。
  真要分权限得先有角色概念，现在没有。
- **语音那半边本来就做完了**。`src/lib/voice/config.mjs` 早就在读
  `VOICE_PROVIDER` / `VOICE_API_KEY` / `VOICE_REALTIME_URL` / `VOICE_REALTIME_MODEL` /
  `VOICE_TTS_URL` / `VOICE_TTS_MODEL` / `VOICE_ASR_MODEL` / `VOICE_DEFAULT_VOICE`
  （StepFun 默认值 + 老的 `STEP_*` 回落）。所以设置页里语音块是**只读**的：
  realtime 一次通话要连着上游，中途换模型没有意义。

验证到哪一步了：`typecheck` / `build` 过；smoke 在两种配置下各 10/10
（没配 `AI_MODELS` 走跳过分支、配了三个模型走完整往返）；换模型的库往返在单元层
证过（没选→默认 / 选了 haiku→haiku / 清掉→回落 / 清单外被拒），测完把库里原值还回去了。

**`ModelsCard` 后来补了浏览器实测，挖出一个真 bug。** 线上没配 `AI_MODELS`，
所以那台实例上这张卡片只走空态分支 —— 要看选择器得另起一个实例把清单喂进去：

```bash
# 只写 AI_MODELS 一行就行，anthropic 那几项会回落到已有的全局 key
setsid env -u ANTHROPIC_BASE_URL -u ANTHROPIC_API_KEY -u ANTHROPIC_MODEL \
  PORT=3057 HOST=127.0.0.1 NODE_ENV=production \
  AI_MODELS='claude-opus-5,claude-haiku-4-5-20251001,deepseek-v4-flash' \
  AI_MODEL_DEEPSEEK_V4_FLASH_PROVIDER=openai \
  AI_MODEL_DEEPSEEK_V4_FLASH_BASE_URL=https://api.deepseek.com/v1 \
  nohup node /tmp/xlb/server.mjs --prod > /tmp/xl-3057.log 2>&1 < /dev/null &
```

**bug：`PATCH /api/models` 少回一个 `voice`，一点换模型整张卡片就炸。**
前端是 `setData(await apiPatch(...))` —— 整个状态换成响应体，而 `PATCH` 以前只回
`modelSettings()`（`catalog` + `roles`）。于是语音那一块读 `data.voice.ready` 抛
`TypeError: Cannot read properties of undefined (reading 'ready')`，卡片整块从 DOM 上消失，
**而库其实已经写成功了** —— 表现是「点一下没反应，还把页面弄坏了」。
已把响应体抽成 `payload()` 给 `GET`/`PATCH` 共用（`api/models/route.ts`）。

smoke 原来没拦住它，两个原因都补了：它只断言了 `after.roles`，没看 `after.voice`；
而线上没配 `AI_MODELS`，那一整段换模型的往返被跳过了。现在 smoke 会比
`PATCH` 和 `GET` 的字段集是否一致。

选择器本身是好的（1440 / 390 两档、`hSpill: 0`、无 console 报错）：三个角色各一行，
每行的选项是「跟配置文件 + 清单里每一个」，`AI_MODEL_*_LABEL` 的显示名生效
（`Opus 5（质量优先）`），没配 key 的项列出来但 `disabled` 并标「缺 key」。

## MiMo TTS：第二路上游（2026-08-27 晚）

用户给了 key，要求朗读接入小米 MiMo（文档 mimo.mi.com/docs/zh-CN/api/audio/tts），
**主要用在阅读/听力/口语** —— 这三个环节的出声全部走 `/api/speak`，所以
接在服务端朗读层上就等于全覆盖；口语环节的「打电话」是另一条 realtime 链路，
没动。设置页同时重排：音色格子化（每行 4 个）、系统语音包只留前 12 个。

### 接口形态（和 Kokoro 完全不同，别照搬）

MiMo 走 **chat/completions**：要合成的文本放 `role=assistant` 消息里，
音频 base64 回在 `choices[0].message.audio.data`。实测 assistant 消息单独就能
合成（user 消息可选），但带上朗读风格指令长句停顿更自然，所以留了一条。
模型 `mimo-v2.5-tts`（另有 voiceclone/voicedesign，没用）。**没有语速参数** ——
合成恒为常速，语速档位由前端 `audio.playbackRate` 兑现，所以 MiMo 的合成
速度恒按 1.0 进缓存键（换档位不重新花钱），倍速公式在
`server-voice-list.playbackRateFor`，**useSpeech 的 speak/previewServerVoice
里各有一份同式拷贝（audio 拿不到响应头），三处必须一起改**。
响应头 `x-tts-playback-rate` 给 smoke/排障用。

实测延迟（2026-08-27）：短句 1.7s、长句 3.3s —— 比 Kokoro（3.3s/13.4s）快
一倍起，云端推理不吃本机 CPU。错误形态：未知音色 400 + Available voices 列表。

### 文件分工

| 文件 | 作用 |
|------|------|
| `src/lib/tts/server-voice-list.ts` | **纯数据层（客户端可 import）**：音色表、分组、provider/gender 判断、倍速公式 |
| `src/lib/tts/server-voices.ts` | 合成入口 `speakWithProvider`/`serverTtsEnabled`（import 了 node:fs，**只许服务端引**） |
| `src/lib/tts/mimo.ts` | MiMo 客户端：chat/completions + base64 解码 + 磁盘缓存（复用 kokoro.ts 的 cacheKey/读写） |
| `src/app/api/speak/route.ts` | 唯一出口不变；白名单收两家的音色；MiMo 语速归一由 `synthSpeed` 处理 |

**为什么拆出 server-voice-list.ts**：设置页（客户端组件）要拿分组表画格子，
原来放 server-voices.ts 时它把 kokoro.ts（node:fs/promises）追进了浏览器
chunk，Turbopack 直接报 `does not support external modules` 构建失败。
纯数据（无 node 依赖）和合成（node 依赖）必须分文件。

### 音色与缓存

- MiMo 4 个英文音色：Mia/Chloe（女）、Milo/Dean（男），设置页标「MiMo · 母语发音（快）」排在最前。
- **缓存键算法没动**：`cacheKey(text, voice, speed)` 两家共用一个磁盘目录，
  同一句话换音色只是键不同。顺手把 kokoro.ts 里模板串的字面 NUL 字节改成
  `\u0000` 转义 —— 产出哈希逐字节一致（缓存不作废），但 grep 从此能搜这个文件。
- 老收藏的 Kokoro 音色全部照旧：路由白名单 = MiMo 4 个 + 展示表 + `KOKORO_ALL_VOICES`。
- 默认音色换成 `Mia`（`DEFAULT_SERVER_VOICE`）。**用户存过的偏好不受影响**
  —— 没选过服务端音色的照旧走浏览器语音包。

### 听力分嗓音（多人对话）

`buildServerVoiceCast`（useSpeech.ts）：说话人→服务端音色，性别对上优先，
MiMo 桶在前、Kokoro 桶兜底。实测六人对话分到 6 个不同嗓音
（Mia/Milo/Chloe/Dean/af_heart/am_michael）。listening.tsx 的两处 speak 现在
传 `kokoroVoice: serverCast.get(speaker)`，speak() 内部服务端不可用时自动
退回浏览器语音包那条路（buildVoiceCast 的 cast 照旧备着）。

### 设置页

- 音色改格子：`VoiceCell` 组件，`grid-cols-2 sm:grid-cols-4`（手机 2 个防挤爆）。
- 系统语音包只列 `rankEnglishVoices` 前 12（4×3）；**用户存过的选择不在前 12
  时单独补进来**（挤掉第 12 名），隐藏数在下方一行小字说明。
- 试听抓包要用 `HTMLMediaElement.prototype.play`（HANDOFF 旧坑再现：
  钩 fetch 没用，audio.src 是浏览器自己发的）。

### 实测（2026-08-27，测试站 :3021）

- HTTP：Mia 未命中 2.6s 出 37KB 合法 mp3 → 再请求 15ms `hit` 字节一致；
  slow=1 回 `x-tts-playback-rate: 0.80` 且缓存键不变（hit）；
  Range 206 正好 100 字节、304、HEAD 200/404、未知音色 400、超长 413、未登录 401；
  af_heart 照旧走 Kokoro（3.5s）；zf_xiaobei（老白名单中文音色）也通。
- 浏览器（CDP 无头 + 真实登录态）：1440 下 MiMo 组 4 列、卡名
  米娅/克洛伊/米洛/迪恩齐全；试听米娅 `audio.src` 确为
  `/api/speak?...&voice=Mia`；390 窄档每行 2 列无横向溢出；console 报错 0。
- `--fast` smoke 12/12（本机 11.3s）。
- 分嗓音单测：两人 Milo/Mia，三人 Mia/Milo/Chloe，无性别 Mia/Milo，
  偏好 Mia 时女性说话人拿 Mia，六人 6 个不重样。

### 生产（/opt/xspeak）已于 2026-08-27 晚发出

- 代码已 tar 同步 + 独立 build（`NEXT_PUBLIC_BASE_PATH` 为空的那套产物），
  `/opt/xspeak/.env.local` 已加 `MIMO_TTS_KEY`（600）。`systemctl restart xspeak`
  生效，smoke 12/12、四音色、设置页格子浏览器验证全过。
- **发产前先 `systemctl stop xspeak`**：unit 是 `Restart=always`，不停的话构建
  中途旧进程会被自动拉起来抢内存 —— 这台机器上早停一次后 earlyoom 直接把
  第一次 build 杀了（exit 143 SIGTERM，journalctl 可见 "badness 832"）。
  构建时把两站都停掉、空出 ~2GB 再跑。

## 长句退回系统语音的修复（2026-08-27 深夜）

用户反馈：听力/阅读还是系统语音，怀疑超时太短。排查出**三个叠加原因**，全修在
`src/hooks/useSpeech.ts`（服务端不动）：

1. **阅读根本没走服务端**：`/api/speak` 限 300 字符，「朗读全文」几百上千字符，
   前端一看超限直接走浏览器语音包，请求都不发。→ 新增 `splitSpeechChunks()`：
   按句边界切块（每块 ≤300、总量 ≤1200），一块块经 `<audio>` 接力播；`canServer`
   的否决条件从 `<=300` 放宽到 `<=1200`。某块失败/超时就把它后面的块拼给系统语音，
   `isContinuation` 保证中段交棒不抢 onEnd。预热（`startWarm`）：当前块开播时用
   fetch 提前合后面最多两块（写盘缓存），**上限 2 个并发** —— 这台机器实测 10 并发
   能把 Kokoro 全部压到 502。
2. **700ms 预算对冷合成必超时**：MiMo 一句话要 1.5–4s。→ 改三级：
   `serverTtsBudgetMs()` 按文本长度和场景分档 —— ≤120 字符仍 700ms（单词例句要极速）；
   更长 4500ms；显式指派音色的听力台词 9000ms。看门狗逐块重新武装（阅读第一块常是
   短标题，不能让整篇跟着吃 700ms）。等待期间提前 `setSpeaking(true)`，按钮脉冲就是
   「正在生成」的提示。
3. 注释里写了的连播预取（SEQUENCE_PREFETCH）从来没实现过 —— 死常量已删。

验证：tsc 0 错；`splitSpeechChunks` tsx 单测 6 组（1046 字符切 4 块不丢字、无标点
硬切兜底、中文句号）；smoke 12/12 ×2（测试服+生产）；设置页试听/格子无回归
（verify-grid.mjs 两站 console 报错 0）；bundle 里确认 9e3/4500/700 分档与切块
函数已编译进客户端 chunk。两站均已发（测试 :3021 手动 env-un 命令起；生产
systemd）。

### 听力预热 + 预算阶梯化（2026-08-28 凌晨，已两站重发）

前情（二修，已含在当前版本里）：fallbackFrom 曾把超时块本身漏掉导致单块
朗读静音（现从 slice(i) 起兜底）；buildServerVoiceCast 表键小写 vs 调用方
原始大小写导致听力全走本地（现 Map 出口 get/has 归一化，写错大小写也不炸）。

用户要求：①听力并发提前请求 TTS，播放时不卡顿；②超时分档改为 ≤20 字符
700ms、其余 2s；③随后补充「大段文本 2s 不够，适当加长或分批」。

1. **整段对话预热**：`useSpeech.ts` 新增共享预热队列（模块级，并发上限 2 ——
   这台机器扛不住更高并发）+ 导出 `warmServerSpeech(lines, paceKey)`。
   `listening.tsx` 挂载时（useEffect [speakerKey]）就把全部台词按分好的嗓音
   排进队列，材料弹窗弹出的几秒正好热完。响应体用 `arrayBuffer()` 读到底，
   否则连接中断服务端缓存写不完整。播放链路的 startWarm 也改成走同一队列
   （startWarmImmediate 插队），不再裸 fetch 双轨。pace 变化不重热：
   不同档位的 Kokoro 键不同会自然 miss，走超时+兜底。
2. **预算阶梯**：≤20 字符 700ms；其余 2000ms 起步、每满 100 字符 +1000ms、
   封顶 6000ms（`serverTtsBudgetMs`）。150 字符台词 =3s、300 字符大块 =5s、
   更长的封顶 6s。因为大块已由 splitSpeechChunks 分批到 ≤300，每块预算
   都落在 2–5s 区间，配 MiMo 实测耗时是够的。

验证（两站同法）：进听力**不点播放**，20s 后逐句探测 `/api/speak`
（与预热完全相同的 text+voice+pace），四句全部 `x-tts-cache: hit` ——
预热确实在挂载时发生且参数一致；点「播放对话」四句 Mia/Milo 交替、
console 0 错；smoke 12/12 ×2。生产探测脚本注意 basePath：测试站
`/xlearn/api/speak`、生产 `/api/speak`（probe 里按 location.pathname 判断）。

## 通话「试试这样说」提示（2026-08-28，开口前提示版，已两站重发）

用户要求：通话时**轮到学生开口之前**就给他下一句提示（v1 是说完才出，被否了），
且可手动关闭。

**独立快路，不搭纠错的车**：提示和回合后的教学分析（`/api/realtime/coach`，
要落库+完整分析，天然晚一两秒）彻底分开，走自己的 `/api/realtime/tip` ——
不写任何库，两次小查询 + fast 模型一次调用，只产一句中英文提示。
两条路并行跑、互不等待，纠正链路（coaching.ts/prompts.ts）已摘掉 tip 字段。

**触发时机是关键设计（relay.mjs）**：fast 角色是推理模型（deepseek-v4-flash），
一次 tip 实测要 5-11s —— 等话说完才发，提示就永远追不上对话节奏。所以
`response.audio_transcript.delta` 里 AI 的转写**刚凑出一句完整的话**
（≥30 字符 + 句末标点）就提前发请求，提示生成与后面好几秒的语音播放**重叠**，
学生听完、还没想好怎么接的时候提示已经在界面上。回合结束时 `tipFired`
没置位才补发（很短的回应走这条路）。回合序号 `turnNo` 对不上就丢弃结果，
慢响应绝不倒退覆盖新提示。

链路：`TipPayload`（schemas.ts，独立于 CoachingPayload）→ `tipPrompt`
（prompts.ts，「AI 刚说 X，给一句学生能照着说的接话」）→ `tip/route.ts`
（不落库、maxTokens 2000 —— 推理模型思考就要 ~700-1000，给 160/320 实测
两连截断，这是 v1 失败的直接原因）→ relay `fetchTip`（提前发 + turn 对版）→
`useVoiceChat` case 'tip' → 面板提示卡（英文+朗读+中文，X 关闭，学生开口后
卡片淡化 50%，旧提示保持可瞄）。

关闭是**通话级**的（tipsOffRef，挂断重拨恢复显示），不落库。
验证：静态断言 18/18；两站真实 POST `/api/realtime/tip` 都返回了贴情境的
提示；smoke 12/12 ×2；bundle 确认提示卡编译进客户端 chunk。
真机验证要点：AI 开口后提示应在语音播完前后出现；点 X 后这一通不再出现。

### fast 角色换 gpt-5.6-luna（2026-08-28，已两站生效）

tip 实测把 deepseek-v4-flash 的真面目暴露了：它是推理模型，一句提示也要先
思考 600-1000 tokens，5.6-11.4s 才出结果。切到 gpt-5.6-luna 后：

- tip：2.0s 稳定（无推理 tokens，out=54 只有答案本身）
- 纠错 emit_coaching：2.2s（原来 8.4-17s）
- 输出成本 ~1/10

**改动只有两处，都不是代码**：
1. `.env.local` 的 `AI_FAST_MODEL_ID=gpt-5.6-luna`（两站）
2. **`app_settings` 表的 `model.fast` 覆盖值** —— 这是踩过的坑：设置页存的选择
   在库里，压过环境变量。只改 .env 不改库 = 白改（启动横幅显示 luna，
   日志照样 deepseek-v4-flash）。两站共用一个 PG，改一次即可：
   `UPDATE app_settings SET value='gpt-5.6-luna' WHERE key='model.fast';`

协议说明：luna 走的是网关的 `/chat/completions` 通道（和 chat 角色同一条），
不需要 /responses 适配层——xiao.xlingo.fun 网关已经把协议翻译好了。
若未来要用「仅 /responses」的通道（如 nayutoai 的 gpt-5.6-sol），才需要在
providers.ts 加 openai-responses provider（choices→output[] 适配，~100 行）。

luna 的 reasoning_effort 不可调（中转站不透传），好在它本来就不思考，
正是 fast 角色要的性质。

### openai 协议改为 Responses（2026-08-28，已两站重发）

用户定的方向：`openai` 应该指 GPT 系原生的 **Responses 协议**（/responses），
chat/completions 保留为显式的 `openai-completion`。

- providers.ts 新增 `responsesProvider`（~200 行）：端点 /responses、
  `instructions`/`input` 字段、`max_output_tokens`、`tool_choice:{type:'function',name}`；
  返回解析 `output[]`（reasoning/message/function_call 三种条目各取各的）；
  截断信号是 `status=incomplete` + `incomplete_details.reason`；
  usage 从 `input_tokens/output_tokens/output_tokens_details.reasoning_tokens` 取。
  `getProvider`：`openai`→responses，`openai-completion`→旧 openaiProvider。
- config.mjs `parseProvider`：`openai`/`responses`→openai；`openai-completion`
  /`openai-compatible`/`oai`/`compatible`→openai-completion（历史别名沿用旧语义，
  **deepseek-v4-flash 配的是 openai-compatible，行为不变**）。
  DEFAULT_MODELS 补 `openai-completion` 条目（老路径回落用，缺了会崩）。
  StepFun key 回退条件从 `provider==='openai'` 放宽为只看 URL。
- **网关注意**：xiao.xlingo.fun 的 /responses 通道会给模型注入一段 Codex
  系统前缀（「You are Codex, a coding agent…」），和我们的 instructions 拼接。
  实测不影响结构化输出；若哪天模型行为怪异（爱写代码、拒绝闲聊），先查这个。

实测（两站）：tip 2.0-3.3s（tool call + schema 校验正常）、coach 纠错 4.5s、
chat 文字对话（sol，17.5s，本来就慢）全部正常；smoke 12/12 ×2。
日志识别：`openai-responses/<model>` = Responses 通道，`openai/<model>` =
completion 通道。

**排查坑**：改完 providers.ts 必须 `npm run build` 才生效 —— server.mjs 直读
源码的 config.mjs 是即时的，但 providers.ts 走 Next 编译，不重建就还是旧
chunk（本次就差点被旧 build 骗过：横幅显示新配置、日志实际走旧协议）。

## 三项功能优化（2026-08-28 上午，已两站重发）

### 1. 每日新词默认 10、上限 100

- schema 默认值 8→10；幂等 DO 块把存量 `=8` 的用户抬到 10（手动改过的不动，
  实测 6 个用户全抬了——没人改过）；db/index.ts 两处 INSERT 默认值同步
- profile/onboarding API 校验 max 40→100；设置页/引导页滑杆 max 20→100、
  文案注明「默认 10，最多 100」

### 2. 已学过的词跳过「看意思」

newwords.tsx：localStorage key `xlearn.seen-words` 记住点过「看意思」的
word.id（上限 2000 防膨胀，隐私模式存失败就退化为本次会话生效）。挂载时
初始 revealed 直接包含本地已学的词 —— 卡片直接展开显示释义，不再猜意思。
按 word.id 匹配（不是 index），换批次也不受影响。SSR 防护 typeof window。
注意：这是**浏览器本地**的「看过卡片」记忆，和库里 user_words 的「在学」
是两回事；换设备/清缓存退回默认行为，无害。

### 3. 凌晨 4 点预生成当日任务（48h 活跃用户）

- 新端点 `POST /api/internal/prefresh`（CRON_SECRET 鉴权，没配则 403 禁用）：
  查 onboarded 且 48h 内有 sessions/daily_stats 记录的用户，逐个
  `getOrCreateToday`（幂等）+ `prewarmNewWords`（新词卡片补充内容提前补完，
  用户醒来打开就是完整卡片，不现场等 AI）
- server.mjs `startDailyPrefresh()`：setTimeout 链排到本地时区明天 04:00
  （与 localDay() 同口径），到点 HTTP 回环自调用，跑完排后天。逻辑跟着
  应用走，测试站/生产站各自跑各自的，无需宿主机 crontab
- .env.local 两站都追加了随机 CRON_SECRET
- 实测：手动 POST 端点为 2 个活跃用户建好当日任务；幂等重跑 sessions 不增；
  错 secret 403；两站启动日志都打了排程时间

验证：seen-words 逻辑单测 8/8；smoke 12/12 ×2；prefresh 生产实测通过。

### 4. 全量预跑 + TTS 预合成（2026-08-28 上午，已发生产）

prefresh 升级为「全量预付」（用户决策：都是核心用户，不在乎 token）：

- **六环内容全部预生成**：`prefillUserSpeech()`（`src/lib/stage-prefill.ts`）
  逐环调 `buildStage`（幂等：当日缓存命中就跳过），再从 payload 挖出
  「前端真挂了朗读按钮的英文句子」逐句送服务端 TTS 预合成
- **缓存键一致性是命门**：播放链路 `speak() → /api/speak → parseParams →
  synthSpeed(voice, pace(paceKey).ttsSpeed) → cacheKey(text, voice, speed)`；
  预合成链路用同一对 `synthSpeed`/`pace`、同一个 `cacheKey` 先 readCache
  跳过已有，miss 才 `speakWithProvider`（内部合成+写盘）。两边 import
  同一份函数，键永远对得上 —— 实测第二轮 prefresh 139 句全部命中缓存
  （synth=0），抽真实台词请求 `x-tts-cache: hit`
- **挖取范围**（对照 stages/*.tsx 的 Speak 按钮）：warmup 每题句子、
  newwords 词+例句+搭配、grammar 例句、listening 每句台词、reading 标题+
  正文（切块逻辑复制自 splitSpeechChunks，'use client' 模块不能服务端
  import）、speaking 开场白。答题后才显示的内容不预合成
- **听力分嗓音**：服务端复刻 buildServerVoiceCast 的分派逻辑（报性别的去
  同性别桶，偏好音色排桶最前；MiMo 4 音色在前，Kokoro 16 个兜底）。
  实测：Mia(female)→Mia 音色 hit、Leo(male)→Milo 音色 hit
- **TTS 并发 2**：与前端 warm 队列同级，别把这台 3.6G 内存的机器压挂
- **失败语义**：单环内容生成失败（如 sol 120s 超时）只记 error 不挡
  其他环；TTS 单句失败照常；用户级失败不挡下一个用户。重跑即重试
  （幂等），凌晨 cron 每天会再跑一遍

### 5. 在线 TTS 落本地的修复（同批）

生产「新词/语法/阅读全走本地语音」的根因：**音色偏好 localStorage
（linxi.ttsVoice）只有打开设置页才回填**。生产 origin 从没开过设置页
→ localStorage 空 → `parseVoicePref(null).kokoro = null` → canServer
false → 全落浏览器语音包。听力没事是因为它显式传 kokoroVoice 分派。

修复两处：
- **AppShell 挂载时回填**（app-shell.tsx `useSyncProfilePrefs`）：拉一次
  /api/profile，库里 voice/pace 且本地为空 → 写 localStorage 并广播。
  本地已有值不覆盖（设置页显式选择优先）
- **未选音色默认在线音色**（useSpeech.ts）：无偏好时 kokoro 取
  DEFAULT_SERVER_VOICE（Mia）——在线音色成为默认体验，浏览器语音包
  降级为服务端不可用时的兜底（原来的语义反了）

注意：~120 首 mp3 现在从 MiMo 按 token 计费合成，缓存目录
`/var/lib/xspeak/tts-cache`（KOKORO_CACHE_DIR），日增约 120×2 用户。
清理该目录 = 白付一遍合成费，别乱删。

### 6. 进门兜底：用户访问 today 也补齐资源 + TTS（2026-08-28 中午，已发生产）

需求：cron 只是第一道；用户进「今天学习」那一刻，缺什么后台就补什么，
用户永远不用现场等。

- `/api/session/today` 的 `after()` 里（响应先走，预取后台跑）：
  `prewarmNewWords` → `missingStages(s)`（查 stage_content 当日缓存，
  返回还没有内容的环节）→ 非空则 `prefillUserSpeech(user, s, missing)`
  （只对缺失环节「生成内容 + 预合成 TTS」）。cron 跑过的用户
  missing 为空 → 进门零 AI 调用，幂等
- TTS 侧天然按句增量：`prefillTts` 每句先 `readCache`，已合成的跳过
- 兜底失败只 warn —— 用户走到环节时 buildStage 现场生成（原有行为），
  播放时 TTS miss 现场合成（原有行为，watchdog 超时退浏览器语音包）
- 日志标记 `[prefill] 用户 N 进门兜底：补 xxx/yyy`

**踩过的坑（已修）**：`prefillUserSpeech` 里 `user.voice` 是
`"kokoro:Mia"` 带前缀，直接当 voiceId 进缓存键 → 非听力五环全部合成到
`voice="kokoro:Mia"` 的错误键上，播放请求 `voice=Mia` 永远 miss。
症状：只有 listening hit（serverCastFor 剥了前缀）。修复 = 统一
`.slice('kokoro:'.length)`。修复后七项抽检全 hit。

实测（生产，user3，先 DELETE 六环 stage_content 模拟 cron 没跑）：
进门响应 0.49s 即回（after 不阻塞）；后台 ~4 分钟补齐六环内容 +
TTS；二次进门 0.09s 且无重复 prefill 日志；warmup/newwords/grammar/
listening(Mia+Tom 双角色分派)/reading/speaking 七项 x-tts-cache 全 hit；
smoke 12/12。

### 7. 双音色方案：Kokoro 主力预生成 + MiMo 点击兜底（2026-08-28 下午，已发生产）

用户方案原话：定时任务和后台用自建（Kokoro）生成，用户点击时还是空白的
才用 MiMo 现场合成——成本和体验都要。**语速分层**：Kokoro 本身快和自然，
1.0 原速；MiMo 偏慢，播放端 ×1.15 追平体感（`x-tts-playback-rate: 1.15`）。

| 层 | 声音 | 何时花钱 | 点击时延迟 |
|----|------|---------|-----------|
| 主力 | Kokoro（自建，免费）| cron/进门兜底/暖队列，全部预生成 | 缓存命中 ≈ 0ms |
| 兜底 | MiMo（按 token 计费）| 仅当点击时 Kokoro 缓存没这句 | ~2.5s 现场合成 |

- **数据层**：`users.voice_offline` 存 `kokoro:X`（主力），`users.voice`
  存 `mimo:X`（兜底偏好）；`profile` API 收 `voiceOffline` 字段。
- **`/api/speak` 新增 `alt` 参数**（仅接受 MiMo 值）：主 voice 查缓存
  → hit 直接回（**alt 不触发**）；miss → 用 alt 现场合成并写缓存，
  响应头 `x-tts-alt: Mia` 标记走了兜底。二次点击即命中 MiMo 缓存。
- **前端 useSpeech**：`offlineVoiceRef`（`linxi.ttsVoiceOffline`）选主力
  Kokoro；在线兜底取 `parseVoicePref().mimo ?? 'Mia'`；qsFor 带
  `alt=`（主力是 MiMo 时不带，避免自兜底）。播放速率 = 主力是 MiMo
  才 ×1.15（封顶 1.6），Kokoro 永远 1.0。
- **预生成只认 `voice_offline`**，完全无视 `voice` 列（stage-prefill 读
  `voice_offline` 剥前缀）；未设置时默认 `af_heart`。
- **语速 ×1.15 的三处同步**（HTMLAudio 读不到响应头，只能各写一份，
  改一处必须三处一起）：服务端 `playbackRateFor`（`MIMO_PLAYBACK_BOOST`）、
  客户端 `speak()`（`MIMO_BOOST`）、`previewServerVoice`。
- **听力分派桶翻转**：`buildServerVoiceCast`/`serverCastFor` 从
  「MiMo 前 Kokoro 后」改为 **Kokoro 前 MiMo 后**（主力免费优先，几乎
  必命中），两处结构必须一致，否则缓存键对不上。
- **设置页两组音色各选各的**：Kokoro 格子标注「主力 · 提前生成」，
  MiMo 格子标注「兜底用」，分别写 `voice_offline` / `voice`。
- **暖队列永不花钱**：warm URL 不带 alt，兜底嗓音 af_heart。
- 实测：全新句子 `voice=af_heart&alt=Mia` → 2.52s 合成、`x-tts-alt: Mia`、
  速率 1.15；重放 0.067s 命中。29/29 单测（/tmp/test-dual-voice.cjs），
  smoke 12/12。
- **MiMo 音色全量 9 个**（2026-08-28 晚补齐）：用假音色名打上游，400
  报错列出真实清单 `[mimo_default, 冰糖, 茉莉, 苏打, 白桦, Mia, Chloe,
  Milo, Dean]`。新增 5 个（mimo_default/冰糖/茉莉/苏打=女，白桦=男，
  性别按合成样本 F0 基频实测，Mia 225Hz/Milo 139Hz 校准）。新增的排原
  4 个后面，DEFAULT_SERVER_VOICE 仍是 Mia。九个全部 200 实测通过。
  注意：中文音色名必须 URL 编码传输（前端 URLSearchParams 天然如此；
  curl 测试要用 `--data-urlencode`，`--data` 塞原始字节会被 Next 400）。
- `x-tts-alt` 头只在真走兜底时输出（原先不用 alt 也挂 `"undefined"`
  字符串，误导排障）。
- 设置页「通话时 AI 的声音」从一音色一行改成 VoiceCell 格子（手机 2 列
  桌面 4 列），与本站音色/系统语音包同一套组件。

### 8. 多主题/天：「进入下一个主题」（2026-08-28 晚，已发生产）

今日主题卡改成双按钮：左「继续 xx」原样；右「进入下一个主题」——当前
session **就算没走完也标记完成入历史**（学习记录页显示已完成环节数），
立刻开一个新主题，一天可连开多个。

- **约束放宽**：`sessions` 的 `UNIQUE(user_id, day)` 删掉，换成部分唯一
  索引 `idx_sessions_open_per_day (user_id, day) WHERE completed_at IS NULL`
  ——「每天最多一条**未完成**」，历史不占坑，并发也开不出两条半成品。
- **repo**：`getOrCreateToday` 查找顺序 ① 当天未完成 → ② 都完成了回最后
  一条（首页显示「再练一轮」，开门不偷偷烧 AI）→ ③ 组装。开新主题只由
  `startNextTheme` 显式触发：先关旧（UPDATE completed_at）再直接
  `assembleSession`（**不能**走 getOrCreateToday，会把刚关掉的端回来——
  第一版就栽在这，POST 后 GET 还是旧主题）。
- **路由**：`POST /api/session/today` = 进入下一个主题；GET/POST 共用
  `backfillAfter`（新主题同样吃进门兜底）和 `todayPayload`（响应体同形）。
  **重建响应体时 user 字段一个都不能少**（level/goal/interests/voice/
  aiVoice/speechPace…），smoke 的 PATCH /api/profile 步骤会抓。
- **首页**：双按钮 grid（手机单列上下排、sm 起左主右次），共用
  switching/finishing loading 互斥；POST 成功先 setData 新主题再跳
  `/learn?stage=warmup`。
- 选词排重天然成立：pickNewWords 排除 user_words 已登记的词，上一个主题
  学过/没学完的不会原样再发。实测：8→10→11 连开三个主题，主题不重复、
  学习记录同天多条、各环节内容生成正常。

### 9. 热身混合题型 + FSRS 记账修复（2026-08-28 深夜，已发生产）

两问引出的改造：①「到期词多为什么只复习 8 个」②「热身能不能加释义
单选，不调 AI」。评估结论：**释义单选完全不用 AI**——干扰项从本次复习
词表 + 新词表挑（同级别、语境相关，比随机抓词迷惑性好），前端拼装零
token 零等待。

- **复习容量**：`reviewCap` 从 `max(6, daily_minutes/30*12)`（20 分钟
  用户=8 个）放宽到 `max(6, min(30, …*2))`——到期堆积不再截断，30 封顶
  防单环节过长。
- **混合题型**：AI 完形只给前 `WARMUP_AI_CLOZE_CAP=8` 个到期词出
  （prompts.ts 导出常量，stage.ts 切片）；**剩余词前端补释义单选**
  （warmup.tsx quizItems）：题干 = 词本身大字 + 朗读键，选项 = 中文释义，
  干扰项排除同释义、按复习词表→新词表顺序取 3 个。两种题统一队列
  （先完形后释义）、统一 FSRS 记账（mode: `cloze` / `meaning_choice`，
  review 路由的 mode 是自由字符串，无需迁移）。
- **顺藤摸出的隐藏 bug（比原需求更严重）**：热身前端 termToId 只映射
  `meta.targetWords`（新词），而热身考的是**复习词** → 答完 wordId 全是
  undefined，**FSRS 记账整个静默丢失**——生产实锤：user3 的 review_logs
  近 4 天 warmup 全部 item_id=0（wordId null 兜底），21 个到期词
  reps=0 永远排不上复习队。修复 = metaFor 在 warmup 时附带
  `reviewWords`（types.ts StageMeta 加可选字段）+ termToId 双源合并。
- WarmupPayload.items 从 min(1) 放宽到 min(0)：AI 全挂时释义题还能撑住
  环节（total 判空态）。
- 生产实测（user3，21 到期词）：新 session 复习词 16 个 → AI 完形 8 道 +
  零 AI 释义单选 8 道，合计 16 题；干扰池 26 个不同释义；smoke 12/12。

### 10. 释义脏数据 + 两个 TTS 播放 bug（2026-08-28 深夜二批，已发生产）

用户报三件事：①「每个选项里都有 `interj. 喂，嘿`，其他干扰项没词性」
②「点发音不出声、也没有后端请求」③「释义只有单个、没有词性」。
外加自查发现的「点 there 出声却是上一句」。

**① 释义脏数据（根因在入库侧）**：`formatSenses` 只用在词典查询路径，
**AI 造词路径（upsertWordFromAi）原样写库** → words 表里躺着 ECDICT
原始格式：`interj. 喂, 嘿`、`n. 抓握, 掠夺\nvi. 抓取`（带换行）、
`+体育馆`（ECDICT 的 `+` 补充标记）。混进释义单选的四个选项里，唯一带
词性前缀的那个一眼就是答案（送分 + 看着像 bug）。修法三层：
  - 入库统一过 `formatSenses`（words.ts），`formatSenses` 本身加剥 `+`；
  - **幂等守卫**（踩过）：formatSenses 输出用「；」分隔多词性段，而它自己
    按 `[,，;；]` 切义项 → 二次清洗会把 `n. 指控，费用；vt. 控诉` 切成
    `指控，费用，vt. 控诉`。判定"真原始格式" = 多行 / `+` 开头 /
    （单行带词性头 **且** 不含「；」）。源码和清库脚本两处同一判定。
  - 存量数据：`scripts/clean-meanings.mjs`（dry-run 默认，`--apply` 生效）
    清了 5 条，charge/to/resilient 被守卫正确跳过。
  - 前端再兜一层：warmup 选项用 `clean()` 剥前缀，老数据不用等重入库。
**③ 词性显示**：`metaFor` 的 reviewWords 补 `pos`，释义题题干下方灰字显示
「音标 · 词性」——给判断依据但**不进选项**（进选项就泄题）。
**④ 「点 A 出声是上一句 B」**：`stop()` 只 pause 不清 src（为了不中断
下载），换句时元素里还挂着旧 src 和已解码数据 → 旧 buffer 先出声；同句
连点时 src 不变不触发重载、currentTime 停在上次末尾 → 像"没反应"。
修法：换句前 `pause() + currentTime = 0`，src 相同则 `load()` 重取。
**② 「点发音没声也没请求」= 熔断永久生效**：`serverFails` 是模块级变量、
只在成功出声时归零。Kokoro 对个别句子稳定 502（当天实测有 4 句），撞两次
之后这个标签页里所有朗读永久走浏览器语音包，只能刷新页面。修法：熔断加
`SERVER_TTS_COOLDOWN_MS = 60_000` 冷却，过期自动再试（`serverTtsBlocked()`
统一判定，三处引用；`noteServerFail()` 刷新起点）。
- 实测：8 道释义题选项 0 处词性前缀、8/8 能显示词性音标；同句二次请求
  0.058s 命中；there/think 返回不同音频；17/17 单测；smoke 12/12。

### 11. TTS 分梯队：凌晨 cron 用自建，其余全部用在线（2026-08-28 三批）

用户改主意（原话）：「只有凌晨4点的定时任务使用自建tts，其他需要时效的
（点击发音、进入页面服务器无tts缓存、开启新的话题时）后台的tts请求全部
使用在线的mimo，自建的速度太慢了 用户体验太差」。

**判断依据（生产同句实测，同一批新鲜句子）**：MiMo 3.32/3.60/3.72s 全成功；
Kokoro 9.32/9.91s + 第三句直接 502。慢 3 倍还带失败率，用户的判断没错。

**改法 = 一个 tier 参数贯穿全链**，`PrefillTier = 'kokoro' | 'mimo'`：
| 路径 | tier | 理由 |
|---|---|---|
| 凌晨 4 点 cron（prefresh） | `kokoro` | 没人等，全站免费 |
| 进门兜底（GET /api/session/today） | `mimo` | 用户已在屏幕前 |
| 开新主题（POST 同上） | `mimo` | 同上 |
| 点朗读 / 听力预热（前端） | `mimo` | 手指刚离开屏幕 |

关键设计点：
- **默认值故意选 `mimo`**：将来新增调用点忘了传参，最坏是多花点钱，
  而不是让用户干等 Kokoro。全仓只有 prefresh 那一处写 `'kokoro'`。
- **两列偏好各归各家**：`users.voice` = 点朗读真正出声的音色（MiMo），
  `users.voice_offline` = 只影响凌晨那轮预生成。设置页标签同步改成
  「点朗读用这个」/「仅凌晨预生成」，别再写「主力/兜底」。
- **`preferredVoiceId(stored, provider)`** 收进 server-voice-list，成为
  前后端唯一的偏好解析入口：剥 `kokoro:`/`mimo:` 前缀 + 校验归属
  （用户选了 Mia 时问"Kokoro 偏好"必须返回 null，不能把 Mia 当 Kokoro）。
  缓存键必须是裸 id —— 前缀 bug 历史上栽过两次。
- **听力分嗓音的桶序改由 tier 驱动**：当前梯队在前、另一家兜后。前后端
  两份实现必须逐例一致，否则预合成的音色和播放请求的音色不同 → 缓存
  永远 miss。写了 `/tmp/test-cast-parity.cjs` 把两份算法各抄一遍实算比对
  （7 种对话形态 + 单人 + cron 梯队，9/9 一致）。
- **`alt` 参数这条路不传了**（主音色本身就是快路），但服务端保留该能力。
- **warm 队列默认音色跟着改**：原来写死 `af_heart` 想省钱，但热的是另一个
  缓存键，等于没热。
- **天然存在两套缓存**（cron 存 Kokoro 音色一份、播放请求 MiMo 一份）：
  第一次点必然 miss → MiMo 3s 现场合成并写盘，第二次起 0.06s。这是
  「时效 > 省钱」的取舍，不是 bug。真正要防的是同一梯队内部两边算不一致。
- 实测：新主题 15 六环内容齐全，兜底日志「TTS 走 MiMo 快路」，该主题
  热身前 4 句点朗读 **4/4 命中、0.06s**（证明键没漂）；34 条新单测
  （tiering 25 + parity 9）+ 既有 6 套全绿；smoke 12/12。
- 顺手修了 3 条过时断言（写的是已被替换的字面代码，功能没坏）：
  warmup 去重改成按 `clean()` 后文案比、app-shell 回填提取了变量、
  dual-voice 的 9 条旧策略断言整体重写；另有一条 `split('函数名')[1]`
  切到了注释段 —— 定位函数体要用 `lastIndexOf('export function …')`。

### 12. 听力/阅读只走在线 TTS + 「语音生成中…」（2026-08-28 四批）

用户要求：听力和阅读的语音**完全使用在线 TTS**，服务端没预生成就现场
发在线请求，并用 tip 告诉用户「语音正在生成中…」。

为什么这两个环节特殊：它们本身就是「听」的训练。别的地方（新词、语法）
退回系统语音包只是音质差一点，听力/阅读退回去等于把训练材料换成了发闷的
机器音 —— 这一环的价值就没了。用户宁可等三秒真嗓音。

**实现 = `speak(text, { onlineOnly: true })`**，它改变四件事：
1. **熔断不拦**。普通模式下连续失败 2 次会转本地语音包；onlineOnly 没有
   退路，拦了就是彻底没声音，所以放行。
2. **pitch 不再否决服务端音色**。听力用 pitch 给「浏览器兜底路」分说话人，
   onlineOnly 下兜底路不会走，pitch 是死参数。
3. **看门狗语义反转**。普通模式的预算是"等多久换系统语音"（700ms~6s）；
   onlineOnly 是"等多久算彻底失败"，给 `ONLINE_ONLY_HARD_MS = 20s`
   （在线合成实测 3s，20s 覆盖冷合成 + 网络抖动）。
4. **失败不静默**。硬性不可用（超 1200 字符上限、传了 rate）或超时，
   通过新的 `speechError` 报给用户，不偷偷降级。

**tip 的关键设计：`synthesizing` 必须和 `speaking` 分开**。`speaking` 从
按下那一刻就点亮（让按钮立刻有反应），但它不区分「已经在响」和「还在等」。
只有后者才该显示 tip：命中缓存时 `synthesizing` 只亮几十毫秒，一闪而过；
真要现场合成才会停留 3 秒左右 —— 那正是需要告诉用户在等什么的时候。
撤销点有四处：`onPlaying`（出声了）、`finish`（收尾）、`stop`（手动停）、
以及 onlineOnly 失败分支。`playChunk` 里逐块重新点亮 —— 阅读全文切成好几
块，后面的块未必预热到了。

其他要点：
- 连播链不能断：某句超时时 `finish(i > 0)` —— 前面已经播过的块不算失败，
  听力的 `onEnd → step(i+1)` 照常推进；一句都没出声才报错。
- `Toast` 直接复用（位置/动画/`role=status aria-live=polite` 都现成），
  听力在组件根节点渲染一个（所有播放入口共用同一个 useTts 实例），
  阅读由 `Speak` 组件自带 `SpeechTip`。失败信息优先于「生成中」。
- `Speak` 在 onlineOnly 下不再因 `speechSynthesis` 缺失而隐藏按钮 ——
  在线音频不依赖那个 API。
- 阅读短文实测 525~663 字符（schema 限 80-140 词），远低于 1200 上限，
  切块连播即可，不会撞到"太长没法在线朗读"那条分支。

### 13. 单词只有一个意思 → 用本地 ECDICT 补义项（2026-08-28 五批）

用户截图：查词卡上 `introduce` 只显示「介绍」，问「你之前修了吗」。

**先分清两件事**（一开始容易误判成同一个 bug）：
- 词性**一直是显示的** —— 卡片上那行 `/ˌɪntrəˈduːs/ · v. · A1` 就是。
- 真问题是**只有一个义项**。第 10 节修的是「热身选项里混着脏词性前缀」
  （formatSenses 没跑在 AI 写入路径上），那是"脏"；这次是"少"，
  两个不同的问题，上次确实没碰。

**根因**：86 个 seed 词是手写的、大多只给一个义项；AI 造的词同样。而本地
ECDICT（`dictionary` 表，768739 行）里 `introduce` 有
`vt. 介绍, 引入, 采用, 输入` —— 数据一直在，只是入库时只"清洗"没"补全"。

**两处修**：
1. 存量：`/opt/xspeak/scripts/enrich-meanings.mjs`（干跑默认，`--apply` 写库）
   → 98 个候选补了 49 条，多义项覆盖 18/127 → **70/127**。
2. 源头：`enrichSenses()` 收进 dictionary.ts，`upsertWordFromAi` 在清洗后
   调它 —— 明天的新词、查词入库的词都自动带多义项。查库失败不挡入库。

**干跑救回来的三个坑**（这就是为什么这类脚本必须先干跑再 `--apply`）：
- **首义绝不能贴猜来的词性**。第一版拿 ECDICT 第一组的词性贴在人工首义
  前面，于是输出 `n. 直地`（straight 的「直地」是 adv.）、`adj. 外带`、
  `vi. 放松` —— 全是错的。改成首义不贴词性（词性整体已经在 pos 列显示，
  段落里再贴本来就冗余）。
- **同词性要并段**。fresh 的「新鲜的」「新奇的」都是 adj.，分成两段
  读起来像两个词性。用 `words.pos` 的第一个词性判断该不该并 ——
  猜错的代价仅仅是多分一段，不像贴错词性那样输出错误信息。
- **语法说明不是义项**。`lost` 会补进「lose的过去式和过去分词」；
  加 `GRAMMAR_NOTE` 正则过掉（过去式/过去分词/比较级/最高级/复数/
  现在分词/第三人称）。
**人工首义永远打头**：`beans` 在这个 App 里首义是「咖啡豆」而 ECDICT 是
「豆子」，整段替换会把这份人工校准丢掉。
- 验证：`/opt/xspeak/scripts/test-enrich-senses.mjs` 拿**真实 ECDICT 数据**
  实算 13 条断言（三个坑各一条 + 幂等 + 长度 + 去重），全绿。

### 零点发布流程（2026-08-28 起，用户要求）

用户要求这个改动及后续修复都在**凌晨 12 点**上线。脚本：
- `~/.hermes/profiles/xiao/scripts/xspeak-deploy-midnight.sh <文件列表>`
  —— 发布前先跑 tsc（零点没人盯着，不能推编译不过的代码）→ 杀 tsserver
  → 停服 → tar 同步 + 逐个 diff 校验 → 构建 → 起服 → 探活 + 冒烟，
  全程 tee 到 `/tmp/xspeak-midnight-deploy-<时间>.log`。
- **构建失败时起回旧构建**（`.next` 可能是半成品，但上一个 standalone
  产物还在）—— 宁可不上线，绝不留下"站是死的"。
- `xspeak-midnight-runner.sh` 负责 sleep 到零点。**故意不用 crontab**：
  一次性发布留常驻条目会每天零点重发一次。
- 探活用 `/login`（200）—— 本项目没有 `/api/health`，`/` 未登录会重定向；
  空跑时这里报过一次误导性的 404。
- 空跑验证过一次（拿与生产一致的文件跑全流程）：36 秒完成，冒烟 12/12。

## 逐句朗读换成服务端音色（自建 Kokoro，2026-08-27）

起因是 iOS 自带语音包读英文发闷。**先试过现成的**：`scripts/probe-en-tts.mjs` 让
StepFun 那 25 个中文人设音色读英文，口音不对（那批是「中文母语者说英文」）。
所以另接一路 —— 自建 **Kokoro-82M**，OpenAI `/v1/audio/speech` 兼容接口。

**两套音色是两回事，别混**：`AI_VOICES`（StepFun，通话用，中文人设）
和 `KOKORO_VOICES`（英/美母语，逐句朗读用）。存进 `users.voice` 时靠
`kokoro:` 前缀区分，没前缀的照旧当浏览器语音包名 —— 省一次数据库迁移。

| 位置 | 作用 |
|------|------|
| `src/lib/tts/kokoro.ts` | 上游客户端 + 磁盘缓存（`speakCached` / `synthesize` / `cacheKey`）|
| `src/lib/tts/kokoro-voices.ts` | 音色表：展示 27 个、白名单 54 个、`parseVoicePref` / `kokoroVoicePref` |
| `src/app/api/speak/route.ts` | GET 回 mp3（含 Range / ETag），HEAD 只问缓存 |
| `src/hooks/useSpeech.ts` | `speak` 里的服务端优先 + 超时退回；`previewServerVoice`；`serverVoicesAvailable` |
| `src/components/settings-page.tsx` | 「本站音色」分组（美/英 × 男/女），逐个能试听 |

### 关键设计（改之前先读这几条）

- **GET 不是 POST**。iOS Safari 要求 `audio.play()` 和用户手势在同一个事件循环里，
  `await fetch()` 之后再 play 已经出了手势窗口会被拦。GET 才能把 URL 直接塞进
  `audio.src` 当场 play。代价是文本走 query string，所以限长 300 字符。
- **服务端出声预算分三级**（2026-08-27 深夜起，见「长句退回系统语音的修复」）：
  ≤120 字符 700ms、更长 4500ms、听力指派音色 9000ms（`serverTtsBudgetMs()`）。
  命中缓存几十毫秒，现场合成 1.5–13 秒。超时那次照旧出声（浏览器的），后台下载
  不打断，服务端把结果写进缓存，**下次点同一个词就是好声音**。所以第一次点
  会听见两个声音里的那个"差的"，是设计；长句现在因为预算放宽+切块预热，
  绝大多数第一次就能等到真嗓音。
- **连续失败 2 次就整个会话不再试**（`SERVER_TTS_GIVE_UP`）。没配 / 服务挂了会稳定
  503，每次都白等一次请求比直接用浏览器还差。
- **必须登录**（`signedIn()`，用 `currentIdentity` 不用 `currentUser` —— 朗读一句话
  不该产生一行 `users`）。未命中缓存要花那台机器 1.5–13 秒 CPU 还要写磁盘，
  不挡的话一个循环就能吃干。单人模式（没配 `AUTH_UPSTREAM_URL`）不挡。
- **音色走白名单**（54 个）。这个接口拿服务端的 key 去调上游，不能让任意字符串透传。
- **fp16 而不是 int8**：同一台机器上 int8 反而慢一倍（2.53s vs 1.21s），
  那颗 CPU 上量化节点的开销盖过整数乘法的收益。别看着「int8 更小」换回去。

**上游有个真会咬人的毛病**：某些短句回 200 + 44 字节的纯 ID3 头（空音频）。
确定性的、跟音素有关 —— `af_heart` 念 `hello world` / `how are you` 必空，
但 `hello world.` 就正常，换音色或换速度也正常（60 条常见文本里中了 2 条）。
`synthesize()` 补一个句点重试一次。**smoke 里那条 `size > 2000` 就是拦这个的。**

### 缓存

键是 `sha256(voice + speed + text)` 前 24 个十六进制字符，按前两字符分 256 个桶
（8493 个文件平铺在一个目录里 ext4 上 readdir 会慢）。先写临时文件再 `rename`
—— 同一个词被两个请求同时合成时，直接写会让读的人拿到半个 mp3。

**生产的 `KOKORO_CACHE_DIR` 必须指到不会被清的路径**（现在是
`/var/lib/xspeak/tts-cache`）。默认值在系统临时目录下，重启就空，
那 8000 多个词得重新合成一遍。整份词表大约 80MB。

### TTS 服务不在本机

`tts.xlingo.fun` 解析到 **106.12.175.21**，是另一台机器（Tengine 在前面）。
本机没有对应的 nginx vhost、没有 docker 容器、没有 systemd unit ——
**在这台机器上找不到它，别白找**。`kokoro.ts` 注释里那些"2 核机器"的实测数字
说的是那一台。上游探活：

```bash
curl -s https://tts.xlingo.fun/kokoro/v1/audio/voices   # 200 + 54 个音色
```

### 实测（2026-08-27，生产站 speak.xlingo.fun）

HTTP 层：

| 检查 | 结果 |
|---|---|
| 未登录 GET `/api/speak` | 401（:3021 和 :3022 都是）|
| `hello` / `thorough` / 一整句 | 200，6.5K / 7.0K / 13.7K 字节，1.46 / 1.60 / 2.43 秒（全 `x-tts-cache: miss`）|
| 同一句再请求 | `hit`，**0.06 秒** |
| `If-None-Match` | 304 |
| `Range: bytes=0-99` / `100-199` | 206 + 正好 100 字节，字节内容和整段对得上 |
| `Range: bytes=-100`（后缀式）| 206 + `content-range: bytes 8008-8107/8108` |
| `Range: bytes=99999999-` | 416 + `content-range: bytes */8108` |
| HEAD 已缓存 / 没缓存 | 200 / 404 |
| 未知音色 / 400 字符 | 400 / 413 |

浏览器层（无头 Chrome 带真实登录态，探针 `/tmp/xlearn-shots/tts2.mjs`）：

- 设置页出现「本站音色」区块，27 个音色各有试听键；
- 点选「暖心」→ `localStorage` 写成 `kokoro:af_heart`、该行 `aria-pressed=true`，
  保存后换页仍是这个值；
- 试听走的是 `audio.src = /api/speak?...`（**不经过 `fetch`**，所以钩 `fetch` 抓不到，
  要钩 `HTMLMediaElement.prototype.play`，这点坑过一次）；
- 新词环节点喇叭，**正好跑出设计里那两级**：第 1 次服务端音频发出去了、
  同时浏览器语音包也读了（未命中，1.5s 超过 700ms 预算）；第 2 次只有服务端音频、
  浏览器语音包 0 条（命中缓存，预算内出声）；
- console 报错 0。

smoke 新增一条 `GET /api/speak（本站朗读音色）`，把上面 HTTP 那张表整个覆盖了，
并且**每次跑用不同文本**（带时间戳）—— 否则永远读上一次留下的缓存文件，
测不到"未命中→合成→写缓存→命中"这条链。没配 `KOKORO_TTS_URL` 的部署回 503，
那条按**跳过**处理，不算失败。`--fast` 由 11 条变 **12 条**，
测试站（:3021，12.9 秒）和生产站（:3022，12.4 秒）各跑过一遍，都是 12/12。

写这条 smoke 时自己踩了个坑，记下来：``assert(res.ok, `…${await res.text()}`)``
里的模板串是**无条件先算的**，成功路径上也会把 body 读空，后面 `arrayBuffer()`
报 `Body is unusable`。要读 body 的报错消息得写在 `if (!ok) throw` 里。

## 下一步（按优先级）

0. **第二、第三轮各 6 条都已完成**，线上 :3021 跑的就是含全部十二条的构建
   （2026-08-26 重新 build + 重启，之后又开了鉴权、配了三个模型，
   全量冒烟 29/29 走公网也全过）。剩的是收尾，不是需求。
1. **等用户截图**再动 warmup —— 用户已选「可滑动卡片」，但说了截图之后再改。
   界面重排也一并等截图。
   顺带可以问一句 newwords 翻开时按钮排下移 142px 那个残留要不要修（见第 1 条一节）。
2. ~~打开鉴权~~ **2026-08-26 已做**，见「鉴权」一节。剩一个待用户定的小事：
   `users` 表里 `id=1`（假 `external_id` `7001`/alice，挂着不要的旧数据）和
   `id=2`（`7002`/bob，零数据）两行测试残留要不要删。
3. ~~配模型清单~~ **2026-08-26 已做**（用户自己填的三个模型，见「第 6 条做了什么」）。
   注意一个坑：**库里存的角色选择优先级高于 `.env.local`**，早先测试留下的
   `chat=deepseek-v4-flash` 曾静默压住用户配的 `gpt-5.6-sol`，已 PATCH 成 `null` 清掉。
   判断实际生效的是哪个，看启动横幅那三行，或 `GET /api/models` 里
   `selected`（库）/ `fromEnv`（环境）/ `effective`（实际）三个字段。
4. 按**第一轮**第 6 条（界面干净）继续排版面。newwords / grammar / listening /
   reading / speaking 都已经因为第二轮的改动动过一轮了，剩的主要是 5 个页面
   （vocab / stats / settings / grammar / import）。
   这些页面在 390 / 1440 两档都已确认无横向溢出、无 console 报错、内容真实渲染，
   剩下的是版面疏密，不是坏。
5. 改动后跟一遍 smoke。鉴权开了以后**必须带账号**，否则第一步就停：
   `BASE=http://127.0.0.1:3021/xlearn SMOKE_USER=xiaoxiao SMOKE_PASS=xiaoxiao npm run smoke -- --fast`
   `--fast` 2026-08-27 是 **12/12**（加了 `/api/speak` 那条）；
   全量（不带 `--fast`）2026-08-26 是 **29/29，218 秒**。

## writing 环节：确认删除

用户 2026-08-25 确认是有意删的。每天的环节从 6 个变成 5 个，收尾由 speaking 承担。
代码里已经一致：`STAGES` 不含它、`schema.ts` 不建 `writings` 表
（表名只留在 `ALL_TABLES` 里，好让 `db:reset` 能清掉老库的残留）。

## 鉴权：接 ai.xlingo.fun（**2026-08-26 已在线上启用**）

用户 2026-08-25 定的方案：用本机已有的 **`https://ai.xlingo.fun`** 做身份来源，
不自己写一套账号系统；用户同一天定了 **「一人一份」**（每个上游身份一份自己的学习记录）。

**线上状态（2026-08-26）：已打开。** `.env.local` 里是这三行：

```bash
AUTH_UPSTREAM_URL=http://127.0.0.1:18082
AUTH_ALLOW_USERS=xiaoxiao
AUTH_ADMIN_USERS=xiaoxiao
```

用户 2026-08-26 提供了管理员账号（`xiaoxiao`，上游 `role: superadmin`、
`status: active`、无 2FA、邮箱为空所以只能按用户名匹配）。它在 xlearn 这边落在
**`users.id = 3`**。

`AUTH_ALLOW_USERS` 特意填了名字而不是留空：上游 `emailRegistrationEnabled: true`，
留空等于任何人注册个上游账号就能在这里领一份档案，而这是个公网地址。
**别为了测试清空这两个名单**（试过一次被权限分类器按「削弱安全」拦下，拦得对）；
要测「非管理员」把 `AUTH_ADMIN_USERS` 换成别的名字，白名单照留。
注意 `AUTH_ADMIN_USERS` 留空会**退回白名单**，所以只清它测不出 403。

**老数据没有迁移，是用户的决定。** `users.id=1` 上挂着 38 段对话 / 18 个生词 /
13 道错题，但它的 `external_id` 是我早先 mock 测试留下的 `'7001'`/alice，而接管那条
UPDATE 带着 `AND external_id IS NULL`，所以接管不会触发。提出来之后用户
2026-08-26 明确说「id=1 的丢了也无所谓 没什么价值」，于是不做接管。
`id=1`、`id=2`（`7002`/bob，零关联数据）两行测试残留还在库里，要不要删由用户定。
`AUTH_ADOPT_USER_ID` 这个机制本身是好的，只是这次用不上了。

摸清的现状：

- 后端是 `/opt/xiaoai-chat/current/xiaoai-chat`（Go，systemd 起，监听 `127.0.0.1:18082`），
  nginx 反代 `ai.xlingo.fun` → 它
- 有完整用户系统：`POST /api/v1/auth/login`（用户名或邮箱 + 密码，JWT）、
  `POST /api/v1/auth/refresh`、`GET /api/v1/me`（缺 token 返回 401
  `auth.invalid_token`）、`/api/v1/auth/sessions`、2FA、密码重置
- `GET /api/v1/auth/login-options` 说明当前开关：用户名登录 ✅、邮箱注册 ✅、
  邮箱验证 ✅、Turnstile ✅、**第三方 provider 列表为空**
- 它**不是** OAuth/OIDC provider（没有 `/.well-known/openid-configuration`，
  那些路径返回的是 SPA 首页不是 JSON）。所以只能走「代理登录 + 校验 token」，
  不能走标准 OIDC 跳转

xlearn 这边的好消息：**数据层本来就是多用户的**，每张业务表都带
`user_id INTEGER NOT NULL REFERENCES users(id)`，索引也都是 `(user_id, …)` 开头。
唯一写死的地方是 `src/lib/db/index.ts` 的 `getOrCreateUser()`（`WHERE id = 1`），
被 `src/lib/api.ts` 的 `currentUser()` 包一层，20 多个路由都只调 `currentUser()`。
所以改造集中在一个函数 + 一个登录页，不用动那 20 多个调用点的签名 —— 实际就是这么做的。

`users.id` 原来是 `INTEGER PRIMARY KEY`（靠写死 1 才不用分配 id），
已经幂等 ALTER 成 `GENERATED BY DEFAULT AS IDENTITY`，并加了 `external_id`
+ 部分唯一索引（`WHERE external_id IS NOT NULL`，这样单人模式那条 NULL 不占名额）。

### 形状：代理登录 + 拿 `/api/v1/me` 验票

token 校验走 `GET /api/v1/me`，**不自己验 JWT**：上游就在本机
（`127.0.0.1:18082`，实测公网 349ms、回环 0.6ms，所以配地址要用回环），
这样 xlearn 不持有对方的 `JWT_SECRET`，对方改签名方式也打不挂这边。
代价是登录页会经手密码（转发给上游）—— 上游不是 OIDC provider，没有别的路。
密码只在那一次转发里存在，不落库、不记日志。

用到上游五个接口：`auth/login`、`auth/2fa/verify`、`auth/refresh`、`me`、`auth/logout`。

**新增文件**

| 文件 | 作用 |
|------|------|
| `src/lib/auth/config.mjs` | 读环境变量、`isAllowed()` 白名单判断 |
| `src/lib/auth/upstream.mjs` | 调上游、`normalizeLogin()` 抹平返回、`pickRefreshCookie()` 按名字挑 cookie |
| `src/lib/auth/session.mjs` | 读写 httpOnly cookie、`identityFromToken()`、续期 |
| `src/lib/auth/index.ts` | 给上面三个 `.mjs` 配的类型门面 |
| `src/proxy.ts` | 未登录访问页面 → 307 到 `/login?next=…` |
| `src/app/api/auth/{login,logout,refresh,session}/route.ts` | 四个端点 |
| `src/components/login-form.tsx` + `src/app/(bare)/login/page.tsx` | 登录页（含 2FA 第二步） |
| `scripts/mock-upstream.mjs` | 测试用的假上游，见下 |

**几个刻意的选择**

- **`middleware.ts` 改名成 `proxy.ts`**：Next 16 把老约定标了 deprecated，构建会警告。
  签名从 `export function middleware(req)` 变成 `export default function proxy(req)`，
  `config.matcher` 不变，行为不变。
- **proxy 只看 cookie 在不在，不验票**：验票要打上游，放在每个页面请求前会把
  首屏拖慢，而且 proxy 里不好做续期。伪造一个 cookie 能拿到页面 HTML（骨架），
  但页面里每个 `/api` 请求都会 401 —— 数据一条都拿不到。这是有意的分工，不是漏洞。
- **session cookie 的 `Path` 是 `/xlearn` 不是 `/`**：同机域名下还有别的服务，
  不该把 cookie 撒给它们。
- **验票结果缓存 60 秒，key 是 token 的 SHA-256**，不是 token 本身 ——
  明文令牌不进进程内存的常驻结构。
- **refresh token 是轮换的**（上游用完即废），所以 `src/lib/fetcher.ts` 里续期
  用一个去重的 promise：并发续期只有一个能拿到新票，其余会把新票作废。
- **WebSocket 用关闭码 `4401`**（私有区间）表示「没登录」，区别于 `1008`「路径不对」。
  前端收到 4401 会跳登录页。
- **白名单在 2FA 第一步之前故意不查**，见 `src/app/api/auth/login/route.ts` 里的注释：
  名单外的账号会先拿到 `challengeToken`、验完码才被 403 挡住。拦得住，只是拦晚了。
  按填进来的字符串提前比会误伤「名单记邮箱、人填用户名」的情况，不值得。

**⚠️ 打开之前要决定白名单**：`GET /api/v1/auth/login-options` 说
`emailRegistrationEnabled: true`，上游是开着邮箱自助注册的。
`AUTH_ALLOW_USERS` 留空 = 任何人注册一个上游账号就能进 xlearn 领一份自己的记录。
只给自己用就写 `AUTH_ALLOW_USERS=<你的用户名>`。

**测试用的假上游**：`node scripts/mock-upstream.mjs`（默认 :19999，`MOCK_2FA=1` 开两步验证）。
存在的理由是 —— 要测「登录成功之后」那一半，就得在 `ai.xlingo.fun`（别人的生产服务）上
注册账号，这不该顺手做。假上游照抄实测到的报文格式和错误码，账号
`alice`/`bob`（正常）、`carol`（停用），密码是 `<用户名>-pass`，2FA 验证码 `123456`。

## 第一轮第 2 条做了什么（离线词典）

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

### 分级换成 CEFR-J 人工标注（`word_level` 表）

用户翻库时提的：「字典表里怎么都是组词」。**这个观察对原始表成立，对应用取到的词不成立** ——
`dictionary` 原始 768,739 行里确实有 365,726 个词组（47.6%），但 `pickGradedWords`
的质量门里有 `word ~ '^[a-zA-Z][a-zA-Z''-]*$'`（**两头都锚定**），
过门后 32,883 行里词组是 **0 个**。按字母序翻库正好落在最脏的那一段。

真正的问题是**分级**：ECDICT 没有 CEFR 列，原来拿考纲标签（zk/gk/cet4…）当代理，
实测和人工标注只有 **54%** 对得上。所以另建 `word_level` 表存等级：

- **`npm run levels:import`**（`scripts/import-levels.mjs`）导入 **8,493** 个词的 A1–C2
  等级。A1–B2 来自 CEFR-J 1.5，C1/C2 来自 Octanove Vocabulary Profile 1.0。
- 8,418 个（99.1%）能 join 上 `dictionary`，其中 8,115 同时有中文和音标。
- 中文释义、音标、词频**仍然全部来自 `dictionary`** —— 那两份表不带中文和音标，单独用不了。
- `word_level` 和 `dictionary` 一样**不在 `ALL_TABLES` 里**，`db:reset` 不删。
- 表空着时选词自动退回旧的考纲标签方案（`TAG_BANDS`），所以先部署后导入不会让新词环节失效。

**授权是有条件的**，`settings-page.tsx` 的 `CreditsCard` 里那三行不能删：
CEFR-J 允许商用但要求原样保留 “The CEFR-J Wordlist Version 1.5. Compiled by Yukio Tono,
Tokyo University of Foreign Studies.”，Octanove 走 CC BY-SA 4.0 也要署名。

每级的词频下限（`LEVEL_FLOORS`）是照实测挑的，作用是跳过"这个等级的人早会了"的词 ——
CEFR-J 把 the/be/and/of 标成 A1 没错，但拿来当每日新词是浪费额度。过门后的池子：

| 等级 | 下限 | 池子 | 头几个词 |
|---|---|---|---|
| A1 | 400 | 675 | wait build stay plan college |
| A2 | 1200 | 786 | complete easily normal solution |
| B1 | 1500 | 1642 | democracy eastern device progress |
| B2 | 2000 | 2023 | cable rural legislation physician |
| C1 | 0 | 756 | coverage cite diversity clinical |
| C2 | 0 | 730 | tactic cognitive hypothesis counsel |

C1/C2 **刻意不设下限**：这两级本身没有"早会了"的词，设了只白砍池子（C1 756→750）。
最小的一级 675 个词按每天 8 个能撑 84 天。

词典路径**只取用户自己那一级**，不像 `words` 表那样放宽一级（`levelsFor`）——
等级是人工标的够准，放宽只会让 B2 的人吃到 B1 的词。

**筛过的其他词表**（都不如上面这套，记下来省得重查）：

| 词典 | 单词量 | 分级 | 结论 |
|---|---|---|---|
| Oxford 3000 (CEFR) | 2,967 | 人工，只到 B2 | **不用**：2,891 个（97.4%）已在 CEFR-J 里，多出的 76 个是英式拼写/变形 |
| Maximax67 | 92,201 | 算法推算 | **不用**：本身派生自 CEFR-J，C2 桶塞了 59,659 个词，词频头部是 senate/buck/pant/ah/wow —— 放不进别处的都倒进来了 |
| NGSL | 2,809 | 只有频次 | 只能当排序信号，没有 CEFR 等级 |

**顺带发现的本地信号**（不用导入就有）：`dictionary` 已经有 `collins`（柯林斯星级）和
`oxford`（牛津 3000 标记）两列，代码里一处没用。过门后 `oxford=1` 有 2,966 个、
`collins>=3` 有 2,796 个，和 CEFR-J 的等级是对得上的（A1 里 833 个 oxford 核心词，C2 里 0 个）。

**下载走 jsDelivr 而不是 raw.githubusercontent.com**：
`cdn.jsdelivr.net/gh/<owner>/<repo>@<ref>/<path>` 在这台机器上快且稳，
raw 那边下 CSV 会爬到 2.3MB 然后从 0 重来。WebFetch 对 github.com / raw 域名一律拒（说没法验证域名安全），curl 可以。

## 第一轮第 3 条做了什么（打电话式畅聊）

> **这一节里的待机屏后来被第二轮第 4 条撤掉了。** 现在是弹窗一打开就接通 ——
> 挑场景那一步搬到了 `/chat` 的场景卡上，进弹窗之前就已经选完，再来一屏
> "先看清对方是谁"就是多一次点击。下面留着是为了记那两个真 bug 和排查手法。

`voice-chat-panel.tsx`：
- 加了 `connected` 状态和待机屏。以前是 `useEffect` 里直接 `vc.start()`，
  一进页面就弹权限、就开始录音。改成先显示"对方是谁 + 聊什么 + 目标词"，点绿色接通键才连。
  （**已撤销**，见上面那条。）
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

## 第一轮第 4 条做了什么

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

## 第一轮第 6 条剩下的工作（界面干净）

这一节写的是**第一轮**第 6 条（每个界面保持干净），跟第二轮那个「可配置模型」无关。

当时只重排了 `warmup`。后来第二轮的 1 / 2 / 4 / 5 条把 newwords、grammar、listening、
reading、speaking 都动过一轮（竖排候选词、材料进弹窗、题卡居中、打电话弹窗），
所以剩的主要是 5 个页面（vocab / stats / settings / grammar / import）——
它们只继承了新配色，版面还没逐个排。

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

这张表是**第二轮改动之前**量的，`/learn` 和 `/chat` 那几行已经不准了
（材料进了弹窗、对话页换成场景卡）。留着是给另外几个页面当参考。

### 2026-08-26 又改了两处（口头报的）

**1. `/onboarding`「先认识一下」宽屏上铺太开。**
`src/components/onboarding.tsx` 根元素以前是裸 `div`，而 `(bare)` 布局只给一个
`min-h-dvh` 的 `main`、不限宽 —— 1440 宽下整页铺满 1440px，四个水平选项被拉成
横贯屏幕的长条。改成 `mx-auto w-full max-w-[34rem] px-4 sm:px-6`。

为什么是 34rem 而不是别的：`--content-w`(52rem) 是正文页宽度，给表格和两列内容用的，
这页全是短标签和滑块，行长过 35em 信息密度反而在掉；登录页的 `max-w-md`(28rem) 又太窄，
兴趣那 12 个 chip 会挤成很多行。实测 544px 下兴趣 2 行、目标 1 行，手机 390 宽兴趣 3 行。
1280 / 1440 / 1920 三档都稳定收在 544px，横向溢出 0。

**2. 设置页「已保存」不再挤保存那一行。**
以前 `<Badge tone="success">已保存</Badge>` 是保存按钮的 flex 兄弟，一出现就参与 flex
分配、把按钮挤窄，两秒后消失按钮再弹回来 —— 一次保存看两次跳动。
现在按钮 `w-full` 独占一行，反馈交给新增的 `Toast`（`src/components/ui/index.tsx` 末尾）。

`Toast` 的几个数字不是随手填的：
- `fixed bottom-[92px]`：保存条是 `h-12` 按钮 + `p-2` + 1px 边框 = 66px 高，从
  `bottom-4` 起算占到 82px，tip 底边落在 92px 正好留 10px 缝。实测两档视口都是 10px。
- `pointer-events-none` 必须有 —— 容器 `inset-x-0` 横跨视口，否则会吃掉底部一条带子上的
  点击。实测 tip 中心的点击穿透到了下面的按钮。
- 配色跟 `Badge` 的同名 tone 走，但暗色底用实色 `dark:bg-brand-900` 而不是 `/50`：
  Badge 躺在纸面上半透明能透出层次，toast 浮在正文之上，透出来的是字，会糊。
  浅色态实测 `rgb(22,72,62)` 配 `rgb(237,245,238)`，对比度 9.3:1。
- `role="status"` + `aria-live="polite"` 让读屏念出来又不打断当前朗读。
- 外层容器常驻、内层 pill 才条件渲染，所以 tip 消失后容器高度是 0，不留白块（实测）。

`saved` 那套状态机（`setSaved(true)` + 2s 后 `setSaved(false)`）原样复用，没动。
注意保存条**仍然必须是那一列的最后一个参与流布局的孩子**，`sticky` 才有效；
`Toast` 排在它后面但是 `fixed`，不参与流，所以不影响 —— 别把这个顺序当成可以随便调。

**两处都已上生产**（2026-08-26，`BUILD_ID=atdDXDXlO2nQg4W3Y23RM`，停机 17s，
smoke 29/29）。线上实测：桌面 544px / 手机 390px 无横向溢出；toast 底边离视口底 92px、
与保存条留 10px 缝、水平居中、保存按钮独占整行、2 秒后容器零残留。

### 品牌写法：xSpeak（大小写别再搞错）

用户可见的地方一律 **`xSpeak`**（大写 X 大写 S）。我第一版全写成了小写 `xspeak`，
被纠正过一次。已改：`layout.tsx` 的 title/applicationName/appleWebApp、
`manifest.webmanifest` 的 name/short_name、顶栏品牌字（`app-shell.tsx`）、
登录页 label、403 文案「这个账号没有使用 xSpeak 的权限。」、`server.mjs` 启动横幅。

**三处必须留小写，别"统一"掉**：
- `package.json` 的 `"name": "xspeak"` —— npm 包名不允许大写。
- **cookie 前缀 `xspeak`**（`src/proxy.ts:30` + `src/lib/auth/config.mjs:109`）——
  cookie 名区分大小写，改大写会让所有已登录用户的会话读不到、当场全部掉线。
  线上实测就是 `xspeak_session` / `xspeak_refresh`。
- 文件系统路径 `/opt/xspeak`。

注释里提到上面这些标识符时也跟着写小写（`config.mjs:25` 讲的是环境变量默认值、
`pace-store.ts:21` 讲的是存储键会变成什么）—— 那些不是品牌名。
登录页那行有 `text-transform: uppercase`，渲染出来是 `XSPEAK`，改源码大小写肉眼看不出，
但还是写对，免得下一个人以为哪里不一致。

### ⚠️ 部署踩过的大坑：`/opt/xspeak` 曾整棵树硬链接到工作区

**症状**：我在工作区跑了一次 `next build`，线上 12 条 JS/CSS 全部指向
`/xlearn/_next/...`，在域名根上 404 —— HTML 还是 200，所以"能打开但没样式、点不动"。

**原因**：`/opt/xspeak` 下的源码和 `.next` 和工作区**共享 inode**（`stat -c %h` 是 2）。
两边 `.env.local` 的 `NEXT_PUBLIC_BASE_PATH` 不同（生产空、测试 `/xlearn`），而这个值
在 `next build` 时被内联进产物。所谓"两份独立构建"其实退化成了一份，谁最后构建谁说了算。

**修法**：用 `tar` 管道重建一棵真副本（**不是** `cp -al`），生产目录独立重建，
`node_modules` 才用硬链接（只读，省 560M）。

**以后同步改动只用内容重写，别用任何会建链接的方式**：
```bash
for f in <改过的文件>; do cat "$f" > "/opt/xspeak/$f"; done
stat -c '%h %n' /opt/xspeak/src/app/layout.tsx   # 必须是 1
```
`%h` 只要不是 1，就是又串起来了，立刻停手。

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

## 生产部署：speak.xlingo.fun（2026-08-26 上线）

项目改名 **xspeak**，生产站 **`https://speak.xlingo.fun`**，跑在 `/opt/xspeak`、`127.0.0.1:3022`。
测试站 `test.xlingo.fun/xlearn`（:3021）**照旧并存**，两边都活着。

**为什么必须是两份构建、不能共用一个 `.next`**：`NEXT_PUBLIC_BASE_PATH` 是构建期内联的
（见下一节踩过的坑）。生产挂在域名根上要它是空，测试站要它是 `/xlearn`，
同一个 `.next` 满足不了两个前缀。所以 `/opt/xspeak` 是独立的一份源码 + 独立构建。

怎么建的（省盘是刻意的 —— 这台机器 40G 盘当时只剩 3.2G）：

```bash
# 1) dev 缓存先清掉：.next/dev 674M，--prod 用不到
rm -rf .next/dev

# 2) 源码打过去，不带 .next / node_modules / .git / ecdict.csv
tar -cf - --exclude=.next --exclude=node_modules --exclude=.git \
    --exclude=ecdict.csv --exclude=tsconfig.tsbuildinfo . | tar -xf - -C /opt/xspeak

# 3) node_modules 硬链，同一文件系统不额外占盘（560M → 0）
cp -al node_modules /opt/xspeak/node_modules
```

- `ecdict.csv`（63M）**没进生产目录**：76 万行词典早在库里了，那文件只给一次性导入用。
- **硬链的代价**：在任一边 `npm install` 都可能改到另一边。装完包要重新 `cp -al`。
- 两边**共用同一个 Postgres**（`PGDATABASE=xlearn`，没改名 —— 改要迁移 + 重灌词典）。
  所以测试站造的数据生产站看得见。要真隔离得另开库 + 重导词典，用户没要求。

`/opt/xspeak/.env.local` 和测试站的差异只有四行：

```
NEXT_PUBLIC_BASE_PATH=          # 空，挂在域名根上
PORT=3022
AUTH_ALLOW_USERS=               # 留空 = ai.xlingo.fun 注册过的都能登录（用户明确要的）
AUTH_ADMIN_USERS=xiaoxiao       # 只有管理员能看/改模型设置
```

**名单里填的名字是上游的 `username`，不是库里的 `users.name`。** 上游
`GET /api/v1/me` 返回 `username: "xiaoxiao"`、`email: ""`（空的，只能靠 username 匹配）。
用户一度改成 `AUTH_ADMIN_USERS=xiao` —— 那是 `users.id=1` 的本地昵称，
`onList()` 一个都匹配不上，而管理员空名单**不退回白名单**（`isAdminUser` 直接 false），
结果会是生产站没有管理员；同时 `AUTH_ALLOW_USERS=xiao` 会把登录整个关掉（403）。
改名单前先 `curl` 上游确认字段。另外白名单留空的前提下，往管理员名单里加一个
**不属于自己的名字**，等于把管理员送给谁先去上游注册那个名字。

**cookie 前缀跟着改名换成 `xspeak`**（`src/proxy.ts:30` 和 `src/lib/auth/config.mjs:109`
两处默认值必须同步，否则前端算出的 cookie 名和服务端写的不一致）。
实测 `Set-Cookie: xspeak_session=…; Path=/; Secure; HttpOnly; SameSite=lax`。
`THEME_KEY = 'xlearn-theme'` 和 `PGUSER`/`PGDATABASE=xlearn` **故意没改**：
前者改了会丢用户已存的主题偏好（和 `src/lib/pace-store.ts:21` 记的同一个理由），
后者要做数据库迁移。

### nginx：把 BT 的静态站改成反代

vhost 在 `/www/server/panel/vhost/nginx/speak.xlingo.fun.conf`，
改前备份到了 `/root/speak.xlingo.fun.conf.bak.<时间戳>`。
原来是 BT 建的静态 + PHP 站（站点根目录只有那个「恭喜，站点创建成功」的欢迎页）。

**必须删掉的三块，否则站是坏的：**

1. `location ~ .*\.(js|css)?$` 和 `location ~ .*\.(gif|jpg|…)$` 这两个加 `expires` 的正则块。
   **正则 location 优先级高于前缀 `location /`**，留着会把 `/_next/static/...`
   拦去磁盘上找文件 → 样式和脚本全 404。
2. `include enable-php-00.conf`，反代不需要 PHP 处理器。

保留的：SSL 段、证书申请验证段、敏感文件/目录黑名单（Next 走的是 `_next` 下划线，
和黑名单里的 `.next` 不冲突）、日志和 BT 监控段。

加的两个 location：

```nginx
location /api/realtime {          # 语音中转是 WebSocket
    proxy_pass http://127.0.0.1:3022;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;     # 通话中会长时间静默
    proxy_send_timeout 3600s;
    proxy_buffering off;
    # Host / X-Real-IP / X-Forwarded-For / X-Forwarded-Proto 同下
}
location / {
    if ($scheme = http) { return 301 https://$host$request_uri; }
    proxy_pass http://127.0.0.1:3022;
    proxy_http_version 1.1;
    proxy_set_header X-Forwarded-Proto $scheme;   # 少了这个 cookie 就不带 Secure
    proxy_read_timeout 300s;      # AI 一次几十秒，默认 60s 会 504
    proxy_send_timeout 300s;
    proxy_buffering off;
    proxy_request_buffering off;
}
```

`X-Forwarded-Proto` 是必须的：进程自己看到的永远是 http（反代到 127.0.0.1），
`isSecureRequest()`（`src/lib/auth/index.ts:246`）只信这个头。少了它会话 cookie
不带 `Secure`，也就没法强制 https。`client_max_body_size 20m`（录音和素材导入）。

**改完先 `nginx -t` 再 `nginx -s reload`** —— reload 影响这台机器上所有站点。
（`nginx -t` 会报一句 `duplicate MIME type "text/html" in ppt.xlingo.fun.conf:96`，
那是别人早就有的 warn，不是本次引入的。）

### 起停生产进程

```bash
cd /opt/xspeak
setsid env -u ANTHROPIC_BASE_URL -u ANTHROPIC_API_KEY -u PORT -u NODE_ENV \
  node server.mjs --prod > /tmp/xspeak-prod.log 2>&1 < /dev/null &
```

`-u PORT` 是关键：agent shell 里塞了 `PORT=8648`，而 `loadEnvConfig` 不覆盖已有变量，
不摘掉就会顶掉 `.env.local` 里的 3022。找进程用端口，别用 `pgrep -f`（会杀到自己）：

```bash
ss -ltnpH | grep ':3022 ' | grep -oP 'pid=\K[0-9]+'
```

**没装 systemd unit，机器重启不自愈。** 我试着写 `/etc/systemd/system/xspeak.service`
被权限分类器按 Unauthorized Persistence 拦下了，拦得对 —— 用户没点名要装持久服务。
要装的话 unit 里注意：`WorkingDirectory=/opt/xspeak`（Next 从 cwd 找 `.next`）、
`ReadWritePaths=/opt/xspeak/.next`（运行时要写 fetch 缓存）、
**别照抄 `xiaoai-chat.service` 的 `ProtectHome=true`** 那条本身在 `/opt` 下无害，
但测试站的目录在 `/root` 下，给测试站装 unit 时会挡到自己。

### 上线后实测（2026-08-26）

| 检查 | 结果 |
|---|---|
| `/login` 标题 | `登录 · xspeak` |
| 静态资源前缀 | `/_next/static/...`，没带 `/xlearn` |
| `http://` 访问 | 301 到 https |
| `/` `/learn` `/settings` 未登录 | 307 跳登录 |
| `/api/session/today` 未登录 | 401 |
| 登录（xiaoxiao） | 200，`admin: true` |
| 登录后 `/learn` `/settings` `/stats` `/api/models` `/api/words` `/api/stats` `/api/profile` | 全 200 |
| `manifest.webmanifest` / `icons/icon-192.png` | 200 |
| **全量 smoke** | **29/29，103.9s**（`BASE=https://speak.xlingo.fun`）|
| 其他站没被 reload 搞坏 | `ai.xlingo.fun` 200、`test.xlingo.fun/xlearn/login` 200 |

## 部署与环境状态（测试站）

测试站是 **`https://test.xlingo.fun/xlearn`**，nginx 反代到本机 `127.0.0.1:3021`，
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

### 重启命令（照抄，别简化）

`@next/env` 的 `loadEnvConfig` **不会覆盖**已存在的 `process.env`，而 agent 会话的
shell 里塞了一堆同名变量，会把 `.env.local` 整个压掉。所以重启必须显式传端口、
并且把 `ANTHROPIC_*` 摘掉：

```bash
cd /root/.hermes-web-ui/coding-agent/workspace/xiao/custom_linxi
setsid env -u ANTHROPIC_BASE_URL -u ANTHROPIC_API_KEY -u ANTHROPIC_MODEL \
  -u ANTHROPIC_DEFAULT_OPUS_MODEL -u ANTHROPIC_DEFAULT_SONNET_MODEL \
  -u ANTHROPIC_DEFAULT_HAIKU_MODEL -u ANTHROPIC_CUSTOM_MODEL_OPTION \
  PORT=3021 HOST=127.0.0.1 NODE_ENV=production \
  nohup node server.mjs --prod > /root/xlearn-3021.log 2>&1 < /dev/null &
```

两个坑都踩过（2026-08-25）：

- **`PORT=8648`**：shell 自带，不显式传就去抢 hermes-web-ui 的端口，
  `app.prepare()` 阶段 `EADDRINUSE` 崩掉，站点直接没人听。
- **`ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY`**：shell 里是 agent 会话的临时代理
  （`http://127.0.0.1:8648/api/claude-code-proxy/<token>`），会话一结束 token 就失效。
  带着它起服务，站点当时能跑，过一阵 AI 全挂 —— 而且日志上看不出所以然。
  起完**必须核对启动日志那三行**，得是 `@ https://api.xlingo.fun`，
  不是 `@ http://127.0.0.1:8648/…`。

**别在跑着的 `.next/` 上 `next build`。** 也是 2026-08-25 踩的：构建把老产物删了，
在跑的进程内存里的清单还指着老 chunk 文件名，于是**改过代码的那几个页面**
（当时是 `/learn`、`/stats`、`/settings`）JS 拿不全、浏览器打开点不动，
没改的页面因为 chunk 没改名反而没事 —— 所以症状是零散的，容易看漏。
要验证就另开目录构建，或者只跑 `tsc --noEmit`；已经构建了就只能重启。

**发版照这个顺序**（2026-08-26 用过两次，都顺）：先 `kill` 掉进程 → `next build`
→ 按上面那条命令重起。停机两三分钟，测试服可以接受，比另开目录省事。
构建前先留个后路：`cp -al .next /root/.next-rollback` —— 硬链接，891M 的产物
不额外占盘（这机器 92% 满），构建被 earlyoom 打断也能换回来。
`earlyoom` 的 `--prefer` 里点名了 `node`/`next-server`/`tsc`，18% 空闲就开杀，
所以**先停服务再构建**：省下来的那 148M 正好给构建用。

**找进程别用 `pgrep -f`，用监听端口。**（2026-08-26 踩的，症状极骗人）
`pgrep -f 'server.mjs.*--prod'` 会**把跑这条命令的 bash 自己也匹配上** ——
脚本文本里就含着那个 pattern。接着 `kill` 就杀了自己的 shell，`nohup` 起的子进程
同属一个进程组、跟着一起没。看到的是：启动横幅打得干干净净，然后端口连不上、
退出码 144、`ps` 里剩幽灵 PID，而内存还有 48% 空闲、earlyoom 也没记 kill。
（另一个红鲱鱼：`ps | grep next-server` 会命中 earlyoom 自己，它的 `--prefer` 参数里
就写着这个词。）正确写法：

```bash
PID=$(ss -ltnpH | grep ':3021' | grep -oP 'pid=\K[0-9]+' | head -1)
```

起进程用 `setsid ... < /dev/null & disown`（脱离进程组，不会被连坐），
别只用 `nohup`。

**没有进程管理**：现在这个服务是手起的孤儿进程，没有 systemd unit 也没有 pm2，
机器一重启站点就没了。要长期挂着得补一个 —— 注意别照抄
`xiaoai-chat.service` 的 `ProtectHome=true`，xlearn 的工作目录在 `/root` 下面，会起不来。

**鉴权相关的环境变量**（都是可选的，不配就是单人模式；`.env.local.example` 里有详细说明）：

| 变量 | 说明 |
|------|------|
| `AUTH_UPSTREAM_URL` | 上游地址。**只有这一个决定开不开鉴权**。用回环 `http://127.0.0.1:18082`（公网 349ms vs 回环 0.6ms） |
| `AUTH_ALLOW_USERS` | 逗号分隔的用户名/邮箱白名单。留空 = 全放行，而上游开着自助注册 |
| `AUTH_ADMIN_USERS` | 谁能看和改设置页的模型卡（全站设置）。不配则回落 `AUTH_ALLOW_USERS`；两个都空 = **没有管理员**。和白名单相反，空≠全放行 |
| `AUTH_ADOPT_USER_ID` | 首个登录的人接管这个已有 `users.id`，用来继承原来单人模式的学习记录。用过一次就该去掉 |
| `AUTH_COOKIE_PREFIX` | cookie 名前缀，默认 `xlearn` |
| `AUTH_SESSION_TTL_MS` | 会话 cookie 寿命 |

这几个都是**运行时**读的，不是 `NEXT_PUBLIC_` 前缀，所以改了不用重新构建，重启就行 ——
和 `NEXT_PUBLIC_BASE_PATH` 不一样，别搞混。`AI_*` 和 `VOICE_*` 也是运行时读的，
而且每次调用都重新读一遍（没有模块级缓存），同样重启就生效。

**线上现在配了三个模型**（用户 2026-08-26 自己填的，`AI_MODELS=claude-opus-5,gpt-5.6-sol,deepseek-v4-flash`）：

| 角色 | 模型 | 协议 / 地址 |
|------|------|------|
| content（出题）| `claude-opus-5` | anthropic @ `xiao.xlingo.fun` |
| chat（对话）| `gpt-5.6-sol` | openai @ `xiao.xlingo.fun/v1` |
| fast（纠错查词）| `deepseek-v4-flash` | openai @ `xiao.xlingo.fun/v1` |

三个都 `ready: true`。判断**实际**生效的是哪个别只看 `.env.local` ——
设置页存进库的选择优先级更高，会静默压住它（已经坑过一次，见「下一步」第 3 条）。
看启动横幅那三行，或 `GET /api/models` 的 `selected`/`fromEnv`/`effective`。

其余：
- 数据库远程 PG `115.159.206.76:54321`，`dictionary` 表已有 768,739 条，重启不影响
- `ecdict.csv` 缓存在项目根，重跑 `dict:import` 会复用它不重新下载
- 出题慢（28–45 秒）是环境问题不是 bug：本机代理 `127.0.0.1:8648` 只供得起
  `claude-opus-5`，`claude-sonnet-5` 和 `claude-haiku-4-5-20251001` 都返回 503
  `model_not_found`，所以 `fast` 角色在这台机器上快不起来
- `earlyoom` 会挑 node 杀，`next build` 被杀过一次；已给构建进程设 `oom_score_adj = -800`

## 浏览器实测怎么做（这台机器上）

没有 Playwright / Puppeteer，用的是自己写的 CDP 小驱动 `/tmp/xlearn-shots/drive.mjs`
（`/tmp` 下的都是一次性的，被清了照着下面重写）。它导出
`viewport / goto / click / shot / text / errors / done / evalRaw`，用 `BASE` 环境变量选目标：

```bash
BASE=http://127.0.0.1:3021/xlearn node /tmp/xlearn-shots/call.mjs
```

启 chromium 时带 `--use-fake-device-for-media-stream` 喂假麦克风，通话才连得上。

几个真会浪费时间的坑：

- **`click(label)` 收的是空白归一化后的子串，不是正则**（`drive.mjs:93-123`）。
  传 `RegExp` 会得到 `no element matching`，看着像元素不存在。
- **AI 生成的页面要等 40–60 秒，不是 2 秒**。这台机器每个环节出题 28–60 秒
  （原因见「部署与环境状态」最后一条）。`sheet.mjs` 有一次报"弹窗没开"，
  其实是 1.8 秒就截了；同一个检查给 60 秒 settle 就通过了。
- **探针里写正则要写 `\\s`**。探针是 heredoc 里的 JS 模板字符串，`\s` 会先被
  折成字面量 `s`，于是 `replace(/\s+/g, ' ')` 把文本里每个 `s` 都删掉 ——
  dump 出来是 `Pre ent ten e`，看着像应用坏了。
- **Read 工具读不了图**（4 个路径 / 格式都试过，一律返回空）。所以视觉验证不靠看截图，
  靠 CDP 打 computed style / getBoundingClientRect 出数字。

**要开发预览又不想碰线上产物**，就硬链接一份出来：

```bash
cp -al /root/.hermes-web-ui/coding-agent/workspace/xiao/custom_linxi /tmp/xlp
```

`cp -al` 是因为 Turbopack **拒绝指向项目根之外的 `node_modules` 符号链接**，
硬链接（同一文件系统）才行。用完记得删 —— 根分区已经 93%。

**起副本实例要连 cwd 一起换，光给绝对路径不够**：`node /tmp/xlb/server.mjs` 里的
Next 是按 `process.cwd()` 找 `.next` 的，cwd 还留在正式目录的话，跑的仍然是
正式那份产物 —— 表现是"改的代码怎么都不生效"，很容易误以为构建没成功。
用 `env -C /tmp/xlb …`。

`next build` 在这台机器上是能跑的。以前那次 exit 137 是 `earlyoom`
（node/tsc/next-server 都在它的 `--prefer` 名单上），残留的 chromium 加剧了它。
构建前先 `pgrep -c chrome` 看一眼。Next 16 不认 `next build --no-lint`。

## 验证命令

```bash
npm run typecheck               # 通过
npm run build                   # 通过（改 NEXT_PUBLIC_BASE_PATH 后必须重跑）
npm run probe:voice             # 三项全过，上游语音是好的
npm run db:check

# 线上鉴权已开，smoke 必须带账号（不带的话第一步就停）
BASE=http://127.0.0.1:3021/xlearn SMOKE_USER=xiaoxiao SMOKE_PASS=xiaoxiao \
  npm run smoke                 # 2026-08-26 全量 29/29，218 秒
```

`npm run lint` 已经失效（Next 16 拿掉了 `next lint`），别拿它当门槛。

**Chromium 目前不可用**：snap 坏了（`missing file /snap/chromium/3483/meta/snap.yaml`），
所以现在只能做 HTTP 层验证，做不了视觉确认 —— 别声称看过页面。

**开着鉴权怎么跑 smoke**：smoke 自带 cookie 罐，会先打 `/api/auth/session`
看有没有开鉴权；开了就必须给账号，不给会直接退出并告诉你该带什么。
下面这套假上游是**离线**验证用的（不碰真账号），线上直接用上面那条命令就行。

```bash
# 1) 起假上游 + 一个连它的实例
node scripts/mock-upstream.mjs &                       # :19999
env -u NODE_OPTIONS PORT=3056 AUTH_UPSTREAM_URL=http://127.0.0.1:19999 \
  node server.mjs --prod &
# 2) 带账号跑
SMOKE_USER=alice SMOKE_PASS=alice-pass \
  BASE=http://127.0.0.1:3056/xlearn npm run smoke -- --fast    # 11/11
```

**怎么验 OpenAI 协议兼容**（第三轮第 6 条）：`scripts/mock-openai.mjs` 是个假的
OpenAI 端点，照请求里的 schema 现编合规数据，还能装出各种兼容实现的毛病。

```bash
node scripts/mock-openai.mjs &          # :19998，MODE 环境变量选行为
# 让某个角色指向它（不用改 .env.local，起实例时传就行）
env -u NODE_OPTIONS PORT=3057 \
  AI_FAST_PROVIDER=openai AI_FAST_BASE_URL=http://127.0.0.1:19998/v1 \
  AI_FAST_API_KEY=whatever AI_FAST_MODEL=fake-1 \
  node server.mjs --prod &
curl -s http://127.0.0.1:19998/_calls | head    # 看它收到的请求形状
curl -s -X POST http://127.0.0.1:19998/_reset   # 清空
```

`MODE` 可选 `tool`（默认）/ `text-instead` / `fenced` / `stringified` / `bad-json` /
`http-401` / `http-429` / `http-500` / `newmodel` / `no-json-mode` / `not-openai` / `picky`。
路径不以 `/chat/completions` 结尾一律 404，baseURL 拼错能立刻看出来。

**鉴权实测过的点**（对真上游 `127.0.0.1:18082` 和假上游各跑了一遍）：

- 未登录：API → 401 `code: "unauthenticated"`；页面 → 307 到 `/xlearn/login?next=…`
- 密码错 → 401「账号或密码不对。」（映射过的话，不是 500）；字段太短 → 422
- **一人一份成立**：alice → `users.id=1`（`AUTH_ADOPT_USER_ID=1` 接管了原来那条
  单人记录），bob → `users.id=2`，`external_id` 分别是上游的 7001 / 7002
- 停用账号（carol）→ 403「这个账号当前不可用。」，且**不建本地档案**
  （上游对停用账号照样发令牌，得由调用方拦，这点假上游也照抄了）
- 轮换：续期后 refresh cookie 变了，且**第二次续期还能成功**（说明新票存住了）
- 登出后再打 `/api/profile` → 401
- WebSocket：带有效 cookie 连着不断；不带 → `close 4401`
- 2FA 两步：第一步 **0 条 set-cookie**（验完之前不发会话），验证码错 → 401，对 → 200 + cookie

一个已知的坑：`ws` 库里 `pause()` 期间 `close()` 的关闭帧发不出去
（客户端收不到，要等 30 秒关闭超时）。而握手时又必须 `pause()` ——
前端是 `onopen` 里立刻发 `start` 的，不按住就整条开场消息丢掉
（实测不 pause 收到 0 条，pause 收到 1 条）。所以拒绝那条路径是
`resume()` 之后再 `close(4401)`，`relay.mjs` 里有注释记着。

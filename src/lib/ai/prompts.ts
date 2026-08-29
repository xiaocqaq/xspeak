/** 学习者画像：每次生成内容都注入，保证难度和兴趣对得上。 */
export type Learner = {
  name: string;
  level: string;
  goal: string;
  interests: string[];
  newWordsPerDay: number;
};

export type MistakeBrief = { wrong: string; correct: string | null; note: string | null; kind: string };

const GOAL_ZH: Record<string, string> = {
  daily_talk: '日常口语交流',
  reading: '英文阅读',
  work: '工作沟通',
  exam: '应试',
  travel: '旅行',
};

export function systemPrompt(l: Learner): string {
  const interests = l.interests.length ? l.interests.join('、') : '暂无特别偏好';
  return [
    '你是一位中文母语者的英语私教，教学风格务实、耐心、不废话。',
    `学生画像：当前水平约 ${l.level}（CEFR），目标是${GOAL_ZH[l.goal] ?? l.goal}，兴趣：${interests}。`,
    '',
    '硬性要求：',
    `1. 所有英文难度必须贴近 ${l.level}。句子要短、结构简单，不要用超出该水平的生僻词或复杂从句（除非当天语法点就是它）。`,
    '2. 所有讲解、提示、点评用中文；例句和练习内容用英文并附中文翻译。',
    '3. 讲语法必须对比中英差异，明确指出中文母语者会怎么说错。空泛的规则复述没有价值。',
    '4. 例句必须是真实场景里会说出口的话，不要教科书式的假句子（例如不要 "This is a book."）。',
    '5. 严格按工具给定的结构返回，字段不要留空。',
  ].join('\n');
}

function mistakeBlock(mistakes: MistakeBrief[]): string {
  if (!mistakes.length) return '';
  const lines = mistakes
    .slice(0, 8)
    .map((m) => `- [${m.kind}] 学生写过「${m.wrong}」${m.correct ? `，应为「${m.correct}」` : ''}${m.note ? `（${m.note}）` : ''}`);
  return [
    '',
    '这位学生最近犯过的错（请在今天的内容里自然地把这些点再考一次，不要直接告诉学生"这是你上次的错"）：',
    ...lines,
  ].join('\n');
}

export type Ctx = {
  themeZh: string;
  themeEn: string;
  learner: Learner;
  mistakes: MistakeBrief[];
};

export function warmupPrompt(ctx: Ctx, words: { term: string; meaning_zh: string; seen: string[] }[]): string {
  const list = words
    .map((w) => {
      const seen = w.seen.length ? `（这些语境已经用过，必须换新的：${w.seen.slice(-3).join(' / ')}）` : '';
      return `- ${w.term}（${w.meaning_zh}）${seen}`;
    })
    .join('\n');
  return [
    `今天的主题是「${ctx.themeZh}」（${ctx.themeEn}）。这是热身复习环节。`,
    '',
    '待复习的词：',
    list,
    '',
    '为每个词出一道填空选择题。要求：',
    '1. 语境必须是全新的，且尽量贴近今天主题。绝不能重复上面列出的旧语境。',
    '2. 干扰项要有意义：放形近词、易混词、或同一个词的错误形式，不要随便凑四个无关词。',
    '3. 句子里目标词的位置用 ___ 表示，正确答案应填入后语法完全通顺。',
    mistakeBlock(ctx.mistakes),
  ].join('\n');
}

/** 热身里 AI 完形题的数量上限：复习词多于这个数时，剩余的由前端用零 AI 的释义单选补（见 WarmupPayload）。 */
export const WARMUP_AI_CLOZE_CAP = 8;

/*
 * 这里原来有个 newWordsPrompt：让 AI 挑今天该学哪些词。已经删了 ——
 * 选词走 CEFR-J 的人工等级 + ECDICT 词频（见 repo/dictionary.ts 的 pickGradedWords），
 * 那是人工分级的结果，比让 AI 每天现挑一遍又快又稳，还不花钱。
 * 补教学内容的提示词在下面的 enrichWordsPrompt。
 */

/**
 * 给已经定好的一批词补教学内容。
 *
 * 和 newWordsPrompt 的关键差别：**词是给定的，不许换**。选词已经交给
 * CEFR 等级 + 词频了，这里让 AI 换词只会破坏分级。中文释义也一并给出，
 * 免得 AI 按自己理解的义项造例句、和卡片上显示的释义对不上。
 */
export function enrichWordsPrompt(
  ctx: Ctx,
  words: { term: string; meaning_zh: string }[],
): string {
  return [
    `今天的主题是「${ctx.themeZh}」（${ctx.themeEn}）。学生水平 ${ctx.learner.level}。`,
    '',
    `下面这 ${words.length} 个词已经定好了，请为**每一个**补充教学内容。`,
    '不要替换任何词、不要增减、不要改写词形，term 原样回抄：',
    ...words.map((w) => `- ${w.term}（${w.meaning_zh}）`),
    '',
    '每个词要给出：',
    '- memory_hook_zh：具体的记忆抓手。可以是词根拆解、发音联想、画面感、或和易混词的对比。禁止写"多读几遍就记住了"这种空话。',
    '- collocations：这个词最常一起出现的搭配，学生背了就能直接用。',
    '- example_en：今天这个场景里真的会说出来的一句话，并给出 example_zh 翻译。',
    '- 例句要贴合上面给的中文释义那个义项，一个词有多个意思时不要跑到别的义项上。',
    mistakeBlock(ctx.mistakes),
  ].join('\n');
}

export function grammarPrompt(
  ctx: Ctx,
  point: { title_zh: string; explain_zh: string; pattern: string | null },
  targetWords: string[],
): string {
  return [
    `今天的主题是「${ctx.themeZh}」（${ctx.themeEn}）。这是语法环节。`,
    '',
    `今天的语法点：${point.title_zh}`,
    `教材原有讲解（供参考，你要写得更好）：${point.explain_zh}`,
    point.pattern ? `句型：${point.pattern}` : '',
    '',
    `请围绕今天主题重讲这个点，并尽量在例句里用上今天的目标词：${targetWords.join(', ')}。`,
    '',
    '要求：',
    '1. mini_lesson_zh 必须点明"中文会怎么说，英文必须怎么说"的差别。',
    /*
     * 全部四选一：不要改错题，也不要中译英。
     * 干扰项那条是重点 —— 不写清楚的话模型爱给三个明显不可能的选项，
     * 题就变成了看一眼就能排除，练不到东西。
     */
    '2. exercises 全部是四选一，只用两种 kind：choice（单选）和 cloze（完型填空，题干里留一个 ___）。',
    '   两种都要有，不要清一色。绝对不要出改错题、翻译题、或任何要自己写句子的题。',
    '3. 干扰项必须是中文母语者真会选错的那种（时态、介词、单复数、词序），',
    '   不要放明显不可能的选项。四个选项长度和形式要接近。',
    '4. answer 必须和 options 里的某一项一字不差。explain_zh 要说清另外三个为什么不对。',
    /*
     * 5 是被真实数据逼出来的：模型爱在题干和选项后补「（中文翻译）」——
     * am（是）、I am here…（我来这里开户。）——四个选项的翻译还一模一样，
     * 纯噪音，选错题还泄露线索。中文只许出现在 explain_zh。
     */
    '5. question 和 options 一律纯英文，禁止在括号里附中文翻译；题目指令也用简单英文写（如 Which is correct?），中文只出现在 explain_zh。',
    mistakeBlock(ctx.mistakes),
  ].join('\n');
}

export function listeningPrompt(ctx: Ctx, targetWords: string[]): string {
  return [
    `今天的主题是「${ctx.themeZh}」（${ctx.themeEn}）。这是听力环节。`,
    '',
    `写一段真实的对话，自然用上这些词：${targetWords.join(', ')}。`,
    '',
    '要求：',
    `1. 语速和用词贴近 ${ctx.learner.level}，句子短，有口语里真实的停顿词（well, actually, you know 之类，别过量）。`,
    '2. 对话要有个小转折或小问题，不要一问一答的平铺直叙。',
    '3. 问题考细节和推断，不要只考"对话发生在哪里"。',
    // 前端一人一个嗓音，靠 gender 挑男声女声，所以两三个人别都是同一个性别
    '4. 每句都填 speaker 和 gender，同一个人前后必须一致；两个人对话时安排成一男一女，听起来更好分。',
  ].join('\n');
}

export function readingPrompt(ctx: Ctx, targetWords: string[]): string {
  const interests = ctx.learner.interests.length ? ctx.learner.interests.join('、') : '通用生活话题';
  return [
    `今天的主题是「${ctx.themeZh}」（${ctx.themeEn}）。这是阅读环节。`,
    '',
    `写一篇 80-140 词的短文，自然嵌入这些词：${targetWords.join(', ')}。`,
    `如果能和学生的兴趣（${interests}）结合就更好。`,
    '',
    '要求：',
    '1. 写成有具体人物和细节的小故事或第一人称经历，不要写成百科说明文。',
    '2. glosses 里挑文中真正值得停下来讲的表达，说清它为什么这么用。',
    // 阅读题原来是开放式问答，现在也是四选一
    '3. questions 全部是四选一，选项用英文。不要出让学生自己写句子的开放题。',
    '4. 考细节和推断，答案必须能在文中找到依据；干扰项要像是文里说过但其实没说的那种。',
    '5. answer 必须和 options 里的某一项一字不差。explain_zh 要指出依据在原文哪一句。',
  ].join('\n');
}

export function speakingPrompt(ctx: Ctx, targetWords: string[]): string {
  return [
    `今天的主题是「${ctx.themeZh}」（${ctx.themeEn}）。这是口语环节，也是今天的收尾，学生要和你真的对话。`,
    '',
    `设计一个角色扮演场景，让学生必须用上这些词才能完成任务：${targetWords.join(', ')}。`,
    '',
    '要求：',
    '1. scenario_zh 要给学生一个明确的任务目标（例如"点一杯不太浓的大杯咖啡并问能不能续杯"），两三句话说完，不要超过 200 字。',
    '2. opening_en 是你作为角色说的第一句，要简单、自然、能让学生接得上话。',
    '3. useful_phrases 给学生卡住时能照着说的句型，要能直接用在这个场景。',
  ].join('\n');
}

export function chatSystemPrompt(
  l: Learner,
  role: string,
  scenarioZh: string,
  targetWords: string[],
): string {
  return [
    systemPrompt(l),
    '',
    '现在你在做角色扮演口语练习。',
    `你的角色：${role}`,
    `情境：${scenarioZh}`,
    targetWords.length ? `希望学生用上的词：${targetWords.join(', ')}` : '',
    '',
    '对话规则：',
    '1. 始终留在角色里，像真人一样回应，回复控制在 1-3 句。',
    `2. 你的英文必须贴近 ${l.level}，不要用学生听不懂的词。`,
    '3. 学生说错了，用 correction 字段温和指出，但 reply_en 里不要打断对话去纠错。',
    '4. 学生卡住或说中文时，用 suggestion_en 给他一个能直接照说的句子。',
    '5. 主动把话题往需要用上目标词的方向引，但不要生硬地命令他用某个词。',
  ].join('\n');
}

/**
 * 畅聊模式的旁路分析。
 *
 * 和 chatSystemPrompt 的区别：这里不生成回复 —— 回复由端到端语音模型直接出。
 * 这一路只负责「学生刚说的这句话有没有问题」和「有没有用上目标词」，
 * 结果异步补到界面上并进错题本。
 *
 * 输入是 ASR 转写，所以必须容忍口语特征：识别可能漏词、把 gonna 写成 going to、
 * 没有标点。只挑真正的语言错误，不要把转写噪声当成学生的错。
 */
export function coachingPrompt(
  l: Learner,
  opts: {
    scenarioZh: string;
    targetWords: string[];
    userText: string;
    history: string;
    /**
     * 这句转写里有汉字。不代表学生说了中文 —— 上游那个识别模型是中文为主的，
     * 把带中文口音的英文听成中文是它的常见失误（见 realtime/protocol.mjs 的 hasChinese）。
     * 置位时下面多给模型一条说明，让它自己判断是哪一种，而不是硬凑一条语法纠正。
     */
    maybeMisheard?: boolean;
  },
): string {
  return [
    systemPrompt(l),
    '',
    '学生正在做口语畅聊练习。你不需要回复他 —— 语音那一路已经回了。',
    '你只负责一件事：看他刚说的这句话，指出该纠正的地方。',
    '',
    `情境：${opts.scenarioZh}`,
    opts.targetWords.length ? `今天希望他说出口的词：${opts.targetWords.join(', ')}` : '',
    opts.history ? `\n之前几轮：\n${opts.history}` : '',
    '',
    `学生刚说（语音识别转写）：${opts.userText}`,
    '',
    '判断要求：',
    '1. 这是语音转写，没有标点、可能漏词或把口语缩略写成完整形式。这些都不算错，不要纠。',
    '2. 只挑真正的语言问题：语法错、用词不当、中式表达。发音问题这里看不出来，不要猜。',
    '3. 没有值得纠的就把 has_issue 设为 false，corrected_en 原样返回他的话，note_zh 给一句简短鼓励。',
    `4. corrected_en 要贴近 ${l.level}，改成他这个水平真能说出口的样子，不要改写成高级表达。`,
    '5. used_target_words 只填他确实说出来的目标词，同义替换不算。',
    /*
     * 转写成中文时额外给的一条。
     *
     * 不在这里做硬拦截（早先版本是直接 return null，把整条纠正吞掉），因为本地
     * 分不清「他说了中文」和「识别听错了」，而后者是用户实测里更常见的那一种。
     * 交给模型判：能还原出英文原意就正常纠，还原不出来就说清楚是识别的问题。
     */
    opts.maybeMisheard
      ? [
          '',
          '注意：这句转写里有汉字，但学生大概率说的是英文 —— 识别模型是中文为主的，' +
            '经常把带中文口音的英文按发音凑成汉字（比如 "I think so" 转成「爱think搜」、' +
            '"very good" 转成「维瑞古德」这类结果）。',
          '- 如果能猜出他想说的英文是什么，就按那句英文来纠，corrected_en 给英文，note_zh 里点一句「识别可能听错了」。',
          '- 如果猜不出来，把 has_issue 设为 false，corrected_en 留空字符串，' +
            'note_zh 说明这句没听清、让他再说一遍，不要凭空编一条语法错误。',
          '- 他要是真的在说中文，就把那句中文对应的英文写进 corrected_en，note_zh 鼓励他用英文说。',
        ].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 「试试这样说」的提示词（畅聊语音）。
 *
 * 时机和 coachingPrompt 完全不同：AI 刚说完话、轮到学生开口的那一两秒就要出结果，
 * 所以单独一路 —— 不落库、不等回合后的完整分析，fast 模型只产这一句话。
 * 输入里的「AI 刚说的话」来自中转层实转（此刻多半还没落库，查历史查不到它）。
 */
export function tipPrompt(
  l: Learner,
  opts: {
    scenarioZh: string;
    targetWords: string[];
    assistantText: string;
    history: string;
  },
): string {
  return [
    systemPrompt(l),
    '',
    '学生正在做口语畅聊练习。AI（对方）刚说完一句话，接下来轮到学生开口。',
    '你要给学生一句他接下来可以照着说的英文，帮他把话接下去。',
    '',
    `情境：${opts.scenarioZh}`,
    opts.targetWords.length ? `今天希望他说出口的词：${opts.targetWords.join(', ')}` : '',
    opts.history ? `\n之前几轮：\n${opts.history}` : '',
    '',
    `AI 刚说：${opts.assistantText}`,
    '',
    '要求：',
    `1. 给一句 ${l.level} 水平能直接照着说的简单英文：回应对方、向对方提问，或自然地把目标词用上。`,
    '2. 一句就好，贴着 AI 刚说的内容接话，不要解释语法，不要写成旁白。',
    '3. tip_zh 是它的中文意思，方便他先看懂再开口。',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 生成 AI 对话的练习场景。
 *
 * 两种入口共用这一个 prompt：
 * - 换一批：wish 为空，模型自由编，但要避开 avoid 里刚出现过的
 * - 自定义：wish 是用户原话，必须围绕它展开
 *
 * 关键约束是 target_terms —— 它决定了对话里说出口的词能不能计进 produced_count。
 * 所以宁可挑得少，也不要把场景里根本用不上的词硬塞进去：塞了之后 AI 会生硬地
 * 往那个词上引，对话立刻失真。
 */
export function scenariosPrompt(
  l: Learner,
  opts: {
    count: number;
    themeZh: string;
    targetWords: { term: string; meaning_zh: string }[];
    grammarZh: string | null;
    /** 用户自己写的话题；空字符串表示「换一批」 */
    wish: string;
    /** 已经出过的场景名，避免重复 */
    avoid: string[];
  },
): string {
  const words = opts.targetWords.length
    ? opts.targetWords.map((w) => `${w.term}（${w.meaning_zh}）`).join('、')
    : '（今天没有指定目标词）';
  return [
    systemPrompt(l),
    '',
    `请为这位学生设计 ${opts.count} 个口语练习场景。`,
    '',
    `今天的主题：${opts.themeZh}`,
    `今天的目标词：${words}`,
    opts.grammarZh ? `今天的语法点：${opts.grammarZh}` : '',
    opts.wish
      ? `学生明确说了想练的话题：「${opts.wish}」—— 所有场景必须围绕这个话题展开，从不同角度切入。`
      : '学生没指定话题，请根据他的兴趣和今天的主题自由发挥。',
    opts.avoid.length ? `下面这些场景刚出现过，换其他的：${opts.avoid.join('、')}` : '',
    '',
    '要求：',
    '1. 场景必须是他真实生活里会遇到的，不要课本式对话（不要「在图书馆借书」这种年代感错位的）。',
    '2. 几个场景之间要真的不一样 —— 不同地点、不同对象、不同目的，不要同一个场景换个说法。',
    `3. opening_en 要像真人开口，难度贴近 ${l.level}，不要上来就问开放得没边的大问题。`,
    '4. ai_role 写英文名词短语，包含身份和场合，比如 "a landlord showing an apartment"。',
    '5. target_terms 只挑这个场景里真的自然用得上的目标词，必须原样抄写。宁可少挑或不挑，不要硬凑。',
  ]
    .filter(Boolean)
    .join('\n');
}

export function lookupPrompt(l: Learner, term: string, context: string | null): string {
  return [
    `解释这个英文词或短语：${term}`,
    context ? `学生是在这个语境里遇到的：${context}` : '',
    `学生水平 ${l.level}，解释要够浅，例句要贴近${l.interests.join('、') || '日常生活'}。`,
    'confusable 里放真正容易混的词并说清区别；确实没有就返回空数组。',
  ].join('\n');
}

export function extractPrompt(l: Learner, title: string, raw: string): string {
  return [
    '学生扔进来一份自己感兴趣的素材，请从里面提取可学习的内容。',
    `标题/来源：${title}`,
    '',
    '素材内容：',
    '"""',
    raw.slice(0, 12_000),
    '"""',
    '',
    `学生水平 ${l.level}。挑词标准：对他来说是新的、且在真实交流中用得上。`,
    '过于简单的（the, have, good）和过于生僻专业的都不要。',
    'grammar_notes 里挑文中出现、值得学的句式，说清怎么套用。',
  ].join('\n');
}

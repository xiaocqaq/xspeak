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

export function newWordsPrompt(ctx: Ctx, existing: string[], count: number): string {
  return [
    `今天的主题是「${ctx.themeZh}」（${ctx.themeEn}）。这是新词环节。`,
    '',
    `请挑出 ${count} 个这个场景下真正高频、开口就要用到的词或短语，难度贴近 ${ctx.learner.level}。`,
    existing.length ? `以下词学生已经学过，不要重复：${existing.join(', ')}` : '',
    '',
    '每个词都要给出：',
    '- memory_hook_zh：具体的记忆抓手。可以是词根拆解、发音联想、画面感、或和易混词的对比。禁止写"多读几遍就记住了"这种空话。',
    '- collocations：这个词最常一起出现的搭配，学生背了就能直接用。',
    '- example_en：今天这个场景里真的会说出来的一句话。',
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
    '2. exercises 要混合题型：至少一道改错（fix）、一道中译英（translate）。',
    '3. 改错题的错误必须是中文母语者真会犯的，不要造不自然的错。',
    '4. kind=choice 的题给四个 options；fix / translate 的题不要带 options 字段。',
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
  ].join('\n');
}

export function speakingPrompt(ctx: Ctx, targetWords: string[]): string {
  return [
    `今天的主题是「${ctx.themeZh}」（${ctx.themeEn}）。这是口语环节，学生要和你真的对话。`,
    '',
    `设计一个角色扮演场景，让学生必须用上这些词才能完成任务：${targetWords.join(', ')}。`,
    '',
    '要求：',
    '1. scenario_zh 要给学生一个明确的任务目标（例如"点一杯不太浓的大杯咖啡并问能不能续杯"）。',
    '2. opening_en 是你作为角色说的第一句，要简单、自然、能让学生接得上话。',
    '3. useful_phrases 给学生卡住时能照着说的句型，要能直接用在这个场景。',
  ].join('\n');
}

export function writingPrompt(ctx: Ctx, targetWords: string[]): string {
  return [
    `今天的主题是「${ctx.themeZh}」（${ctx.themeEn}）。这是写作环节，也是今天的收尾。`,
    '',
    `出一个小写作任务，要求学生用上：${targetWords.join(', ')}。`,
    '',
    '要求：',
    `1. 任务量控制在 3-5 句，学生水平是 ${ctx.learner.level}，别出难度过高的题。`,
    '2. prompt_zh 要说清写几句、写什么、必须用哪些词。',
    '3. sample_en 是参考答案，必须是这个水平的学生真能写出来的，不要炫技。',
  ].join('\n');
}

export function correctionPrompt(
  l: Learner,
  promptEn: string,
  text: string,
  mustUse: string[],
): string {
  return [
    '批改学生的英文写作。',
    '',
    `题目：${promptEn}`,
    mustUse.length ? `要求用到的词：${mustUse.join(', ')}` : '',
    '',
    '学生写的：',
    '"""',
    text,
    '"""',
    '',
    '要求：',
    '1. summary_zh 先具体指出写得好的地方（不要泛泛地夸），再说主要问题。',
    '2. issues 里 wrong 字段必须是学生原文里的准确子串，方便前端高亮。',
    `3. corrected_en 保持学生的原意和大致句式，只改错和明显不自然的地方。不要替他重写成 ${l.level} 之上的漂亮文章。`,
    '4. 评分标准：能表达清楚意思就有 70 分以上；语法错误多但可懂 50-70；跑题或无法理解才低于 50。',
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
  opts: { scenarioZh: string; targetWords: string[]; userText: string; history: string },
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

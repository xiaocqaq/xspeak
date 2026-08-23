/**
 * 内置语法点：按 A1→B1 顺序排列，每条都带"中文讲透 + 例句 + 中国人常犯的坑"。
 * 语法点也进 FSRS 调度，所以你学过的点会在后面的日子里被重新考到。
 */
export type SeedGrammar = {
  slug: string;
  title_zh: string;
  title_en: string;
  cefr: string;
  explain_zh: string;
  pattern: string;
  examples: { en: string; zh: string }[];
  pitfalls: string[];
  ord: number;
};

export const SEED_GRAMMAR: SeedGrammar[] = [
  {
    slug: 'be-present',
    title_zh: 'be 动词现在式（am / is / are）',
    title_en: 'Present tense of "be"',
    cefr: 'A1',
    explain_zh:
      '英语句子几乎必须有动词。当你想说"某人/某物 是什么、怎么样、在哪里"，用 be 动词：I 配 am，he/she/it 和单数配 is，you/we/they 和复数配 are。中文说"我很累"没有动词，英语必须写成 I am tired。',
    pattern: '主语 + am/is/are + 名词/形容词/地点',
    examples: [
      { en: 'I am tired today.', zh: '我今天很累。' },
      { en: 'She is a nurse.', zh: '她是护士。' },
      { en: 'They are at the station.', zh: '他们在车站。' },
    ],
    pitfalls: ['漏掉 be：❌ I tired → ✅ I am tired', '形容词前加了 very 还是要 be：❌ He very busy → ✅ He is very busy'],
    ord: 1,
  },
  {
    slug: 'present-simple',
    title_zh: '一般现在时与第三人称单数 -s',
    title_en: 'Present simple and third-person -s',
    cefr: 'A1',
    explain_zh:
      '讲习惯、事实、常态用一般现在时。主语是 he/she/it 或单个人/物时，动词要加 -s（go→goes, study→studies）。否定和疑问借助 do/does，且此时动词回到原形。',
    pattern: '肯定：主语 + 动词(-s) ｜ 否定：主语 + don\'t/doesn\'t + 动词原形',
    examples: [
      { en: 'I work from home on Fridays.', zh: '我周五在家工作。' },
      { en: 'He watches a movie every weekend.', zh: '他每个周末看一部电影。' },
      { en: "She doesn't drink coffee.", zh: '她不喝咖啡。' },
    ],
    pitfalls: ['忘记加 -s：❌ He work here → ✅ He works here', 'doesn\'t 后面又加 -s：❌ She doesn\'t likes it → ✅ She doesn\'t like it'],
    ord: 2,
  },
  {
    slug: 'present-continuous',
    title_zh: '现在进行时（be + doing）',
    title_en: 'Present continuous',
    cefr: 'A1',
    explain_zh:
      '正在发生、或最近一段时间在持续的事，用 be + 动词-ing。和一般现在时的区别：I work here 是"我在这儿工作（常态）"，I am working 是"我此刻正在工作"。',
    pattern: '主语 + am/is/are + 动词-ing',
    examples: [
      { en: "I'm waiting for my coffee.", zh: '我在等我的咖啡。' },
      { en: 'She is learning English this year.', zh: '她今年在学英语。' },
      { en: "It's raining outside.", zh: '外面在下雨。' },
    ],
    pitfalls: ['漏掉 be：❌ I waiting → ✅ I am waiting', 'know/like/want 等状态动词一般不用进行时：❌ I am knowing → ✅ I know'],
    ord: 3,
  },
  {
    slug: 'articles',
    title_zh: '冠词 a / an / the',
    title_en: 'Articles a, an, the',
    cefr: 'A1',
    explain_zh:
      '首次提到、泛指一个可数单数名词用 a/an（元音音标开头用 an）；双方都清楚指哪一个时用 the。中文没有冠词，所以这是最容易漏的地方：说 I need pen 是错的，要说 I need a pen。',
    pattern: 'a/an + 首次提到的单数名词 ｜ the + 已知的特定对象',
    examples: [
      { en: 'I bought a cup. The cup is blue.', zh: '我买了一个杯子。那个杯子是蓝的。' },
      { en: 'She is an engineer.', zh: '她是工程师。' },
      { en: 'Can you close the window?', zh: '你能关一下窗户吗？' },
    ],
    pitfalls: ['漏冠词：❌ I am student → ✅ I am a student', 'an 只看发音不看字母：a university（发 /juː/），an hour（h 不发音）'],
    ord: 4,
  },
  {
    slug: 'plurals',
    title_zh: '名词复数',
    title_en: 'Plural nouns',
    cefr: 'A1',
    explain_zh:
      '可数名词表示两个以上要加 -s/-es（box→boxes, city→cities）。少数不规则：man→men, child→children, foot→feet。中文靠上下文表复数，英语必须在词尾体现。',
    pattern: '名词 + s/es ｜ 不规则变化单独记',
    examples: [
      { en: 'I have two brothers.', zh: '我有两个兄弟。' },
      { en: 'There are three boxes on the table.', zh: '桌上有三个盒子。' },
      { en: 'Many children like this song.', zh: '很多小孩喜欢这首歌。' },
    ],
    pitfalls: ['数字后忘记复数：❌ two book → ✅ two books', 'people 本身就是复数：❌ two peoples → ✅ two people'],
    ord: 5,
  },
  {
    slug: 'there-is-are',
    title_zh: 'There is / There are（存在句）',
    title_en: 'There is / There are',
    cefr: 'A1',
    explain_zh:
      '表示"某处有什么"，用 There is + 单数/不可数，There are + 复数。注意不要用 have：中文"这附近有一家药店"不能说 Here has a pharmacy。',
    pattern: 'There is/are + 名词 + 地点',
    examples: [
      { en: 'There is a pharmacy nearby.', zh: '附近有一家药店。' },
      { en: 'There are two seats left.', zh: '还剩两个座位。' },
      { en: 'Is there any milk?', zh: '有牛奶吗？' },
    ],
    pitfalls: ['用 have 表存在：❌ Here has a bank → ✅ There is a bank here', 'be 的单复数要跟后面的名词：There are three people'],
    ord: 6,
  },
  {
    slug: 'can-ability',
    title_zh: 'can 表能力与请求',
    title_en: 'can for ability and requests',
    cefr: 'A1',
    explain_zh:
      'can 后面永远跟动词原形，不加 to、不加 -s。既能说能力（I can swim），也能提请求（Can you help me?）。更客气的请求用 Could you...?',
    pattern: '主语 + can/can\'t + 动词原形',
    examples: [
      { en: 'I can speak a little English.', zh: '我能说一点英语。' },
      { en: "I can't hear you clearly.", zh: '我听不清你说话。' },
      { en: 'Could you say that again?', zh: '你能再说一遍吗？' },
    ],
    pitfalls: ['can 后加 to：❌ I can to go → ✅ I can go', 'can 后加 -s：❌ He can swims → ✅ He can swim'],
    ord: 7,
  },
  {
    slug: 'past-simple',
    title_zh: '一般过去时',
    title_en: 'Past simple',
    cefr: 'A1',
    explain_zh:
      '已经结束的事用过去式：规则动词加 -ed（work→worked），不规则要单独记（go→went, buy→bought, see→saw）。否定/疑问用 did，动词回原形。',
    pattern: '肯定：动词过去式 ｜ 否定：didn\'t + 动词原形',
    examples: [
      { en: 'I went to the doctor yesterday.', zh: '我昨天去看医生了。' },
      { en: "We didn't book a table.", zh: '我们没订桌。' },
      { en: 'Did you enjoy the movie?', zh: '你喜欢那部电影吗？' },
    ],
    pitfalls: ['didn\'t 后用过去式：❌ I didn\'t went → ✅ I didn\'t go', '有明确过去时间就别用现在完成时：yesterday 必须配过去式'],
    ord: 8,
  },
  {
    slug: 'future-will-going-to',
    title_zh: 'will 与 be going to',
    title_en: 'will vs be going to',
    cefr: 'A2',
    explain_zh:
      '临时决定、承诺、预测用 will；已经计划好、或有现实迹象用 be going to。例：（服务员来了）I\'ll have a latte（当场决定）；I\'m going to visit my parents this weekend（早计划好）。',
    pattern: 'will + 动词原形 ｜ am/is/are going to + 动词原形',
    examples: [
      { en: "I'll take the small one.", zh: '我要小杯的。' },
      { en: "I'm going to start the gym next month.", zh: '我下个月要开始健身。' },
      { en: 'It looks like it\'s going to rain.', zh: '看起来要下雨了。' },
    ],
    pitfalls: ['will 后加 to：❌ I will to go → ✅ I will go', 'going to 后用过去式：❌ going to went → ✅ going to go'],
    ord: 9,
  },
  {
    slug: 'comparatives',
    title_zh: '比较级与最高级',
    title_en: 'Comparatives and superlatives',
    cefr: 'A2',
    explain_zh:
      '短形容词加 -er/-est（cheap→cheaper→cheapest），长形容词用 more/most（expensive→more expensive）。比较对象前用 than，最高级前用 the。不规则：good→better→best，bad→worse→worst。',
    pattern: '形容词-er + than ｜ the + 形容词-est',
    examples: [
      { en: 'This one is cheaper than that one.', zh: '这个比那个便宜。' },
      { en: 'It was the best coffee in town.', zh: '那是城里最好的咖啡。' },
      { en: 'Today is more humid than yesterday.', zh: '今天比昨天更潮。' },
    ],
    pitfalls: ['双重比较级：❌ more cheaper → ✅ cheaper', '用 as 代替 than：❌ better as → ✅ better than'],
    ord: 10,
  },
  {
    slug: 'countable-uncountable',
    title_zh: '可数与不可数（some / any / much / many）',
    title_en: 'Countable and uncountable nouns',
    cefr: 'A2',
    explain_zh:
      'water、money、advice、information 这类不可数名词不加 -s，也不能用 a。数量表达要分开：many books / much water；肯定句常用 some，疑问和否定常用 any。',
    pattern: 'many/a few + 可数复数 ｜ much/a little + 不可数',
    examples: [
      { en: 'Is there any milk left?', zh: '还有牛奶吗？' },
      { en: 'I need some information about the room.', zh: '我需要一些房间的信息。' },
      { en: 'He gave me a lot of advice.', zh: '他给了我很多建议。' },
    ],
    pitfalls: ['不可数加 -s：❌ many informations → ✅ much information', '❌ an advice → ✅ a piece of advice'],
    ord: 11,
  },
  {
    slug: 'prepositions-time',
    title_zh: '时间介词 in / on / at',
    title_en: 'Prepositions of time',
    cefr: 'A2',
    explain_zh:
      '范围由大到小：in 配月份、年份、季节和"上下午"（in May, in 2026, in the morning）；on 配具体某天（on Monday, on May 3rd）；at 配钟点和 night（at 7 o\'clock, at night）。',
    pattern: 'in 月/年 ｜ on 具体某天 ｜ at 钟点',
    examples: [
      { en: 'The meeting is at three on Tuesday.', zh: '会议在周二三点。' },
      { en: 'I usually read in the evening.', zh: '我通常晚上读书。' },
      { en: 'She was born in 1998.', zh: '她 1998 年出生。' },
    ],
    pitfalls: ['❌ in Monday → ✅ on Monday', '❌ in night → ✅ at night'],
    ord: 12,
  },
  {
    slug: 'question-word-order',
    title_zh: '疑问句语序（含疑问词）',
    title_en: 'Question word order',
    cefr: 'A2',
    explain_zh:
      '英语疑问句要把助动词提到主语前：疑问词 + do/does/did/be + 主语 + 动词原形。中文疑问句语序不变（"你去哪儿"），英语必须倒装，这是口语最容易出错的地方。',
    pattern: '疑问词 + 助动词 + 主语 + 动词原形',
    examples: [
      { en: 'Where do you live?', zh: '你住哪儿？' },
      { en: 'What time does it open?', zh: '它几点开门？' },
      { en: 'How long have you been here?', zh: '你来这儿多久了？' },
    ],
    pitfalls: ['忘记倒装：❌ Where you live? → ✅ Where do you live?', '助动词后又变形：❌ Where does he lives → ✅ Where does he live'],
    ord: 13,
  },
  {
    slug: 'present-perfect',
    title_zh: '现在完成时（经历与影响）',
    title_en: 'Present perfect',
    cefr: 'A2',
    explain_zh:
      'have/has + 过去分词。用来讲"到现在为止的经历"（I have been to Japan）、"刚做完且影响还在"（I have lost my key）。有具体过去时间点时不能用它。for 接时间长度，since 接起点。',
    pattern: 'have/has + 过去分词',
    examples: [
      { en: "I've had this cough for three days.", zh: '我咳嗽三天了。' },
      { en: 'Have you ever tried Thai food?', zh: '你试过泰国菜吗？' },
      { en: "She hasn't finished the report yet.", zh: '她还没写完报告。' },
    ],
    pitfalls: ['配具体过去时间：❌ I have seen him yesterday → ✅ I saw him yesterday', 'for/since 混用：for two years / since 2024'],
    ord: 14,
  },
  {
    slug: 'would-like',
    title_zh: 'would like 与礼貌表达',
    title_en: 'Polite requests with would like',
    cefr: 'A2',
    explain_zh:
      'I want 在服务场景显得生硬，用 I would like（缩写 I\'d like）+ 名词或 to + 动词更得体。点单、订位、办事时最常用。',
    pattern: "I'd like + 名词 / to + 动词原形",
    examples: [
      { en: "I'd like a large americano, please.", zh: '我要一杯大杯美式。' },
      { en: "I'd like to make an appointment.", zh: '我想预约。' },
      { en: 'Would you like anything else?', zh: '还需要别的吗？' },
    ],
    pitfalls: ['❌ I would like to a coffee → ✅ I would like a coffee', '❌ I would like going → ✅ I would like to go'],
    ord: 15,
  },
  {
    slug: 'adverbs-frequency',
    title_zh: '频率副词的位置',
    title_en: 'Adverbs of frequency',
    cefr: 'A2',
    explain_zh:
      'always/usually/often/sometimes/never 放在一般动词之前、be 动词之后。never 本身表否定，不能再配 don\'t。',
    pattern: '主语 + 频率副词 + 一般动词 ｜ 主语 + be + 频率副词',
    examples: [
      { en: 'I usually take the bus.', zh: '我通常坐公交。' },
      { en: 'He is always late.', zh: '他总是迟到。' },
      { en: 'I never drink coffee at night.', zh: '我晚上从不喝咖啡。' },
    ],
    pitfalls: ['位置放错：❌ I take usually the bus → ✅ I usually take the bus', '双重否定：❌ I don\'t never → ✅ I never'],
    ord: 16,
  },
  {
    slug: 'modals-advice',
    title_zh: 'should / have to / must（建议与义务）',
    title_en: 'Modals for advice and obligation',
    cefr: 'B1',
    explain_zh:
      'should 是建议（你最好…）；have to 是外部要求（规定如此）；must 是说话人强烈认为必须。否定差别大：don\'t have to 是"不必"，mustn\'t 是"禁止"。',
    pattern: 'should / have to / must + 动词原形',
    examples: [
      { en: 'You should see a doctor.', zh: '你该去看医生。' },
      { en: 'I have to work this weekend.', zh: '我这周末得工作。' },
      { en: "You don't have to pay a deposit.", zh: '你不必付押金。' },
    ],
    pitfalls: ['混淆否定：don\'t have to（不必）≠ mustn\'t（禁止）', '❌ should to go → ✅ should go'],
    ord: 17,
  },
  {
    slug: 'gerund-infinitive',
    title_zh: '动词后接 to do 还是 doing',
    title_en: 'Infinitive vs gerund',
    cefr: 'B1',
    explain_zh:
      '有些动词后固定接 to do（want/decide/plan/hope/need），有些固定接 doing（enjoy/finish/avoid/mind/keep）。介词后一律用 doing（good at singing, interested in learning）。',
    pattern: 'want/plan + to do ｜ enjoy/finish + doing ｜ 介词 + doing',
    examples: [
      { en: 'I enjoy reading before bed.', zh: '我喜欢睡前看书。' },
      { en: 'I decided to change my plan.', zh: '我决定改计划。' },
      { en: "I'm interested in learning to cook.", zh: '我有兴趣学做饭。' },
    ],
    pitfalls: ['❌ I enjoy to read → ✅ I enjoy reading', '❌ good at swim → ✅ good at swimming'],
    ord: 18,
  },
  {
    slug: 'first-conditional',
    title_zh: '条件句（真实可能）',
    title_en: 'First conditional',
    cefr: 'B1',
    explain_zh:
      '讲"如果发生 A，就会 B"（有可能实现）：if 从句用现在时，主句用 will。注意 if 从句里不能用 will，这是中文直译最常见的错误。',
    pattern: 'If + 现在时, 主句 will + 动词原形',
    examples: [
      { en: "If it rains, we'll take a taxi.", zh: '如果下雨，我们就打车。' },
      { en: "I'll call you if I'm late.", zh: '我要是迟到就给你打电话。' },
      { en: "If you don't feel better, see a doctor.", zh: '如果没好转，去看医生。' },
    ],
    pitfalls: ['❌ If it will rain → ✅ If it rains', '两个分句都用 will 是错的'],
    ord: 19,
  },
  {
    slug: 'second-conditional',
    title_zh: '虚拟条件（不太可能/假设）',
    title_en: 'Second conditional',
    cefr: 'B1',
    explain_zh:
      '假设不现实的情况：If + 过去式, would + 动词原形。这里的过去式不表过去，只表"假设"。be 动词习惯用 were（If I were you）。',
    pattern: 'If + 过去式, would + 动词原形',
    examples: [
      { en: 'If I had more time, I would travel more.', zh: '如果我有更多时间，我会多旅行。' },
      { en: 'If I were you, I would take the aisle seat.', zh: '如果我是你，我会选靠走道的座位。' },
      { en: 'What would you do if you lost your phone?', zh: '如果你手机丢了会怎么办？' },
    ],
    pitfalls: ['❌ If I would have time → ✅ If I had time', 'would 后加 to：❌ would to travel → ✅ would travel'],
    ord: 20,
  },
  {
    slug: 'passive-voice',
    title_zh: '被动语态',
    title_en: 'Passive voice',
    cefr: 'B1',
    explain_zh:
      '不知道或不在意谁做的，用 be + 过去分词：My flight was delayed. 关注对象是"被影响的那个"。动作执行者用 by 引出（可省）。',
    pattern: 'be + 过去分词 (+ by 执行者)',
    examples: [
      { en: 'My flight was delayed by two hours.', zh: '我的航班延误了两小时。' },
      { en: 'Breakfast is served until ten.', zh: '早餐供应到十点。' },
      { en: 'The room hasn\'t been cleaned yet.', zh: '房间还没打扫。' },
    ],
    pitfalls: ['漏掉 be：❌ My flight delayed（意思变成航班自己延误了别人）', '用过去式代替过去分词：❌ was broke → ✅ was broken'],
    ord: 21,
  },
  {
    slug: 'relative-clauses',
    title_zh: '定语从句（who / which / that）',
    title_en: 'Relative clauses',
    cefr: 'B1',
    explain_zh:
      '用来补充说明前面的名词：人用 who，物用 which，两者都可用 that。中文把修饰语放名词前面（"我昨天买的杯子"），英语放后面（the cup that I bought yesterday）。',
    pattern: '名词 + who/which/that + 从句',
    examples: [
      { en: 'The colleague who helped me is on leave.', zh: '帮我的那位同事休假了。' },
      { en: 'This is the dish that I recommended.', zh: '这就是我推荐的那道菜。' },
      { en: 'I lost the receipt which had the price.', zh: '我丢了写着价格的那张收据。' },
    ],
    pitfalls: ['从句里重复宾语：❌ the cup that I bought it → ✅ the cup that I bought', '人物混用：人优先 who'],
    ord: 22,
  },
  {
    slug: 'reported-speech',
    title_zh: '间接引语',
    title_en: 'Reported speech',
    cefr: 'B1',
    explain_zh:
      '转述别人的话时，主句是过去时，从句时态通常往后退一格：is→was, will→would, can→could。人称和时间词也要跟着变（today→that day）。',
    pattern: 'He said (that) + 从句（时态后退）',
    examples: [
      { en: 'She said she was busy.', zh: '她说她很忙。' },
      { en: 'He told me he would call later.', zh: '他跟我说他晚点打电话。' },
      { en: 'They said the flight had been delayed.', zh: '他们说航班延误了。' },
    ],
    pitfalls: ['时态不后退：❌ She said she is busy（口语可接受，考试算错）', 'say 和 tell 用法不同：tell 后必须接人'],
    ord: 23,
  },
  {
    slug: 'phrasal-verbs',
    title_zh: '动词短语与可分性',
    title_en: 'Phrasal verbs',
    cefr: 'B1',
    explain_zh:
      'pick up、drop off、figure out 这类短语在口语里极常用。可分的短语，代词必须放中间：pick it up（不能说 pick up it）。不可分的（look after）不能拆。',
    pattern: '动词 + 副词/介词（代词放中间）',
    examples: [
      { en: 'Can you drop me off at the corner?', zh: '你能在拐角放我下车吗？' },
      { en: "I can't figure it out.", zh: '我搞不明白。' },
      { en: 'She looks after her little brother.', zh: '她照顾她弟弟。' },
    ],
    pitfalls: ['代词放后面：❌ pick up it → ✅ pick it up', '硬拆不可分短语：❌ look her after → ✅ look after her'],
    ord: 24,
  },
];

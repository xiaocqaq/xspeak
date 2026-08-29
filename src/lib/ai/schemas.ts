import { z } from 'zod';

/** 各环节 AI 输出的结构约束。前端直接按这些类型渲染。 */

/*
 * 所有测试题都是四选一。
 *
 * 原来语法有改错（fix）和中译英（translate）、阅读是开放式问答，都要自己写英文再
 * 跟参考答案对照、自评对错。用户要求去掉这两类，只留单选和完型填空 —— 所以判题
 * 从「自评」变成了「机器判」，错题本记的也是真选错的那一项，不再是自己说错了。
 *
 * 提取成一个共享定义而不是各处抄一遍：三个环节的题型现在完全一样，抄三遍迟早漂移。
 * 听力本来就是这个形状且一直好用，所以这里照它写。
 */
const CHOICE_FIELDS = {
  options: z.array(z.string()).length(4).describe('四个选项，长度接近、干扰项要合理'),
  answer: z.string().describe('正确选项，必须和 options 里的某一项一字不差'),
  explain_zh: z.string().describe('中文讲解：为什么是它，另外几个为什么不对'),
};

/** 四选一的题。题干用 q_zh。 */
export const ChoiceQuestion = z.object({
  q_zh: z.string().describe('中文问题'),
  ...CHOICE_FIELDS,
});

export const ClozeItem = z.object({
  term: z.string().describe('要考的目标单词原形'),
  sentence_en: z.string().describe('含空格的英文句子，目标词位置用 ___ 代替'),
  sentence_zh: z.string().describe('整句中文意思'),
  hint_zh: z.string().describe('一句极短的中文提示，不能直接写出答案'),
  options: z.array(z.string()).length(4).describe('四个选项，其中一个是正确答案原形或正确变形'),
  answer: z.string().describe('正确选项，必须和 options 里的某一项完全一致'),
  why_zh: z.string().describe('为什么选它，一两句中文'),
});

export const WarmupPayload = z.object({
  intro_zh: z.string().describe('一句话开场，把今天主题和这批复习词联系起来'),
  /** 2026-08-28 混合题型：AI 完形只出前 AI_CLOZE_CAP 个，剩余词前端用零 AI 的释义单选补 */
  items: z.array(ClozeItem).min(0).describe('每个待复习单词一题，语境必须是全新的'),
});

export const NewWord = z.object({
  term: z.string(),
  phonetic: z.string().describe('美式音标，带斜杠'),
  pos: z.string().describe('词性缩写，如 n. v. adj. phr.'),
  meaning_zh: z.string(),
  meaning_en: z.string().describe('用更简单的英文解释，控制在 12 词内'),
  example_en: z.string().describe('贴合今天主题的例句'),
  example_zh: z.string(),
  memory_hook_zh: z.string().describe('一句记忆抓手：词根、谐音、画面感或对比易混词，要具体'),
  collocations: z.array(z.string()).min(1).max(3).describe('最常用的搭配，如 place an order'),
});

/*
 * 这里原来有个 NewWordsPayload（intro_zh + 一整批 AI 选的词）。
 * 选词改成走词典分级词表之后没人用了，删掉免得又被当成"新词环节的返回格式"。
 * NewWord 本身留着 —— 导入材料时确实要 AI 从原文里挑词。
 */

/**
 * 只补词典给不了的教学内容，不让 AI 选词。
 *
 * 和 NewWord 的差别是刻意的：term / meaning_zh 由调用方给定（AI 只是回抄，
 * 用来对齐是哪个词），phonetic 不要 —— 词典的音标比 AI 编的准。
 * 字段少一半，产出的 token 也少一半。
 */
export const WordDetail = z.object({
  term: z.string().describe('必须和给定的词完全一致，不要改写、不要换成别的词'),
  pos: z.string().describe('词性缩写，如 n. v. adj. phr.'),
  meaning_en: z.string().describe('用更简单的英文解释，控制在 12 词内'),
  example_en: z.string().describe('贴合今天主题的例句，一句话'),
  example_zh: z.string().describe('例句的中文翻译'),
  memory_hook_zh: z.string().describe('一句记忆抓手：词根、谐音、画面感或对比易混词，要具体'),
  collocations: z.array(z.string()).min(1).max(3).describe('最常用的搭配，如 place an order'),
});

export const EnrichWordsPayload = z.object({
  words: z.array(WordDetail).min(1),
});

export const GrammarExercise = z.object({
  /*
   * 只剩这两种，都是四选一。
   * cloze 的题干带 ___，choice 的题干是完整句子或提问 —— 差别只在题干长相，
   * 判题逻辑一样。留着这个字段是因为它能让界面上的标签说得准一点。
   */
  kind: z.enum(['choice', 'cloze']).describe('choice=单选 cloze=完型填空（题干里用 ___ 留空）'),
  question: z.string().describe('题干；kind=cloze 时必须含一个 ___'),
  ...CHOICE_FIELDS,
});

export const GrammarPayload = z.object({
  focus_zh: z.string().describe('用一句话说明今天这个语法点在本主题里怎么用得上'),
  mini_lesson_zh: z.string().describe('150 字内的中文讲解，允许换行，重点讲和中文的差别'),
  examples: z.array(z.object({ en: z.string(), zh: z.string() })).min(2).max(4),
  exercises: z.array(GrammarExercise).min(3).max(5),
});

export const ListeningPayload = z.object({
  scene_zh: z.string().describe('场景说明，一句中文'),
  dialogue: z
    .array(
      z.object({
        speaker: z.string().describe('说话人名字，两三个人轮流'),
        /*
         * 前端一人一个嗓音，靠这个字段挑男声/女声。
         * optional 是为了老缓存 —— 加这个字段之前生成的对话没有它，
         * 缺了就退回按名字猜（见 useSpeech 的 buildVoiceCast）。
         */
        gender: z
          .enum(['male', 'female'])
          .optional()
          .describe('这个说话人的性别，用来给他挑朗读嗓音；同一个人每句都要填一样的'),
        text_en: z.string(),
        text_zh: z.string(),
      }),
    )
    .min(4)
    .max(10),
  questions: z.array(ChoiceQuestion).min(2).max(4),
});

export const ReadingPayload = z.object({
  title_en: z.string(),
  title_zh: z.string(),
  passage_en: z.string().describe('80-140 词的短文，自然嵌入今天的目标词'),
  passage_zh: z.string().describe('整段中文翻译'),
  glosses: z
    .array(z.object({ term: z.string(), meaning_zh: z.string(), note_zh: z.string() }))
    .min(2)
    .describe('文中值得单独讲的词或短语'),
  // 原来是开放式问答（自己写英文再对参考答案），按要求改成四选一
  questions: z.array(ChoiceQuestion).min(2).max(3).describe('四选一，答案必须能在文中找到依据'),
});

export const SpeakingPayload = z.object({
  scenario_zh: z.string().describe('角色设定和情境，中文说明你要做什么'),
  ai_role: z.string().describe('AI 扮演的角色，英文，如 a barista at a busy café'),
  opening_en: z.string().describe('AI 的第一句话，简单、自然、能引出对话'),
  opening_zh: z.string(),
  must_use: z.array(z.string()).min(2).describe('必须用上的目标词'),
  useful_phrases: z
    .array(z.object({ en: z.string(), zh: z.string() }))
    .min(3)
    .max(5)
    .describe('卡住时可以照着说的句型'),
});

/** 口语对话回复 */
export const ChatReplyPayload = z.object({
  reply_en: z.string().describe('自然的英文回应，1-3 句，保持对话推进'),
  reply_zh: z.string().describe('中文翻译'),
  correction: z
    .object({
      has_issue: z.boolean(),
      corrected_en: z.string().describe('没问题就原样返回用户的话'),
      note_zh: z.string().describe('没问题就给一句鼓励'),
    })
    .describe('对用户上一句的即时纠正，语气要温和'),
  used_target_words: z.array(z.string()).describe('用户这句话里用上的目标词'),
  suggestion_en: z.string().describe('给用户下一句可以怎么接的提示，一句英文'),
});

/**
 * 畅聊模式的旁路分析。
 *
 * 端到端语音模型只负责把对话撑住，不返回纠正。这个 schema 给的是
 * 「学生刚说的那句话」的教学侧结果：没有 reply_en，因为回复已经由语音给出了。
 */
export const CoachingPayload = z.object({
  correction: z
    .object({
      has_issue: z.boolean().describe('这句话是否有需要纠正的问题'),
      corrected_en: z.string().describe('没问题就原样返回学生的话'),
      note_zh: z.string().describe('一句中文说明；没问题就给一句简短鼓励'),
    })
    .describe('对学生这句话的纠正，语气温和'),
  used_target_words: z.array(z.string()).describe('学生这句话里真正用上的目标词，没有就空数组'),
});

/**
 * 「试试这样说」提示，独立于 CoachingPayload。
 *
 * 提示要在 AI 说完话的瞬间就到（赶在学生开口之前），不能陪着回合后的完整分析
 * 慢慢跑 —— 所以单独一个 schema、单独一个接口（/api/realtime/tip）、单独的
 * 提示词（tipPrompt），只产出这一句话。
 */
export const TipPayload = z.object({
  tip_en: z
    .string()
    .describe('给学生的下一句提示：一句他能直接照着说的简单英文，帮助对话继续或用上目标词'),
  tip_zh: z.string().describe('tip_en 的中文意思'),
});

/** 查词 */
export const LookupPayload = z.object({
  term: z.string(),
  phonetic: z.string(),
  pos: z.string(),
  meaning_zh: z.string(),
  meaning_en: z.string(),
  cefr: z.enum(['A1', 'A2', 'B1', 'B2', 'C1']),
  examples: z.array(z.object({ en: z.string(), zh: z.string() })).min(2).max(3),
  memory_hook_zh: z.string(),
  confusable: z.array(z.object({ term: z.string(), diff_zh: z.string() })).describe('易混词，没有就空数组'),
});

/** 从你自己扔进来的素材里抽取学习内容 */
export const ExtractPayload = z.object({
  title: z.string(),
  summary_zh: z.string().describe('三句以内的中文摘要'),
  words: z.array(NewWord).min(1).max(15).describe('值得学的词，按你的水平挑，太简单的不要'),
  grammar_notes: z
    .array(z.object({ title_zh: z.string(), explain_zh: z.string(), example_en: z.string() }))
    .max(4)
    .describe('文中出现的值得讲的句式'),
});

/**
 * AI 对话的场景生成。
 *
 * 和其他 payload 的区别：这里生成的是「练什么」的容器，不是练习内容本身。
 * ai_role 必须是英文 —— 它会原样进 realtime 的 instructions；其余字段给界面看。
 */
export const ScenarioItem = z.object({
  zh: z.string().describe('场景名，4-8 个中文字，像「和房东谈租房」这种一眼看懂的'),
  hint: z.string().describe('这个场景里会聊到什么，中文，10-18 字，用顿号分隔要点'),
  ai_role: z
    .string()
    .describe('AI 扮演的角色，英文，形如 "a friendly barista at a busy coffee shop"，不要写成句子'),
  opening_en: z.string().describe('AI 的第一句话，英文，1-2 句，自然像真人开口'),
  opening_zh: z.string().describe('开场白的中文翻译'),
  target_terms: z
    .array(z.string())
    .describe('这个场景真的用得上的今日目标词，从给定列表里挑，挑不到就空数组'),
});

export const ScenariosPayload = z.object({
  scenarios: z.array(ScenarioItem).min(1).max(8),
});

export type WarmupData = z.infer<typeof WarmupPayload>;
export type GrammarData = z.infer<typeof GrammarPayload>;
export type ListeningData = z.infer<typeof ListeningPayload>;
export type ReadingData = z.infer<typeof ReadingPayload>;
export type SpeakingData = z.infer<typeof SpeakingPayload>;
export type ChatReplyData = z.infer<typeof ChatReplyPayload>;
export type CoachingData = z.infer<typeof CoachingPayload>;
export type LookupData = z.infer<typeof LookupPayload>;
export type ExtractData = z.infer<typeof ExtractPayload>;
export type NewWordData = z.infer<typeof NewWord>;
export type WordDetailData = z.infer<typeof WordDetail>;
export type EnrichWordsData = z.infer<typeof EnrichWordsPayload>;
export type ScenariosData = z.infer<typeof ScenariosPayload>;
export type ScenarioItemData = z.infer<typeof ScenarioItem>;
export type ChoiceQuestionData = z.infer<typeof ChoiceQuestion>;
export type GrammarExerciseData = z.infer<typeof GrammarExercise>;

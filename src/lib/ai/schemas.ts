import { z } from 'zod';

/** 各环节 AI 输出的结构约束。前端直接按这些类型渲染。 */

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
  items: z.array(ClozeItem).min(1).describe('每个待复习单词一题，语境必须是全新的'),
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

export const NewWordsPayload = z.object({
  intro_zh: z.string(),
  words: z.array(NewWord).min(1),
});

export const GrammarExercise = z.object({
  kind: z.enum(['choice', 'fix', 'translate']).describe('choice=选择 fix=改错 translate=中译英'),
  question: z.string().describe('题干；fix 类型给出含错误的英文句子；translate 给中文'),
  // fix / translate 题没有选项。要求模型显式给空数组它经常直接省略字段，
  // 所以这里给个默认值：缺字段就当空数组，前端按 options.length 判断是否渲染选择题。
  options: z
    .array(z.string())
    .default([])
    .describe('仅 kind=choice 时给四个选项；fix / translate 不要给这个字段'),
  answer: z.string().describe('参考答案'),
  explain_zh: z.string().describe('讲清为什么，并指出中文母语者容易踩的点'),
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
        text_en: z.string(),
        text_zh: z.string(),
      }),
    )
    .min(4)
    .max(10),
  questions: z
    .array(
      z.object({
        q_zh: z.string(),
        options: z.array(z.string()).length(4),
        answer: z.string(),
        explain_zh: z.string(),
      }),
    )
    .min(2)
    .max(4),
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
  questions: z
    .array(z.object({ q_zh: z.string(), answer_en: z.string(), explain_zh: z.string() }))
    .min(2)
    .max(3)
    .describe('开放式问题，答案要能在文中找到依据'),
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

export const WritingPayload = z.object({
  prompt_en: z.string().describe('写作任务，英文'),
  prompt_zh: z.string().describe('中文说明，讲清要写几句、写什么'),
  must_use: z.array(z.string()).min(2),
  sample_en: z.string().describe('一个 A2 水平能写出来的参考答案'),
  checklist_zh: z.array(z.string()).min(2).max(4).describe('自检要点'),
});

/** 写作批改 */
export const CorrectionPayload = z.object({
  score: z.number().min(0).max(100),
  corrected_en: z.string().describe('改好的版本，尽量保留原意和原有句式'),
  summary_zh: z.string().describe('两三句总体评价，先说做对的地方'),
  issues: z
    .array(
      z.object({
        wrong: z.string().describe('原文里出问题的片段，必须是原文子串'),
        correct: z.string(),
        kind: z.enum(['grammar', 'word_choice', 'spelling', 'style']),
        note_zh: z.string(),
      }),
    )
    .describe('没有问题就给空数组'),
  used_target_words: z.array(z.string()).describe('实际用上的目标词'),
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

export type WarmupData = z.infer<typeof WarmupPayload>;
export type NewWordsData = z.infer<typeof NewWordsPayload>;
export type GrammarData = z.infer<typeof GrammarPayload>;
export type ListeningData = z.infer<typeof ListeningPayload>;
export type ReadingData = z.infer<typeof ReadingPayload>;
export type SpeakingData = z.infer<typeof SpeakingPayload>;
export type WritingData = z.infer<typeof WritingPayload>;
export type CorrectionData = z.infer<typeof CorrectionPayload>;
export type ChatReplyData = z.infer<typeof ChatReplyPayload>;
export type CoachingData = z.infer<typeof CoachingPayload>;
export type LookupData = z.infer<typeof LookupPayload>;
export type ExtractData = z.infer<typeof ExtractPayload>;
export type NewWordData = z.infer<typeof NewWord>;

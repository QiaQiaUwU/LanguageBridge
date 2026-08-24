
export type LevelType = 'CET4' | 'CET6' | '考研' | 'TOEFL' | 'IELTS' | 'GRE' | 'SAT' | '高考'

export interface LearningRecord {
  lastReview: string; // ISO日期字符串
  nextReview: string; // ISO日期字符串
  familiarity: number; // 0-100
  reviewCount: number;
  testScore?: number; // 最近听写得分
  consecutiveCorrect?: number;
  consecutiveWrong?: number;
  totalWrongCount?: number;
}

export interface WordMeaning {
  chinese: string;
  english?: string;
  partOfSpeech: string;
  examples?: string[];
  synonyms?: string[];
  root?: string;
  exampleSentences?: {
    english: string;
    chinese: string;
  }[];
}

export interface WordMorphology {
  plural?: string;           // 复数
  third_person?: string;      // 第三人称单数
  present_participle?: string; // 现在分词
  past_tense?: string;        // 过去式
  past_participle?: string;   // 过去分词
  comparative?: string;       // 比较级
  superlative?: string;       // 最高级
}

export interface WordPhrase {
  phrase_en: string;
  phrase_zh: string;
  example_en?: string;
  example_zh?: string;
}

export interface WordSynonym {
  word: string;
  difference?: string;       // 与原词的区别说明
}

export interface WordExample {
  en: string;
  zh: string;
  note?: string;
}

export type WordStatus = 'unmarked' | 'known' | 'fuzzy' | 'unknown'

export interface WordItem {
  id: string;
  word: string;
  phonetic: string;
  status?: WordStatus;
  groupId?: string;
  meanings: WordMeaning[];
  level: LevelType;
  source?: string;
  audioUrl?: string;
  createdAt: string;
  updatedAt: string;
  learningRecord?: LearningRecord;
  tags?: string[];
  isCustom?: boolean;

  morphology?: WordMorphology;
  etymology?: string;
  memory_tips?: string;
  common_phrases?: WordPhrase[];
  synonyms?: WordSynonym[];
  antonyms?: { word: string; note?: string }[];
  word_family?: string[];
  example_sentences?: WordExample[];
  detailed_explanation?: string;

  topics?: string[];

  morphemes?: {
    prefix?: { form: string; meaning: string };
    root?: { form: string; meaning: string };
    suffix?: { form: string; meaning: string };
  };

  aiEnrichedAt?: string;

  /**
   * 每一项各自的"跑过"时间。
   *
   * 原来只有 aiEnrichedAt 一个布尔式的戳：跑过一次就整个词条算"试过了"，
   * 之后缺什么都不再跑。可早期那几轮**只要话题和词根**，
   * 释义、音标、例句压根没进过请求 —— 却被这个戳一并标记成"跑过但没填上"，
   * 从此再也补不上。界面上"缺中文释义 1759"和"七项里有缺的词 15"两个数
   * 对不上，就是这么来的。
   *
   * 改成按项记：只有这一项真的请求过，才算它跑过。
   */
  aiEnrichedFields?: Record<string, string>;

  /**
   * 「补全释义与音标」跑过这个词的时间。
   *
   * 判定要不要补，不能只看数据缺不缺 —— 词典和接口都查不到的词
   * （生僻词、词组、专有名词）补完还是缺，于是每次都被重新送一遍、
   * 每次都失败，界面上那个"还有 N 个信息不全"永远不降。
   * 盖了戳的下次跳过，想强制重跑得自己勾。
   */
  basicEnrichedAt?: string;

  /**
   * 用户自己给这个词记的笔记（练习卡片上那个「笔记」按钮写的）。
   * 跟 memory_tips 分开：那个是 AI 补的记忆法，这个是人写的。
   */
  userNote?: string;
}

export interface WordGroup {
  id: string;
  name: string;
  description: string;
  wordIds: string[];
  createdAt: string;
  updatedAt: string;
  color?: string;
  parentId?: string; // 用于树形分组
  order?: number; // 排序权重

  lastLearnIndex?: number;
  perDayStudyNumber?: number;
  complete?: boolean;
  system?: boolean;
}

export interface FsrsCard {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: string;
  learning_steps?: number;
}

export interface StudyStatistics {
  startDate: number;
  spend: number;
  total: number;
  newCount: number;
  reviewCount: number;
  wrong: number;
  segments?: [number, number][];
  sessionRole?: 'single' | 'start' | 'middle' | 'end';
}

export interface ImportResult {
  successCount: number;
  failCount: number;
  total: number;
  messages: string[];
}

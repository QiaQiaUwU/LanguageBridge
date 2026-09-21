
export interface ArticleSentence {
  en: string
  zh: string
  audioStart?: number
  audioEnd?: number
  /**
   * 双语音频里这句中文朗读的起点（秒）。
   * 有它就能「只播英文」= [audioStart, audioZhStart]。
   */
  audioZhStart?: number
  /** 自然段的第一句：双语对照按段排 */
  para?: boolean
  /** 不是朗读内容（Part 1、题组标题这类），对轴时跳过 */
  noAlign?: boolean
}

export interface ArticleMark {
  id: string
  text: string
  sentIdx?: number
  localStart?: number
  localEnd?: number
  start: number
  end: number
  color: string
  note?: string
  zhText?: string
  createdAt: string
}

export interface ArticleChapter {
  title: string
  sentenceIndex: number
}

export interface Article {
  id: string
  title: string
  rawEnglish: string
  sentences: ArticleSentence[]
  source: string
  sourceUrl?: string
  notes: string
  reciteDraft?: string
  reciteDrafts?: string[]
  needsCleanup?: boolean
  groupId?: string
  bookmarked?: boolean
  completed?: boolean
  marks?: ArticleMark[]
  chapters?: ArticleChapter[]
  chapterNotes?: string[]
  /** 书签：上次读到哪一章的起始句号。下次打开自动展开到这里。 */
  lastChapter?: number

  /**
   * 这一条是一本书。书本身不存正文，只按顺序引用若干篇文章当章节。
   * 列表里书显示成一个带书脊的框，被收进书里的章节不再单独出现。
   */
  isBook?: boolean
  /** 章节顺序：文章 id 列表 */
  chapterIds?: string[]
  /** 读到第几章（下标）。对应 TypeWords 的 Dict.lastLearnIndex */
  lastLearnIndex?: number
  /** 被收进哪本书。有值的文章在列表里隐藏。 */
  partOfBook?: string
  /** 列表里的手动排序位置。没有这个字段的按创建时间排在后面。 */
  sortIndex?: number
  /** 置顶：排在列表最前，不受手动排序影响 */
  pinned?: boolean
  /** 收藏 */
  starred?: boolean
  vocabBookId?: string
  /**
   * 试题（雅思阅读这类）：正文照常存在 sentences 里，题目单独存结构，按试卷的样子渲染。
   * 有这个字段的文章不分章节。
   */
  exam?: import('@/shared/core/examPaper').ExamPaper
  /** 自己做的答案：题号 → 答案 */
  examAnswers?: Record<number, string>
  /** 作文题：自己写的作文 */
  examEssay?: string
  audioFileName?: string
  audioUrl?: string
  createdAt: string
  updatedAt: string
}

export interface ArticleGroup {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  bookNotes?: string[]
}

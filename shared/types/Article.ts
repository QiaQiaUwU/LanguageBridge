
export interface ArticleSentence {
  en: string
  zh: string
  audioStart?: number
  audioEnd?: number
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
  vocabBookId?: string
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

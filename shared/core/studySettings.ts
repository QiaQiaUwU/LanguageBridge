
const STORAGE_KEY = 'lb-study-settings'

export type PracticeMode =
  | 'system'        // 完整流程：新词跟写→听写→默写，旧词自测→听写→默写
  | 'free'          // 自由：只跟写，不分阶段
  | 'identifyOnly'  // 只自测
  | 'dictationOnly' // 只默写
  | 'listenOnly'    // 只听写
  | 'review'        // 只复习旧词（自测→听写→默写）
  | 'shuffle'       // 随机复习：新词旧词混在一起，全部默写

export type PracticeType = 'followWrite' | 'spell' | 'identify' | 'listen' | 'dictation'

export type PracticeStage =
  | 'followWriteNew' | 'identifyNew' | 'listenNew' | 'dictationNew'
  | 'followWriteReview' | 'identifyReview' | 'listenReview' | 'dictationReview'
  | 'shuffle' | 'complete'

export interface StudySettings {
  wordReviewRatio: number

  soundType: 'uk' | 'us'
  fsrsParameters: number[]
  fsrsEasyLimit: number
  fsrsGoodLimit: number
  fsrsHardLimit: number

  autoNextWord: boolean
  waitTimeForChangeWord: number
  spaceCooldownTime: number
  inputWrongClear: boolean
  ignoreCase: boolean
  allowSpellVariant: boolean
  repeatCount: number
  repeatCustomCount: number
  ignoreSymbol: boolean
  identifyMethod: 'self' | 'choice'
  practiceSentence: boolean

  wordSound: boolean
  wordSoundSpeed: number
  wordSoundVolume: number
  keyboardSound: boolean
  keyboardSoundFile: string
  keyboardSoundVolume: number
  effectSound: boolean
  effectSoundVolume: number
  ttsVoice: string
  showEtymologyAndRelWords: boolean
  autoPlayFirstSentence: boolean

  showTranslate: boolean
  ignoreSimpleWord: boolean
  practiceMode: PracticeMode

  allowWordTip: boolean
  showNearWord: boolean
  sentenceSoundVolume: number
  sentenceSoundSpeed: number
  fontSize: {
    wordForeign: number
    wordTranslate: number
    articleForeign: number
    articleTranslate: number
  }
  shortcutKeyMap: {
    showTip: string
    replaySound: string
    skipWord: string
    /** 标记/取消「已掌握」，对应 TypeWords 的 ToggleSimple（它默认是 `） */
    toggleMastered: string
    /** 把这个词收藏进某个词表，对应它的 ToggleCollect */
    collectWord: string
    /** 给这个词写笔记 */
    editNote: string
  }
  articleAutoPlayNext: boolean
  articleSoundVolume: number
  articleSoundSpeed: number

  scenarioEvery: number
  autoMarkStatus: boolean

  /**
   * 练完判成「认识」的词，要不要顺手收进已掌握词表。
   * 收进去就不再排课，所以已掌握那页可以逐个移出。
   */
  autoMasterKnown: boolean

  /** 卡片背单词是否要先把词敲出来（关掉就是普通闪卡） */
  flashcardTyping: boolean

  /**
   * 一组几个词：跟写完这一组就回头拼写这一组，然后再跟写下一组。
   * 上游 TypeWords 写死 7（practice-words/[id].vue 的 `const groupSize = 7`），
   * 设置里也没这一项。这里默认同样是 7，但做成可调 ——
   * 7 个一组对长词偏多、对短词偏少，没有理由不让人改。
   */
  groupSize: number

  /** 卡片消消乐：一页放多少对、要不要打乱顺序 */
  matchPairsPerPage: number
  matchShuffle: boolean
  statusKnownLimit: number
  statusFuzzyLimit: number
}

export function statusFromWrongTimes(times: number, s: StudySettings): 'known' | 'fuzzy' | 'unknown' {
  if (times <= s.statusKnownLimit) return 'known'
  if (times <= s.statusFuzzyLimit) return 'fuzzy'
  return 'unknown'
}

export const DEFAULT_STUDY_SETTINGS: StudySettings = {
  wordReviewRatio: 3,

  soundType: 'us',
  fsrsParameters: [],
  fsrsEasyLimit: 0,
  fsrsGoodLimit: 3,
  fsrsHardLimit: 6,

  autoNextWord: true,
  waitTimeForChangeWord: 300,
  spaceCooldownTime: 300,
  inputWrongClear: false,
  ignoreCase: true,
  allowSpellVariant: true,
  repeatCount: 1,   // 100 = 用 repeatCustomCount，跟 TypeWords 的哨兵值一致
  repeatCustomCount: 3,
  ignoreSymbol: false,
  identifyMethod: 'self',
  practiceSentence: false,

  wordSound: true,
  wordSoundSpeed: 1,
  wordSoundVolume: 100,
  keyboardSound: true,
  keyboardSoundFile: '机械键盘2',   // 对齐 TypeWords 的 SoundFileOptions，用别的值会落到合成音兜底
  keyboardSoundVolume: 100,
  effectSound: true,
  effectSoundVolume: 100,
  ttsVoice: '',
  showEtymologyAndRelWords: false,
  autoPlayFirstSentence: false,

  showTranslate: true,
  ignoreSimpleWord: false,
  practiceMode: 'system',

  allowWordTip: true,
  showNearWord: true,
  sentenceSoundVolume: 100,
  sentenceSoundSpeed: 1,
  fontSize: {
    wordForeign: 64,
    wordTranslate: 20,
    articleForeign: 20,
    articleTranslate: 16
  },

  shortcutKeyMap: {
    showTip: 'Tab',
    replaySound: 'Ctrl+KeyP',
    skipWord: 'Escape',
    // 上游 ToggleSimple 就是 `，直接照搬；收藏它用 Enter，但 Enter 在默写模式
    // 是提交键，会打架，所以换成 Ctrl+D。笔记上游没给快捷键，这里补一个。
    toggleMastered: 'Backquote',
    collectWord: 'Ctrl+KeyD',
    editNote: 'Ctrl+KeyN'
  },
  articleAutoPlayNext: true,
  articleSoundVolume: 100,
  articleSoundSpeed: 1,

  scenarioEvery: 30,
  autoMarkStatus: true,
  autoMasterKnown: true,
  flashcardTyping: true,
  groupSize: 7,
  matchPairsPerPage: 10,
  matchShuffle: true,
  statusKnownLimit: 0,
  statusFuzzyLimit: 2
}

export const FSRS_PARAMETERS = {
  request_retention: 0.9,   // 目标记忆保持率：期望复习时还记得的概率
  maximum_interval: 36500,  // 复习间隔上限（天），100 年 = 实际上不封顶
  w: [
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
    1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542
  ],
  enable_fuzz: false,       // 是否给间隔加随机扰动（避免同一天堆积太多复习）
  enable_short_term: true,  // 是否启用当天内的短期重复（learning_steps）
  learning_steps: ['1m', '10m'],
  relearning_steps: ['10m']
}

export const MODE_STAGES: Record<PracticeMode, PracticeStage[]> = {
  free: ['followWriteNew', 'complete'],
  identifyOnly: ['identifyNew', 'identifyReview', 'complete'],
  dictationOnly: ['dictationNew', 'dictationReview', 'complete'],
  listenOnly: ['listenNew', 'listenReview', 'complete'],
  system: [
    'followWriteNew',
    'listenNew',
    'dictationNew',
    'identifyReview',
    'listenReview',
    'dictationReview',
    'complete'
  ],
  review: ['identifyReview', 'listenReview', 'dictationReview', 'complete'],
  // 对应上游的 WordPracticeMode.Shuffle：只有一个 Shuffle 阶段
  shuffle: ['shuffle', 'complete']
}

export const STAGE_NAMES: Record<PracticeStage, string> = {
  followWriteNew: '跟写新词',
  identifyNew: '自测新词',
  listenNew: '听写新词',
  dictationNew: '默写新词',
  followWriteReview: '跟写旧词',
  identifyReview: '自测旧词',
  listenReview: '听写旧词',
  dictationReview: '默写旧词',
  shuffle: '随机复习',
  complete: '完成学习'
}

export function typeOfStage(stage: PracticeStage): PracticeType {
  switch (stage) {
    case 'dictationNew':
    case 'dictationReview':
    case 'shuffle':
      return 'dictation'
    case 'listenNew':
    case 'listenReview':
      return 'listen'
    case 'identifyNew':
    case 'identifyReview':
      return 'identify'
    default:
      return 'followWrite'
  }
}

export function isReviewStage(stage: PracticeStage): boolean {
  return stage.endsWith('Review')
}

let cached: StudySettings | null = null

import { setTtsVoice } from './audio'

export function getStudySettings(): StudySettings {
  if (cached) return cached
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const saved = raw ? JSON.parse(raw) : null
    cached = saved ? { ...DEFAULT_STUDY_SETTINGS, ...saved } : { ...DEFAULT_STUDY_SETTINGS }
    cached.fontSize = { ...DEFAULT_STUDY_SETTINGS.fontSize, ...(saved?.fontSize || {}) }
    cached.shortcutKeyMap = { ...DEFAULT_STUDY_SETTINGS.shortcutKeyMap, ...(saved?.shortcutKeyMap || {}) }
  } catch {
    cached = { ...DEFAULT_STUDY_SETTINGS }
  }
  return cached as StudySettings
}

export function saveStudySettings(patch: Partial<StudySettings>): StudySettings {
  const next: StudySettings = { ...getStudySettings(), ...patch }
  cached = next
  try { setTtsVoice(next.ttsVoice) } catch { /* 无 speechSynthesis 的环境 */ }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
  }
  return next
}

export function getAccomplishDays(remaining: number, perDay: number): number | '-' {
  if (perDay <= 0) return '-'
  const r = Math.ceil(remaining / perDay)
  if (!r || !Number.isFinite(r)) return '-'
  return r
}

export function getAccomplishDate(remaining: number, perDay: number): string {
  const d = getAccomplishDays(remaining, perDay)
  if (d === '-') return '-'
  const date = new Date()
  date.setDate(date.getDate() + d)
  return date.toISOString().slice(0, 10)
}

import type { WordItem, WordGroup } from '@/shared/types/WordItem'
import { getStudySettings } from './studySettings'
import { getCard } from './fsrs'
import { getIgnoreSet } from './masteredWords'

export interface TaskWords {
  newWords: WordItem[]
  reviewWords: WordItem[]
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export interface ScheduleInput {
  words: WordItem[]
  group?: Pick<WordGroup, 'lastLearnIndex' | 'perDayStudyNumber' | 'complete'> | null
  ignoreSet?: Set<string>
}

export function buildTodayTask({ words, group, ignoreSet }: ScheduleInput): TaskWords {
  const result: TaskWords = { newWords: [], reviewWords: [] }
  if (!words.length) return result

  const settings = getStudySettings()
  const ignore = ignoreSet || getIgnoreSet(settings.ignoreSimpleWord)
  const perDay = Math.max(1, group?.perDayStudyNumber ?? 20)
  const start = Math.min(Math.max(0, group?.lastLearnIndex ?? 0), words.length)
  const complete = !!group?.complete
  const isEnd = start >= words.length - 1 && words.length !== 1
  const reviewRatio = settings.wordReviewRatio

  let end = start
  if (!isEnd) {
    for (let i = start; i < words.length; i++) {
      if (result.newWords.length >= perDay) break
      const w = words[i]
      if (!ignore.has(w.word.toLowerCase())) result.newWords.push(w)
      end++
    }
  }

  if (!(reviewRatio >= 1 || complete || isEnd)) return result

  const totalNeed = perDay * (isEnd ? reviewRatio || 1 : reviewRatio)
  if (totalNeed <= 0) return result

  const now = Date.now()
  const newWordSet = new Set(result.newWords.map(w => w.word.toLowerCase()))

  const dueList: { item: WordItem; due: number }[] = []
  for (const w of words) {
    const key = w.word.toLowerCase()
    if (ignore.has(key) || newWordSet.has(key)) continue
    const card = getCard(key)
    if (!card) continue
    const due = new Date(card.due).getTime()
    if (due <= now) dueList.push({ item: w, due })
  }
  dueList.sort((a, b) => a.due - b.due)

  result.reviewWords = shuffle(dueList.slice(0, totalNeed).map(x => x.item))

  if (result.reviewWords.length < totalNeed) {
    const used = new Set([...newWordSet, ...result.reviewWords.map(w => w.word.toLowerCase())])
    let pool = words.slice(0, start).reverse()
    if (complete) pool = pool.concat(words.slice(end).reverse())
    for (const w of pool) {
      if (result.reviewWords.length >= totalNeed) break
      const key = w.word.toLowerCase()
      if (ignore.has(key) || used.has(key) || getCard(key)) continue
      used.add(key)
      result.reviewWords.push(w)
    }
  }

  return result
}

export function getTodayOverview(input: ScheduleInput): {
  newCount: number
  reviewCount: number
  learnedIndex: number
  total: number
  perDay: number
} {
  const task = buildTodayTask(input)
  const group = input.group
  return {
    newCount: task.newWords.length,
    reviewCount: task.reviewWords.length,
    learnedIndex: Math.min(group?.lastLearnIndex ?? 0, input.words.length),
    total: input.words.length,
    perDay: group?.perDayStudyNumber ?? 20
  }
}

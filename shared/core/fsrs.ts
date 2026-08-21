import { createEmptyCard, FSRS, Rating, type Card, type Grade } from 'ts-fsrs'
import { getStudySettings, FSRS_PARAMETERS } from './studySettings'
import type { FsrsCard } from '@/shared/types/WordItem'
import * as be from './backendClient'

let fsrsInstance: FSRS | null = null

function getFsrs(): FSRS {
  if (!fsrsInstance) {
    const custom = getStudySettings().fsrsParameters
    const w = Array.isArray(custom) && custom.length >= 17 ? custom : undefined
    fsrsInstance = new FSRS({ ...(FSRS_PARAMETERS as any), ...(w ? { w } : {}) })
  }
  return fsrsInstance
}

export function getGradeByWrongTimes(wrongTimes?: number): Grade {
  if (wrongTimes === undefined) return Rating.Easy as Grade
  const s = getStudySettings()
  if (wrongTimes <= s.fsrsEasyLimit) return Rating.Easy as Grade
  if (wrongTimes <= s.fsrsGoodLimit) return Rating.Good as Grade
  if (wrongTimes <= s.fsrsHardLimit) return Rating.Hard as Grade
  return Rating.Again as Grade
}

export { Rating }

export function nextCard(card: Card | undefined, grade: Grade): Card {
  const base = card || createEmptyCard()
  return getFsrs().next(base, new Date(), grade).card
}

const LOCAL_KEY = 'lb-fsrs-data'

let memoryCache: Record<string, Card> | null = null

function readLocal(): Record<string, Card> {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeLocal(data: Record<string, Card>) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data))
  } catch {
  }
}

export async function loadFsrsData(): Promise<Record<string, Card>> {
  if (memoryCache) return memoryCache
  const remote = await be.beListFsrs()
  if (remote !== null) {
    const map: Record<string, Card> = {}
    for (const row of remote) if (row?.id) map[row.id] = row.card
    if (!remote.length) {
      const local = readLocal()
      if (Object.keys(local).length) {
        await be.beBulkSaveFsrs(Object.entries(local).map(([id, card]) => ({ id, card })))
        memoryCache = local
        return local
      }
    }
    memoryCache = map
    writeLocal(map)
    return map
  }
  memoryCache = readLocal()
  return memoryCache
}

export function getCard(word: string): Card | undefined {
  return memoryCache?.[word.toLowerCase()]
}

export function applyGrade(word: string, grade: Grade): Card {
  if (!memoryCache) memoryCache = readLocal()
  const key = word.toLowerCase()
  const card = nextCard(memoryCache[key], grade)
  memoryCache[key] = card
  return card
}

export function forgetWord(word: string) {
  if (!memoryCache) return
  delete memoryCache[word.toLowerCase()]
}

export async function flushFsrsData(): Promise<void> {
  if (!memoryCache) return
  writeLocal(memoryCache)
  const rows = Object.entries(memoryCache).map(([id, card]) => ({ id, card }))
  await be.beBulkSaveFsrs(rows)
}

export function countDue(now = Date.now()): number {
  if (!memoryCache) return 0
  let n = 0
  for (const card of Object.values(memoryCache)) {
    if (new Date(card.due).getTime() <= now) n++
  }
  return n
}

/**
 * 一个词的「下次复习」时间，全项目只认这一个来源。
 *
 * 之前有两套：打字流程走 FSRS（存在这个文件里），听写走
 * spacedRepetition.ts 那张固定间隔表（1/2/4/7/15/30 天），写在
 * word.learningRecord.nextReview 上。单词详情显示的是后者，
 * 而今日复习挑词看的是前者 —— 同一个词两个日期，怎么都对不上。
 *
 * 现在统一：有 FSRS 卡片就用卡片的 due；没有（老数据、还没练过的词）
 * 才回退到 learningRecord.nextReview，不至于让历史记录凭空消失。
 */
export function nextReviewOf(word: {
  word: string
  learningRecord?: { nextReview?: string }
}): string {
  const card = getCard(word.word)
  if (card) return new Date(card.due).toISOString()
  return word.learningRecord?.nextReview || ''
}

export function toPlainCard(card: Card): FsrsCard {
  return {
    due: new Date(card.due).toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as unknown as number,
    last_review: card.last_review ? new Date(card.last_review).toISOString() : undefined
  }
}

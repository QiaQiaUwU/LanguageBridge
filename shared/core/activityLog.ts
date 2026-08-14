import { wordDB } from './database'
import * as be from './backendClient'

export interface DayActivity {
  date: string // YYYY-MM-DD
  newWords: number // 当天新掌握（标记为"认识"）的词数
  reviewCount: number // 当天听写/复习的总次数
  correctCount: number // 当天听写答对的次数
  minutesActive: number // 当天使用时长（分钟）
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function emptyDay(date: string): DayActivity {
  return { date, newWords: 0, reviewCount: 0, correctCount: 0, minutesActive: 0 }
}

async function getOrCreateToday(): Promise<DayActivity> {
  const date = todayStr()
  const existing = await wordDB.getActivity(date)
  return existing || emptyDay(date)
}

export async function recordWordLearned() {
  const day = await getOrCreateToday()
  day.newWords += 1
  await wordDB.saveActivity(day)
  be.beSaveActivity(day)
}

export async function recordWordsLearned(n: number) {
  if (n <= 0) return
  const day = await getOrCreateToday()
  day.newWords += n
  await wordDB.saveActivity(day)
  be.beSaveActivity(day)
}

export async function recordReview(correct: boolean) {
  const day = await getOrCreateToday()
  day.reviewCount += 1
  if (correct) day.correctCount += 1
  await wordDB.saveActivity(day)
  be.beSaveActivity(day)
}

export async function recordActiveMinute() {
  const day = await getOrCreateToday()
  day.minutesActive += 1
  await wordDB.saveActivity(day)
  be.beSaveActivity(day)
}

export async function getTodayStats(): Promise<DayActivity> {
  return getOrCreateToday()
}

export async function getRecentStats(days = 7): Promise<{ reviewCount: number; correctCount: number; accuracy: number }> {
  const all = await wordDB.getAllActivity()
  const map = new Map<string, DayActivity>(all.map((d: DayActivity) => [d.date, d]))
  let reviewCount = 0
  let correctCount = 0
  const cursor = new Date()
  for (let i = 0; i < days; i++) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    const d = map.get(key)
    if (d) { reviewCount += d.reviewCount; correctCount += d.correctCount }
    cursor.setDate(cursor.getDate() - 1)
  }
  return { reviewCount, correctCount, accuracy: reviewCount ? Math.round((correctCount / reviewCount) * 100) : 0 }
}

export async function getStreak(): Promise<number> {
  const all = await wordDB.getAllActivity()
  const activeDates = new Set(
    all.filter((d: DayActivity) => d.newWords > 0 || d.reviewCount > 0 || d.minutesActive > 0).map((d: DayActivity) => d.date)
  )
  let streak = 0
  const cursor = new Date()
  while (true) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    if (activeDates.has(key)) {
      streak++
      cursor.setDate(cursor.getDate() - 1)
    } else {
      break
    }
  }
  return streak
}

export interface HeatmapCell {
  date: string
  level: 0 | 1 | 2 | 3 // 无/少/中/多，用于染色
}

export async function getAllActivity(): Promise<DayActivity[]> {
  const all = await wordDB.getAllActivity()
  return (all as DayActivity[]).sort((a, b) => a.date.localeCompare(b.date))
}

export async function getHeatmap(weeks = 18): Promise<HeatmapCell[][]> {
  const all = await wordDB.getAllActivity()
  const map = new Map<string, DayActivity>(all.map((d: DayActivity) => [d.date, d]))

  const days: HeatmapCell[] = []
  const cursor = new Date()
  cursor.setDate(cursor.getDate() - (weeks * 7 - 1))
  for (let i = 0; i < weeks * 7; i++) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    const d = map.get(key)
    const score = d ? d.newWords + d.reviewCount + d.minutesActive : 0
    const level: HeatmapCell['level'] = score === 0 ? 0 : score < 5 ? 1 : score < 15 ? 2 : 3
    days.push({ date: key, level })
    cursor.setDate(cursor.getDate() + 1)
  }

  const weeksArr: HeatmapCell[][] = []
  for (let i = 0; i < days.length; i += 7) weeksArr.push(days.slice(i, i + 7))
  return weeksArr
}

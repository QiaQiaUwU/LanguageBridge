import type { WordStatus } from '@/shared/types/WordItem'

const REVIEW_INTERVALS_DAYS = [1, 2, 4, 7, 15, 30]

function addDaysIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

export function nextReviewAfterCorrect(consecutiveCorrect: number): string {
  const idx = Math.min(Math.max(consecutiveCorrect, 0), REVIEW_INTERVALS_DAYS.length - 1)
  return addDaysIso(REVIEW_INTERVALS_DAYS[idx])
}

export function nextReviewAfterWrong(_consecutiveWrong: number): string {
  return addDaysIso(1)
}

export function statusAfterWrong(consecutiveWrong: number): WordStatus {
  return consecutiveWrong >= 2 ? 'unknown' : 'fuzzy'
}

export function statusAfterCorrect(consecutiveCorrect: number, currentStatus: WordStatus): WordStatus {
  return consecutiveCorrect >= 3 ? 'known' : currentStatus
}

import { getCard } from './fsrs'
import type { WordItem } from '@/shared/types/WordItem'

export type FamiliarityLevel = 'unseen' | 'unknown' | 'fuzzy' | 'known' | 'mastered'

export interface Familiarity {
  level: FamiliarityLevel
  score: number
  fromUser: boolean
}

const STABILITY_REF_DAYS = 30

const ABSOLUTE_MASTERY_DAYS = 180

function retrievability(stability: number, daysSince: number): number {
  const s = Math.max(0.1, stability)
  return Math.pow(0.9, Math.max(0, daysSince) / s)
}

function scoreOfCard(
  stability: number,
  lapses: number,
  reps: number,
  daysSince: number
): number {
  const s = Math.max(0, stability)
  const base = Math.log1p(s) / Math.log1p(STABILITY_REF_DAYS)
  const penalty = Math.min(0.45, lapses * 0.15)
  const confidence = Math.min(1, reps / 3)
  const strength = Math.max(0, Math.min(1, (base - penalty) * (0.55 + 0.45 * confidence)))

  if (s >= ABSOLUTE_MASTERY_DAYS) return Math.max(strength, 0.9)

  const r = retrievability(s, daysSince)
  return Math.max(0, Math.min(1, strength * (0.25 + 0.75 * r)))
}

export function familiarityOf(
  w: Pick<WordItem, 'word' | 'status'>,
  masteredSet?: Set<string>
): Familiarity {
  const key = w.word.toLowerCase()
  if (masteredSet?.has(key)) return { level: 'mastered', score: 1, fromUser: true }

  if (w.status && w.status !== 'unmarked') {
    const lv = w.status as FamiliarityLevel
    const score = lv === 'known' ? 0.85 : lv === 'fuzzy' ? 0.5 : 0.2
    return { level: lv, score, fromUser: true }
  }

  const card = getCard(w.word)
  if (!card) return { level: 'unseen', score: 0, fromUser: false }

  const last = card.last_review ? new Date(card.last_review as any).getTime() : 0
  const daysSince = last ? Math.max(0, (Date.now() - last) / 86400000) : 0
  const score = scoreOfCard(card.stability ?? 0, card.lapses ?? 0, card.reps ?? 0, daysSince)
  const level: FamiliarityLevel = score >= 0.7 ? 'known' : score >= 0.35 ? 'fuzzy' : 'unknown'
  return { level, score, fromUser: false }
}

export const FAMILIARITY_LABEL: Record<FamiliarityLevel, string> = {
  unseen: '未练过',
  unknown: '不认识',
  fuzzy: '模糊',
  known: '认识',
  mastered: '已掌握'
}

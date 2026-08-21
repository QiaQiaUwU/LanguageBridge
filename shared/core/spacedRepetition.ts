import type { WordStatus } from '@/shared/types/WordItem'

/**
 * 这里原来还有一张固定间隔表（1/2/4/7/15/30 天）和
 * nextReviewAfterCorrect / nextReviewAfterWrong 两个函数，用来给听写排期。
 * 那是项目里的第二套排期算法，跟打字流程用的 FSRS 各算各的。
 * 现在排期只由 FSRS 出（见 fsrs.ts 的 applyGrade / nextReviewOf），
 * 这两个函数连同间隔表一起删掉，免得以后又被接回去变成两套。
 *
 * 留下的 statusAfterWrong / statusAfterCorrect 只管「认识/模糊/不认识」这个标签，
 * 跟排期无关，不冲突。
 */

export function statusAfterWrong(consecutiveWrong: number): WordStatus {
  return consecutiveWrong >= 2 ? 'unknown' : 'fuzzy'
}

export function statusAfterCorrect(consecutiveCorrect: number, currentStatus: WordStatus): WordStatus {
  return consecutiveCorrect >= 3 ? 'known' : currentStatus
}

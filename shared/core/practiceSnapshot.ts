/**
 * 练习进度快照。
 *
 * 之前打字流程完全没有断点：`applyGrade`（FSRS 评级）和自动标状态都写在
 * `complete()` 里，学到一半退出——哪怕已经练完 80 个词——这一轮的排期和
 * 标记一个都不落，下次进来从头开始。上游 TypeWords 有
 * `usePracticeWordPersistence` 专门做这件事。
 *
 * 这里的取舍：**退出时只存快照，不提前落 FSRS**。
 * 因为落了之后如果用户又选择「接着练」，同一批词会被评两次。
 * 三条出路都堵死：
 *   接着练   → 快照原样恢复，最后由 complete() 统一结算
 *   重新开始 → 先把快照里的成绩结算掉，再清快照，成绩不白丢
 *   隔天再来 → 进页面时发现快照不是今天的，静默结算并丢弃
 */

const KEY = 'lb-practice-snapshot'

export interface PracticeSnapshot {
  /** 哪一批词。scope 不同的快照互不干扰 */
  scopeKey: string
  /** 存的时候是哪一天（本地日期），用来判断是不是隔夜了 */
  date: string
  savedAt: number

  stage: string
  type: string
  index: number
  /** 当前这一列的词（按 word 存，恢复时从词库查回，避免存整份词条） */
  listWords: string[]
  taskNewWords: string[]
  taskReviewWords: string[]
  newCount: number
  reviewCount: number

  wrongTimesMap: Record<string, number>
  ratingMap: Record<string, number>
  excludeWords: string[]
  wrongWords: string[]
  isWrongRound: boolean
  /** 计时用的分段，恢复后接着累计 */
  segments: [number, number][]

  /**
   * 这一轮已经打完的词（按 word 存，跟上面几个列表一个口径）。
   *
   * 场景学习靠它判断「教材里某一课的词是不是都学完了」。不存的话，
   * 中途退出再接着练，之前学过的词就不算数了 —— 某一课明明学完也不会弹课文。
   *
   * 可选：旧快照（这个字段之前不存在）读出来是 undefined，
   * 恢复那头按空数组处理，不会因为少个字段就整份快照作废。
   */
  recentWords?: string[]
  /** 没有教材时按数量触发场景学习的计数，同样是可选、旧快照按 0 处理 */
  learnedSinceScenario?: number
}

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function saveSnapshot(s: Omit<PracticeSnapshot, 'date' | 'savedAt'>): void {
  try {
    const full: PracticeSnapshot = { ...s, date: today(), savedAt: Date.now() }
    localStorage.setItem(KEY, JSON.stringify(full))
  } catch {
    /* 存不下就当没断点，不影响练习 */
  }
}

export function readSnapshot(): PracticeSnapshot | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (!s || typeof s.scopeKey !== 'string' || !Array.isArray(s.listWords)) return null
    return s as PracticeSnapshot
  } catch {
    return null
  }
}

export function clearSnapshot(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 清不掉也没关系，下次会被覆盖 */
  }
}

/** 快照是不是「今天的、同一批词的」——只有这种才值得问用户要不要接着练 */
export function snapshotUsable(s: PracticeSnapshot | null, scopeKey: string): boolean {
  if (!s) return false
  if (s.scopeKey !== scopeKey) return false
  if (s.date !== today()) return false
  return s.listWords.length > 0 || Object.keys(s.wrongTimesMap || {}).length > 0
}

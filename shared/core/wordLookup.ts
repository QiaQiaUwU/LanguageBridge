/**
 * 悬停/点击查词。
 *
 * 移植自 typing-word（GPL-3.0）：
 *   packages/core/src/hooks/useWordLookup.ts
 *   packages/core/src/utils/wordLookup.ts
 *
 * 它用 compromise 做词形还原（动词还原成原形、名词还原成单数），我们没有装
 * 这个库，所以用一组规则替代，覆盖英语里最常见的屈折变化。查不到再退回原词。
 */
import { reactive } from 'vue'
import type { WordItem } from '@/shared/types/WordItem'

export const wordLookupState = reactive({
  visible: false,
  loading: false,
  notFound: false,
  queryWord: '',
  data: null as WordItem | null,
  x: 0,
  y: 0
})

const cache = new Map<string, WordItem | null>()

/**
 * 最近查过的词。
 *
 * Agent 的「把我刚查的词加进词表」需要它，但之前压根没人记 ——
 * 查词是即用即弃的。这里只留一个内存里的短表（最近 50 个），
 * 不进数据库：它只服务于"刚才"这个时间窗，存久了反而没意义。
 */
const RECENT_MAX = 50
const recentWords: string[] = []

export function recordLookup(word: string) {
  const w = word.trim().toLowerCase()
  if (!w) return
  const at = recentWords.indexOf(w)
  if (at >= 0) recentWords.splice(at, 1)
  recentWords.unshift(w)
  if (recentWords.length > RECENT_MAX) recentWords.length = RECENT_MAX
}

export function getRecentLookups(limit = 20): string[] {
  return recentWords.slice(0, limit)
}

/**
 * 「收进生词本」时，如果当前页面能划线，就顺带划一道。
 *
 * 原来 collect 只把词的状态改成 unknown —— 既不划线也不进笔记，
 * 收藏完页面上一点痕迹都没有，等于白点。
 * 阅读助手在挂载时把自己的划线函数注册进来，别的页面没注册就只改状态。
 */
type MarkHook = (word: string, opts: { surface?: string; remove?: boolean }) => void | Promise<void>
let markHook: MarkHook | null = null

export function setCollectMarkHook(fn: MarkHook | null) {
  markHook = fn
}

export async function runCollectMarkHook(
  word: string,
  opts: { surface?: string; remove?: boolean } = {}
) {
  try { await markHook?.(word, opts) } catch { /* 划线失败不该挡住收藏本身 */ }
}

/** 原样移植 stripWordPunctuation */
export function stripWordPunctuation(word: string): string {
  return word.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '')
}

/** 原样移植 splitEnglishText：把一段文本切成「单词 / 非单词」的片段 */
export function splitEnglishText(text: string): { text: string; isWord: boolean }[] {
  if (!text) return []
  const tokens: { text: string; isWord: boolean }[] = []
  const regex = /[a-zA-Z]+(?:'[a-zA-Z]+)?|[^a-zA-Z]+/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const token = match[0]
    tokens.push({ text: token, isWord: /[a-zA-Z]/.test(token) })
  }
  return tokens
}

/** 词形还原候选。对应它用 compromise 做的 toInfinitive / toSingular */
export function normalizeWordForLookup(raw: string): string[] {
  const cleaned = stripWordPunctuation(raw.trim())
  if (!cleaned) return []

  const out = new Set<string>()
  out.add(cleaned)
  const low = cleaned.toLowerCase()
  out.add(low)

  const add = (w: string) => {
    if (w && w.length >= 2) out.add(w)
  }

  // 复数 / 三单
  if (/ies$/.test(low)) add(low.slice(0, -3) + 'y')
  if (/(ches|shes|sses|xes|zes)$/.test(low)) add(low.slice(0, -2))
  if (/s$/.test(low) && !/ss$/.test(low)) add(low.slice(0, -1))
  // 过去式 / 过去分词
  if (/ied$/.test(low)) add(low.slice(0, -3) + 'y')
  if (/ed$/.test(low)) {
    add(low.slice(0, -2))
    add(low.slice(0, -1))
    if (/([bdfglmnprt])\1ed$/.test(low)) add(low.slice(0, -3))
  }
  // 现在分词
  if (/ing$/.test(low)) {
    add(low.slice(0, -3))
    add(low.slice(0, -3) + 'e')
    if (/([bdfglmnprt])\1ing$/.test(low)) add(low.slice(0, -4))
  }
  // 比较级 / 最高级
  if (/er$/.test(low)) add(low.slice(0, -2))
  if (/est$/.test(low)) add(low.slice(0, -3))
  // 副词
  if (/ily$/.test(low)) add(low.slice(0, -3) + 'y')
  if (/ly$/.test(low)) add(low.slice(0, -2))

  return Array.from(out).filter(Boolean)
}

export function closeWordLookup() {
  wordLookupState.visible = false
  wordLookupState.data = null
  wordLookupState.notFound = false
  wordLookupState.loading = false
}

/** 对应它的 updatePosition：浮层挂在目标元素正下方居中 */
function updatePosition(target: HTMLElement) {
  const rect = target.getBoundingClientRect()
  wordLookupState.x = rect.left + rect.width / 2
  wordLookupState.y = rect.bottom + 8
}

export async function openWordLookup(
  rawWord: string,
  target: HTMLElement,
  find: (candidates: string[]) => Promise<WordItem | null>
) {
  const stripped = stripWordPunctuation(rawWord)
  if (!stripped) return

  updatePosition(target)
  wordLookupState.visible = true
  wordLookupState.queryWord = stripped
  wordLookupState.notFound = false
  // 记一笔，Agent 的「把我刚查的词加进词表」要用
  recordLookup(stripped)

  if (cache.has(stripped)) {
    const cached = cache.get(stripped) ?? null
    wordLookupState.data = cached
    wordLookupState.notFound = !cached
    wordLookupState.loading = false
    return
  }

  wordLookupState.loading = true
  wordLookupState.data = null
  try {
    const hit = await find(normalizeWordForLookup(rawWord))
    cache.set(stripped, hit)
    wordLookupState.data = hit
    wordLookupState.notFound = !hit
  } catch {
    wordLookupState.notFound = true
  } finally {
    wordLookupState.loading = false
  }
}

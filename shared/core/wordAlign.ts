/**
 * 听写的词级对齐。
 *
 * 用户输入可能漏词、多词、拼错、词序颠倒、把 every day 连写成 everyday。
 * 做法：Needleman–Wunsch 全局对齐，替换代价取两词的字符级编辑距离占比，
 * 足够像（≤ TYPO_MAX）就算拼错但对上；再做两轮后处理：
 *   1. 相邻的「漏 + 多」如果是同一个词 → 顺序颠倒（moved）
 *   2. 连写 / 拆写（every day ↔ everyday）→ 拼错（typo）
 */
import type { AlignOp } from './studyRecords'

export const TYPO_MAX = 0.34

const NUM: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16',
  seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20', hundred: '100', thousand: '1000'
}

export interface AlignOptions {
  /** 严格模式：大小写、数字写法都算错 */
  strict?: boolean
}

export function tokenize(s: string): string[] {
  return s
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, '"')
    .split(/\s+|(?<=\w)[—–](?=\w)|(?<=\w)[,;:!?.]+(?=\s|$)|[()"]/)
    .map(t => t.replace(/^[^\w']+|[^\w']+$/g, ''))
    .filter(Boolean)
}

function norm(w: string, strict?: boolean): string {
  return strict ? w : w.toLowerCase()
}

const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
/** 数字写法：six ↔ 6，twenty-two ↔ 22；认不出返回 null */
function numVal(w: string): string | null {
  if (/^\d+$/.test(w)) return String(Number(w))
  if (NUM[w] && !['hundred', 'thousand'].includes(w)) return NUM[w]
  if (TENS[w]) return String(TENS[w])
  const m = /^([a-z]+)-([a-z]+)$/.exec(w)
  if (m && TENS[m[1]] && NUM[m[2]] && Number(NUM[m[2]]) < 10) return String(TENS[m[1]] + Number(NUM[m[2]]))
  return null
}

function same(a: string, b: string, strict?: boolean): boolean {
  if (a === b) return true
  if (strict) return false
  const x = numVal(a), y = numVal(b)
  return x != null && x === y
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev2: number[] = []
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      // 相邻换位（recieve / receive）算一步
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1)
    }
    prev2 = prev
    prev = cur
  }
  return prev[n]
}

function ratio(a: string, b: string): number {
  return editDistance(a, b) / Math.max(a.length, b.length)
}

export function alignWords(original: string, typed: string, opts: AlignOptions = {}): AlignOp[] {
  const A = tokenize(original)
  const B = tokenize(typed)
  const a = A.map(w => norm(w, opts.strict))
  const b = B.map(w => norm(w, opts.strict))
  const m = a.length, n = b.length
  const GAP = 1
  const cost: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  const from: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0)) // 0 对角 1 上(漏) 2 左(多)
  for (let i = 1; i <= m; i++) { cost[i][0] = i * GAP; from[i][0] = 1 }
  for (let j = 1; j <= n; j++) { cost[0][j] = j * GAP; from[0][j] = 2 }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const r = same(a[i - 1], b[j - 1], opts.strict) ? 0 : ratio(a[i - 1], b[j - 1])
      const sub = r === 0 ? 0 : r <= TYPO_MAX ? 0.3 + r : 3 // 不像就不许硬配
      const d = cost[i - 1][j - 1] + sub
      const u = cost[i - 1][j] + GAP
      const l = cost[i][j - 1] + GAP
      if (d <= u && d <= l) { cost[i][j] = d; from[i][j] = 0 }
      else if (u <= l) { cost[i][j] = u; from[i][j] = 1 }
      else { cost[i][j] = l; from[i][j] = 2 }
    }
  }
  const ops: AlignOp[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    const f = i > 0 && j > 0 ? from[i][j] : i > 0 ? 1 : 2
    if (f === 0) {
      ops.push({ kind: same(a[i - 1], b[j - 1], opts.strict) ? 'ok' : 'typo', src: A[i - 1], typed: B[j - 1] }); i--; j--
    } else if (f === 1) { ops.push({ kind: 'miss', src: A[i - 1] }); i-- }
    else { ops.push({ kind: 'extra', typed: B[j - 1] }); j-- }
  }
  ops.reverse()
  return postProcess(ops, opts)
}

function postProcess(ops: AlignOp[], opts: AlignOptions): AlignOp[] {
  const key = (w?: string) => norm(w || '', opts.strict).replace(/[-']/g, '')
  /**
   * 连写 / 拆写：在连续 2~4 个非 ok 的操作里，原文拼起来等于输入拼起来，
   * 就合成一个 typo（every day ↔ everyday、any more ↔ anymore）。
   */
  for (let k = 0; k < ops.length; k++) {
    for (let len = 4; len >= 2; len--) {
      const win = ops.slice(k, k + len)
      if (win.length < len || win.some(o => o.kind === 'ok' || o.kind === 'moved')) continue
      const src = win.map(o => o.src).filter(Boolean) as string[]
      const typed = win.map(o => o.typed).filter(Boolean) as string[]
      if (!src.length || !typed.length || src.length === typed.length) continue
      if (key(src.join('')) === key(typed.join(''))) {
        ops.splice(k, len, { kind: 'typo', src: src.join(' '), typed: typed.join(' ') })
        break
      }
    }
  }
  // 顺序颠倒：同一个词一边漏、一边多
  for (const x of ops) {
    if (x.kind !== 'extra') continue
    const hit = ops.find(mm => mm.kind === 'miss' && same(key(mm.src), key(x.typed), opts.strict))
    if (!hit) continue
    hit.kind = 'moved'
    hit.typed = x.typed
    ;(x as any).__drop = true
  }
  return ops.filter(o => !(o as any).__drop)
}

export function scoreOps(ops: AlignOp[]): number {
  const src = ops.filter(o => o.kind !== 'extra').length
  if (!src) return 0
  const got = ops.reduce((s, o) => s + (o.kind === 'ok' ? 1 : o.kind === 'typo' || o.kind === 'moved' ? 0.5 : 0), 0)
  const extra = ops.filter(o => o.kind === 'extra').length
  return Math.max(0, Math.round(((got - extra * 0.25) / src) * 100))
}

export function countOps(ops: AlignOp[]) {
  const c = { ok: 0, typo: 0, moved: 0, miss: 0, extra: 0 }
  for (const o of ops) c[o.kind]++
  return c
}

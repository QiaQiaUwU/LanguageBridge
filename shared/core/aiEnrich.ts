import type { WordItem } from '@/shared/types/WordItem'
import { askAi } from './aiClient'

export { EXAM_TAGS } from './examTags'
import { EXAM_TAGS, canonicalExamTags } from './examTags'

export const TOPIC_CATEGORIES = [
  '住宿', '医疗', '商业经济金融', '校园生活', '银行服务', '工作', '图书馆',
  '旅游', '社会生活', '环境', '动植物', '地点', '学科', '运动', '日常物品',
  '情感态度', '时间数量', '交通', '科技', '艺术文化'
]

export const DEFAULT_BATCH_SIZE = 12

export interface EnrichAiProgress {
  done: number
  total: number
  current: string
  failed: number
  lastError?: string
}

export function missingOf(w: WordItem): { topics: boolean; morphemes: boolean; tags: boolean; family: boolean } {
  return {
    topics: !w.topics?.length,
    morphemes: !(w.morphemes?.root?.form || w.morphemes?.prefix?.form || w.morphemes?.suffix?.form),
    family: !w.word_family?.length,
    tags: !w.tags?.length
  }
}

export function needsAiEnrich(w: WordItem, force = false): boolean {
  const m = missingOf(w)
  if (!(m.topics || m.morphemes)) return false
  if (force) return true
  return !w.aiEnrichedAt
}

export function countNeedAiEnrich(words: WordItem[], force = false): number {
  return words.filter(w => needsAiEnrich(w, force)).length
}

export interface EnrichPreview {
  total: number
  pending: number
  attempted: number
  complete: number
  requests: number
}

export function previewAiEnrich(
  words: WordItem[],
  force = false,
  batchSize = DEFAULT_BATCH_SIZE,
  canBackfillTags?: (w: WordItem) => boolean
): EnrichPreview {
  let pending = 0, attempted = 0, complete = 0
  for (const w of words) {
    const m = missingOf(w)
    if (!(m.topics || m.morphemes)) complete++
    else if (w.aiEnrichedAt) attempted++
    else pending++
  }
  const willRunItems = words.filter(w => needsAiEnrich(w, force))
  const sizes = new Map<string, number>()
  for (const w of willRunItems) {
    const k = needKey(needOf(w, canBackfillTags))
    sizes.set(k, (sizes.get(k) || 0) + 1)
  }
  let requests = 0
  for (const n of sizes.values()) requests += Math.ceil(n / batchSize)
  return { total: words.length, pending, attempted, complete, requests }
}

export interface LibraryHealth {
  total: number
  noPhonetic: number
  noMeaning: number
  noExample: number
  noPos: number
  noTags: number
  noTopics: number
  noMorphemes: number
  noFamily: number
  fixableFree: number
  needAi: number
}

export function checkLibraryHealth(words: WordItem[]): LibraryHealth {
  const h: LibraryHealth = {
    total: words.length,
    noPhonetic: 0, noMeaning: 0, noExample: 0, noPos: 0,
    noTags: 0, noTopics: 0, noMorphemes: 0, noFamily: 0,
    fixableFree: 0, needAi: 0
  }
  for (const w of words) {
    const noPhonetic = !w.phonetic
    const noMeaning = !w.meanings?.[0]?.chinese
    const noExample = !w.example_sentences?.length
    const noPos = !w.meanings?.[0]?.partOfSpeech
    if (noPhonetic) h.noPhonetic++
    if (noMeaning) h.noMeaning++
    if (noExample) h.noExample++
    if (noPos) h.noPos++
    if (!w.tags?.length) h.noTags++
    if (!w.topics?.length) h.noTopics++
    if (missingOf(w).morphemes) h.noMorphemes++
    if (!w.word_family?.length) h.noFamily++
    if (noPhonetic || noExample || noPos || noMeaning) h.fixableFree++
    const m = missingOf(w)
    if (m.topics || m.morphemes) h.needAi++
  }
  return h
}

export interface EnrichNeed {
  exam: boolean
  topics: boolean
  morphemes: boolean
  family: boolean
}

export function needOf(w: WordItem, canBackfillTags?: (w: WordItem) => boolean): EnrichNeed {
  const m = missingOf(w)
  return {
    exam: m.tags && !(canBackfillTags?.(w) ?? false),
    topics: m.topics,
    morphemes: m.morphemes,
    family: m.family
  }
}

function needKey(n: EnrichNeed): string {
  return `${n.exam ? 1 : 0}${n.topics ? 1 : 0}${n.morphemes ? 1 : 0}${n.family ? 1 : 0}`
}

function buildPrompt(batch: WordItem[], need: EnrichNeed): string {
  const list = batch.map(w => w.word).join(', ')
  const fields: string[] = []
  const rules: string[] = []
  if (need.exam) {
    fields.push(`  "exam_tags": ["这个词收录在哪些考纲的词表里"],`)
    rules.push(`exam_tags 只能从这个清单里选，写法必须一模一样：${EXAM_TAGS.join('、')}`)
  }
  if (need.topics) {
    fields.push(`  "topics": ["从话题清单里选 1-3 个最贴切的"],`)
    rules.push(`topics 只能从这个清单里选：${TOPIC_CATEGORIES.join('、')}`)
  }
  return `为下面这些英语单词各生成 ${fields.length + (need.morphemes ? 1 : 0) + (need.family ? 1 : 0)} 项数据，返回严格的 JSON 数组，不要任何额外文本或 markdown 代码块标记。

单词：${list}

每一项的格式：
{
  "word": "原单词",
${fields.join('\n')}${need.morphemes ? `
  "morphemes": {
    "prefix": { "form": "前缀，如 in-", "meaning": "该前缀的含义，如 向内、不" },
    "root":   { "form": "词根，如 spect", "meaning": "该词根的含义，如 看" },
    "suffix": { "form": "后缀，如 -or", "meaning": "该后缀的含义，如 表示人或物" }
  },` : ''}${need.family ? `
  "word_family": ["同一词根衍生出的其它常见单词"]` : ''}
}

${rules.join('\n')}
${need.morphemes && need.family ? `关于 morphemes（词根词缀）和 word_family（词族）的区别，这是两件不同的事，不要混：
· morphemes 拆的是这个词本身的构词零件。inspect → prefix "in-"（向内）+ root "spect"（看）
· word_family 列的是同一词根衍生出的其它单词。inspect 的词族是 respect、prospect、spectator、inspection
` : ''}
要求：
· 只输出上面列出的字段，没列的一个都不要加——没要的字段答了也不会被采纳，纯属浪费
· 清单类字段必须来自上面给的清单，不要自创写法${need.morphemes ? `
· morphemes 三个位置都是可选的，没有就整个省略那个键，不要填空字符串：
  - 很多词只有词根没有词缀（如 port、act）
  - 本身不是拉丁/希腊构词的词（the、get、take 这类）整个 morphemes 省略，不要硬拆
· 前缀后缀写成带连字符的标准形式（in-、-tion），词根不带连字符（spect）` : ''}${need.family ? `
· word_family 只给真正同源的词，形近但不同源的不要放（island 和 isolate 不同源，
  understand 里的 stand 跟 status 的词根 sta- 也不是一回事）
· word_family 给 3-6 个常见的就够，不要罗列生僻词` : ''}
· 返回的数组长度必须和输入单词数一致，顺序一致
· 严格的 UTF-8 JSON，不要 markdown 代码块符号`
}

function pickMorphemes(raw: any): WordItem['morphemes'] | null {
  const bad = new Set(['', '无', '没有', 'none', 'null', 'n/a', '-', '—'])
  const one = (v: any): { form: string; meaning: string } | undefined => {
    const form = String(v?.form ?? '').trim()
    if (!form || bad.has(form.toLowerCase())) return undefined
    return { form, meaning: String(v?.meaning ?? '').trim() }
  }
  const out: WordItem['morphemes'] = {}
  const prefix = one(raw.prefix)
  const root = one(raw.root)
  const suffix = one(raw.suffix)
  if (prefix) out.prefix = prefix
  if (root) out.root = root
  if (suffix) out.suffix = suffix
  return prefix || root || suffix ? out : null
}

function extractJsonArray(text: string): any[] | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  if (!cleaned) return null

  const asArray = (v: any): any[] | null => {
    if (Array.isArray(v)) return v
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) if (Array.isArray(v[k])) return v[k]
      if (typeof v.word === 'string') return [v]
    }
    return null
  }

  try {
    const hit = asArray(JSON.parse(cleaned))
    if (hit) return hit
  } catch { /* 往下退 */ }

  const start = cleaned.indexOf('[')
  if (start < 0) return null

  const end = cleaned.lastIndexOf(']')
  if (end > start) {
    try {
      const hit = asArray(JSON.parse(cleaned.slice(start, end + 1)))
      if (hit) return hit
    } catch { /* 往下退：可能中间某条坏了，按截断处理 */ }
  }

  const lastObjEnd = cleaned.lastIndexOf('}')
  if (lastObjEnd > start) {
    try {
      const salvaged = JSON.parse(cleaned.slice(start, lastObjEnd + 1) + ']')
      if (Array.isArray(salvaged) && salvaged.length) return salvaged
    } catch { /* 确实救不回来 */ }
  }
  return null
}

function statusOf(msg: string): number {
  const m = /\((?:状态码\s*)?(\d{3})\)/.exec(msg)
  return m ? Number(m[1]) : 0
}

function isFatalError(msg: string): boolean {
  const code = statusOf(msg)
  if (code === 400 || code === 401 || code === 403 || code === 404) return true
  return /尚未配置|模型名称还没填|无法连接本地服务|invalid[_ ]api[_ ]key|unauthorized|no such model|model.*not found/i.test(msg)
}

function isRetryable(msg: string): boolean {
  const code = statusOf(msg)
  if (code === 429 || (code >= 500 && code <= 599)) return true
  return /超时|timeout|rate.?limit|too many requests|overloaded|temporarily|请求转发失败|ECONNRESET|fetch failed/i.test(msg)
}

const sleep = (ms: number, shouldStop?: () => boolean) => new Promise<void>(resolve => {
  if (!shouldStop) { setTimeout(resolve, ms); return }
  const step = 200
  let left = ms
  const tick = () => {
    if (shouldStop() || left <= 0) return resolve()
    left -= step
    setTimeout(tick, Math.min(step, Math.max(0, left + step)))
  }
  tick()
})

export async function probeAiEnrich(words: WordItem[], force = false): Promise<{
  ok: boolean
  error?: string
  raw: string
  parsed: number
  sample: string[]
}> {
  const targets = words.filter(w => needsAiEnrich(w, force)).slice(0, 3)
  if (!targets.length) return { ok: false, error: '这个范围里没有待补全的词', raw: '', parsed: 0, sample: [] }
  const sample = targets.map(w => w.word)
  const need = needOf(targets[0])
  let raw = ''
  try {
    raw = await askAi(
      buildPrompt(targets, need),
      '你是一位英语词汇学习专家。你必须返回严格的 JSON，不要有任何额外文本、markdown 标记或代码块符号。',
      1200
    )
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), raw: '', parsed: 0, sample }
  }
  const arr = extractJsonArray(raw)
  if (!arr) {
    return {
      ok: false,
      error: raw.trim() ? '模型有回复，但里面找不到能用的 JSON 数组（下面是原始回复）' : '模型回复是空的',
      raw,
      parsed: 0,
      sample
    }
  }
  return { ok: true, raw, parsed: arr.length, sample }
}

export async function enrichWordsWithAi(
  words: WordItem[],
  onProgress?: (p: EnrichAiProgress) => void,
  opts: {
    batchSize?: number
    shouldStop?: () => boolean
    force?: boolean
    onBatchDone?: (changed: WordItem[]) => void | Promise<void>
    canBackfillTags?: (w: WordItem) => boolean
  } = {}
): Promise<WordItem[]> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE
  const targets = words.filter(w => needsAiEnrich(w, opts.force))

  const buckets = new Map<string, { need: EnrichNeed; items: WordItem[] }>()
  for (const w of targets) {
    const need = needOf(w, opts.canBackfillTags)
    const key = needKey(need)
    const b = buckets.get(key)
    if (b) b.items.push(w)
    else buckets.set(key, { need, items: [w] })
  }
  const plan: Array<{ batch: WordItem[]; need: EnrichNeed }> = []
  for (const { need, items } of buckets.values()) {
    for (let i = 0; i < items.length; i += batchSize) {
      plan.push({ batch: items.slice(i, i + batchSize), need })
    }
  }

  const changed: WordItem[] = []
  let done = 0
  let failed = 0
  let lastError: string | undefined
  let timeouts = 0

  const askBatch = async (batch: WordItem[], need: EnrichNeed): Promise<any[] | null> => {
    const timeoutMs = Math.min(240_000, 45_000 + batch.length * 8_000)
    const reply = await askAi(
      buildPrompt(batch, need),
      '你是一位英语词汇学习专家。你必须返回严格的 JSON，不要有任何额外文本、markdown 标记或代码块符号。',
      Math.min(8000, 500 + batch.length * 280),
      timeoutMs
    )
    if (!reply.trim()) {
      lastError = '模型返回了空内容。带思考过程的推理模型常把正文放在另一个字段里，这类模型不适合跑批量补全，换一个普通对话模型试试。'
      return null
    }
    const arr = extractJsonArray(reply)
    if (!arr) lastError = `模型有回复，但里面解析不出 JSON 数组。开头是：${reply.trim().slice(0, 120)}`
    return arr
  }

  const deliver = async (batch: WordItem[], need: EnrichNeed, depth = 0): Promise<any[] | null> => {
    let worthSplitting = false
    for (let attempt = 0; attempt <= 2; attempt++) {
      if (opts.shouldStop?.()) return null
      try {
        const arr = await askBatch(batch, need)
        if (arr) return arr
        worthSplitting = true
        break
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        lastError = msg
        if (isFatalError(msg)) throw e
        const isTimeout = /超时|timeout/i.test(msg)
        if (isTimeout) {
          timeouts++
          worthSplitting = true
          break
        }
        if (isRetryable(msg) && attempt < 2) {
          await sleep(1200 * (attempt + 1), opts.shouldStop)
          continue
        }
        break
      }
    }
    if (worthSplitting && batch.length > 1 && depth < 3 && !opts.shouldStop?.()) {
      const mid = Math.ceil(batch.length / 2)
      const left = await deliver(batch.slice(0, mid), need, depth + 1)
      const right = await deliver(batch.slice(mid), need, depth + 1)
      if (!left && !right) return null
      return [...(left || []), ...(right || [])]
    }
    return null
  }

  let concurrency = 4
  const adaptConcurrency = () => {
    if (timeouts >= 12 && concurrency > 1) { concurrency = 1; return }
    if (timeouts >= 5 && concurrency > 2) concurrency = 2
  }
  let cursor = 0
  let fatal: unknown = null

  const runOne = async (item: { batch: WordItem[]; need: EnrichNeed }) => {
    const { batch, need } = item
    onProgress?.({ done, total: targets.length, current: batch[0]?.word || '', failed, lastError })

    let arr: any[] | null = null
    try {
      arr = await deliver(batch, need)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      onProgress?.({ done, total: targets.length, current: '', failed, lastError: msg })
      fatal = e
      return
    }

    if (!arr) {
      failed += batch.length
      done += batch.length
      onProgress?.({ done, total: targets.length, current: batch[0]?.word || '', failed, lastError })
      return
    }

    const byWord = new Map<string, any>()
    for (const item of arr) {
      if (item?.word) byWord.set(String(item.word).toLowerCase(), item)
    }

    const batchChanged: WordItem[] = []
    for (const w of batch) {
      const got = byWord.get(w.word.toLowerCase())
      done++
      if (!got) { failed++; continue }
      let touched = false

      if (need.exam && !w.tags?.length && Array.isArray(got.exam_tags)) {
        const valid = canonicalExamTags(got.exam_tags.map((t: any) => String(t)))
          .filter(t => EXAM_TAGS.includes(t))
        if (valid.length) { w.tags = valid; touched = true }
      }

      if (need.topics && !w.topics?.length && Array.isArray(got.topics)) {
        const valid = got.topics.filter((t: any) => TOPIC_CATEGORIES.includes(String(t)))
        if (valid.length) { w.topics = valid; touched = true }
      }

      if (need.morphemes && missingOf(w).morphemes && got.morphemes) {
        const m = pickMorphemes(got.morphemes)
        if (m) { w.morphemes = m; touched = true }
      }

      if (need.family && !w.word_family?.length && Array.isArray(got.word_family)) {
        const fam = got.word_family
          .map((x: any) => String(x).trim().toLowerCase())
          .filter((x: string) => x && x !== w.word.toLowerCase())
        const uniq = [...new Set<string>(fam)]
        if (uniq.length) { w.word_family = uniq; touched = true }
      }

      const now = new Date().toISOString()
      w.aiEnrichedAt = now
      if (touched) w.updatedAt = now
      changed.push(w)
      batchChanged.push(w)
    }

    if (batchChanged.length && opts.onBatchDone) {
      try {
        await opts.onBatchDone(batchChanged)
      } catch (e) {
        console.warn('[AI补全] 这一批落盘失败，继续跑：', e)
      }
    }
  }

  const worker = async (slot: number) => {
    while (true) {
      if (opts.shouldStop?.() || fatal) return
      adaptConcurrency()
      if (slot >= concurrency) return
      const item = plan[cursor++]
      if (!item) return
      await runOne(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, plan.length) }, (_, i) => worker(i)))
  while (cursor < plan.length && !opts.shouldStop?.() && !fatal) {
    await Promise.all(Array.from({ length: Math.min(concurrency, plan.length - cursor) }, (_, i) => worker(i)))
  }
  if (fatal) throw fatal

  onProgress?.({ done, total: targets.length, current: '', failed, lastError })
  return changed
}

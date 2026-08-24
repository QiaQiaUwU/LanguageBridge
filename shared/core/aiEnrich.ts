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

export function missingOf(w: WordItem): {
  topics: boolean; morphemes: boolean; tags: boolean; family: boolean
  meaning: boolean; phonetic: boolean; examples: boolean
} {
  return {
    topics: !w.topics?.length,
    morphemes: !(w.morphemes?.root?.form || w.morphemes?.prefix?.form || w.morphemes?.suffix?.form),
    family: !w.word_family?.length,
    tags: !w.tags?.length,
    /**
     * 释义、音标、例句也算在内。
     *
     * 这三样本来只有「补全释义与音标」那一步管，走的是免费词典 ——
     * 词典查不到的词（生僻词、词组、专有名词，你那边两千多个）就永远缺着，
     * AI 补全又只盯着话题和词根，谁都不管它们。
     * 导进来的新词尤其明显：一整批连中文释义都没有，却不在任何一个待办数字里。
     */
    meaning: !w.meanings?.length || !w.meanings[0]?.chinese,
    phonetic: !w.phonetic,
    examples: !w.example_sentences?.length
  }
}

/**
 * 这条记录的 word 字段像不像一个真正的英文单词/短语。
 *
 * 词库里混着一批脏数据：word 字段存的其实是释义或词性缩写 ——
 * `a. 灵巧的， 熟练的`、`undersize d` 这种。
 * 把它们混在一批里送给模型，模型会一路纠结"用户给的是词还是解释、
 * 是不是分词分错了"，然后把这段纠结当正文吐出来，**整批都拿不到 JSON**。
 * 一条脏数据毁掉一整批十二个词，这是补全一直跑不通的直接原因。
 *
 * 判据保守：含中文就不是英文词；带 `a.` `n.` `v.` 这类词性前缀的是释义；
 * 太长的（超过 4 个词）多半是句子或释义串。
 */
export function looksLikeWord(raw: string): boolean {
  const w = String(raw || '').trim()
  if (!w) return false
  if (/[\u4e00-\u9fa5]/.test(w)) return false          // 有汉字：这才是真脏数据
  if (/^[a-z]{1,4}\.\s/i.test(w)) return false          // a. / adj. / n. 开头，是释义不是词
  if (!/[a-zA-Z]/.test(w)) return false                 // 一个字母都没有
  return true
}

/**
 * 这一条是不是"多词条目"——句型、搭配、固定说法。
 *
 * 原来 looksLikeWord 里有一条"超过 4 个词就不是词"，把
 * `orientation tour on the campus`、`have strong hearts and lungs`
 * 这类正经句型全挡在门外，还给人看一个"不是英文词，清掉吧"的按钮 ——
 * 差点把好数据删了。
 *
 * 它们当然该补，只是能补的项不一样：
 *   中文释义、例句 —— 要，而且正是最需要的
 *   音标 —— 不要，一个句型没有国际音标
 *   词根词缀、词族 —— 不要，拆一个短语的词根没有意义
 */
export function isPhrase(raw: string): boolean {
  return String(raw || '').trim().split(/\s+/).length > 2
}

/**
 * 指定重跑哪几项。
 *
 * 不选就是默认行为「缺什么补什么」；选了就**只跑这几项，并且不管有没有值都重跑**。
 * 之前只有一个"连跑过但没填上的也重跑"的开关，粒度太粗 ——
 * 想把之前回填错的考纲标签整批重来，只能连话题词根一起再跑一遍，白花钱。
 */
export type EnrichField = 'exam' | 'topics' | 'morphemes' | 'family' | 'meaning' | 'phonetic' | 'examples'

const FIELD_CN: Record<string, string> = {
  meaning: '释义', phonetic: '音标', examples: '例句',
  exam: '考纲', topics: '话题', morphemes: '词根', family: '词族'
}

export const ENRICH_FIELD_LABELS: { key: EnrichField; label: string }[] = [
  { key: 'meaning', label: '中文释义' },
  { key: 'phonetic', label: '音标' },
  { key: 'examples', label: '例句' },
  { key: 'exam', label: '考纲来源' },
  { key: 'topics', label: '话题' },
  { key: 'morphemes', label: '词根词缀' },
  { key: 'family', label: '词族' }
]

export function needsAiEnrich(w: WordItem, force = false, redo?: EnrichField[]): boolean {
  // 脏词条永远不送 —— 送了也补不出东西，还会把同批的好词一起拖垮
  if (!looksLikeWord(w.word)) return false
  // 指定了重跑项：这些词一律要跑，不看缺不缺、也不看跑没跑过
  if (redo?.length) return true
  const m = missingOf(w)
  // 七样里缺任何一样都值得跑一次，不再只盯话题和词根
  if (!(m.topics || m.morphemes || m.meaning || m.phonetic || m.examples || m.tags || m.family)) return false
  if (force) return true

  /**
   * 只有「这一项自己跑过」才算跑过。
   *
   * 旧的 aiEnrichedAt 是整条记录一个戳，早期只请求话题和词根的那几轮
   * 也会盖上它 —— 于是释义、音标、例句从没被问过，却永远排不进队。
   * 现在逐项看：缺的项里只要有一项没跑过，这个词就该跑。
   */
  const ran = w.aiEnrichedFields || {}
  const phrase = isPhrase(w.word)
  const pending: EnrichField[] = []
  if (m.meaning) pending.push('meaning')
  if (m.examples) pending.push('examples')
  if (m.tags) pending.push('exam')
  if (m.topics) pending.push('topics')
  // 这三项对句型没意义，缺着也不算欠 —— 否则它们会永远排在队里
  if (m.phonetic && !phrase) pending.push('phonetic')
  if (m.morphemes && !phrase) pending.push('morphemes')
  if (m.family && !phrase) pending.push('family')
  return pending.some(k => !ran[k])
}

export function countNeedAiEnrich(words: WordItem[], force = false): number {
  return words.filter(w => needsAiEnrich(w, force)).length
}

export interface EnrichPreview {
  total: number
  pending: number
  attempted: number
  complete: number
  /** word 字段不像英文词（存的是释义或词性缩写），一律不送模型 */
  dirty: number
  requests: number
}

export function previewAiEnrich(
  words: WordItem[],
  force = false,
  batchSize = DEFAULT_BATCH_SIZE,
  canBackfillTags?: (w: WordItem) => boolean
): EnrichPreview {
  /**
   * 三个数字必须跟"点下去到底会跑多少"一致。
   *
   * 之前 pending 的判据是「有没有 aiEnrichedAt 这个总戳」，而真正决定跑不跑的
   * needsAiEnrich 早就改成按项看了 —— 于是卡片上写着"待跑 15"，
   * 点下去实际跑一千八百多；体检说"缺中文释义 1767"，这边一个都不认。
   * 现在 pending 直接用 needsAiEnrich 数，口径只有一套。
   *
   * dirty 那一档留着但基本不会有数了：放宽长度限制之后，
   * 只有真的含中文、或者以 `a.` 这类词性缩写开头的才算脏 ——
   * 那才是导入时把释义当词收进来的产物。
   */
  let pending = 0, attempted = 0, complete = 0, dirty = 0
  for (const w of words) {
    const m = missingOf(w)
    const lacks = m.topics || m.morphemes || m.meaning || m.phonetic || m.examples || m.tags || m.family
    if (!lacks) { complete++; continue }
    if (!looksLikeWord(w.word)) { dirty++; continue }
    if (needsAiEnrich(w, force)) pending++
    else attempted++
  }
  const willRunItems = words.filter(w => needsAiEnrich(w, force))
  const sizes = new Map<string, number>()
  for (const w of willRunItems) {
    const k = needKey(needOf(w, canBackfillTags))
    sizes.set(k, (sizes.get(k) || 0) + 1)
  }
  let requests = 0
  for (const n of sizes.values()) requests += Math.ceil(n / batchSize)
  return { total: words.length, pending, attempted, complete, dirty, requests }
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
    // 句型不该算"缺音标"—— 它本来就不该有
    const noPhonetic = !w.phonetic && !isPhrase(w.word)
    const noMeaning = !w.meanings?.[0]?.chinese
    const noExample = !w.example_sentences?.length
    const noPos = !w.meanings?.[0]?.partOfSpeech
    if (noPhonetic) h.noPhonetic++
    if (noMeaning) h.noMeaning++
    if (noExample) h.noExample++
    if (noPos) h.noPos++
    if (!w.tags?.length) h.noTags++
    if (!w.topics?.length) h.noTopics++
    if (missingOf(w).morphemes && !isPhrase(w.word)) h.noMorphemes++
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
  meaning: boolean
  phonetic: boolean
  examples: boolean
}

export function needOf(
  w: WordItem,
  canBackfillTags?: (w: WordItem) => boolean,
  redo?: EnrichField[]
): EnrichNeed {
  // 指定了重跑项：只要这几项，其余一概不问，省 token 也省时间
  if (redo?.length) {
    const on = (k: EnrichField) => redo.includes(k)
    return {
      exam: on('exam'), topics: on('topics'), morphemes: on('morphemes'), family: on('family'),
      meaning: on('meaning'), phonetic: on('phonetic'), examples: on('examples')
    }
  }
  const m = missingOf(w)
  // 句型/搭配：音标和词根词缀对它们没意义，别问，也别因为"缺"这些就一直排队
  const phrase = isPhrase(w.word)
  return {
    exam: m.tags && !(canBackfillTags?.(w) ?? false),
    topics: m.topics,
    morphemes: m.morphemes && !phrase,
    family: m.family && !phrase,
    meaning: m.meaning,
    phonetic: m.phonetic && !phrase,
    examples: m.examples
  }
}

/** 缺的组合一样的词才凑一批，免得给不缺的词也要一遍那些字段 */
function needKey(n: EnrichNeed): string {
  return [n.exam, n.topics, n.morphemes, n.family, n.meaning, n.phonetic, n.examples]
    .map(x => (x ? 1 : 0))
    .join('')
}

function buildPrompt(batch: WordItem[], need: EnrichNeed): string {
  const list = batch.map(w => w.word).join(', ')
  /*
   * 单复数措辞的问题不用再单独处理了：现在写的是"输入词（共 N 个）"，
   * 一个词和十二个词是同一句话，不会出现"这些"配一个词的别扭。
   */
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
  // 词典查不到的词只能靠模型补这三样，字段名跟词条结构对齐
  if (need.phonetic) {
    fields.push(`  "phonetic": "国际音标，不带斜杠",`)
  }
  if (need.meaning) {
    fields.push(`  "meanings": [{ "partOfSpeech": "词性缩写如 n. v. adj.", "chinese": "中文释义，多个义项用分号隔开" }],`)
    rules.push('meanings 至少给一个义项；是词组就把 partOfSpeech 留空字符串')
  }
  if (need.examples) {
    fields.push(`  "example_sentences": [{ "en": "包含该词的英文例句", "zh": "这句的中文翻译" }],`)
    rules.push('example_sentences 给 1-2 句，句子里必须出现这个词本身或它的变形')
  }
  // 一批里有句型/搭配时说一句，免得模型硬给短语拆词根、编音标
  if (batch.some(w => isPhrase(w.word))) {
    rules.push('输入里有句型和固定搭配，它们照样要给中文释义和例句；不要为它们编造音标或拆词根')
  }
  const count = fields.length + (need.morphemes ? 1 : 0) + (need.family ? 1 : 0)
  /**
   * 提示词的写法。
   *
   * 之前写的是"为下面这些单词各生成 N 项数据"——一句自然语言描述。
   * 模型得先理解"N 项是哪几项"，再去看清单，然后碰上 `undersize d`
   * 这种带空格的条目就开始纠结"这是不是笔误、要不要纠正成 undersized"，
   * 一纠结就把推理当正文吐出来，整批作废。
   *
   * 参考项目那边的做法是**先给 JSON 骨架，模型照着填**，不需要它理解任务描述。
   * 这里改成同一路子，并补上一句最要紧的：
   * **word 原样照抄，不要纠正拼写** —— 这句话直接掐掉了上面那种纠结。
   */
  return `按下面的 JSON 模板，为每个输入词填出一个对象，返回一个 JSON 数组。
数组长度和顺序必须跟输入词完全一致。
word 字段原样照抄输入，即使看起来像拼写错误或带空格也照抄，不要纠正、不要拆分、不要跳过。
不要任何额外文本或 markdown 代码块标记，第一个字符必须是 [ ，最后一个字符必须是 ]。
不要写任何思考过程、说明或前言。

输入词（共 ${batch.length} 个）：${list}

模板：
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

/**
 * 从模型回复里把 JSON 数组抠出来。
 * 导出给别处复用 —— 教材那边原来自己写了一版简陋的（只找第一个 [ 和最后一个 ]），
 * 碰上尾随逗号、中文引号、夹杂思考文字就整段解析失败。
 */
export function extractJsonArray(text: string): any[] | null {
  const cleaned = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    // 中文引号和尾随逗号是模型最常犯的两种，JSON.parse 一碰就炸
    // 用 \u 转义写，别直接敲中文引号 —— 上一版这两行里的引号
    // 落到文件里变成了英文引号，等于把 " 换成 "、' 换成 '，白写一场
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([\]}])/g, '$1')
    .trim()
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
    } catch { /* 往下退：逐个对象捡 */ }
  }

  return pickObjects(cleaned)
}

/**
 * 最后一层兜底：从一堆文字里把 `{...}` 一个个抠出来试。
 *
 * 有些模型（尤其带思考过程的）会先讲一段"我们需要理解用户的请求…"，
 * 再把 JSON 混在里面；也有的只给一个对象不给数组。
 * 前面几层都要求整体能解析，碰上这种就整批作废、整批重跑，
 * 而重跑同一个模型多半还是同样的结果。
 * 这里按大括号配对逐个扫，能解析出来且带 word 键的就收下，
 * 一条坏的不影响别的。
 */
function pickObjects(text: string): any[] | null {
  const out: any[] = []
  let depth = 0
  let start = -1
  let inStr = false
  let esc = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; continue }
    if (c === '{') { if (depth === 0) start = i; depth++; continue }
    if (c === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        try {
          const obj = JSON.parse(text.slice(start, i + 1))
          if (obj && typeof obj.word === 'string') out.push(obj)
        } catch { /* 这一个坏了就跳过 */ }
        start = -1
      }
      if (depth < 0) depth = 0
    }
  }
  return out.length ? out : null
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
    /**
     * 试跑必须跟正式补全走**完全一样**的参数。
     *
     * 这里原来漏了两样：jsonOnly 没传（于是走的是旧路径，思维链会被当正文
     * 原样返回），maxTokens 写死 1200（推理模型的思考都不止这个数）。
     * 结果是试跑和正式跑表现不一致 —— 试跑"正常"、正式跑全失败，
     * 或者反过来，拿试跑根本验不出真实情况。
     */
    raw = await askAi(
      buildPrompt(targets, need),
      '你是一位英语词汇学习专家。你必须返回严格的 JSON，不要有任何额外文本、markdown 标记或代码块符号。',
      Math.min(16000, 2000 + targets.length * 700),
      60_000,
      true
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
    /** 只重跑这几项；不给就是默认的「缺什么补什么」 */
    redo?: EnrichField[]
  } = {}
): Promise<WordItem[]> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE
  const targets = words.filter(w => needsAiEnrich(w, opts.force, opts.redo))

  /**
   * 逐项统计。
   *
   * 「跑了 1781 个、已存 1781 个，可七项还是缺」这种情况，笼统的进度数字
   * 一点忙都帮不上 —— 到底是模型没给这一项、还是给了写不进去，看不出来。
   * 分项记账，跑完直接报「释义 填上1700/没给81」这样的结果。
   */
  /**
   * 逐项记账。跑完报「释义 1700/1781」这样的账，
   * 一眼看出是哪一项模型没给，而不是笼统一个"已存 N 个"。
   */
  const filled: Record<string, number> = { meaning: 0, phonetic: 0, examples: 0, exam: 0, topics: 0, morphemes: 0, family: 0 }
  const miss: Record<string, number> = { meaning: 0, phonetic: 0, examples: 0, exam: 0, topics: 0, morphemes: 0, family: 0 }

  const buckets = new Map<string, { need: EnrichNeed; items: WordItem[] }>()
  for (const w of targets) {
    const need = needOf(w, opts.canBackfillTags, opts.redo)
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
      /**
       * 配额要按「正文 + 思考」一起估。
       *
       * 12 个词的 JSON 大约 3000 token，原来就按这个给 —— 一点余量都没有。
       * 推理模型的思考轻松几千 token，一超就是 finish_reason=length、
       * JSON 写到一半没了，而报出来的却是"模型不返回 JSON"。
       * 留出三倍余量；还不够时 askAi 会自动加大重试。
       * 用不完不花钱：max_tokens 是上限，不是用量。
       */
      Math.min(16000, 2000 + batch.length * 700),
      timeoutMs,
      true          // 要 JSON：思维链不许当正文顶上来
    )
    if (!reply.trim()) {
      lastError = '模型返回了空内容。带思考过程的推理模型常把正文放在另一个字段里，这类模型不适合跑批量补全，换一个普通对话模型试试。'
      return null
    }
    let arr = extractJsonArray(reply)
    if (arr) return arr

    /**
     * 第一次没给 JSON 就再要一次，这次把话说死。
     *
     * 带思考过程的模型很容易把推理当正文吐出来；同一段提示词换个说法
     * 往往就正常了，比整批作废、下次补跑再来一遍便宜得多。
     * 只重试一次，避免在一个不合适的模型上反复烧额度。
     */
    const retry = await askAi(
      `${buildPrompt(batch, need)}\n\n上一次回复不是 JSON。这次只输出 JSON 数组本身，第一个字符是 [，不要任何解释。`,
      'Output ONLY a valid JSON array. No reasoning, no explanation, no markdown. Start with [ and end with ].',
      Math.min(16000, 2000 + batch.length * 700),
      timeoutMs,
      true          // 要 JSON：思维链不许当正文顶上来
    )
    arr = extractJsonArray(retry)
    if (arr) return arr

    lastError = `模型有回复但两次都不是 JSON，多半是带思考过程的推理模型，换一个普通对话模型试试。开头是：${reply.trim().slice(0, 120)}`
    return null
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
    for (let bi = 0; bi < batch.length; bi++) {
      const w = batch[bi]
      /**
       * 先按词名对，对不上就按下标对。
       *
       * 提示词要求"数组长度和顺序跟输入完全一致"，但模型偶尔还是会把
       * `undersize d` 规范成 `undersized`、或者改个大小写 ——
       * 只按词名匹配的话这一条就算"没返回"，白跑一次。
       * 长度一致时按下标兜底，比丢掉靠谱。
       */
      const got = byWord.get(w.word.toLowerCase())
        || (arr.length === batch.length ? arr[bi] : undefined)
      done++
      if (!got) { failed++; continue }
      let touched = false

      /**
       * 指定重跑的项**允许覆盖**旧值。
       *
       * 平时的规矩是"已有值绝不覆盖"，那是为了保护原始数据；
       * 但用户明确点了"重跑考纲来源"，意思就是现在这个值不对、要换掉 ——
       * 这时还守着不覆盖，等于这个按钮点了没用。
       */
      const redoSet = new Set(opts.redo || [])
      /**
       * **`hasValue` 必须跟 missingOf 用同一把尺子。**
       *
       * 这里踩过一个很隐蔽的坑：判"缺不缺释义"用的是 `!meanings[0]?.chinese`，
       * 而判"能不能写"用的是 `!!meanings?.length` —— 有数组但中文是空的词条
       * （导入时只带了词性、没带释义的那一大批就是这样）在两把尺子下
       * 一个说"缺"、一个说"有"，于是**永远排队、永远不写**。
       * 表现出来就是"跑完 1781 个，一个字段都没填上，刷新还是那个数"。
       *
       * 所以这里不自己判断有没有值，直接拿 missingOf 的结论取反。
       */
      const mNow = missingOf(w)
      const canWrite = (k: EnrichField) => {
        if (redoSet.has(k)) return true
        switch (k) {
          case 'meaning': return mNow.meaning
          case 'phonetic': return mNow.phonetic
          case 'examples': return mNow.examples
          case 'exam': return mNow.tags
          case 'topics': return mNow.topics
          case 'morphemes': return mNow.morphemes
          case 'family': return mNow.family
          default: return false
        }
      }

      if (need.exam && canWrite('exam') && Array.isArray(got.exam_tags)) {
        const valid = canonicalExamTags(got.exam_tags.map((t: any) => String(t)))
          .filter(t => EXAM_TAGS.includes(t))
        if (valid.length) { w.tags = valid; touched = true }
      }

      if (need.topics && canWrite('topics') && Array.isArray(got.topics)) {
        const valid = got.topics.filter((t: any) => TOPIC_CATEGORIES.includes(String(t)))
        if (valid.length) { w.topics = valid; touched = true }
      }

      if (need.morphemes && canWrite('morphemes') && got.morphemes) {
        const m = pickMorphemes(got.morphemes)
        if (m) { w.morphemes = m; touched = true }
      }

      if (need.family && canWrite('family') && Array.isArray(got.word_family)) {
        const fam = got.word_family
          .map((x: any) => String(x).trim().toLowerCase())
          .filter((x: string) => x && x !== w.word.toLowerCase())
        const uniq = [...new Set<string>(fam)]
        if (uniq.length) { w.word_family = uniq; touched = true }
      }

      // 词典补不上的那三样。同样只填空缺，已有的一律不动
      if (need.phonetic && canWrite('phonetic') && typeof got.phonetic === 'string') {
        const ph = got.phonetic.trim().replace(/^\/|\/$/g, '')
        if (ph) { w.phonetic = ph; touched = true }
      }

      if (need.meaning && canWrite('meaning')) {
        /**
         * 释义的键名多认几种。
         *
         * 模板里写的是 meanings[].chinese，但模型经常给成
         * definition_zh（跟词库文件里的字段同名）、zh、definition、
         * 或者干脆把整条释义放在顶层 meaning 上。
         * 只认一种键名的话，明明返回了内容却当成"没填上"。
         */
        const rawList: any[] = Array.isArray(got.meanings) ? got.meanings
          : Array.isArray(got.pos_definitions) ? got.pos_definitions
            : got.meaning || got.chinese ? [{ chinese: got.meaning || got.chinese }]
              : []
        const cnOf = (x: any) =>
          String(x?.chinese ?? x?.definition_zh ?? x?.zh ?? x?.definition ?? '').trim()
        const posOf = (x: any) =>
          String(x?.partOfSpeech ?? x?.pos ?? x?.part_of_speech ?? '').trim()

        const ms = rawList
          .filter(x => cnOf(x))
          .map(x => ({ partOfSpeech: posOf(x), chinese: cnOf(x) }))
        if (ms.length) { w.meanings = ms; touched = true }
      }

      if (need.examples && canWrite('examples')) {
        // 例句同理：en/zh、sentence/translation、english/chinese 都见过
        const rawEx: any[] = Array.isArray(got.example_sentences) ? got.example_sentences
          : Array.isArray(got.examples) ? got.examples : []
        const enOf = (x: any) => String(x?.en ?? x?.english ?? x?.sentence ?? '').trim()
        const zhOf = (x: any) => String(x?.zh ?? x?.chinese ?? x?.translation ?? '').trim()
        const ex = rawEx.filter(x => enOf(x)).map(x => ({ en: enOf(x), zh: zhOf(x) }))
        if (ex.length) { w.example_sentences = ex; touched = true }
      }

      /**
       * 逐项记账：这次到底哪一项填上了、哪一项模型压根没给。
       *
       * 「跑了 1781 个，可七项还是缺」这种情况，笼统的进度数字一点忙都帮不上 ——
       * 分项统计出来才知道是模型没返回这一项，还是返回了写不进去。
       */
      if (need.meaning) (w.meanings?.length ? filled.meaning++ : miss.meaning++)
      if (need.phonetic) (w.phonetic ? filled.phonetic++ : miss.phonetic++)
      if (need.examples) (w.example_sentences?.length ? filled.examples++ : miss.examples++)
      if (need.exam) (w.tags?.length ? filled.exam++ : miss.exam++)
      if (need.topics) (w.topics?.length ? filled.topics++ : miss.topics++)
      if (need.morphemes) (!missingOf(w).morphemes ? filled.morphemes++ : miss.morphemes++)
      if (need.family) (w.word_family?.length ? filled.family++ : miss.family++)

      const now = new Date().toISOString()
      w.aiEnrichedAt = now
      /**
       * 按项记账：这次请求里带了哪几项，就给哪几项盖戳。
       * 没带的项不盖 —— 它压根没被问过，凭什么算试过。
       */
      const ran: Record<string, string> = { ...(w.aiEnrichedFields || {}) }
      for (const [k, on] of Object.entries(need)) if (on) ran[k] = now
      w.aiEnrichedFields = ran
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

  const report = Object.keys(filled)
    .filter(k => filled[k] || miss[k])
    .map(k => `${FIELD_CN[k] || k} ${filled[k]}/${filled[k] + miss[k]}`)
    .join('，')
  onProgress?.({
    done, total: targets.length, current: '', failed,
    lastError: report ? `本轮填充：${report}${lastError ? ` · 最后错误：${lastError}` : ''}` : lastError
  })
  return changed
}

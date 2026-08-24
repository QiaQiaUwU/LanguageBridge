/**
 * 词表配套教材（syllabus）。
 *
 * 解决的问题：现在的场景学习是"学满 N 个词 → 跳到一个页面 → 自己选主题 → 现场生成"。
 * 每次生成互不相干，选出来的词也是刚学的那 N 个，凑在一起未必能写成一篇像样的东西。
 *
 * 改成：**一个词表配一套教材**。第一次学这个词表时按话题把词分好组、排好顺序，
 * 规划出若干课，每课覆盖一批话题相近的词。之后学习就照这个顺序走，
 * 学到某一课覆盖的词学完了，就把那一课的短文端出来读。
 *
 * 两个关键取舍：
 *
 * 1. **只在勾了场景学习或造句训练时才跑。** 这是一次 AI 请求（几千词的词表会拆成
 *    多次），要花额度。没勾就完全不碰，学习流程跟以前一模一样。
 *
 * 2. **分组用词条自带的 topics，不够才问 AI。** 词库里大部分词已经有话题标签
 *    （AI 补全那一步填的），能用就不该再花一次钱。只有话题标签覆盖率太低时
 *    才整批送给模型分类。
 */

import type { WordItem } from '@/shared/types/WordItem'
import { askAi } from './aiClient'

export interface SyllabusLesson {
  id: string
  /** 这一课围绕什么话题 */
  topic: string
  /** 覆盖哪些词（存 word 本身，词条 id 会因为重建缓存而变） */
  words: string[]
  /** 这一段生成好的句对；没生成过就是空 */
  sentences?: { en: string; zh: string }[]
  /** 已经读过了 */
  read?: boolean
}

/**
 * 一篇播客稿。
 *
 * 由若干课组成，**一课就是一段**。学完一课的词就放出那一段，
 * 所有段都放完了才拼成完整的一篇 —— 一次给一整篇压力太大，
 * 而且那时候后面几段的词还没学，读了等于剧透。
 */
export interface SyllabusPodcast {
  id: string
  title: string
  /** 按顺序的课 id，每个对应一段 */
  lessonIds: string[]
  /** 存进阅读助手之后的文章 id */
  articleId?: string
}

export interface Syllabus {
  /** 哪个词表。空串表示"全部词库"那种没有具体词表的范围 */
  groupId: string
  createdAt: string
  /** 排好的学习顺序，同一话题的词挨在一起 */
  order: string[]
  lessons: SyllabusLesson[]
  podcasts: SyllabusPodcast[]
}

const KEY_PREFIX = 'lb-syllabus-'

function keyOf(groupId: string) {
  return KEY_PREFIX + (groupId || 'all')
}

/**
 * 列出本机存过的所有教材。
 *
 * 有了它才能回答"我上次跑的那套跑哪去了" —— 早先因为存储键算错，
 * 教材会落在别的 key 下（比如本该是 group:xxx 却存成了 all），
 * 界面上看着像凭空消失，其实还在。列出来就能认领或清掉。
 */
export function listSyllabuses(): Array<{ key: string; syllabus: Syllabus }> {
  const out: Array<{ key: string; syllabus: Syllabus }> = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(KEY_PREFIX)) continue
      try {
        const sy = JSON.parse(localStorage.getItem(k) || 'null')
        if (sy && Array.isArray(sy.lessons)) out.push({ key: k.slice(KEY_PREFIX.length), syllabus: sy })
      } catch { /* 坏的跳过 */ }
    }
  } catch { /* 忽略 */ }
  return out
}

export function readSyllabus(groupId: string): Syllabus | null {
  try {
    const raw = localStorage.getItem(keyOf(groupId))
    if (!raw) return null
    const s = JSON.parse(raw)
    return s && Array.isArray(s.order) && Array.isArray(s.lessons) ? (s as Syllabus) : null
  } catch {
    return null
  }
}

export function saveSyllabus(s: Syllabus): void {
  try {
    localStorage.setItem(keyOf(s.groupId), JSON.stringify(s))
  } catch {
    /* 存不下就当没有教材，学习流程照常 */
  }
}

export function clearSyllabus(groupId: string): void {
  try {
    localStorage.removeItem(keyOf(groupId))
  } catch { /* 忽略 */ }
}

/** 词条自带话题的覆盖率。低于这个值才值得花钱让模型重新分类 */
const TOPIC_COVER_MIN = 0.6

/**
 * 一课覆盖多少词。
 *
 * 不固定 3 组 —— 话题下的词有多有少，硬切成一样大会把关系近的词拆开。
 * 这里给一个区间：少于 MIN 的话题并进"综合"，多于 MAX 的话题再切成几课。
 */
const LESSON_MIN = 12
const LESSON_MAX = 28

function groupByOwnTopics(words: WordItem[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const w of words) {
    const t = w.topics?.[0] || '综合'
    const arr = map.get(t) || []
    arr.push(w.word)
    map.set(t, arr)
  }
  return map
}

/** 问模型：这批词按话题怎么分。只在词条自带话题不够时才走这条 */
async function askTopics(
  words: string[],
  hooks?: { onProgress?: (done: number, total: number, note: string) => void; shouldStop?: () => boolean }
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  const BATCH = 60
  for (let i = 0; i < words.length; i += BATCH) {
    if (hooks?.shouldStop?.()) throw new Error('已停止')
    const batch = words.slice(i, i + BATCH)
    hooks?.onProgress?.(i, words.length, `分类 ${batch[0]} 等 ${batch.length} 个词`)
    const reply = await askAi(
      `把下面的英语单词按话题分组，返回严格的 JSON 对象：键是中文话题名，值是属于这个话题的单词数组。\n` +
      `话题数控制在 4-8 个，每个词只归一个话题，实在归不了的放进"综合"。\n` +
      `只输出 JSON，第一个字符是 {。\n\n单词：${batch.join(', ')}`,
      'Output ONLY a valid JSON object. No explanation.',
      2000,
      60_000,
      true
    )
    try {
      const cleaned = reply.replace(/```json/gi, '').replace(/```/g, '').trim()
      const start = cleaned.indexOf('{')
      const end = cleaned.lastIndexOf('}')
      if (start < 0 || end <= start) continue
      const obj = JSON.parse(cleaned.slice(start, end + 1))
      for (const [topic, list] of Object.entries(obj)) {
        if (!Array.isArray(list)) continue
        const arr = map.get(topic) || []
        for (const w of list) if (typeof w === 'string') arr.push(w)
        map.set(topic, arr)
      }
    } catch {
      // 这一批分不了就整批算"综合"，不至于让整套教材生成失败
      const arr = map.get('综合') || []
      arr.push(...batch)
      map.set('综合', arr)
    }
  }
  return map
}

/** 把话题分组切成课：太小的并起来，太大的拆开 */
function toLessons(groups: Map<string, string[]>): SyllabusLesson[] {
  const lessons: SyllabusLesson[] = []
  let carry: string[] = []
  let carryNames: string[] = []
  let n = 0

  const push = (topic: string, words: string[]) => {
    lessons.push({ id: `ls-${Date.now().toString(36)}-${n++}`, topic, words })
  }

  // 先按词数从多到少，大话题先成课，小话题攒着并成一课
  const entries = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [topic, words] of entries) {
    if (words.length >= LESSON_MIN) {
      for (let i = 0; i < words.length; i += LESSON_MAX) {
        const slice = words.slice(i, i + LESSON_MAX)
        // 尾巴太短就并进上一课，避免出现只有两三个词的一课
        if (slice.length < LESSON_MIN && lessons.length) {
          lessons[lessons.length - 1].words.push(...slice)
        } else {
          push(topic, slice)
        }
      }
      continue
    }
    carry.push(...words)
    carryNames.push(topic)
    if (carry.length >= LESSON_MIN) {
      push(carryNames.slice(0, 3).join(' / '), carry)
      carry = []
      carryNames = []
    }
  }
  if (carry.length) {
    if (lessons.length) lessons[lessons.length - 1].words.push(...carry)
    else push(carryNames.join(' / ') || '综合', carry)
  }
  return lessons
}

/**
 * 生成一个词表的教材。
 * 调用方负责判断"要不要跑"（勾没勾场景学习、有没有跑过）。
 */
export async function buildSyllabus(
  groupId: string,
  words: WordItem[],
  hooks?: {
    onProgress?: (done: number, total: number, note: string) => void
    shouldStop?: () => boolean
  }
): Promise<Syllabus> {
  const withTopic = words.filter(w => w.topics?.length).length
  const cover = words.length ? withTopic / words.length : 0

  const groups = cover >= TOPIC_COVER_MIN
    ? groupByOwnTopics(words)
    : await askTopics(words.map(w => w.word), hooks)
  if (hooks?.shouldStop?.()) throw new Error('已停止')

  const lessons = toLessons(groups)
  // 学习顺序 = 按课依次排开，同一课的词挨在一起
  const order: string[] = []
  for (const l of lessons) order.push(...l.words)

  const s: Syllabus = {
    groupId,
    createdAt: new Date().toISOString(),
    order,
    lessons,
    podcasts: toPodcasts(lessons)
  }
  saveSyllabus(s)
  return s
}

/**
 * 分篇：**按话题聚，不按固定段数切**。
 *
 * 原来写死"每 3 段一篇"，于是同一个话题的四段会被硬切成两篇、
 * 两个毫不相干的话题反被塞进同一篇。一篇随笔该是围绕一件事写的，
 * 段数是结果不是前提。
 *
 * 规则：同话题的段归一篇；一篇最多 5 段（再多读起来没有收束），
 * 超了就拆；只有一段的零散话题攒到一起凑成一篇"杂篇"。
 */
const MAX_SECTIONS = 5

function toPodcasts(lessons: SyllabusLesson[]): SyllabusPodcast[] {
  const out: SyllabusPodcast[] = []
  let n = 0
  const push = (part: SyllabusLesson[], title: string) => {
    if (!part.length) return
    out.push({
      id: `pd-${Date.now().toString(36)}-${n++}`,
      // 标题先用话题拼一个，正文写出来之后模型会给更像样的，那时再覆盖
      title,
      lessonIds: part.map(l => l.id)
    })
  }

  // 先按话题归堆，保持课本身的先后顺序
  const byTopic = new Map<string, SyllabusLesson[]>()
  for (const l of lessons) {
    const arr = byTopic.get(l.topic) || []
    arr.push(l)
    byTopic.set(l.topic, arr)
  }

  const singles: SyllabusLesson[] = []
  for (const [topic, group] of byTopic) {
    if (group.length === 1) { singles.push(group[0]); continue }
    for (let i = 0; i < group.length; i += MAX_SECTIONS) {
      push(group.slice(i, i + MAX_SECTIONS), topic)
    }
  }

  // 零散的单段话题凑成几篇，别让每个话题都独占一篇只有一段的稿子
  for (let i = 0; i < singles.length; i += 3) {
    const part = singles.slice(i, i + 3)
    push(part, part.map(l => l.topic).join(' · '))
  }
  return out
}

/**
 * 这套教材算不算「齐了」：每一课都得有课文。
 *
 * 学习入口拿它当门槛 —— 缺课文的话，学到那一课什么都弹不出来，
 * 而学词顺序又已经按教材排过，等于半套东西，不如不开始。
 */
export function syllabusReady(s: Syllabus | null): boolean {
  if (!s || !s.lessons.length) return false
  return s.lessons.every(l => !!l.sentences?.length)
}

/** 还差几段没写 */
export function missingSectionCount(s: Syllabus | null): number {
  if (!s) return 0
  return s.lessons.filter(l => !l.sentences?.length).length
}

/** 这一课属于哪篇播客稿 */
export function podcastOfLesson(s: Syllabus, lessonId: string): SyllabusPodcast | null {
  return s.podcasts.find(p => p.lessonIds.includes(lessonId)) || null
}

/** 这篇稿子的所有段都写完并读过了吗 */
export function podcastComplete(s: Syllabus, p: SyllabusPodcast): boolean {
  return p.lessonIds.every(id => {
    const l = s.lessons.find(x => x.id === id)
    return !!l?.sentences?.length && !!l.read
  })
}

/** 把一篇稿子的所有段按顺序拼起来 */
export function podcastSentences(s: Syllabus, p: SyllabusPodcast): { en: string; zh: string }[] {
  const out: { en: string; zh: string }[] = []
  for (const id of p.lessonIds) {
    const l = s.lessons.find(x => x.id === id)
    if (l?.sentences?.length) out.push(...l.sentences)
  }
  return out
}

/**
 * 按教材给的顺序重排词。
 * 教材里没有的词（后来新加进词表的）排在最后，不会因为没排进去就学不到。
 */
export function applyOrder(words: WordItem[], order: string[]): WordItem[] {
  if (!order.length) return words
  const rank = new Map(order.map((w, i) => [w.toLowerCase(), i]))
  return [...words].sort((a, b) => {
    const ra = rank.get(a.word.toLowerCase())
    const rb = rank.get(b.word.toLowerCase())
    if (ra === undefined && rb === undefined) return 0
    if (ra === undefined) return 1
    if (rb === undefined) return -1
    return ra - rb
  })
}

/**
 * 这批刚学完的词，是否正好把某一课覆盖完了。
 * 覆盖完才把那一课的短文端出来 —— 词还没学全就读，等于提前剧透。
 */
export function lessonReadyFor(s: Syllabus, learnedWords: Set<string>): SyllabusLesson | null {
  for (const l of s.lessons) {
    if (l.read) continue                           // 这一段已经放过了
    if (!l.words.length) continue
    const done = l.words.filter(w => learnedWords.has(w.toLowerCase())).length
    if (done >= l.words.length) return l
  }
  return null
}

/**
 * 写这一段。
 *
 * 带上同一篇稿子里前面已经写好的段落作为上文 —— 一段一段分开生成，
 * 不给上文的话每段都会各写各的，拼起来不像一篇东西。
 * 用户自己那批「沉浸式背单词」稿的文风范例也一起带上（跟播客文章共用一套）。
 */
export async function generateSection(
  s: Syllabus,
  lesson: SyllabusLesson,
  opts: { isFirst: boolean; isLast: boolean; prev: { en: string; zh: string }[] }
): Promise<{ en: string; zh: string }[]> {
  const { buildStyleSampleBlock } = await import('./podcastStyleSamples')
  const prevText = opts.prev.slice(-6).map(x => x.en).join(' ')

  /**
   * 句数跟着词数走。
   *
   * 原来写死「8-12 句」，可一课最多有 28 个词，还要求全用上 ——
   * 平均每句塞两三个目标词，这是个自相矛盾的要求：
   * 模型要么硬凑出不像话的句子，要么干脆不按格式回，
   * 表现出来就是"24 段全失败"。
   * 按每句约 1.5 个目标词给区间，写起来才是件能做到的事。
   */
  const n = lesson.words.length
  const minLines = Math.max(8, Math.round(n / 2))
  const maxLines = Math.max(minLines + 4, Math.round(n / 1.2))

  const lines = [
    `写一段中英对照的随笔，围绕「${lesson.topic}」，长度 ${minLines}-${maxLines} 句。`,
    `必须自然地用上这些词（一句里放一到两个就行，不要硬堆）：${lesson.words.join(', ')}`,
    '',
    opts.isFirst
      ? '这是全文的开头，起个头就行，不要收尾。'
      : `这是中间的一段，接着上文往下写，不要重新开头。上文结尾：${prevText}`,
    opts.isLast ? '这是最后一段，写完要收住。' : '',
    '',
    buildStyleSampleBlock(2),
    '',
    '返回严格的 JSON 数组，每项是 {"en": "英文句", "zh": "中文句"}。',
    '第一个字符必须是 [ ，不要任何解释或 markdown。'
  ]

  const reply = await askAi(
    lines.filter(Boolean).join('\n'),
    'Output ONLY a valid JSON array of {en, zh} objects.',
    // 一句中英对照约 100 token。正文之外还要给思考留位置 ——
    // 推理模型的思考经常比正文还长，配额只按正文算必然被截断。
    Math.min(16000, 3000 + maxLines * 500),
    120_000,
    true          // 要 JSON：只返回思考过程的模型直接报错，别拿去解析
  )

  /**
   * 用 aiEnrich 那套解析，不要自己再写一版。
   *
   * 我这里原来是「找第一个 [ 和最后一个 ]，中间 JSON.parse」——
   * 尾随逗号、中文引号、夹在思考文字里的 JSON，一个都扛不住，
   * 报出来就是 `Unexpected token ','`。那边那套已经处理过这些，
   * 还有逐对象兜底（能从一堆废话里把 {...} 一个个捡出来）。
   */
  const { extractJsonArray } = await import('./aiEnrich')
  const arr = extractJsonArray(reply)
  if (!arr) throw new Error(`模型回复里没有可用的 JSON。开头是：${reply.trim().slice(0, 80)}`)

  return arr
    .filter((x: any) => x && typeof x.en === 'string' && x.en.trim())
    .map((x: any) => ({ en: String(x.en).trim(), zh: String(x.zh || '').trim() }))
}

/**
 * 把整套教材的正文一次写完。
 *
 * 为什么不是"学到哪写到哪"：写一段要十几秒，学习途中现写会把节奏卡断；
 * 而且后面几段的用词要接着前面来，攒到一起写才连得上。
 * 所以放在进学习之前跑完，跑的时候在任务中心里，能看进度也能停。
 *
 * **每写完一段立刻存盘**：中途停掉、关软件、断网，已经写好的段不会白花。
 * 下次再来只补没写的那几段。
 */
export async function generateAllSections(
  s: Syllabus,
  hooks?: {
    onProgress?: (done: number, total: number, note: string) => void
    shouldStop?: () => boolean
  }
): Promise<{ written: number; skipped: number; failed: number; lastError: string }> {
  let written = 0
  let skipped = 0
  let failed = 0
  /**
   * 最后一次失败的原因要带出去。
   *
   * 之前只 console.warn，界面上只剩一句「24 段失败」——
   * 到底是没配 key、模型不返回 JSON、还是超时，一概看不出来，
   * 只能干瞪眼。任何一个会失败的批处理都得把原因摆到台面上。
   */
  let lastError = ''

  const total = s.lessons.length
  let done = 0

  for (const pod of s.podcasts) {
    for (let i = 0; i < pod.lessonIds.length; i++) {
      if (hooks?.shouldStop?.()) return { written, skipped, failed, lastError }

      const lesson = s.lessons.find(x => x.id === pod.lessonIds[i])
      done++
      if (!lesson) continue
      if (lesson.sentences?.length) { skipped++; continue }

      hooks?.onProgress?.(done, total, `写「${lesson.topic}」第 ${i + 1} 段`)

      // 上文取同一篇里前面几段，跨篇不带 —— 那是两篇独立的稿子
      const prev: { en: string; zh: string }[] = []
      for (const id of pod.lessonIds.slice(0, i)) {
        const l = s.lessons.find(x => x.id === id)
        if (l?.sentences?.length) prev.push(...l.sentences)
      }

      /**
       * 每段失败重试一次。
       *
       * 一次网络抖动、一次模型抽风，不该让这一段永远缺着 ——
       * 而缺一段整篇就拼不起来，代价比多发一次请求大得多。
       * 只重试一次：真的是提示词或模型的问题，重试多少次都一样。
       */
      let ok = false
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          lesson.sentences = await generateSection(s, lesson, {
            isFirst: i === 0,
            isLast: i === pod.lessonIds.length - 1,
            prev
          })
          written++
          saveSyllabus(s)   // 每段落盘，别让中断白跑
          ok = true
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e)
          if (attempt === 0) {
            console.warn(`[教材] 「${lesson.topic}」第一次没写出来，重试一次：`, lastError)
            continue
          }
          failed++
          console.warn(`[教材] 「${lesson.topic}」两次都没写出来：`, e)
        }
      }
    }
  }
  return { written, skipped, failed, lastError }
}

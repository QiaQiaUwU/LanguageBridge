/**
 * 雅思阅读这类试题的识别与解析。
 *
 * 从做题网站整页复制下来的试题，结构是：试卷标题 → 答题说明 → 文章标题 → 正文 →
 * 若干「Questions 1–7」题组。按普通文章导入会出三个问题：
 *  - 「1」「2」这种题号行被当成编号标题，整篇切出一串章节目录
 *  - 题目、选项、「收藏本题」这类网页按钮混进正文，一行一句
 *  - 填空题的空位（「types of 8 / used on…」）被拆成两行
 * 这里把正文和题目分开：正文照常走分句、翻译、划线；题目单独存成结构，按试卷的样子渲染。
 */

export type QuestionKind = 'tfng' | 'ynng' | 'choice' | 'fill' | 'other'

/** 填空笔记里的一行：文字和空位交替 */
export type NoteSeg = { text: string } | { blank: number }

export interface ExamItem {
  no: number
  text: string
  /** 选择题的选项（A 选项文字…） */
  options?: { key: string; text: string }[]
}

export interface ExamGroup {
  /** 听力的 Part 1 / Section 2，放在题组上方 */
  section?: string
  /** Questions 1–7 */
  title: string
  from: number
  to: number
  kind: QuestionKind
  /** 答题说明，原样逐行 */
  instructions: string[]
  /** 判断题的三个选项及含义 */
  judge?: { key: string; desc: string }[]
  items: ExamItem[]
  /** 填空题：笔记标题和逐行内容 */
  notesTitle?: string
  notes?: NoteSeg[][]
  /** 选项列表（匹配题的 A–H、i–x 等），题目里只填字母 */
  choices?: { key: string; text: string }[]
}

export type ExamType = 'reading' | 'listening' | 'writing'

export interface ExamPaper {
  type?: ExamType
  title: string
  /** Read the text below and answer questions 1-13 */
  intro: string
  passageTitle: string
  passage: string
  groups: ExamGroup[]
  /** 作文题目（Task 1 / Task 2 的题干） */
  prompt?: string[]
  /** 题目配图（作文的图表、听力的地图等），data URL */
  images?: string[]
  /** 题目译文：英文原文 → 中文 */
  zh?: Record<string, string>
}

/** 做题网站页面上的按钮、计时、账号，不是题目内容 */
const NOISE = /^(收藏本题|题目纠错|Review|暂停答题|退出练习|交卷|上一题|下一题|提交|标记)$|暂停答题|退出练习|\d{3}\*{3,}\d+/
const GROUP_HEAD = /^Questions?\s+(\d{1,2})\s*(?:[–—\-~～]|to|and)\s*(\d{1,2})\s*$/i
const SINGLE_HEAD = /^Question\s+(\d{1,2})\s*$/i

const WRITING_CUE = /You should spend about \d+ minutes on this task|Write at least \d+ words|WRITING TASK\s*[12]/i
const TRANSCRIPT_HEAD = /^(Transcripts?|Audio ?scripts?|Tape ?scripts?|Recording scripts?|听力原文|录音原文|听力文本|原文)\s*[:：]?\s*$/i
const MODEL_HEAD = /^(Sample (answer|essay|response)|Model (answer|essay)|Band \d(\.\d)? (answer|essay|sample)|(考官|参考|高分)?范文(参考)?|示范答案)\s*[:：]?\s*$/i
const PART_HEAD = /^(PART|SECTION|Part|Section)\s*\d+\s*$/

export function looksLikeExam(raw: string): boolean {
  const text = String(raw || '')
  if (WRITING_CUE.test(text)) return true
  const lines = text.split('\n').map(l => l.trim())
  const heads = lines.filter(l => GROUP_HEAD.test(l) || SINGLE_HEAD.test(l)).length
  const cues = /answer questions|reading passage|TRUE\s+if the statement|NOT GIVEN|Choose (ONE|TWO|NO MORE)|Complete the (notes|summary|table|sentences|form|flow)|Label the|Write (ONE|NO MORE)/i.test(text)
  return heads >= 1 && cues
}

/** 正文里不是朗读内容的行（Part 1、题组标题、Example），对轴时跳过 */
export function isUnspokenLine(en: string): boolean {
  return /^(PART|SECTION)\s*\d+\b|^Questions?\s+\d|^Example\b|^Answer\s*[:：]/i.test(en.trim())
}

const JUDGE_WORDS = /^(TRUE|FALSE|NOT GIVEN|YES|NO)$/
const JUDGE_DEF = /^(TRUE|FALSE|NOT GIVEN|YES|NO)\s{2,}(.+)$|^(TRUE|FALSE|NOT GIVEN|YES|NO)\s+(if .+)$/i
const INSTRUCTION = /^(Do the following|In boxes|Write|Choose|Complete|Answer|Look at|Match|Label|Classify|Which|Reading Passage has|The (text|passage|reading passage) has|NB\b|You may use)/i
const OPTION = /^([A-H]|i{1,3}|iv|vi{0,3}|ix|x)[\s.、)）]+(.+)$/

/**
 * 把一行里的空位题号切开：「types of 8」→ 文字 + 空位 8。
 * 只认本题组范围内、单独成词的数字，文章里的年份、百分比不会被当成空位。
 */
function splitBlanks(line: string, from: number, to: number): NoteSeg[] {
  const out: NoteSeg[] = []
  let last = 0
  const re = /(^|\s)(\d{1,2})(?=\s|$|[.,;:?!])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    const n = Number(m[2])
    if (n < from || n > to) continue
    const at = m.index + m[1].length
    if (at > last) out.push({ text: line.slice(last, at) })
    out.push({ blank: n })
    last = at + m[2].length
  }
  if (last < line.length) out.push({ text: line.slice(last) })
  return out
}

function parseGroup(title: string, from: number, to: number, body: string[]): ExamGroup {
  const g: ExamGroup = { title, from, to, kind: 'other', instructions: [], items: [] }
  const text = body.join('\n')
  if (/NOT GIVEN/.test(text) && /\bTRUE\b/.test(text)) g.kind = 'tfng'
  else if (/NOT GIVEN/.test(text) && /\bYES\b/.test(text)) g.kind = 'ynng'
  else if (/Complete the|ONE WORD|NO MORE THAN|WORDS? (AND\/OR|ONLY)/i.test(text)) g.kind = 'fill'
  else if (/Choose the correct letter|Choose (TWO|THREE) letters/i.test(text)) g.kind = 'choice'

  let i = 0
  // 说明部分：直到第一道题
  const isItemStart = (l: string) => {
    const m = /^(\d{1,2})(?:[\s.、)）]+(.*))?$/.exec(l)
    return !!m && Number(m[1]) >= from && Number(m[1]) <= to
  }
  for (; i < body.length; i++) {
    const l = body[i]
    if (isItemStart(l)) break
    if (g.kind === 'fill' && !INSTRUCTION.test(l) && !JUDGE_DEF.test(l)) break
    const jd = JUDGE_DEF.exec(l)
    if (jd && (g.kind === 'tfng' || g.kind === 'ynng')) {
      ;(g.judge ||= []).push({ key: (jd[1] || jd[3]).toUpperCase(), desc: (jd[2] || jd[4]).trim() })
      continue
    }
    if (g.kind !== 'fill' && OPTION.test(l) && !INSTRUCTION.test(l)) {
      const m = OPTION.exec(l)!
      ;(g.choices ||= []).push({ key: m[1], text: m[2].trim() })
      continue
    }
    g.instructions.push(l)
  }

  // 句子填空：每道题有自己的题号行，题干里用「……」「____」标空位 —— 按逐题处理，不当笔记
  const firstRest = body[i] || ''
  const itemised = /^\d{1,2}$/.test(firstRest) && Number(firstRest) >= from && Number(firstRest) <= to
  if (g.kind === 'fill' && !itemised) {
    // 空位题号常被网页排版甩到行尾，下一行才是后半句：先把续行接回去
    const merged: string[] = []
    for (const l of body.slice(i)) {
      const prev = merged[merged.length - 1]
      const endsBlank = prev != null && /(\s|^)\d{1,2}$/.test(prev) && (() => {
        const n = Number(/(\d{1,2})$/.exec(prev)![1]); return n >= from && n <= to
      })()
      const isNew = /^[·•\-–*●▪]/.test(l)
      if (prev != null && (endsBlank || (!isNew && /^[a-z(,.;]/.test(l)))) merged[merged.length - 1] = `${prev} ${l}`
      else merged.push(l)
    }
    let lines = merged.map(l => l.replace(/^[·•\-–*●▪]\s*/, ''))
    // 摘要填空后面常跟一个选词框（A cost / B speed …），拿出来当选项
    const box = lines.filter(l => /^[A-L]\s+\S/.test(l) && !splitBlanks(l, from, to).some(x => 'blank' in x))
    if (box.length >= 3) {
      g.choices = box.map(l => { const m = /^([A-L])\s+(.+)$/.exec(l)!; return { key: m[1], text: m[2].trim() } })
      lines = lines.filter(l => !box.includes(l))
    }
    const firstBlank = lines.findIndex(l => splitBlanks(l, from, to).some(s => 'blank' in s))
    // 第一行当笔记标题；空位之前的其余行（Example、Location: … 这类）照常作为笔记行
    if (firstBlank > 0) g.notesTitle = lines[0]
    g.notes = lines.slice(firstBlank > 0 ? 1 : 0).map(l => splitBlanks(l, from, to))
    return g
  }

  // 逐题：题号行 + 题干（可能跨行），选择题再跟选项
  let cur: ExamItem | null = null
  for (; i < body.length; i++) {
    const l = body[i]
    const m = /^(\d{1,2})(?:[\s.、)）]+(.*))?$/.exec(l)
    if (m && Number(m[1]) >= from && Number(m[1]) <= to) {
      cur = { no: Number(m[1]), text: (m[2] || '').trim() }
      g.items.push(cur)
      continue
    }
    if (!cur) continue
    // 判断题每道题下面网页会重复印一遍 TRUE / FALSE / NOT GIVEN，丢掉
    if (JUDGE_WORDS.test(l)) continue
    const opt = OPTION.exec(l)
    if (opt && cur.text && g.kind === 'choice') {
      ;(cur.options ||= []).push({ key: opt[1], text: opt[2].trim() })
      continue
    }
    cur.text = cur.text ? `${cur.text} ${l}` : l
  }
  return g
}

export function parseExamPaper(raw: string, fallbackTitle = ''): ExamPaper | null {
  const lines = String(raw || '').replace(/\r\n/g, '\n').split('\n')
    .map(l => l.replace(/\u00a0/g, ' ').trim())
    .filter(l => l && !NOISE.test(l))
  const isHead = (l: string) => GROUP_HEAD.test(l) || SINGLE_HEAD.test(l)
  const firstQ = lines.findIndex(isHead)

  /* 作文：题干 + 配图 + 范文。没有题组。 */
  if (firstQ < 0 || (WRITING_CUE.test(raw) && firstQ < 0)) {
    if (!WRITING_CUE.test(raw)) return null
    const title = lines.find(l => /(Task\s*[12]|Test|剑雅|剑桥|Cambridge|真题|作文|写作)/i.test(l) && l.length < 60) || fallbackTitle
    const modelAt = lines.findIndex(l => MODEL_HEAD.test(l))
    const lastPrompt = lines.findIndex(l => /Write at least \d+ words/i.test(l))
    const promptEnd = modelAt >= 0 ? (lastPrompt >= 0 && lastPrompt < modelAt ? lastPrompt + 1 : modelAt) : lastPrompt + 1
    const prompt = lines.slice(0, Math.max(0, promptEnd)).filter(l => l !== title)
    const essayFrom = modelAt >= 0 ? modelAt + 1 : promptEnd
    return {
      type: 'writing', title, intro: '', passageTitle: modelAt >= 0 ? lines[modelAt] : '',
      passage: lines.slice(essayFrom).join('\n\n'), groups: [], prompt
    }
  }

  const transcriptAt = lines.findIndex(l => TRANSCRIPT_HEAD.test(l))
  // 听力：有「听力原文」标题、Part 标题，或开头几行写明是听力（正文里出现 listening 这个词不算）
  const listening = transcriptAt >= 0 || lines.some(l => PART_HEAD.test(l)) || lines.slice(0, 3).some(l => /Listening|听力/i.test(l))

  // 头部：试卷标题、答题说明、文章标题
  let k = 0
  let title = ''
  let intro = ''
  const head: string[] = []
  const headEnd = transcriptAt >= 0 && transcriptAt < firstQ ? transcriptAt : firstQ
  while (k < headEnd && head.length < 4) {
    const l = lines[k]
    if (PART_HEAD.test(l)) break
    if (/answer questions|Reading Passage \d/i.test(l) && l.length < 120) { intro = l; k++; continue }
    if (!title && /(Test|Passage|剑雅|剑桥|Cambridge|真题|阅读|听力|Listening)/i.test(l) && l.length < 60 && !/[.!?]$/.test(l)) { title = l; k++; continue }
    // 文章标题：短、不以句号结尾
    if (!listening && l.length < 90 && !/[.!?]$/.test(l) && l.split(' ').length <= 12) { head.push(l); k++; continue }
    break
  }
  const passageTitle = head[head.length - 1] || ''

  // 正文：阅读是题组前面那段；听力是「听力原文」标题后面那段（在题目前后都认）
  let passageLines: string[]
  let qEnd = lines.length
  if (transcriptAt >= 0) {
    if (transcriptAt > firstQ) {
      passageLines = lines.slice(transcriptAt + 1)
      qEnd = transcriptAt
    } else {
      passageLines = lines.slice(transcriptAt + 1, firstQ)
    }
  } else {
    passageLines = listening ? [] : lines.slice(k, firstQ)
  }
  const passage = passageLines
    .filter(l => !PART_HEAD.test(l) || listening)
    // 「a . . . thorough」这种省略号拆开会被分句器当成句号
    .map(l => l.replace(/\.\s\.\s\./g, '…'))
    .join('\n\n')

  const groups: ExamGroup[] = []
  let start = firstQ
  let section = ''
  // 题组前面紧挨着的 Part 标题
  for (let j = firstQ - 1; j >= 0 && j >= firstQ - 3; j--) if (PART_HEAD.test(lines[j])) { section = lines[j]; break }
  while (start < qEnd) {
    let end = start + 1
    while (end < qEnd && !isHead(lines[end]) && !PART_HEAD.test(lines[end])) end++
    const h = GROUP_HEAD.exec(lines[start]) || SINGLE_HEAD.exec(lines[start])
    if (h) {
      const g = parseGroup(lines[start], Number(h[1]), Number(h[2] || h[1]), lines.slice(start + 1, end))
      if (section) { g.section = section; section = '' }
      groups.push(g)
    } else if (PART_HEAD.test(lines[start])) {
      section = lines[start]
    }
    start = end
  }

  return {
    type: listening ? 'listening' : 'reading',
    title: title || fallbackTitle, intro, passageTitle, passage, groups
  }
}

/** 需要翻译的题目文字（去重）。填空笔记里的空位写成 ____ */
export function examTexts(exam: ExamPaper): string[] {
  const out = new Set<string>()
  const add = (t?: string) => { const x = (t || '').trim(); if (x && /[A-Za-z]{2}/.test(x)) out.add(x) }
  exam.prompt?.forEach(add)
  for (const g of exam.groups) {
    g.instructions.forEach(add)
    add(g.notesTitle)
    g.choices?.forEach(c => add(c.text))
    g.notes?.forEach(line => add(noteLineText(line)))
    for (const it of g.items) { add(it.text); it.options?.forEach(o => add(o.text)) }
  }
  return [...out]
}

export function noteLineText(line: NoteSeg[]): string {
  return line.map(s => ('blank' in s ? '____' : s.text)).join('').replace(/\s+/g, ' ').trim()
}

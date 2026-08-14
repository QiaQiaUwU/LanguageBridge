import type { ArticleSentence } from '@/shared/types/Article'

function isChineseLine(line: string): boolean {
  const cjk = (line.match(/[\u4e00-\u9fff]/g) || []).length
  return cjk > 0 && cjk / Math.max(line.length, 1) > 0.25
}

function isEnglishLine(line: string): boolean {
  if (!line.trim()) return false
  const cjk = (line.match(/[\u4e00-\u9fff]/g) || []).length
  const letters = (line.match(/[a-zA-Z]/g) || []).length
  return cjk === 0 && letters >= 2
}

export function splitEnglishSentences(text: string): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return []
  const parts = cleaned.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [cleaned]
  return parts.map(s => s.trim()).filter(Boolean)
}

function stripMdInline(line: string): string {
  return line
    .replace(/\\$/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^#{1,6}\s+/, '')
    .trim()
}

type LineKind = 'zh' | 'en' | 'other'

/** 「正面观点：」「反面观点：」这类小标题：短、以冒号收尾、没有句末标点。
 *  它们是分节标记不是译文，混进中文段里会把整段的对应关系顶偏一位。 */
function isMarkerLine(line: string): boolean {
  const t = line.trim()
  return t.length <= 12 && /[：:]$/.test(t) && !/[。.!?！？]/.test(t)
}

/** 编号题目行：`1. Some people believe that…`，长英文句，是章节标题不是译文。 */
export function isNumberedHeading(line: string): boolean {
  const t = line.trim()
  return /^\d{1,3}[.、)]\s+[A-Z]/.test(t) && t.length >= 30
}

function kindOf(line: string): LineKind {
  if (isMarkerLine(line) || isNumberedHeading(line)) return 'other'
  if (isChineseLine(line)) return 'zh'
  if (isEnglishLine(line)) return 'en'
  return 'other'
}

interface Run {
  kind: LineKind
  text: string
}

function runsOf(lines: string[]): Run[] {
  const runs: Run[] = []
  for (const raw of lines) {
    const line = stripMdInline(raw)
    if (!line || isStructuralLine(line)) continue
    const kind = kindOf(line)
    const last = runs[runs.length - 1]
    if (last && last.kind === kind) last.text += (kind === 'zh' ? '' : ' ') + line
    else runs.push({ kind, text: line })
  }
  return runs
}

function pairRuns(runs: Run[]): ArticleSentence[] {
  const out: ArticleSentence[] = []
  let i = 0
  while (i < runs.length) {
    const a = runs[i]
    const b = runs[i + 1]
    if (a.kind === 'other') { i++; continue }
    if (b && b.kind !== 'other' && b.kind !== a.kind) {
      out.push(a.kind === 'en' ? { en: a.text, zh: b.text } : { en: b.text, zh: a.text })
      i += 2
      continue
    }
    if (a.kind === 'en') out.push({ en: a.text, zh: '' })
    i++
  }
  return out
}

function paragraphsOf(text: string): string[][] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map(b => b.split('\n').map(l => l.trim()).filter(Boolean))
    .filter(b => b.length)
}

export function detectBilingual(text: string): ArticleSentence[] | null {
  const paras = paragraphsOf(text)
  if (!paras.length) return null

  const paired: ArticleSentence[] = []
  let bothCount = 0
  let unitCount = 0
  for (const lines of paras) {
    const units = pairRuns(runsOf(lines))
    for (const u of units) {
      unitCount++
      if (u.en && u.zh) bothCount++
      paired.push(u)
    }
  }
  if (unitCount >= 3 && bothCount / unitCount >= 0.6) {
    return paired.filter(u => u.en)
  }

  const flat: string[] = []
  for (const p of paras) for (const l of p) {
    const s = stripMdInline(l)
    if (s) flat.push(s)
  }
  if (flat.length >= 4) {
    const lineResult: ArticleSentence[] = []
    let good = 0
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const a = flat[i], b = flat[i + 1]
      const ka = kindOf(a), kb = kindOf(b)
      if (ka === 'en' && kb === 'zh') { lineResult.push({ en: a, zh: b }); good++ }
      else if (ka === 'zh' && kb === 'en') { lineResult.push({ en: b, zh: a }); good++ }
      else if (ka === 'en') lineResult.push({ en: a, zh: '' })
      else if (kb === 'en') lineResult.push({ en: b, zh: '' })
    }
    if (lineResult.length >= 3 && good / lineResult.length >= 0.6) return lineResult
  }

  if (paras.length >= 2) {
    const blocks = paras.map(p => p.map(stripMdInline).filter(Boolean).join(' '))
    const blockResult: ArticleSentence[] = []
    let good = 0
    for (let i = 0; i + 1 < blocks.length; i += 2) {
      const a = blocks[i], b = blocks[i + 1]
      const ka = kindOf(a.slice(0, 60)), kb = kindOf(b.slice(0, 60))
      const en = ka === 'en' ? a : kb === 'en' ? b : ''
      const zh = ka === 'zh' ? a : kb === 'zh' ? b : ''
      if (!en) continue
      for (const s of splitEnglishSentences(en)) blockResult.push({ en: s, zh: '' })
      if (zh && blockResult.length) { blockResult[blockResult.length - 1].zh = zh; good++ }
    }
    if (blockResult.length >= 3 && good > 0) return blockResult
  }

  return null
}

export function toEnglishOnlySentences(text: string): ArticleSentence[] {
  const lines: string[] = []
  for (const p of paragraphsOf(text)) for (const l of p) {
    const s = stripMdInline(l)
    if (s) lines.push(s)
  }
  return splitEnglishSentences(lines.join(' ')).map(en => ({ en, zh: '' }))
}

/** 中文句子切分：按句末标点断句，保留标点。 */
export function splitChineseSentences(text: string): string[] {
  const out: string[] = []
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = stripMdInline(raw)
    if (!line) continue
    const parts = line.match(/[^。！？…；]+[。！？…；]+|[^。！？…；]+$/g) || [line]
    for (const p of parts) {
      const t = p.trim()
      if (t) out.push(t)
    }
  }
  return out
}

/**
 * 整篇是不是纯中文（没有可用的英文正文）。
 *
 * 有些稿子只有中文脚本，英文那一栏根本不存在（文件头会写明）。这种进不了
 * 「双语配对」，旧代码会把中文丢给英文分句器当英文切，切出几段乱码一样的
 * 长句，再拿去让 AI 按 EN/ZH 整理 —— AI 手上没有英文，怎么都整理不出来。
 */
export function isChineseOnly(text: string): boolean {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length
  if (cjk < 50) return false
  let enLines = 0
  let total = 0
  for (const raw of text.split('\n')) {
    const line = stripMdInline(raw)
    if (!line) continue
    total++
    if (isEnglishLine(line) && line.length > 20) enLines++
  }
  return total > 0 && enLines / total < 0.05
}

/** 纯中文稿 → 只有中文、等待翻译的句子列表 */
export function toChineseOnlySentences(text: string): ArticleSentence[] {
  return splitChineseSentences(text)
    .filter(zh => !isStructuralLine(zh))
    .map(zh => ({ en: '', zh }))
}

/**
 * 结构行：章节号、分节标题、目录条目、页码。
 *
 * 这些东西不是正文，不该进句子流，更不该送去翻译 —— 花钱把「Part 3」翻成
 * 「第三部分」没有意义，还会占掉一整条句子的位置。TypeWords 的做法是把
 * title / titleTranslate 单独存字段，正文里根本不会出现标题，我们这里做不到
 * 改数据模型，就在切句这一步把它们滤掉，章节名已经存在 chapters 里了。
 */
export function isStructuralLine(line: string): boolean {
  const t = stripMdInline(line)
  if (!t) return true
  if (t.length > 60) return false
  // Part 3 / Chapter 5 / 第三章 / 第 12 节
  if (/^(part|chapter|section|book|episode|unit)\s*[0-9ivxlcIVXLC]+\b/i.test(t)) return true
  if (/^第\s*[0-9一二三四五六七八九十百零]+\s*[章节回部篇讲课]/.test(t)) return true
  // 纯页码 / 纯编号
  if (/^[-—–\s]*\d{1,4}[-—–\s]*$/.test(t)) return true
  // 目录条目：Part 3 xxx 这种带编号的短行
  if (/^[-*+•]\s*(part|chapter)\s*\d+/i.test(t)) return true
  return false
}

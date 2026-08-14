import type { ArticleSentence } from '@/shared/types/Article'
import { askAi, AiError } from './aiClient'

const SPEAKER_LINE = /^发言人\s*\d*\s+\d{1,2}:\d{2}(:\d{2})?\s*$/
const DATE_LINE = /^\d{4}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}(:\d{2})?\s*$/

export interface StripResult {
  text: string
  looksLikeRawTranscript: boolean
}

function countScriptSwitches(text: string): number {
  const sample = text.slice(0, 3000)
  let switches = 0
  let lastType: 'cjk' | 'en' | null = null
  for (const ch of sample) {
    const isCjk = /[\u4e00-\u9fff]/.test(ch)
    const isEn = /[a-zA-Z]/.test(ch)
    if (!isCjk && !isEn) continue
    const type = isCjk ? 'cjk' : 'en'
    if (lastType && type !== lastType) switches++
    lastType = type
  }
  return switches
}

export function stripTranscriptNoise(raw: string, fileTitle?: string): StripResult {
  const lines = raw.split(/\r?\n/)
  let start = 0

  const firstLine = (lines[0] || '').trim()
  const secondLine = (lines[1] || '').trim()
  if (fileTitle && firstLine && firstLine.includes(fileTitle.slice(0, 6))) {
    start = DATE_LINE.test(secondLine) ? 2 : 1
  } else if (DATE_LINE.test(secondLine)) {
    start = 2
  }

  let speakerLineCount = 0
  const kept: string[] = []
  for (let i = start; i < lines.length; i++) {
    const t = lines[i].trim()
    if (!t) continue
    if (SPEAKER_LINE.test(t)) {
      speakerLineCount++
      continue
    }
    if (DATE_LINE.test(t)) continue
    kept.push(t)
  }

  const text = kept.join('\n')
  const looksLikeRawTranscript = speakerLineCount >= 2 || countScriptSwitches(text) > 40
  return { text, looksLikeRawTranscript }
}

const CHUNK_CHARS = 5000

function chunkRaw(raw: string): string[] {
  const paras = raw.split(/\n+/).filter(p => p.trim())
  const chunks: string[] = []
  let buf = ''
  for (const p of paras) {
    if (buf && buf.length + p.length + 1 > CHUNK_CHARS) {
      chunks.push(buf)
      buf = p
    } else {
      buf = buf ? buf + '\n' + p : p
    }
  }
  if (buf) chunks.push(buf)
  if (chunks.length) return chunks
  const out: string[] = []
  for (let i = 0; i < raw.length; i += CHUNK_CHARS) out.push(raw.slice(i, i + CHUNK_CHARS))
  return out.length ? out : [raw]
}

function parseEnZhPairs(result: string): ArticleSentence[] {
  const out: ArticleSentence[] = []
  let pendingEn = ''
  for (const line of result.split('\n')) {
    const enMatch = line.match(/^EN[:：]\s*(.+)$/)
    const zhMatch = line.match(/^ZH[:：]\s*(.+)$/)
    if (enMatch) {
      pendingEn = enMatch[1].trim()
    } else if (zhMatch && pendingEn) {
      out.push({ en: pendingEn, zh: zhMatch[1].trim() })
      pendingEn = ''
    }
  }
  return out
}

export async function aiReorganizeTranscript(
  raw: string,
  onProgress?: (done: number, total: number) => void
): Promise<ArticleSentence[]> {
  const chunks = chunkRaw(raw)
  let lastRawReply = ''
  const all: ArticleSentence[] = []
  let failed = 0

  for (let i = 0; i < chunks.length; i++) {
    const prompt = `以下是一段中英文混杂、可能存在语法或转写错误的口播/视频转录稿的第 ${i + 1}/${chunks.length} 段。请你：
1. 提炼、修正出一篇通顺、完整、语法正确的英文原文（去除转写错误和重复，不要遗漏原文的信息点）
2. 给出这篇英文对应的准确、自然的中文翻译
3. 按句切分，一一对应输出

只处理这一段，不要补写上下文，不要写任何总结或说明。严格按下面的格式输出，每句一组 EN/ZH：
EN: 第1句英文
ZH: 第1句中文
EN: 第2句英文
ZH: 第2句中文

本段原文：
${chunks[i]}`

    try {
      const result = await askAi(prompt)
      lastRawReply = result
      const pairs = parseEnZhPairs(result)
      if (pairs.length) all.push(...pairs)
      else failed++
    } catch {
      failed++
    }
    onProgress?.(i + 1, chunks.length)
  }

  if (!all.length) {
    // 把 AI 的原始返回带出来，否则只能看到「格式不对」，分不清是配置问题还是原文问题
    const sample = lastRawReply.slice(0, 200).replace(/\s+/g, ' ')
    throw new AiError(
      `AI 未能按 EN/ZH 格式整理出内容。AI 实际返回的开头是：\n${sample || '（空）'}`
    )
  }
  if (failed) {
    console.warn(`[整理] ${chunks.length} 段里有 ${failed} 段没能整理，已保留其余部分`)
  }
  return all
}

export async function aiTranslateLines(lines: string[]): Promise<string[]> {
  if (!lines.length) return []
  const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join('\n')
  const prompt = `把下面每一行英文翻译成自然的中文。严格按 "序号. 译文" 的格式逐行输出，行数必须和输入一致，不要合并、不要拆分、不要写任何说明文字。

${numbered}`
  const result = await askAi(prompt)
  const out: string[] = new Array(lines.length).fill('')
  for (const line of result.split('\n')) {
    const m = line.match(/^\s*(\d+)[.、)]\s*(.+)$/)
    if (!m) continue
    const idx = Number(m[1]) - 1
    if (idx >= 0 && idx < out.length) out[idx] = m[2].trim()
  }
  return out
}

/**
 * 中文 → 英文。纯中文稿的「整理」就是把英文那一栏补出来，
 * 跟 aiTranslateLines 方向相反。
 */
export async function aiTranslateToEnglish(lines: string[]): Promise<string[]> {
  if (!lines.length) return []
  const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join('\n')
  const prompt = `把下面每一行中文翻译成自然、地道的英文。严格按 "序号. 英文" 的格式逐行输出，行数必须和输入一致，不要合并、不要拆分、不要写任何说明文字。

${numbered}`
  const result = await askAi(prompt)
  const out: string[] = new Array(lines.length).fill('')
  for (const line of result.split('\n')) {
    const m = line.match(/^\s*(\d+)[.、)]\s*(.+)$/)
    if (!m) continue
    const idx = Number(m[1]) - 1
    if (idx >= 0 && idx < out.length) out[idx] = m[2].trim()
  }
  return out
}

export interface OutlineSection {
  title: string
  /** 这一章从原文第几行开始（0 基） */
  startLine: number
}

/**
 * 只让 AI 做结构判断：哪几行是章节标题。不翻译、不改写、不重排。
 *
 * 这是整理长稿的第一步。原来是把整篇丢给 AI 让它「整理成 EN/ZH 对照」，
 * AI 要同时做分章、断句、翻译三件事，任何一件出岔子整篇就废了，而且没有
 * 中间结果可以检查。拆开之后：结构由 AI 判断一次（只回行号，便宜且好校验），
 * 断句和配对由本地代码做（确定性的），翻译最后单独补（可断点续跑）。
 *
 * 返回的行号一律用原文校验过，AI 编出来的行号会被丢掉。
 */
export async function aiOutlineChapters(lines: string[]): Promise<OutlineSection[]> {
  const MAX_LINES = 1200
  const sample = lines.slice(0, MAX_LINES)
  const numbered = sample
    .map((l, i) => `${i}\t${l.slice(0, 80)}`)
    .filter(l => l.split('\t')[1]?.trim())
    .join('\n')

  const prompt = `下面是一篇长稿的正文，每行前面是行号。请判断哪些行是**章节标题**（例如「第一章」「Part 3」「Chapter 5」、编号小标题、明显的分节名）。

只输出章节标题所在的行号和标题文本，一行一个，格式严格为：
行号<TAB>标题
不要输出任何解释、不要翻译、不要改写标题、不要输出正文行。如果整篇没有章节结构，输出「NONE」。

${numbered}`

  const result = await askAi(prompt)
  if (/^\s*NONE\s*$/i.test(result)) return []

  const out: OutlineSection[] = []
  const seen = new Set<number>()
  for (const line of result.split('\n')) {
    const m = line.match(/^\s*(\d+)\s*[\t|:：.]\s*(.+?)\s*$/)
    if (!m) continue
    const idx = Number(m[1])
    if (!Number.isInteger(idx) || idx < 0 || idx >= sample.length) continue
    if (seen.has(idx)) continue
    // 校验：AI 报的这一行必须真的和它给的标题对得上，否则是编的
    const real = sample[idx]?.trim() || ''
    const claimed = m[2].trim()
    const norm = (t: string) => t.replace(/[\s#*\-—:：]/g, '').toLowerCase()
    if (!real || (!norm(real).includes(norm(claimed)) && !norm(claimed).includes(norm(real)))) continue
    seen.add(idx)
    out.push({ title: real.replace(/^#+\s*/, ''), startLine: idx })
  }
  out.sort((a, b) => a.startLine - b.startLine)
  return out.length >= 2 ? out : []
}

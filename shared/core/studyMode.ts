import { askAi, AiError } from './aiClient'
import type { ArticleSentence } from '@/shared/types/Article'

export interface StudyPoint {
  title: string
  detail: string
  sentenceIndex: number
}

export interface StudyQuizQuestion {
  question: string
  options: string[]
  answer: number
  explanation: string
  sentenceIndex: number
}

const MAX_PASSAGE_CHARS = 8000 // 单次学习模式请求的正文上限（文章通常不长，不需要MyLibrary那套按模型动态算窗口的复杂度）

function buildNumberedPassage(sentences: ArticleSentence[], start: number, end: number): string {
  const lines: string[] = []
  let total = 0
  for (let i = start; i < end && i < sentences.length; i++) {
    const line = `${i}: ${sentences[i].en}`
    total += line.length
    if (total > MAX_PASSAGE_CHARS) break
    lines.push(line)
  }
  return lines.join('\n')
}

function extractJson(text: string): any {
  if (!text) return null
  let t = text.trim()
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(t)
  } catch {
    const m = t.match(/\{[\s\S]*\}/)
    if (m) {
      try {
        return JSON.parse(m[0])
      } catch {
        return null
      }
    }
    return null
  }
}

function clampIndex(idx: any, max: number): number {
  const n = Number(idx)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(max - 1, Math.round(n)))
}

const SYS_POINTS = `你是阅读学习助手。请从下面这段编号的英语文章中梳理出关键"知识点/要点"，帮助读者理解与记忆。

要求：
1. 提炼 3-8 个知识点，覆盖主要概念、论点、因果或逻辑关系，按在文章中出现的先后排列
2. 每个知识点给三个字段：
   - title：简短标题（中文，不超过20字）
   - detail：1-2句话说明，讲清这个点是什么/为什么重要（中文）
   - sentenceIndex：这个知识点主要对应原文里编号为几的那一句（必须是传入文本里真实出现过的编号，不要编造）
3. 只输出 JSON，不要任何解释、前言或 markdown 代码块，格式严格如下：
{"points":[{"title":"...","detail":"...","sentenceIndex":0}]}`

const SYS_STRUCTURE = `你是阅读学习助手。请分析下面这段编号的英语文章的【知识架构/逻辑框架】，帮助读者把握整体结构、脉络和层次关系。

要求：
1. 输出 3-8 个条目，按框架的层次/顺序排列；每条代表框架里的一个环节（如：背景→问题→论点→论据→结论）
2. 每个条目给三个字段：
   - title：这一环节的名称（中文，可用"1. …""2.1 …"体现层级）
   - detail：1-2句话说明这一环节讲了什么、与前后如何衔接（中文）
   - sentenceIndex：这一环节主要对应原文里编号为几的那一句（必须是传入文本里真实出现过的编号，不要编造）
3. 只输出 JSON，不要任何解释或 markdown 代码块，格式严格如下：
{"points":[{"title":"...","detail":"...","sentenceIndex":0}]}`

function sysQuiz(n: number): string {
  return `你是阅读学习助手。请根据下面这段编号的英语文章，出 ${n} 道单项选择题来考查读者对内容的理解，也可以适当考查里面出现的英语词汇/表达。

要求：
1. 出 ${n} 道题，紧扣这段文字的内容，不要考文字里没有的信息
2. 每题给：
   - question：题干（中文或英文均可，你自行判断）
   - options：4 个选项（字符串数组，不要带 A/B/C/D 前缀）
   - answer：正确选项的下标（0-3 的整数）
   - explanation：简短解析，说明为什么这个答案对（中文）
   - sentenceIndex：这道题主要考查原文里编号为几的那一句（必须是传入文本里真实出现过的编号，不要编造）
3. 只输出 JSON，不要任何解释或 markdown 代码块，格式严格如下：
{"questions":[{"question":"...","options":["...","...","...","..."],"answer":0,"explanation":"...","sentenceIndex":0}]}`
}

export async function makeOutline(
  sentences: ArticleSentence[],
  start: number,
  end: number,
  mode: 'points' | 'structure'
): Promise<StudyPoint[]> {
  const passage = buildNumberedPassage(sentences, start, end)
  if (!passage.trim()) throw new AiError('选中的范围是空的')
  const result = await askAi(passage, mode === 'structure' ? SYS_STRUCTURE : SYS_POINTS)
  const data = extractJson(result)
  if (!data || !Array.isArray(data.points)) {
    throw new AiError('AI 返回格式解析失败，可以再试一次')
  }
  return data.points.map((p: any) => ({
    title: String(p.title || '').slice(0, 60),
    detail: String(p.detail || '').slice(0, 300),
    sentenceIndex: clampIndex(p.sentenceIndex, sentences.length)
  }))
}

export async function makeQuiz(
  sentences: ArticleSentence[],
  start: number,
  end: number,
  n = 4
): Promise<StudyQuizQuestion[]> {
  const passage = buildNumberedPassage(sentences, start, end)
  if (!passage.trim()) throw new AiError('选中的范围是空的')
  const count = Math.max(1, Math.min(10, n))
  const result = await askAi(passage, sysQuiz(count))
  const data = extractJson(result)
  if (!data || !Array.isArray(data.questions)) {
    throw new AiError('AI 返回格式解析失败，可以再试一次')
  }
  return data.questions
    .filter((q: any) => Array.isArray(q.options) && q.options.length >= 2)
    .map((q: any) => {
      const options = q.options.slice(0, 6).map((o: any) => String(o).slice(0, 200))
      return {
        question: String(q.question || '').slice(0, 300),
        options,
        answer: clampIndex(q.answer, options.length),
        explanation: String(q.explanation || '').slice(0, 300),
        sentenceIndex: clampIndex(q.sentenceIndex, sentences.length)
      }
    })
}

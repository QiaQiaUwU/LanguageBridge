import { askAi } from './aiClient'
import type { WordItem } from '@/shared/types/WordItem'

export type ScenarioLevel = 'CET4' | 'CET6' | 'IELTS' | 'TOEFL'

export const LEVEL_PARAMS: Record<ScenarioLevel, { vocab: number; dialogues: number; passage: string; writing: number }> = {
  CET4: { vocab: 15, dialogues: 3, passage: 'short', writing: 1 },
  CET6: { vocab: 20, dialogues: 3, passage: 'short', writing: 1 },
  IELTS: { vocab: 25, dialogues: 4, passage: 'medium', writing: 2 },
  TOEFL: { vocab: 25, dialogues: 4, passage: 'medium', writing: 2 }
}

export interface ScenarioMaterial {
  scenario: string
  level: ScenarioLevel
  vocabulary: { word: string; phonetic?: string; meaning: string; usage?: string }[]
  dialogues: { title: string; turns: { speaker: string; en: string; zh: string }[] }[]
  reading: { title: string; paragraphs: { en: string; zh: string }[] }
  writing: { prompt_en: string; prompt_zh: string }[]
  createdAt: string
}

function extractJson(text: string): any | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const a = cleaned.indexOf('{')
    const b = cleaned.lastIndexOf('}')
    if (a < 0 || b <= a) return null
    try {
      return JSON.parse(cleaned.slice(a, b + 1))
    } catch {
      return null
    }
  }
}

export async function generateScenario(
  scenario: string,
  level: ScenarioLevel,
  seedWords: WordItem[] = []
): Promise<ScenarioMaterial | null> {
  const p = LEVEL_PARAMS[level]
  const seedList = seedWords.slice(0, p.vocab).map(w => w.word).join(', ')

  const prompt = `围绕「${scenario}」这个场景，生成一套 ${level} 难度的英语学习材料。返回严格 JSON，不要任何额外文本或 markdown 代码块标记。

${seedList ? `必须优先覆盖这些词（它们是学习者当前正在学的）：${seedList}\n` : ''}
格式：
{
  "vocabulary": [ { "word": "", "phonetic": "", "meaning": "中文释义", "usage": "在这个场景里怎么用，一句话" } ],
  "dialogues": [ { "title": "对话标题", "turns": [ { "speaker": "A", "en": "", "zh": "" } ] } ],
  "reading": { "title": "", "paragraphs": [ { "en": "", "zh": "" } ] },
  "writing": [ { "prompt_en": "", "prompt_zh": "" } ]
}

要求：
1. vocabulary ${p.vocab} 个，都是这个场景里真会用到的高频词，不要凑生僻词
2. dialogues ${p.dialogues} 段，每段 6-10 轮，speaker 用 A / B，要像真人对话，不要教科书腔
3. reading 一篇${p.passage === 'short' ? '短文（3-4 段）' : '中等长度文章（5-6 段）'}，中英逐段对照
4. writing ${p.writing} 道题，是能实际动笔写的具体题目，不是"谈谈你的看法"这种空题
5. 对话和短文里要自然地用上 vocabulary 里的词，不要为了塞词而生造句子
6. 严格 UTF-8 JSON，不要 markdown 代码块符号`

  try {
    const reply = await askAi(
      prompt,
      '你是一位英语教学材料编写专家。你必须返回严格的 JSON，不要有任何额外文本、markdown 标记或代码块符号。',
      6000
    )
    const data = extractJson(reply)
    if (!data) return null
    return {
      scenario,
      level,
      vocabulary: Array.isArray(data.vocabulary) ? data.vocabulary : [],
      dialogues: Array.isArray(data.dialogues) ? data.dialogues : [],
      reading: data.reading || { title: scenario, paragraphs: [] },
      writing: Array.isArray(data.writing) ? data.writing : [],
      createdAt: new Date().toISOString()
    }
  } catch {
    return null
  }
}

export interface ScenarioReview {
  score: number
  summary: string
  strengths: string[]
  issues: { quote: string; problem: string; better: string }[]
  nextFocus: string[]
}

export async function reviewScenarioAnswer(
  material: ScenarioMaterial,
  question: string,
  answer: string
): Promise<ScenarioReview | null> {
  const vocab = material.vocabulary.map(v => v.word).join(', ')
  const prompt = `批改下面这段英语作答。返回严格 JSON，不要任何额外文本或 markdown 标记。

场景：${material.scenario}（${material.level} 难度）
本场景的目标词汇：${vocab}

题目：${question}

学习者的作答：
${answer}

格式：
{
  "score": 0-100 的整数,
  "summary": "两三句话总评，先说做得好的地方再说问题",
  "strengths": ["具体做得好的点，指到句子"],
  "issues": [ { "quote": "原文里有问题的那一句", "problem": "问题是什么", "better": "改成什么样" } ],
  "nextFocus": ["接下来该重点练什么，1-3 条，要具体可执行"]
}

要求：
1. issues 必须指到原文具体句子，不要笼统说"语法有误"
2. better 要给出可以直接用的改写，不是"建议修改"
3. 目标词汇用对了要在 strengths 里点名表扬，用错了放进 issues
4. 学习者水平就是 ${material.level}，不要用超出这个水平的表达去要求他
5. 严格 UTF-8 JSON，不要 markdown 代码块符号`

  try {
    const reply = await askAi(
      prompt,
      '你是一位耐心、具体的英语写作老师。你必须返回严格的 JSON，不要有任何额外文本或 markdown 标记。',
      4000
    )
    const data = extractJson(reply)
    if (!data) return null
    return {
      score: Number(data.score) || 0,
      summary: String(data.summary || ''),
      strengths: Array.isArray(data.strengths) ? data.strengths : [],
      issues: Array.isArray(data.issues) ? data.issues : [],
      nextFocus: Array.isArray(data.nextFocus) ? data.nextFocus : []
    }
  } catch {
    return null
  }
}

export function scenarioToNoteHtml(m: ScenarioMaterial, q?: string, a?: string, r?: ScenarioReview | null): string {
  const esc = (t: string) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const parts: string[] = []
  parts.push(`<p><b>场景学习：${esc(m.scenario)}</b>（${m.level}）</p>`)
  if (m.vocabulary.length) {
    parts.push('<p><b>核心词</b></p><ul>')
    for (const v of m.vocabulary) parts.push(`<li>${esc(v.word)} — ${esc(v.meaning)}</li>`)
    parts.push('</ul>')
  }
  if (q && a) {
    parts.push(`<p><b>实战题目</b></p><p>${esc(q)}</p>`)
    parts.push(`<p><b>我的作答</b></p><p>${esc(a)}</p>`)
  }
  if (r) {
    parts.push(`<p><b>评分：${r.score}</b></p><p>${esc(r.summary)}</p>`)
    if (r.issues.length) {
      parts.push('<p><b>需要改的地方</b></p><ul>')
      for (const it of r.issues) {
        parts.push(`<li>${esc(it.quote)}<br>问题：${esc(it.problem)}<br>改成：${esc(it.better)}</li>`)
      }
      parts.push('</ul>')
    }
    if (r.nextFocus.length) {
      parts.push('<p><b>接下来重点练</b></p><ul>')
      for (const n of r.nextFocus) parts.push(`<li>${esc(n)}</li>`)
      parts.push('</ul>')
    }
  }
  return parts.join('')
}

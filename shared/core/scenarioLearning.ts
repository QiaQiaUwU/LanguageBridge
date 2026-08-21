import { buildStyleSampleBlock } from './podcastStyleSamples'
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

/**
 * 生成沉浸式播客体的双语稿。
 *
 * 跟 generateScenario 的 reading 不是一回事：那个是「短文 + 段落翻译」，
 * 读起来像课文；这个要的是中英交替的口播稿 ——
 * 一句中文陈述，紧跟一句英文表达，围绕一个母题铺开。
 *
 * 直接产出 sentences，存成文章后就继承文章的全套能力
 * （分组、收藏、置顶、拖进书、配音频、对轴、跟读）。
 */
export interface PodcastDraft {
  title: string
  sentences: { en: string; zh: string }[]
  covered: string[]
}

export async function generatePodcastArticle(
  theme: string,
  seedWords: string[] = [],
  minutes = 5
): Promise<PodcastDraft | null> {
  const list = seedWords.slice(0, 40).join(', ')
  // 口播大约每分钟 130 个英文词，据此估句数
  const sentenceCount = Math.max(12, Math.round((minutes * 130) / 12))

  const prompt = `写一篇中文的沉浸式随笔，主题是「${theme}」，然后给出对应的英文表达。

${buildStyleSampleBlock()}

${list ? `文章里要自然地用上这些词（这是学习者正在背的，用不上的宁可不用，别硬塞）：\n${list}\n` : ''}
关于文风——这是最重要的部分，当成硬要求看：

要写得美。不是堆辞藻的那种美，是把一个寻常东西说到人心里去的那种。
这个文体的核心手法是：**先给一个具体的物、一个具体的时刻，再给一个偏一点的比喻，
最后落回人的处境。** 抽象形容词（美好、难忘、温暖）本身没有力量，
要靠具体的东西把它顶出来。

同一个题目，两种写法的差别：
  差：\"雨季有三个特点：潮湿、闷热、漫长。\"
  好：从潮气本身写起——它渗进哪里、留下什么气味、让人怎么不舒服；
      再往下走一步，发霉的也许不只是屋子。

  差：\"月亮自古以来寄托着人们的思念。\"
  好：先说小时候见过的那个月亮是什么颜色、挂在哪里、当时家里是什么光景；
      再说现在见到的月亮和那时候有什么不一样。

具体要求：
1. 从一个有质感的生活切片起笔——某个时刻、某种气味、某个动作，不要从概念或定义起笔。
2. 中间要有一次\"转\"：从写景转到写人，或从眼前转到回忆，别一路平铺。
3. 允许联想跑远：一句诗、一个说法、一段来历都行，但要像自然想起来的，
   不是特意插进来讲知识。
4. 句子长短交替。短句落定，长句铺展。连着三句一样长就是失败的。
5. 结尾往开阔处收，一个转念、一句自语即可，不要总结陈词，不要升华成口号。
6. 不许出现：\"本文\"\"首先/其次/最后\"\"综上\"\"总之\"\"让我们\"
   \"是一种美好的体验\"\"给人留下深刻印象\"这类词句和罗列结构。
7. 不要写成教学材料，读者是来读文章的，不是来上课的。
8. 宁可写得短一点、密一点，也不要用没有信息量的句子凑数。

英文那一栏是这句中文的地道英文表达，不是逐字翻译——
中文说"月圆，人也团圆"，英文可以是 "The moon was whole, so were the family."

大约 ${sentenceCount} 句。

返回严格 JSON，不要 markdown 代码块标记：
{
  "title": "文章标题（中文，10 字以内，要有味道）",
  "sentences": [ { "zh": "中文那一句", "en": "对应的英文表达" } ],
  "covered": ["实际用上的目标词"]
}`

  const raw = await askAi(prompt, undefined, 4000, 180_000)
  const data = extractJson(raw)
  if (!data || !Array.isArray(data.sentences) || !data.sentences.length) return null

  return {
    title: String(data.title || theme).trim(),
    sentences: data.sentences
      .filter((x: any) => x && (x.en || x.zh))
      .map((x: any) => ({ en: String(x.en || '').trim(), zh: String(x.zh || '').trim() })),
    covered: Array.isArray(data.covered) ? data.covered.map((x: any) => String(x)) : []
  }
}

/**
 * 按词表做分组规划。
 *
 * 先规划再写文章 —— 一次性把几百个词丢给模型让它写，
 * 结果只会是把词硬塞进句子里。先按语义/场景分成一组组，
 * 每组再单独成篇，用户也能在生成前调整分组。
 */
export interface WordGroupPlan {
  theme: string
  words: string[]
  why: string
}

export async function planWordGroups(
  words: string[],
  groupCount = 6
): Promise<WordGroupPlan[]> {
  if (!words.length) return []
  const list = words.slice(0, 300).join(', ')

  const prompt = `下面是一份英语单词表。请把它们按语义和使用场景分成大约 ${groupCount} 组，
每组的词要能自然地出现在同一篇文章里。

单词表：
${list}

返回严格 JSON，不要 markdown 代码块标记：
{
  "groups": [
    { "theme": "这一组的主题（中文，能直接当文章题目）", "words": ["..."], "why": "为什么归在一起，一句话" }
  ]
}

要求：
- 每组 8–15 个词，尽量把所有词都分掉，实在归不进去的可以单列一组"其他"
- 主题要具体（"雨天与情绪"好过"日常生活"）
- 同一个词不要出现在两组里`

  const raw = await askAi(prompt, undefined, 3000, 180_000)
  const data = extractJson(raw)
  if (!data || !Array.isArray(data.groups)) return []

  return data.groups
    .filter((g: any) => g && Array.isArray(g.words) && g.words.length)
    .map((g: any) => ({
      theme: String(g.theme || '未命名').trim(),
      words: g.words.map((w: any) => String(w)),
      why: String(g.why || '').trim()
    }))
}

/**
 * 造句训练的语法检查。
 *
 * 跟 reviewScenarioAnswer 的区别：那个是整篇作文批改，给的是总评；
 * 这个是针对一句话的即时检查，要能**在原句里把出问题的片段标出来**，
 * 所以必须返回 span（原文里的确切片段），前端才好高亮。
 */
export interface GrammarIssue {
  /** 原句里出问题的那一小段，必须是原文的确切子串 */
  span: string
  /** 错误类型：时态 / 冠词 / 介词 / 单复数 / 搭配 / 语序 / 用词 */
  type: string
  /** 改成什么 */
  fix: string
  /** 为什么 */
  why: string
}

export interface SentenceCheck {
  ok: boolean
  issues: GrammarIssue[]
  /** 整句的地道改写 */
  better: string
  /** 目标词用对了没有 */
  usedTarget: boolean
}

export async function checkSentenceGrammar(
  sentence: string,
  targetWord = ''
): Promise<SentenceCheck | null> {
  const prompt = `检查下面这句英语，找出语法和用词问题。

${targetWord ? `这句话是为了练习「${targetWord}」这个词写的，请一并判断这个词用得对不对。\n` : ''}
句子：
${sentence}

返回严格 JSON，不要 markdown 代码块标记：
{
  "ok": 没有问题就 true,
  "issues": [
    { "span": "原句里出问题的那一小段", "type": "时态/冠词/介词/单复数/搭配/语序/用词", "fix": "改成什么", "why": "为什么，一句话" }
  ],
  "better": "整句更地道的写法",
  "usedTarget": ${targetWord ? '目标词用对了就 true' : 'true'}
}

要求：
1. span 必须是原句里**一字不差**的片段，前端要靠它定位高亮，写错了就标不出来
2. 没问题就 ok=true、issues 为空，不要为了凑数硬挑毛病
3. why 讲清楚道理，不要只说"这样更好"
4. better 是可以直接拿去用的完整句子`

  try {
    const reply = await askAi(prompt, undefined, 1500)
    const data = extractJson(reply)
    if (!data) return null

    const issues: GrammarIssue[] = Array.isArray(data.issues)
      ? data.issues
          .filter((x: any) => x?.span && sentence.includes(String(x.span)))  // span 对不上就丢掉，否则高亮会错位
          .map((x: any) => ({
            span: String(x.span),
            type: String(x.type || '用词'),
            fix: String(x.fix || ''),
            why: String(x.why || '')
          }))
      : []

    return {
      ok: !!data.ok && !issues.length,
      issues,
      better: String(data.better || '').trim(),
      usedTarget: data.usedTarget !== false
    }
  } catch {
    return null
  }
}

/**
 * 把一句话按 issue 的 span 切成片段，供前端高亮。
 * 在这里做而不是在组件里，是因为要处理重叠和越界，逻辑不轻。
 */
export function splitByIssues(
  sentence: string,
  issues: GrammarIssue[]
): { text: string; issue?: GrammarIssue }[] {
  type Range = { start: number; end: number; issue: GrammarIssue }
  const ranges: Range[] = []

  for (const it of issues) {
    const at = sentence.indexOf(it.span)
    if (at < 0) continue
    // 跟已有区间重叠就跳过，避免切出错乱的片段
    if (ranges.some(r => at < r.end && at + it.span.length > r.start)) continue
    ranges.push({ start: at, end: at + it.span.length, issue: it })
  }
  ranges.sort((a, b) => a.start - b.start)

  const out: { text: string; issue?: GrammarIssue }[] = []
  let cur = 0
  for (const r of ranges) {
    if (r.start > cur) out.push({ text: sentence.slice(cur, r.start) })
    out.push({ text: sentence.slice(r.start, r.end), issue: r.issue })
    cur = r.end
  }
  if (cur < sentence.length) out.push({ text: sentence.slice(cur) })
  return out
}

/**
 * Agent 工具调用。
 *
 * 目标：用户说「看看 spect 这一族」，助手不是干巴巴列一串词，而是在聊天记录里
 * 直接嵌一个能转的词汇宇宙小窗；说「讲讲这几个词的关系」，它能读到当前页面上
 * 有什么再回答。
 *
 * 做法是最朴素的那种：让模型在回答里输出一段 ```lb-widget 代码块，
 * 前端解析出来渲染成组件。不依赖模型厂商的 function calling，
 * 换任何一个能对话的模型都能用。
 */

export type WidgetKind = 'universe' | 'wordcard' | 'wordlist' | 'quiz'

export interface WidgetSpec {
  kind: WidgetKind
  /** 词汇宇宙：围绕哪个词 / 哪个词根展开 */
  center?: string
  /** 要展示的词 */
  words?: string[]
  /** 标题 */
  title?: string
  /** quiz：题目 */
  question?: string
  /** quiz：选项 */
  options?: string[]
  /** quiz：正确答案下标 */
  answer?: number
}

/** 给模型看的工具说明。拼进系统提示里。 */
export const TOOL_PROMPT = `你可以在回答里嵌入交互小部件。需要时输出一个 lb-widget 代码块，格式如下：

\`\`\`lb-widget
{"kind":"universe","center":"spect","title":"spect 词族"}
\`\`\`

可用的 kind：
- universe  词汇宇宙小窗。center 填词根、词缀或某个单词；也可以用 words 指定一组词。
  用户想看词与词之间的关系、词族、同根词时用这个。
- wordcard   单词卡。words 填 1 到 6 个单词，显示音标释义，可以点发音。
- wordlist   词表。words 填若干单词，紧凑列出。
- quiz       小测验。question、options（2-4 个）、answer（正确项下标，从 0 开始）。

规则：
1. 代码块里必须是合法 JSON，单独成行，不要加注释。
2. 一条回答最多嵌 2 个部件。
3. 部件是补充，前后仍然要有正常的文字说明——不要只丢一个部件就完事。
4. 用户只是问释义、翻译这类简单问题时，不要硬塞部件。`

/**
 * 从模型回复里抽出部件，返回剩下的正文。
 * 解析失败的代码块原样留在正文里，方便看出问题在哪，而不是静默吞掉。
 */
export function extractWidgets(reply: string): { text: string; widgets: WidgetSpec[] } {
  const widgets: WidgetSpec[] = []
  const text = reply.replace(/```lb-widget\s*([\s\S]*?)```/g, (whole, body) => {
    try {
      const spec = JSON.parse(String(body).trim())
      if (!spec || typeof spec !== 'object' || !spec.kind) return whole
      if (!['universe', 'wordcard', 'wordlist', 'quiz'].includes(spec.kind)) return whole
      if (widgets.length >= 2) return ''
      widgets.push(spec as WidgetSpec)
      return ''
    } catch {
      return whole
    }
  })
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), widgets }
}

export interface PageContext {
  route: string
  summary: string
}

/**
 * 当前页面上有什么。喂给模型，它才能回答「讲讲现在屏幕上这些词的关系」。
 * 只传摘要不传全量数据 —— 词库上万条，全塞进提示里既贵又没用。
 */
export function describePage(ctx: {
  path: string
  centerWord?: string
  visibleWords?: string[]
  articleTitle?: string
  currentSentence?: string
}): PageContext {
  const parts: string[] = []
  if (ctx.centerWord) parts.push(`中心词是 ${ctx.centerWord}`)
  if (ctx.visibleWords?.length) {
    const shown = ctx.visibleWords.slice(0, 40)
    parts.push(`屏幕上有这些词：${shown.join(', ')}${ctx.visibleWords.length > 40 ? ` 等 ${ctx.visibleWords.length} 个` : ''}`)
  }
  if (ctx.articleTitle) parts.push(`正在读《${ctx.articleTitle}》`)
  if (ctx.currentSentence) parts.push(`当前句子：${ctx.currentSentence}`)

  const names: Record<string, string> = {
    '/universe': '词汇宇宙',
    '/words': '词汇中心',
    '/study': '学习',
    '/reading': '阅读助手',
    '/dictation': '听写'
  }
  const page = Object.entries(names).find(([k]) => ctx.path.startsWith(k))?.[1] || ctx.path

  return {
    route: page,
    summary: parts.length ? `用户当前在「${page}」页面，${parts.join('；')}。` : `用户当前在「${page}」页面。`
  }
}

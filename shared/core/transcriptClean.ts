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

/**
 * 每次送进模型的原文长度。
 *
 * 从 5000 降到 1200。理由是可验证的：同一个 key、同一个模型，
 * 逐句翻译（一次二十来行）一直正常，只有整理（一次 5000 字）报
 * 403「预扣费额度失败」。两者唯一的差别就是请求大小。
 *
 * 中转站按「输入 + 预留输出」估算预扣，请求越大预扣越多；
 * 缩到跟翻译同一量级之后，如果整理也能跑通，就说明问题一直是请求太大，
 * 跟模型、跟 max_tokens 都无关。
 *
 * 代价是请求次数变多（每次多一点固定开销），但整理本来就不是高频操作。
 */
const CHUNK_CHARS = 1200

/**
 * 把原文切成能塞进一次请求的块。
 *
 * 原来只按 \n+ 切段，单个段落再长也不拆 —— 转录稿常常整篇没有换行，
 * 于是 4 万字被当成一块塞进提示词，直接超上下文，模型返回空。
 * 这就是「AI 实际返回的开头是：（空）」的真正来源。
 *
 * 现在超长的段落会继续按句子切，句子还超长就硬切。
 */
function chunkRaw(raw: string): string[] {
  // 先按句末标点断句（中英标点都认），保证每个单元不会太长
  const splitLong = (text: string): string[] => {
    if (text.length <= CHUNK_CHARS) return [text]
    const units = text.match(/[^。！？.!?\n]+[。！？.!?]*/g) || [text]
    const out: string[] = []
    for (const u of units) {
      if (u.length <= CHUNK_CHARS) { out.push(u); continue }
      // 单句就超长（没有标点的整篇文本）：按字数硬切
      for (let k = 0; k < u.length; k += CHUNK_CHARS) out.push(u.slice(k, k + CHUNK_CHARS))
    }
    return out
  }

  const paras = raw.split(/\n+/).filter(p => p.trim()).flatMap(splitLong)

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
  return chunks
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
  onProgress?: (done: number, total: number) => void,
  /** 返回 true 就停下来，已完成的部分保留 */
  shouldCancel?: () => boolean
): Promise<ArticleSentence[]> {
  const chunks = chunkRaw(raw)
  let lastRawReply = ''
  let lastError = ''
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

    // 每段开始前检查一次；正在等的那一次请求没法中途掐断，
    // 但它一回来就会停，不会再发下一段
    if (shouldCancel?.()) break

    try {
      /**
       * 显式限死 3000。
       *
       * 中转站按 max_tokens **预扣费**：不发这个参数，服务商就按自己的默认
       * 上限（十万级）算，四句话的请求也要预扣 ¥600，余额不够直接 403。
       * chunkRaw 已保证每块 ≤5000 字，3000 tokens 足够放下一块的 EN/ZH 配对。
       */
      /**
       * 预扣费 403 就把这一段再切一半重试。
       *
       * 与其让用户自己去调配置，不如让程序自己退到能跑通的粒度 ——
       * 中转站按请求大小估预扣，段落小到一定程度自然就过了。
       */
      let result = ''
      try {
        result = await askAi(prompt, undefined, 1500, 180_000, true)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const isQuota = /预扣费|额度|quota|insufficient/i.test(msg)
        const half = chunks[i].slice(0, Math.ceil(chunks[i].length / 2))
        if (!isQuota || half.length < 200) throw e
        // 只重试前半段，剩下的交给下一轮（整段跳过总比整篇失败强）
        result = await askAi(prompt.replace(chunks[i], half), undefined, 1000, 180_000, true)
      }
      lastRawReply = result
      const pairs = parseEnZhPairs(result)
      if (pairs.length) all.push(...pairs)
      else failed++
    } catch (e) {
      /**
       * 原来是 catch { failed++ }，把异常整个吞掉。
       *
       * 下面报错只会说「AI 实际返回的开头是：（空）」——
       * 而真正的原因（被长度截断、结构不对、超上下文、限流）全丢了。
       * 我为此连着猜错了好几轮。现在把最后一条错误留下来带出去。
       */
      lastError = e instanceof Error ? e.message : String(e)
      failed++
    }
    onProgress?.(i + 1, chunks.length)
  }

  if (!all.length) {
    const sample = lastRawReply.slice(0, 200).replace(/\s+/g, ' ')
    // 有具体错误就报具体错误，没有才退回「返回了什么」
    if (lastError) {
      throw new AiError(
        `整理失败（${chunks.length} 段全部没成功）。最后一次的错误是：\n${lastError}`
      )
    }
    throw new AiError(
      `AI 返回的内容里找不到 EN/ZH 配对。实际返回的开头是：\n${sample || '（完全是空的）'}`
    )
  }
  if (shouldCancel?.()) {
    console.warn(`[整理] 用户中止，已完成 ${all.length} 句`)
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

/**
 * 修英文转写错误。
 *
 * 语音识别出来的英文里有大量同音误听：
 *   self-taught → selfish taught / selfish tot
 *   danmaku     → denmark-u / Dan MAU
 *   Veblen good → webling good
 *   spark       → smirk
 *   Bilibili    → Bill Billy / 比利·比利
 *   go-to       → gosto / gostou
 * 这些错误中文翻译修不掉 —— 之前的整理只重译中文，英文原样保留，
 * 所以听读跟打都在跟着错的文本走。
 *
 * 提示词里明确要求「只改明显听错的词，不要改写句子」，避免模型顺手润色，
 * 那样会让英文跟音频对不上，跟读和对轴就全废了。
 */
/**
 * 自检：塞一句已知有错的进去，看模型认不认得出来。
 *
 * 修英文改了 0 句时，光看结果分不清是「文稿本来就没错」还是「提示词没生效、
 * 模型在敷衍」。用一句必然有错的样本探一下，一试就知道。
 */
export async function probeEnglishFixer(): Promise<{ ok: boolean; got: string }> {
  const sample = "It's what economists call a webling good."
  const [out] = await aiFixEnglish([sample])
  return { ok: !!out && out !== sample, got: out || '(没有返回)' }
}

export async function aiFixEnglish(lines: string[]): Promise<string[]> {
  if (!lines.length) return []
  const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join('\n')

  /**
   * 只让模型输出**改动过的行**，没问题的行不要回。
   *
   * 之前是要求逐行输出全部内容，结果模型图省事把原文一字不改地回吐，
   * 解析成功但 fixed 恒为 0 —— 表面上"扫了 309 句"，实际一个字没改。
   * 改成只回改动行之后，回吐原文这条路就走不通了：要么给出修正，要么明说没有。
   */
  const prompt = `下面是语音识别生成的英文文稿，存在同音误听——识别器把词听错了，写出来的是发音相近但意思不通的另一个词。

例子：
  a self taught a kind of person → a self-taught kind of person
  webling good     → Veblen good
  the denmark-u    → the danmaku
  no smirk         → no spark
  Brian Mortar     → brick-and-mortar
  gosto            → go-to
专有名词的音译（Xia Hong Shu、Bill Billy 这类）保留不改。

判断标准：这个词在这句话里说得通吗？说不通就是听错了，换成发音相近、意思通顺的词。
除同音误听外，也修明显漏掉的功能词和不成立的语法。
不要润色措辞、不要替换同义词、不要增删内容、不要改写句式——这些文本要和音频逐句对齐。

**只输出你改动过的行**，格式 "序号. 修改后的整句"，一行一条。
没有改动的行不要输出。如果整批都没有需要改的，只回一个字：无。

${numbered}`

  /**
   * 超时放到 3 分钟。
   *
   * 默认 60 秒对这个请求太短：提示词本身很长，模型还要逐句判断有没有听错，
   * 慢一点就整批超时 —— 之前「3 批报错」全是这个原因，跟文稿有没有错无关。
   * maxTokens 也调大：只输出改动行，正常远用不到，但不能被截断。
   */
  const result = await askAi(prompt, undefined, 3000, 180_000)
  const out = lines.slice()
  if (/^\s*无\s*$/.test(result)) return out
  for (const line of result.split('\n')) {
    const m = line.match(/^\s*(\d+)[.、)]\s*(.+)$/)
    if (!m) continue
    const idx = Number(m[1]) - 1
    const text = m[2].trim()
    if (idx >= 0 && idx < out.length && text) out[idx] = text
  }
  return out
}

export type TranscriptKind =
  | 'mixed'       // 中英混杂的口播稿：要重新提炼英文并配译文
  | 'chinese'     // 纯中文：要补英文
  | 'english'     // 纯英文：要补译文
  | 'bilingual'   // 已经是中英对照，只有零星缺口
  | 'book'        // 篇幅长且有章节结构，要先切章

export interface TranscriptAnalysis {
  kind: TranscriptKind
  /** 说给用户听的判断理由 */
  reason: string
  lines: number
  mixedLines: number
  cjkRatio: number
}

/**
 * 判断这是什么稿子。
 *
 * 之前这些判断散在四五个 if/return 里，谁在前谁说了算 —— 结果
 * aiReorganizeTranscript 被前面的分支挡成了死代码，混排稿永远走不到它。
 * 集中成一个函数之后，路由是显式的，加新类型也不会再挡住老的。
 *
 * 判断只用本地规则：字符集比例、行结构、已有译文的覆盖率。
 * 这些信号足够可靠，不值得为它多跑一次模型。
 */
export function analyzeTranscript(
  raw: string,
  sentences: { en: string; zh: string }[] = []
): TranscriptAnalysis {
  const lines = raw.split('\n').filter(l => l.trim())
  const cjk = (raw.match(/[\u4e00-\u9fff]/g) || []).length
  const latin = (raw.match(/[A-Za-z]/g) || []).length
  const cjkRatio = cjk + latin > 0 ? cjk / (cjk + latin) : 0

  // 单行里两种文字都占相当篇幅 = 这一行是混排
  const mixedLines = lines.filter(l => {
    const c = (l.match(/[\u4e00-\u9fff]/g) || []).length
    const e = (l.match(/[A-Za-z]/g) || []).length
    return c >= 4 && e >= 8
  }).length

  const base = { lines: lines.length, mixedLines, cjkRatio }

  // 已经是干净的中英对照：绝大多数句子两边都有
  if (sentences.length >= 5) {
    const paired = sentences.filter(s => s.en.trim() && s.zh.trim()).length
    if (paired / sentences.length >= 0.9) {
      return { ...base, kind: 'bilingual', reason: `已是中英对照稿（${paired}/${sentences.length} 句成对），只补缺口` }
    }
  }

  // 混排：三成以上的行中英交错
  if (lines.length > 0 && mixedLines >= lines.length * 0.3) {
    return { ...base, kind: 'mixed', reason: `中英混杂口播稿（${mixedLines}/${lines.length} 行交错），重新提炼英文并配译文` }
  }

  // 有明显章节标记且篇幅长 = 书
  const headings = lines.filter(l =>
    /^#{1,3}\s/.test(l) ||
    /^第\s*[0-9一二三四五六七八九十百]+\s*[章节回]/.test(l.trim()) ||
    /^(Chapter|CHAPTER)\s+\d+/.test(l.trim())
  ).length
  if (headings >= 3 && lines.length >= 60) {
    return { ...base, kind: 'book', reason: `长文且有 ${headings} 处章节标记，先切章再逐章处理` }
  }

  if (cjkRatio > 0.7) {
    return { ...base, kind: 'chinese', reason: '基本是中文稿，补出英文' }
  }
  return { ...base, kind: 'english', reason: '基本是英文稿，补出译文' }
}

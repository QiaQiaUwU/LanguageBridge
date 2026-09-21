/**
 * 自然段。
 *
 * 句子是分句器切出来的，原来的段落信息在切的时候丢了，于是「双语对照」只能整篇堆成
 * 一大块英文 + 一大块中文。这里把段落找回来：
 *  1. 句子上有 para 标记（新导入的试题会标）就直接用
 *  2. 否则拿原文按空行分段，逐句到原文里定位，看它落在第几段
 *  3. 原文本来就没分段（转录稿一整坨）：按长度和转折词切，4~6 句一段
 */

interface SentenceLike { en: string; para?: boolean }

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '')

export function paragraphStartsOf(sentences: SentenceLike[], raw: string): Set<number> {
  const starts = new Set<number>([0])
  const text = String(raw || '').replace(/\r\n/g, '\n')
  let paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => /[A-Za-z]{3}/.test(p))
  if (paras.length <= 1) paras = text.split('\n').map(p => p.trim()).filter(p => /[A-Za-z]{3}/.test(p))
  if (paras.length <= 1) return starts

  // 把各段拼成一条，记下每段在拼接串里的起点
  const bounds: number[] = []
  let full = ''
  for (const p of paras) { bounds.push(full.length); full += norm(p) }
  const paraAt = (pos: number) => { let k = 0; while (k + 1 < bounds.length && bounds[k + 1] <= pos) k++; return k }

  let cursor = 0
  let last = 0
  let hits = 0
  sentences.forEach((s, i) => {
    const key = norm(s.en).slice(0, 24)
    if (!key) return
    const at = full.indexOf(key, cursor)
    if (at < 0) return
    hits++
    const k = paraAt(at)
    if (i > 0 && k > last) starts.add(i)
    last = k
    cursor = at + key.length
  })
  // 大半句子都没在原文里找到（原文和句子对不上），这份结果不可信
  return hits >= sentences.length * 0.6 ? starts : new Set([0])
}

const TURN = /^(However|But|So|Then|Now|Meanwhile|Moreover|Furthermore|In addition|Another|Finally|First|Firstly|Second|Secondly|Third|Lastly|In conclusion|Overall|On the other hand|As a result|For example|For instance|Today|In \d{4}|Yet|Instead|Consequently|Therefore|Of the|Other)\b/

function heuristicStarts(sentences: SentenceLike[]): Set<number> {
  const starts = new Set<number>([0])
  let since = 0
  let chars = 0
  sentences.forEach((s, i) => {
    if (i === 0) { chars = s.en.length; return }
    since++
    const long = chars > 600 || since >= 6
    const turn = since >= 3 && TURN.test(s.en.trim())
    if (long || turn) { starts.add(i); since = 0; chars = 0 }
    chars += s.en.length
  })
  return starts
}

/** 按段分组，返回每段的句子下标 */
export function groupParagraphs(sentences: SentenceLike[], raw: string): number[][] {
  if (!sentences.length) return []
  let starts: Set<number>
  if (sentences.some(s => s.para)) {
    starts = new Set(sentences.map((s, i) => (s.para || i === 0 ? i : -1)).filter(i => i >= 0))
  } else {
    starts = paragraphStartsOf(sentences, raw)
    if (starts.size <= 1 && sentences.length > 6) starts = heuristicStarts(sentences)
  }
  const out: number[][] = []
  sentences.forEach((_, i) => {
    if (starts.has(i) || !out.length) out.push([])
    out[out.length - 1].push(i)
  })
  return out
}

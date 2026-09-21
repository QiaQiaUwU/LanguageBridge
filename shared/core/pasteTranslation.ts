/**
 * 把「英文句 + 中文句」连在一起的整篇译文，拆开并贴回文章的每一句。
 *
 * 常见来源是各种双语材料，整段长这样：
 *   He must learn them again.创作者必须重新学会这一切；and, teaching himself that…教会自己…
 * 英文和中文之间没有任何分隔符，只能靠字符本身换行：
 * 一段连续的拉丁字母是英文，紧跟着的一段中日韩字符是它的译文。
 *
 * 拆完之后按英文相似度贴回文章的句子，而不是按顺序硬贴 ——
 * 原文的断句和这份材料未必一一对应（材料常把两三句并成一条）。
 */

export interface TransPair { en: string; zh: string }

const CJK = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/
const isCjk = (c: string) => CJK.test(c)
const isLatin = (c: string) => /[A-Za-z]/.test(c)

/** 切成「英文段 + 中文段」的配对 */
export function parseBilingual(raw: string): TransPair[] {
  const text = (raw || '').replace(/\r/g, '')
  const out: TransPair[] = []
  let en = ''
  let zh = ''
  const flush = () => {
    const e = en.trim()
    const z = zh.trim()
    if (e && z) out.push({ en: e, zh: z })
    en = ''
    zh = ''
  }
  for (const ch of text) {
    if (isCjk(ch)) {
      zh += ch
    } else if (isLatin(ch) && zh) {
      // 中文之后又出现字母：上一对结束，开始下一对
      flush()
      en += ch
    } else if (zh) {
      zh += ch              // 中文里的标点、数字、空格
    } else {
      en += ch
    }
  }
  flush()
  return out.map(p => ({
    // 材料里常带「2.」「15.」这种小节编号，去掉
    en: p.en.replace(/^\s*\d+\s*[.、]\s*/, '').trim(),
    zh: p.zh.replace(/^\s*\d+\s*[.、]\s*/, '').trim()
  })).filter(p => p.en && p.zh)
}

/**
 * 整篇重排后，把划线标记重新锚到新句子上。
 *
 * 标记记的是「第几句、句内第几个字符」，句子一换全错位：
 * 要么划到别的词上，要么直接落在句子外面。
 * 这里按标记的原文去新句子里重新找一遍，找不到的丢掉 —— 留着也是错的。
 */
export function reanchorMarks<T extends { text: string; sentIdx?: number; localStart?: number; localEnd?: number }>(
  marks: T[],
  sentences: string[]
): { kept: T[]; dropped: number } {
  const kept: T[] = []
  let dropped = 0
  for (const m of marks || []) {
    const t = String(m.text || '').trim()
    if (!t) { dropped++; continue }
    // 先在原来那一句附近找，找不到再全篇找，避免同一个词把标记搬得太远
    const order = [m.sentIdx, ...sentences.map((_, i) => i)].filter(
      (i): i is number => typeof i === 'number' && i >= 0 && i < sentences.length
    )
    let hit = -1
    let at = -1
    for (const i of order) {
      const p = sentences[i].indexOf(t)
      if (p >= 0) { hit = i; at = p; break }
    }
    if (hit < 0) { dropped++; continue }
    kept.push({ ...m, sentIdx: hit, localStart: at, localEnd: at + t.length })
  }
  return { kept, dropped }
}

/** 归一化后的词集合，用来比相似度 */
function wordsOf(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z']+/g) || []).filter(w => w.length > 2))
}
function similarity(a: string, b: string): number {
  const x = wordsOf(a), y = wordsOf(b)
  if (!x.size || !y.size) return 0
  let n = 0
  for (const w of x) if (y.has(w)) n++
  return n / Math.min(x.size, y.size)
}

export interface ApplyResult {
  zh: (string | null)[]      // 每句对应的新译文，null = 没匹配上，保持原样
  matched: number
  total: number
}

/**
 * 把解析好的配对贴回句子。
 *
 * 只往前走：第 i 句匹配过的材料条目，后面的句子不再用，
 * 免得同一条译文被反复贴到好几句上。窗口往后看 6 条，够应付材料合并断句的情况。
 */
export function applyTranslation(sentences: string[], pairs: TransPair[], minSim = 0.34): ApplyResult {
  const zh: (string | null)[] = sentences.map(() => null)
  let p = 0
  let matched = 0
  for (let i = 0; i < sentences.length; i++) {
    let best = -1
    let bestSim = minSim
    for (let k = p; k < Math.min(pairs.length, p + 6); k++) {
      const sim = similarity(sentences[i], pairs[k].en)
      if (sim > bestSim) { bestSim = sim; best = k }
    }
    if (best >= 0) {
      zh[i] = pairs[best].zh
      matched++
      p = best + 1
    }
  }
  return { zh, matched, total: sentences.length }
}

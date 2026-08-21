/**
 * 无字幕自动对轴。
 *
 * 之前只有两条路：导入字幕（要有字幕文件）、手动逐句点「标记开始」。一篇文章
 * 几百句，手动标是不现实的工作量。
 *
 * 这里做的是按「说这句话大概要多久」把音频时长分配下去。朗读速度在一段音频里
 * 是相对稳定的，所以每句耗时基本正比于音节数 —— 比按字符数分配准，因为
 * "strength"（8 个字母 1 个音节）和 "idea"（4 个字母 2 个音节）读起来时长差得远。
 *
 * 再叠两条：句末标点带来的停顿（句号 > 逗号 > 无），以及首尾静音裁剪。
 * 结果不会像真正的强制对齐那么精确，但对跟读足够用，而且一步到位不用点几百次。
 */

export interface AutoAlignSentence {
  en: string
  audioStart?: number
  audioEnd?: number
}

/** 数音节：英语里元音组算一个，末尾哑 e 不算，至少 1。 */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return 0
  if (w.length <= 3) return 1
  const trimmed = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '')
  const groups = trimmed.match(/[aeiouy]{1,2}/g)
  return Math.max(1, groups ? groups.length : 1)
}

/** 一句话的相对时长权重 */
export function weightOf(sentence: string): number {
  const words = sentence.trim().split(/\s+/).filter(Boolean)
  let syl = 0
  for (const w of words) syl += countSyllables(w)
  if (!syl) return 0

  // 句末停顿：句号/问号/叹号 ≈ 半秒，逗号/分号 ≈ 四分之一秒。
  // 这里统一折算成「相当于多少个音节的时间」，跟音节一起按比例分。
  const tail = /[.!?…]$/.test(sentence.trim()) ? 2.5
    : /[,;:]$/.test(sentence.trim()) ? 1.2
    : 0
  return syl + tail
}

export interface AutoAlignResult {
  timings: { start: number; end: number }[]
  /** 估算出来的语速，音节/秒，用来判断结果靠不靠谱 */
  syllablesPerSecond: number
}

/**
 * @param sentences 句子（用英文那一栏）
 * @param duration  音频总时长（秒）
 * @param leadIn    开头静音，默认 0
 */
export function autoAlign(
  sentences: { en: string }[],
  duration: number,
  leadIn = 0
): AutoAlignResult {
  const weights = sentences.map(s => weightOf(s.en || ''))
  const total = weights.reduce((a, b) => a + b, 0)
  if (!total || duration <= 0) return { timings: [], syllablesPerSecond: 0 }

  const usable = Math.max(0, duration - leadIn)
  const timings: { start: number; end: number }[] = []
  let cursor = leadIn
  for (const w of weights) {
    const span = (w / total) * usable
    timings.push({
      start: Math.round(cursor * 100) / 100,
      end: Math.round((cursor + span) * 100) / 100
    })
    cursor += span
  }

  const syllables = weights.reduce((a, b) => a + b, 0)
  return { timings, syllablesPerSecond: syllables / usable }
}

/**
 * 语速落在合理区间才算可信。
 * 正常朗读 3–6 音节/秒；播客快的能到 7。超出说明句子和音频根本不是一回事
 * （比如音频只有半篇、或者句子里混了大段中文）。
 */
export function looksReasonable(sps: number): boolean {
  return sps >= 1.5 && sps <= 9
}

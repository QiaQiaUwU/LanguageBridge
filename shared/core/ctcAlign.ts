/**
 * CTC 强制对齐。
 *
 * 逐步移植自 torchaudio 官方教程 Forced Alignment with Wav2Vec2：
 *   https://docs.pytorch.org/audio/stable/tutorials/forced_alignment_tutorial.html
 * 流程和它一致：
 *   1. emission：模型给出的逐帧标签概率（log 概率）
 *   2. get_trellis：算出「文本前 j 个字符在第 t 帧之前出现完」的概率矩阵
 *   3. backtrack：从右下角回溯出最可能的路径
 *   4. merge_repeats：把同一字符的连续帧并成一段
 *   5. merge_words：字符段合成词段
 *
 * emission 从哪来：浏览器里跑 wav2vec2 CTC（onnxruntime-web）。模型没加载时，
 * 上层会退回 forcedAlign.ts 的词序列 DTW，那条不需要声学模型。
 */

export interface Point {
  tokenIndex: number
  timeIndex: number
  score: number
}

export interface Segment {
  label: string
  start: number
  end: number
  score: number
}

/**
 * @param emission [numFrames][numLabels] 的 log 概率
 * @param tokens   文本转成的标签下标序列
 * @param blankId  CTC blank 的下标
 *
 * 对应教程里的 get_trellis。trellis[t][j] 表示前 j 个 token 在 t 帧前出现完的概率。
 */
export function getTrellis(
  emission: Float32Array[],
  tokens: number[],
  blankId = 0
): Float32Array[] {
  const numFrame = emission.length
  const numTokens = tokens.length
  const NEG = -3.4e38

  /**
   * 规模保护。trellis 是 (帧数+1)×(token数+1) 的完整矩阵，
   * 整篇一次性做会到几十亿格、好几个 GB，浏览器会直接冻死。
   * 上层已经分段了，这里是最后一道闸 —— 宁可报错也不要卡死页面。
   */
  const cells = (numFrame + 1) * (numTokens + 1)
  if (cells > 40_000_000) {
    throw new Error(
      `这一段太长了（${numFrame} 帧 × ${numTokens} 字符）。请把文章拆成更短的章节再对齐。`
    )
  }

  const trellis: Float32Array[] = []
  for (let t = 0; t <= numFrame; t++) trellis.push(new Float32Array(numTokens + 1).fill(NEG))
  trellis[0][0] = 0

  for (let t = 0; t < numFrame; t++) {
    const frame = emission[t]
    for (let j = 0; j <= numTokens; j++) {
      const cur = trellis[t][j]
      if (cur <= NEG) continue
      // 停在原地（吃一个 blank）
      const stay = cur + frame[blankId]
      if (stay > trellis[t + 1][j]) trellis[t + 1][j] = stay
      // 前进一个 token
      if (j < numTokens) {
        const go = cur + frame[tokens[j]]
        if (go > trellis[t + 1][j + 1]) trellis[t + 1][j + 1] = go
      }
    }
  }
  return trellis
}

/** 对应教程里的 backtrack */
export function backtrack(
  trellis: Float32Array[],
  emission: Float32Array[],
  tokens: number[],
  blankId = 0
): Point[] {
  let t = trellis.length - 1
  let j = tokens.length
  const path: Point[] = []

  while (t > 0 && j >= 0) {
    const frame = emission[t - 1]
    // 停留 vs 前进，比较的是「转移之后」的概率
    const stayed = trellis[t - 1][j] + frame[blankId]
    const changed = j > 0 ? trellis[t - 1][j - 1] + frame[tokens[j - 1]] : -Infinity

    const tokenIndex = j > 0 ? j - 1 : 0
    const prob = Math.exp(changed > stayed ? frame[tokens[tokenIndex]] : frame[blankId])
    path.push({ tokenIndex, timeIndex: t - 1, score: prob })

    if (changed > stayed) {
      j -= 1
      if (j === 0) break
    }
    t -= 1
  }
  return path.reverse()
}

/** 对应教程里的 merge_repeats：同一 token 的连续帧并成一段，分数取平均 */
export function mergeRepeats(path: Point[], transcript: string): Segment[] {
  const segments: Segment[] = []
  let i1 = 0
  while (i1 < path.length) {
    let i2 = i1
    while (i2 < path.length && path[i1].tokenIndex === path[i2].tokenIndex) i2++
    let score = 0
    for (let k = i1; k < i2; k++) score += path[k].score
    score /= i2 - i1
    segments.push({
      label: transcript[path[i1].tokenIndex] ?? '',
      start: path[i1].timeIndex,
      end: path[i2 - 1].timeIndex + 1,
      score
    })
    i1 = i2
  }
  return segments
}

/** 对应教程里的 merge_words：按分隔符把字符段合成词段 */
export function mergeWords(segments: Segment[], separator = '|'): Segment[] {
  const words: Segment[] = []
  let i1 = 0
  let i2 = 0
  while (i1 < segments.length) {
    if (i2 >= segments.length || segments[i2].label === separator) {
      if (i1 !== i2) {
        const segs = segments.slice(i1, i2)
        const word = segs.map(s => s.label).join('')
        let score = 0
        let total = 0
        for (const s of segs) {
          score += s.score * (s.end - s.start)
          total += s.end - s.start
        }
        words.push({
          label: word,
          start: segs[0].start,
          end: segs[segs.length - 1].end,
          score: total ? score / total : 0
        })
      }
      i1 = i2 + 1
      i2 = i1
    } else {
      i2++
    }
  }
  return words
}

/**
 * 一步到位：emission + 文本 → 词级时间段（秒）
 *
 * @param transcript 用 | 分隔单词的大写文本，例如 "I|HAD|THAT|CURIOSITY"
 *                   （教程里就是这个格式）
 * @param labels     模型的标签表，下标要和 emission 的列对应
 * @param frameRate  每帧多少秒（wav2vec2 base 是 0.02）
 */
export function alignWithEmission(
  emission: Float32Array[],
  transcript: string,
  labels: string[],
  frameRate: number
): Segment[] {
  const dict = new Map<string, number>()
  labels.forEach((l, i) => dict.set(l, i))
  const tokens: number[] = []
  for (const ch of transcript) {
    const id = dict.get(ch)
    if (id !== undefined) tokens.push(id)
  }
  if (!tokens.length || !emission.length) return []

  const blankId = dict.get('<pad>') ?? dict.get('-') ?? 0
  const trellis = getTrellis(emission, tokens, blankId)
  const path = backtrack(trellis, emission, tokens, blankId)
  const charSegs = mergeRepeats(path, transcript)
  const wordSegs = mergeWords(charSegs)

  return wordSegs.map(w => ({
    ...w,
    start: w.start * frameRate,
    end: w.end * frameRate
  }))
}

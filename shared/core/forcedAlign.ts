/**
 * 句子级强制对齐。
 *
 * 参考：
 *  - PyTorch/torchaudio 的 CTC forced alignment 教程（trellis + backtracking 的思路）
 *    https://docs.pytorch.org/audio/stable/tutorials/forced_alignment_tutorial.html
 *  - bournemouth-forced-aligner 的 silence anchoring：在停顿处（逗号、句号）切段，
 *    长句对齐明显更准
 *  - Medium《Forced Alignment: How to match audio with a transcript》里提到的第二条路：
 *    先识别出带时间戳的词，再把它和已有文本对齐（DTW），比重新跑声学模型省得多
 *
 * 这里走的是第二条路：whisper 转写已经给了带时间戳的词序列，文章又有确定的句子，
 * 剩下的就是把两串词对上。用编辑距离对齐（Needleman-Wunsch），能容忍转写的错词、
 * 漏词、多词 —— 这正是纯按顺序切分做不到的。
 */

export interface TimedWord {
  word: string
  start: number
  end: number
}

export interface SentenceTiming {
  start: number
  end: number
  /** 这一句里有多少个词真的在转写里找到了，用来判断可信度 */
  matched: number
  total: number
  /**
   * 双语音频里，这一句的中文朗读大约从什么时候开始（= 英文最后一个词读完）。
   * 只有 bilingual 模式且这句真的命中过词时才有值。
   * 想「只播英文」就放 [start, zhStart]，想连中文一起就放 [start, end]。
   */
  zhStart?: number
}

function norm(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9']/g, '')
}

/**
 * 把文章的词序列和转写的词序列对齐。
 * 返回 articleWords[i] 对应的 timedWords 下标，对不上是 -1。
 *
 * Needleman-Wunsch：匹配 +2、不匹配 -1、插入/删除 -1。
 * 词数多的时候矩阵会很大，所以按 band 限制搜索宽度（两串顺序基本一致，
 * 偏移不会太远），复杂度从 O(nm) 降到 O(n·band)。
 */
export function alignWordSequences(
  articleWords: string[],
  timedWords: string[],
  band = 200
): number[] {
  const n = articleWords.length
  const m = timedWords.length
  const map = new Array<number>(n).fill(-1)
  if (!n || !m) return map

  const a = articleWords.map(norm)
  const b = timedWords.map(norm)

  /**
   * 完整 DP，不做 band 裁剪。
   *
   * 之前那版按 i 的比例滑动窗口，但滑窗的偏移量每行都在变，
   * 回溯时用的下标跟填表时对不上，越界的格子一律当成 -1e9 ——
   * 结果 500 词 15% 错词只能命中 66%（应该 85%+），
   * 真实数据上更差，就是你看到的 1%。
   *
   * 词数上限内直接算完整矩阵：3000×3000 是 900 万格，Int32Array 36MB，
   * 几百毫秒能跑完，比错误的优化强得多。超了再按块切。
   */
  const MAX_CELLS = 12_000_000
  if ((n + 1) * (m + 1) > MAX_CELLS) {
    // 太大就切两半分别对齐，切点取中位
    const half = Math.floor(n / 2)
    const bHalf = Math.floor(m / 2)
    const left = alignWordSequences(articleWords.slice(0, half), timedWords.slice(0, bHalf), band)
    const right = alignWordSequences(articleWords.slice(half), timedWords.slice(bHalf), band)
    for (let i = 0; i < left.length; i++) map[i] = left[i]
    for (let i = 0; i < right.length; i++) {
      map[half + i] = right[i] >= 0 ? right[i] + bHalf : -1
    }
    return map
  }

  const W = m + 1
  const score = new Int32Array((n + 1) * W)
  const back = new Uint8Array((n + 1) * W) // 0=对角 1=上(删) 2=左(插)

  // 边界：全删 / 全插
  for (let i = 1; i <= n; i++) {
    score[i * W] = -i
    back[i * W] = 1
  }
  for (let j = 1; j <= m; j++) {
    score[j] = -j
    back[j] = 2
  }

  for (let i = 1; i <= n; i++) {
    const ai = a[i - 1]
    const row = i * W
    const prow = (i - 1) * W
    for (let j = 1; j <= m; j++) {
      const hit = ai && ai === b[j - 1] ? 2 : -1
      const diag = score[prow + j - 1] + hit
      const up = score[prow + j] - 1
      const left = score[row + j - 1] - 1
      let best = diag
      let dir = 0
      if (up > best) { best = up; dir = 1 }
      if (left > best) { best = left; dir = 2 }
      score[row + j] = best
      back[row + j] = dir
    }
  }

  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const dir = back[i * W + j]
    if (dir === 0) {
      if (a[i - 1] && a[i - 1] === b[j - 1]) map[i - 1] = j - 1
      i--
      j--
    } else if (dir === 1) {
      i--
    } else {
      j--
    }
  }
  return map
}

/** 一句话切成词 */
export function wordsOf(sentence: string): string[] {
  return (sentence.match(/[A-Za-z0-9']+/g) || [])
}

/**
 * 把转写出来的带时间戳的词，对到文章的每个句子上。
 *
 * @param sentences 文章句子（英文）
 * @param timed     转写结果，词级时间戳
 */
export function alignSentencesToTranscript(
  sentences: string[],
  timed: TimedWord[],
  /**
   * 音频真实时长（秒）。
   * 不给的话末尾只能取"最后一个识别到的词"的结束时间 —— 结尾那段
   * 没识别出词的音频就被截掉了，播到最后一句会提前停。
   */
  totalDuration?: number,
  /**
   * 双语音频（读一句英文，紧跟着读这句的中文）。
   *
   * 不开这个开关时，两句之间的空隙取中点切开 —— 而在双语音频里，
   * 那段"空隙"根本不是停顿，是这一句的中文朗读。取中点等于把中文
   * 劈成两半，前半留给本句、后半甩给下一句：播本句会拖半截中文，
   * 跳到下一句会先听到另外半截。
   *
   * 开了之后，切点贴到下一句英文开始之前，整段中文归本句，
   * 同时把中文起点记在 zhStart 上。
   */
  bilingual = false
): SentenceTiming[] {
  const perSentence = sentences.map(wordsOf)
  const flat: string[] = []
  const owner: number[] = []
  perSentence.forEach((ws, si) => {
    for (const w of ws) {
      flat.push(w)
      owner.push(si)
    }
  })

  const map = alignWordSequences(flat, timed.map(t => t.word))

  const out: SentenceTiming[] = sentences.map((_, si) => ({
    start: 0,
    end: 0,
    matched: 0,
    total: perSentence[si].length
  }))

  // 每句取「命中的第一个词的开始」和「命中的最后一个词的结束」
  const firstHit: number[] = new Array(sentences.length).fill(-1)
  const lastHit: number[] = new Array(sentences.length).fill(-1)
  for (let i = 0; i < map.length; i++) {
    const j = map[i]
    if (j < 0) continue
    const si = owner[i]
    if (firstHit[si] < 0) firstHit[si] = j
    lastHit[si] = j
    out[si].matched++
  }

  /**
   * 由锚点算出句子边界。
   *
   * 之前 start 取「这句第一个匹配上的词」、end 取「最后一个匹配上的词」——
   * 而句首句尾的词经常匹配不上（识别错、人名地名），于是：
   *   start 偏晚 → 这句开头那几个词被划给了上一句
   *   end   偏早 → 这句结尾那几个词被划给了下一句
   * 两头一起偏，播放时听到的就是「上句的尾巴 + 这句的前半」，
   * 整段被切得稀碎，根本听不成完整句子。
   *
   * 改成：两句之间只定**一个**切点，取在上句最后命中词的结束
   * 和下句第一个命中词的开始之间（也就是真正的停顿处）的中点。
   * 这样每句 = [上一个切点, 下一个切点]，既不丢音频，边界也落在停顿上。
   */
  const anchorStart: number[] = new Array(sentences.length).fill(NaN)
  const anchorEnd: number[] = new Array(sentences.length).fill(NaN)
  for (let si = 0; si < sentences.length; si++) {
    if (firstHit[si] >= 0) {
      anchorStart[si] = timed[firstHit[si]].start
      anchorEnd[si] = timed[lastHit[si]].end
    }
  }

  const audioStart = timed.length ? timed[0].start : 0
  // 有真实时长就用真实时长，末尾不留残缺
  const lastWordEnd = timed.length ? timed[timed.length - 1].end : 0
  const audioEnd = totalDuration && totalDuration > lastWordEnd ? totalDuration : lastWordEnd

  // 没有任何命中的句子：在前后锚点之间按句子数均分，先给它一个位置
  for (let si = 0; si < sentences.length; si++) {
    if (!Number.isNaN(anchorStart[si])) continue
    let prev = si - 1
    while (prev >= 0 && Number.isNaN(anchorEnd[prev])) prev--
    let next = si + 1
    while (next < sentences.length && Number.isNaN(anchorStart[next])) next++
    const from = prev >= 0 ? anchorEnd[prev] : audioStart
    const to = next < sentences.length ? anchorStart[next] : audioEnd
    const slots = next - (prev >= 0 ? prev : -1)
    const step = slots > 0 ? (to - from) / slots : 0
    const k = si - (prev >= 0 ? prev : -1)
    anchorStart[si] = from + step * (k - 1)
    anchorEnd[si] = from + step * k
  }

  // 切点：相邻两句之间那段空隙的中点（双语模式下贴到下一句开头）
  const GAP_MARGIN = 0.12   // 切在下一句第一个词之前一点点，别把词头削掉
  const cuts: number[] = new Array(sentences.length + 1)
  cuts[0] = audioStart
  cuts[sentences.length] = audioEnd
  for (let si = 1; si < sentences.length; si++) {
    const gapFrom = anchorEnd[si - 1]
    const gapTo = anchorStart[si]
    if (gapTo < gapFrom) {
      // 锚点交叉（识别乱序）时退回取较大的那个，保证切点单调递增
      cuts[si] = Math.max(gapFrom, gapTo)
    } else if (bilingual) {
      cuts[si] = Math.max(gapFrom, gapTo - GAP_MARGIN)
    } else {
      cuts[si] = (gapFrom + gapTo) / 2
    }
  }
  // 强制单调，避免个别错位让某句时长变成负数
  for (let si = 1; si <= sentences.length; si++) {
    if (cuts[si] < cuts[si - 1]) cuts[si] = cuts[si - 1]
  }

  for (let si = 0; si < sentences.length; si++) {
    out[si].start = Math.round(cuts[si] * 100) / 100
    out[si].end = Math.round(cuts[si + 1] * 100) / 100
    if (bilingual && out[si].matched > 0 && !Number.isNaN(anchorEnd[si])) {
      // 英文读完的位置就是中文开始的位置；夹在本句区间内，别越界
      const z = Math.min(Math.max(anchorEnd[si], out[si].start), out[si].end)
      out[si].zhStart = Math.round(z * 100) / 100
    }
  }

  return out
}

/** 命中率：低于这个值说明转写和文章对不上 */
export function matchRate(timings: SentenceTiming[]): number {
  let m = 0
  let t = 0
  for (const x of timings) {
    m += x.matched
    t += x.total
  }
  return t ? m / t : 0
}

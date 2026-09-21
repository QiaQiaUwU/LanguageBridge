/**
 * 音频文件名 ↔ 章节标题的配对。
 *
 * 单独成文件是为了能直接用 node 跑（audioAlign 里有浏览器依赖，测不了）。
 * 见 tests/audioPair.check.ts。
 */
/**
 * 音频文件名 ↔ 章节标题 自动配对。
 *
 * 一本书几十章、音频也几十个，一个个手动对太麻烦。
 * 这里只做匹配和打分，**不落库** —— 结果要列给用户确认、允许手改，
 * 猜错了直接写进去比不猜还糟。
 */
export interface PairCandidate {
  fileIndex: number
  chapterIndex: number
  score: number
  reason: string
}

/** 归一化：去扩展名、去序号前缀、去标点空格、转小写 */
function normalizeName(s: string): string {
  return s
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/^[\s\-_.]*\d+[\s\-_.、)．]*/, '')
    .replace(/[\s\-_.,，。、（）()【】\[\]#]+/g, '')
    .toLowerCase()
}

/**
 * 取出名字里所有可用来配对的编号。
 *
 * 原来只取第一个 1~3 位数字，"每日听写 8-29" 和 "4320-每日听写 8-1"
 * 都会被读成 8，于是"序号都是 8"把毫不相干的两条配到一起。
 * 现在取全部编号，并且把 8-29 这种成对的数字合成一个键，
 * 这种键才真正能区分不同篇目。
 */
function seqKeysOf(s: string): string[] {
  const base = s.replace(/\.[a-z0-9]{2,4}$/i, '')
  const keys: string[] = []
  // 8-29、9/19 这类成对数字：整体当一个键
  for (const m of base.matchAll(/(?<![0-9])(\d{1,2})[-\/.](\d{1,2})(?![0-9])/g)) {
    keys.push(`${Number(m[1])}-${Number(m[2])}`)
  }
  for (const m of base.matchAll(/(?<![0-9])(\d{1,4})(?![0-9])/g)) keys.push(String(Number(m[1])))
  return [...new Set(keys)]
}

/** 每个键在一侧出现了几次 */
function countKeys(names: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const n of names) for (const k of seqKeysOf(n)) m.set(k, (m.get(k) || 0) + 1)
  return m
}

/** 最长公共子串长度占比 */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const short = a.length <= b.length ? a : b
  const long = a.length <= b.length ? b : a
  let best = 0
  for (let i = 0; i < short.length; i++) {
    for (let j = i + best + 1; j <= short.length; j++) {
      if (long.includes(short.slice(i, j))) best = j - i
      else break
    }
  }
  return best / long.length
}

/**
 * 去掉两边共有的套话。
 *
 * 一批文件常常长得像「每日听写 9-19」「每日听写 8-29」，
 * 「每日听写」四个字人人都有，拿整串算相似度全是 90%，等于没比。
 * 把两边都共有的前后缀去掉，剩下的才是真正用来区分篇目的部分。
 */
function stripBoilerplate(a: string[], b: string[]): { a: string[]; b: string[] } {
  const all = [...a, ...b].filter(Boolean)
  if (all.length < 2) return { a, b }
  const common = (pick: (s: string) => string) => {
    let c = pick(all[0])
    for (const s of all.slice(1)) {
      let i = 0
      while (i < c.length && i < s.length && pick(s)[i] === c[i]) i++
      c = c.slice(0, i)
      if (!c) break
    }
    return c
  }
  const pre = common(s => s)
  const suf = [...common(s => [...s].reverse().join(''))].reverse().join('')
  const cut = (s: string) => {
    let t = s
    if (pre.length >= 2 && t.startsWith(pre)) t = t.slice(pre.length)
    if (suf.length >= 2 && t.endsWith(suf) && t.length - suf.length >= 1) t = t.slice(0, -suf.length)
    return t || s
  }
  return { a: a.map(cut), b: b.map(cut) }
}

export function matchAudioToChapters(
  fileNames: string[],
  chapterTitles: string[]
): PairCandidate[] {
  const norm = stripBoilerplate(fileNames.map(normalizeName), chapterTitles.map(normalizeName))
  const files = norm.a
  const chaps = norm.b
  const fileKeys = fileNames.map(seqKeysOf)
  const chapKeys = chapterTitles.map(seqKeysOf)
  const fileKeyCount = countKeys(fileNames)
  const chapKeyCount = countKeys(chapterTitles)

  const all: PairCandidate[] = []
  for (let f = 0; f < files.length; f++) {
    for (let c = 0; c < chaps.length; c++) {
      const sim = similarity(files[f], chaps[c])
      let score = sim
      let reason = `名称相似 ${Math.round(sim * 100)}%`

      /**
       * 编号一致才是强信号，但要这个编号真的能区分篇目：
       * 成对数字（8-29），或者两边都只出现一次的编号。
       * 满大街都是的 8 只作为很弱的加分，最终还是看名字像不像。
       */
      const shared = fileKeys[f].filter(k => chapKeys[c].includes(k))
      const strong = shared.find(
        k => k.includes('-') || (fileKeyCount.get(k) === 1 && chapKeyCount.get(k) === 1)
      )
      const pct = Math.round(sim * 100)
      if (strong) {
        // 编号对上了也要看名字：同编号的几条之间，名字越像排越前
        score = 0.72 + 0.28 * sim
        reason = `编号 ${strong} · 名称 ${pct}%`
      } else if (shared.length) {
        score = Math.min(0.7, sim + 0.06 * shared.length)
        reason = `名称 ${pct}% · 编号 ${shared.join('、')}`
      } else {
        reason = `名称 ${pct}%`
        // 两边都带编号却没有一个对得上：多半就不是同一篇，别让名字里的套话把它抬上来
        if (fileKeys[f].length && chapKeys[c].length) {
          score *= 0.5
          reason = `名称 ${pct}% · 编号对不上`
        }
      }
      if (score > 0.15) all.push({ fileIndex: f, chapterIndex: c, score, reason })
    }
  }

  // 贪心取最优且互不冲突的配对
  all.sort((a, b) => b.score - a.score)
  const usedFile = new Set<number>()
  const usedChap = new Set<number>()
  const picked: PairCandidate[] = []
  for (const p of all) {
    if (usedFile.has(p.fileIndex) || usedChap.has(p.chapterIndex)) continue
    usedFile.add(p.fileIndex)
    usedChap.add(p.chapterIndex)
    picked.push(p)
  }

  // 都没配上的文件按顺序补给剩下的章节，标成低置信
  const leftFiles = fileNames.map((_, i) => i).filter(i => !usedFile.has(i))
  const leftChaps = chapterTitles.map((_, i) => i).filter(i => !usedChap.has(i))
  for (let k = 0; k < Math.min(leftFiles.length, leftChaps.length); k++) {
    picked.push({
      fileIndex: leftFiles[k],
      chapterIndex: leftChaps[k],
      score: 0.1,
      reason: '没匹配上，按剩余顺序凑'
    })
  }

  return picked.sort((a, b) => a.chapterIndex - b.chapterIndex)
}

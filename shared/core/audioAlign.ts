import { wordDB } from './database'

function audioHandleKey(articleId: string) {
  return `article-audio-${articleId}`
}

export async function pickArticleAudio(articleId: string): Promise<{ name: string } | null> {
  const handle = await (window as any).showOpenFilePicker({
    types: [{ description: '音频文件', accept: { 'audio/*': ['.mp3', '.m4a', '.wav', '.ogg', '.aac'] } }],
    multiple: false
  })
  const fileHandle = handle[0]
  if (!fileHandle) return null
  await wordDB.saveHandle(audioHandleKey(articleId), fileHandle)
  return { name: fileHandle.name }
}

/**
 * 直接存一份音频数据（不是文件句柄）。
 *
 * 从视频里抽出来的音轨、或者不支持 showOpenFilePicker 的浏览器，都走这条路：
 * blob 存进 IndexedDB。句柄那条路只对「用户在磁盘上选的文件」有效。
 */
export async function saveArticleAudioBlob(articleId: string, blob: Blob, name: string): Promise<void> {
  await wordDB.saveHandle(audioHandleKey(articleId), { __blob: blob, name })
}

export async function getArticleAudioFile(articleId: string): Promise<File | null> {
  const handle = await wordDB.getHandle(audioHandleKey(articleId))
  if (!handle) return null
  // 存的是 blob 而不是句柄
  if ((handle as any).__blob) {
    const h = handle as any
    return new File([h.__blob], h.name || 'audio.wav', { type: h.__blob.type || 'audio/wav' })
  }
  try {
    const opts = { mode: 'read' as const }
    let perm = await handle.queryPermission(opts)
    if (perm !== 'granted') perm = await handle.requestPermission(opts)
    if (perm !== 'granted') return null
    return await handle.getFile()
  } catch {
    return null
  }
}

export async function clearArticleAudio(articleId: string): Promise<void> {
  await wordDB.deleteHandle(audioHandleKey(articleId))
}

export function audioPickerSupported(): boolean {
  return typeof (window as any).showOpenFilePicker === 'function'
}

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

/** 取出名字里的数字序号，优先用它配对 */
function seqOf(s: string): number | null {
  const m = s.match(/(?:^|[^0-9])(\d{1,3})(?:[^0-9]|$)/)
  return m ? parseInt(m[1], 10) : null
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

export function matchAudioToChapters(
  fileNames: string[],
  chapterTitles: string[]
): PairCandidate[] {
  const files = fileNames.map(normalizeName)
  const chaps = chapterTitles.map(normalizeName)
  const fileSeq = fileNames.map(seqOf)
  const chapSeq = chapterTitles.map(seqOf)

  const all: PairCandidate[] = []
  for (let f = 0; f < files.length; f++) {
    for (let c = 0; c < chaps.length; c++) {
      const sim = similarity(files[f], chaps[c])
      let score = sim
      let reason = `名称相似 ${Math.round(sim * 100)}%`

      // 序号一致是很强的信号，直接抬到高分
      if (fileSeq[f] != null && fileSeq[f] === chapSeq[c]) {
        score = Math.max(score, 0.9)
        reason = `序号都是 ${fileSeq[f]}`
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

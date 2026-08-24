import { wordDB } from './database'

function audioHandleKey(articleId: string) {
  return `article-audio-${articleId}`
}

/**
 * 选一个音频关联到文章。
 *
 * **存的是文件内容，不是文件句柄。**
 *
 * 原来存的是句柄（一个指向你磁盘上那个文件的引用）。两个问题：
 *   1. 权限活不过重启 —— 重开应用要重新授权，而自动加载没有用户手势，
 *      要不到权限，界面上就只剩一句「已关联 xxx.wav」，播放器凭空消失
 *   2. 原文件一旦移动、改名、删除，或者换台电脑，关联就断了
 *
 * 从视频抽出来的音轨本来就是直接存 blob（saveArticleAudioBlob），
 * 两条路径没有理由不一样。现在统一：选完立刻读进来存下，
 * 之后不再依赖磁盘上那个文件，也永远不用再授权。
 *
 * 代价是占空间（一份音频存两遍：你的原文件 + 库里这份）。
 * 但音频对轴、跟读、逐句播放全都要随时能读到它，
 * 这个代价换的是"打开就能用"，值。
 */
/**
 * 只负责让用户选一个音频文件，把 File 交出去。
 * 存到哪由调用方决定（现在是上传给后端，见 articleAudio.ts）。
 */
export async function pickArticleAudioFile(): Promise<File | null> {
  const handle = await (window as any).showOpenFilePicker({
    types: [{ description: '音频文件', accept: { 'audio/*': ['.mp3', '.m4a', '.wav', '.ogg', '.aac'] } }],
    multiple: false
  })
  const fileHandle = handle[0]
  if (!fileHandle) return null
  return await fileHandle.getFile()
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

/**
 * 取文章关联的音频。
 *
 * `interactive` 决定要不要向用户弹权限请求。
 *
 * 为什么要分：文件句柄（用户在磁盘上选的文件）存进 IndexedDB 之后能活过重启，
 * 但**权限活不过**——重开应用第一次读它，浏览器/Electron 给的是 'prompt'，
 * 必须 `requestPermission` 重新要一次，而这个调用**只在用户手势里才允许**。
 * 打开文章时的自动加载没有手势，request 会直接失败或抛错，
 * 结果就是：界面上写着「已关联 xxx.wav」，播放器和对轴列表却一个都不出现，
 * 也没有任何解释。
 *
 * 所以自动加载走 interactive=false，只查不要；查出来没权限就返回
 * 'need-permission'，让界面显示一个按钮，用户点了再带着手势去要。
 */
export type AudioLoadResult =
  | { kind: 'ok'; file: File }
  | { kind: 'none' }
  | { kind: 'need-permission' }

export async function getArticleAudio(
  articleId: string,
  interactive = false
): Promise<AudioLoadResult> {
  const handle = await wordDB.getHandle(audioHandleKey(articleId))
  if (!handle) return { kind: 'none' }

  // 存的是 blob 而不是句柄：从视频抽的音轨走这条，没有权限问题
  if ((handle as any).__blob) {
    const h = handle as any
    return {
      kind: 'ok',
      file: new File([h.__blob], h.name || 'audio.wav', { type: h.__blob.type || 'audio/wav' })
    }
  }

  try {
    const opts = { mode: 'read' as const }
    let perm = await handle.queryPermission(opts)
    if (perm !== 'granted') {
      if (!interactive) return { kind: 'need-permission' }
      perm = await handle.requestPermission(opts)
    }
    if (perm !== 'granted') return { kind: 'need-permission' }
    return { kind: 'ok', file: await handle.getFile() }
  } catch {
    // 句柄还在但读不动了（文件被移动/删除、或环境不支持这套 API）
    return { kind: 'need-permission' }
  }
}

/** 老签名，保留给还没改的调用方 */
export async function getArticleAudioFile(articleId: string): Promise<File | null> {
  const r = await getArticleAudio(articleId, true)
  return r.kind === 'ok' ? r.file : null
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

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

export { matchAudioToChapters, type PairCandidate } from './audioPairing'


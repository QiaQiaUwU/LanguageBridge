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

export async function getArticleAudioFile(articleId: string): Promise<File | null> {
  const handle = await wordDB.getHandle(audioHandleKey(articleId))
  if (!handle) return null
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

import { wordDB } from './database'

/**
 * 释义库文件夹关联（免复制）
 *
 * 之前的做法是用 node 脚本把释义库 JSON 复制进项目的 public/data 目录，
 * 释义库有几千上万个文件时会白白占用一份磁盘空间。
 * 这里改用 File System Access API：你只需要在浏览器里选一次那个文件夹，
 * 之后每次都直接读取原始位置的文件，不做任何复制。
 * 仅 Chrome / Edge 支持（跟"听力材料"用的是同一套 API）。
 */

export const libraryFolderSupported = 'showDirectoryPicker' in window

const HANDLE_KEY = 'explanationLibraryFolder'
const INDEX_KEY = 'lb_explanation_library_index' // localStorage：word -> 文件名 的映射（很小，可以直接存localStorage）
const META_KEY = 'lb_explanation_library_meta' // 文件夹名、词条数等元信息

export interface LibraryMeta {
  folderName: string
  wordCount: number
  scannedAt: string
}

let cachedHandle: FileSystemDirectoryHandle | null = null
let cachedIndex: Record<string, string> | null = null

function loadIndexFromStorage(): Record<string, string> {
  if (cachedIndex) return cachedIndex
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    cachedIndex = raw ? JSON.parse(raw) : {}
  } catch {
    cachedIndex = {}
  }
  return cachedIndex || {}
}

function saveIndexToStorage(index: Record<string, string>) {
  cachedIndex = index
  localStorage.setItem(INDEX_KEY, JSON.stringify(index))
}

export function getLibraryMeta(): LibraryMeta | null {
  try {
    const raw = localStorage.getItem(META_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveLibraryMeta(meta: LibraryMeta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta))
}

/** 弹出文件夹选择框，选完之后记住授权（存进 IndexedDB），不复制任何文件 */
export async function pickLibraryFolder(): Promise<FileSystemDirectoryHandle> {
  const handle = await (window as any).showDirectoryPicker()
  await wordDB.saveHandle(HANDLE_KEY, handle)
  cachedHandle = handle
  return handle
}

/** 取出之前关联过的文件夹句柄，会话间持久化；权限被收回时会重新弹一次授权确认 */
export async function getLibraryFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (cachedHandle) return cachedHandle
  const handle = await wordDB.getHandle(HANDLE_KEY)
  if (!handle) return null
  try {
    const opts = { mode: 'read' as const }
    let perm = await handle.queryPermission(opts)
    if (perm !== 'granted') {
      perm = await handle.requestPermission(opts)
    }
    if (perm !== 'granted') return null
    cachedHandle = handle
    return handle
  } catch {
    return null
  }
}

export async function clearLibraryFolder() {
  await wordDB.deleteHandle(HANDLE_KEY)
  localStorage.removeItem(INDEX_KEY)
  localStorage.removeItem(META_KEY)
  cachedHandle = null
  cachedIndex = null
}

export interface ScanDiagnostics {
  totalFiles: number
  jsonFiles: number
  parsedOk: number
  parsedFailed: number
  sampleErrors: string[]
}

/**
 * 扫描文件夹，建立"单词 → 文件名"的索引（不读完整内容存起来，只存这个很小的映射）。
 * 文件名是哈希值看不出对应哪个单词，所以必须打开每个文件读一下 word 字段，
 * 这一步不可避免要读一遍全部文件，但读完只留一个 KB 级别的映射表，原始文件不会被复制。
 * 支持子目录递归（有些释义库会按字母/分类分文件夹存放）。
 */
export async function scanLibraryFolder(
  handle: FileSystemDirectoryHandle,
  onProgress?: (done: number) => void
): Promise<LibraryMeta & { diagnostics: ScanDiagnostics }> {
  const index: Record<string, string> = {}
  const diag: ScanDiagnostics = { totalFiles: 0, jsonFiles: 0, parsedOk: 0, parsedFailed: 0, sampleErrors: [] }
  let count = 0

  async function walk(dir: FileSystemDirectoryHandle, prefix: string) {
    for await (const [name, entryHandle] of (dir as any).entries()) {
      if (entryHandle.kind === 'directory') {
        await walk(entryHandle, prefix ? `${prefix}/${name}` : name)
        continue
      }
      diag.totalFiles++
      if (!name.toLowerCase().endsWith('.json')) continue
      diag.jsonFiles++
      const relPath = prefix ? `${prefix}/${name}` : name
      try {
        const file = await entryHandle.getFile()
        const data = JSON.parse(await file.text())
        const word = String(data.word || '').toLowerCase().trim()
        if (word) {
          index[word] = relPath
          diag.parsedOk++
        } else {
          diag.parsedFailed++
          if (diag.sampleErrors.length < 5) diag.sampleErrors.push(`${relPath}：没有 word 字段`)
        }
      } catch (e) {
        diag.parsedFailed++
        if (diag.sampleErrors.length < 5) {
          diag.sampleErrors.push(`${relPath}：${e instanceof Error ? e.message : '解析失败'}`)
        }
      }
      count++
      if (count % 200 === 0) onProgress?.(count)
    }
  }

  await walk(handle, '')
  saveIndexToStorage(index)
  const meta: LibraryMeta = {
    folderName: handle.name,
    wordCount: Object.keys(index).length,
    scannedAt: new Date().toISOString()
  }
  saveLibraryMeta(meta)
  onProgress?.(count)
  return { ...meta, diagnostics: diag }
}

/** 按文件相对路径（可能带子目录前缀）读取一个文件句柄下的文件 */
async function getFileByRelPath(root: FileSystemDirectoryHandle, relPath: string): Promise<FileSystemFileHandle> {
  const parts = relPath.split('/')
  let dir = root
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i])
  }
  return dir.getFileHandle(parts[parts.length - 1])
}

/** 按单词查找并读取释义内容（每次都是从原始文件夹直接读取） */
export async function getExplanationByWord(word: string): Promise<any | null> {
  const handle = await getLibraryFolderHandle()
  if (!handle) return null
  const index = loadIndexFromStorage()
  const relPath = index[word.toLowerCase().trim()]
  if (!relPath) return null
  try {
    const fileHandle = await getFileByRelPath(handle, relPath)
    const file = await fileHandle.getFile()
    return JSON.parse(await file.text())
  } catch {
    return null
  }
}

/** 遍历索引里全部单词对应的释义内容（供"导入完整释义库"使用），分批读取避免一次性占用过多内存 */
export async function* iterateAllExplanations(
  handle: FileSystemDirectoryHandle
): AsyncGenerator<any, void, unknown> {
  const index = loadIndexFromStorage()
  for (const relPath of Object.values(index)) {
    try {
      const fileHandle = await getFileByRelPath(handle, relPath)
      const file = await fileHandle.getFile()
      yield JSON.parse(await file.text())
    } catch {
      /* 跳过 */
    }
  }
}

export function getIndexedWordCount(): number {
  return Object.keys(loadIndexFromStorage()).length
}

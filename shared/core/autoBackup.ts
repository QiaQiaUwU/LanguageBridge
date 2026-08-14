import { wordDB } from './database'

/**
 * 数据备份（客户端版本）
 *
 * 上一版我说"参考 MyLibrary 的 _auto_backup 加个数据库自动备份"，被正确地指出这站不住脚——
 * MyLibrary 是 Python 后端，有真实文件系统能定期写备份文件；LanguageBridge 没有后端，
 * 所有数据都在浏览器的 IndexedDB 里，服务器（scripts/server.mjs）只是个静态文件服务器+AI转发，
 * 完全不碰用户数据，没有地方能替你"在后端定期写文件"。
 *
 * 能做的对等方案：用 File System Access API（跟"关联释义库文件夹"同一套技术）
 * 让你选一个本地文件夹，之后由浏览器自己定期把全部数据写一份 JSON 快照进去——
 * 本质还是客户端写本地文件，只是流程上做到"选一次之后不用再手动点"。
 */

const HANDLE_KEY = 'autoBackupFolder'
const LAST_BACKUP_KEY = 'lb_last_backup_at'
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000 // 每 24 小时最多自动备份一次
const KEEP_LAST_N = 14 // 保留最近 14 份，避免文件夹里无限堆积

export interface BackupMeta {
  folderName: string
  lastBackupAt: string
}

export async function pickBackupFolder(): Promise<FileSystemDirectoryHandle> {
  const handle = await (window as any).showDirectoryPicker()
  await wordDB.saveHandle(HANDLE_KEY, handle)
  return handle
}

export async function getBackupFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await wordDB.getHandle(HANDLE_KEY)
  if (!handle) return null
  try {
    const opts = { mode: 'readwrite' as const }
    let perm = await handle.queryPermission(opts)
    if (perm !== 'granted') perm = await handle.requestPermission(opts)
    return perm === 'granted' ? handle : null
  } catch {
    return null
  }
}

export async function clearBackupFolder() {
  await wordDB.deleteHandle(HANDLE_KEY)
  localStorage.removeItem(LAST_BACKUP_KEY)
}

export function getBackupMeta(): { lastBackupAt: string | null } {
  return { lastBackupAt: localStorage.getItem(LAST_BACKUP_KEY) }
}

/** 收集全部数据（词库/词书/文章/文章分组/学习活动/待办/习惯），打成一份 JSON */
async function buildFullBackup() {
  const [words, groups, articles, articleGroups, activity, todos, habits] = await Promise.all([
    wordDB.getAllWords(),
    wordDB.getAllGroups(),
    wordDB.getAllArticles(),
    wordDB.getAllArticleGroups(),
    wordDB.getAllActivity(),
    wordDB.getAllTodos(),
    wordDB.getAllHabits()
  ])
  return {
    kind: 'languagebridge-full-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    words,
    groups,
    articles,
    articleGroups,
    activity,
    todos,
    habits
  }
}

/** 立即备份一次（手动触发或到点自动触发都走这个） */
export async function backupNow(): Promise<{ ok: boolean; error?: string; fileName?: string }> {
  const handle = await getBackupFolderHandle()
  if (!handle) return { ok: false, error: '还没关联备份文件夹' }
  try {
    const data = await buildFullBackup()
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const fileName = `LanguageBridge-backup-${stamp}.json`
    const fileHandle = await handle.getFileHandle(fileName, { create: true })
    const writable = await (fileHandle as any).createWritable()
    await writable.write(JSON.stringify(data))
    await writable.close()
    localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString())
    await pruneOldBackups(handle)
    return { ok: true, fileName }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '备份失败' }
  }
}

/** 只保留最近 N 份备份，删掉更早的，避免文件夹无限变大 */
async function pruneOldBackups(handle: FileSystemDirectoryHandle) {
  try {
    const names: string[] = []
    for await (const [name, entry] of (handle as any).entries()) {
      if (entry.kind === 'file' && name.startsWith('LanguageBridge-backup-') && name.endsWith('.json')) {
        names.push(name)
      }
    }
    names.sort() // 文件名带时间戳，字典序即时间序
    const toDelete = names.slice(0, Math.max(0, names.length - KEEP_LAST_N))
    for (const name of toDelete) {
      await (handle as any).removeEntry(name)
    }
  } catch {
    /* 清理失败不影响本次备份是否成功 */
  }
}

/** 到点了就自动备份一次（App.vue 启动时调用），没关联文件夹或还没到 24 小时就什么都不做 */
export async function maybeAutoBackup() {
  const handle = await getBackupFolderHandle()
  if (!handle) return
  const last = localStorage.getItem(LAST_BACKUP_KEY)
  if (last && Date.now() - new Date(last).getTime() < BACKUP_INTERVAL_MS) return
  await backupNow()
}

export interface RestoreResult {
  ok: boolean
  error?: string
  articlesRestored: number
  articleGroupsRestored: number
  wordsRestored: number
  groupsRestored: number
}

/** 从备份 JSON 文件恢复：只补本地 IndexedDB 缺的（按 id 判断），不会覆盖或删除本地已有的
 *  任何一条数据——原则跟"从后端恢复"一样，只做加法。这个是这份备份机制原来没有对应的
 *  "读回来"功能，只有"写出去"（backupNow），现在补上。
 *  todos/habits/activity 这次没做——它们的 id 是数据库自增的，"这条是不是已经存在"这个判断
 *  没有 articles/words 那么直接，为了不在紧急恢复的时候引入新的重复数据风险，先只做
 *  内容本身有稳定 id、被别的数据引用（比如 article.groupId）的这几类。 */
export async function restoreFromBackupFile(file: File): Promise<RestoreResult> {
  const empty: RestoreResult = { ok: false, articlesRestored: 0, articleGroupsRestored: 0, wordsRestored: 0, groupsRestored: 0 }
  let data: any
  try {
    data = JSON.parse(await file.text())
  } catch {
    return { ...empty, error: '这个文件不是有效的 JSON，确认选的是 LanguageBridge-backup-*.json' }
  }
  if (data?.kind !== 'languagebridge-full-backup') {
    return { ...empty, error: '这个文件看起来不是 LanguageBridge 的备份文件（kind 字段对不上）' }
  }

  const [localArticles, localArticleGroups, localWords, localGroups] = await Promise.all([
    wordDB.getAllArticles(),
    wordDB.getAllArticleGroups(),
    wordDB.getAllWords(),
    wordDB.getAllGroups()
  ])
  const localArticleIds = new Set(localArticles.map((a: any) => a.id))
  const localArticleGroupIds = new Set(localArticleGroups.map((g: any) => g.id))
  const localWordIds = new Set(localWords.map((w: any) => w.id))
  const localGroupIds = new Set(localGroups.map((g: any) => g.id))

  let articlesRestored = 0
  let articleGroupsRestored = 0
  let wordsRestored = 0
  let groupsRestored = 0

  for (const g of data.articleGroups || []) {
    if (!localArticleGroupIds.has(g.id)) { await wordDB.saveArticleGroup(g); articleGroupsRestored++ }
  }
  for (const a of data.articles || []) {
    if (!localArticleIds.has(a.id)) { await wordDB.saveArticle(a); articlesRestored++ }
  }
  for (const g of data.groups || []) {
    if (!localGroupIds.has(g.id)) { await wordDB.saveGroup(g); groupsRestored++ }
  }
  for (const w of data.words || []) {
    if (!localWordIds.has(w.id)) { await wordDB.saveWord(w); wordsRestored++ }
  }

  return { ok: true, articlesRestored, articleGroupsRestored, wordsRestored, groupsRestored }
}

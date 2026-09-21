/**
 * 阅读里划出来的生词收进哪个词表。
 *
 * 结构是两层：文件夹（或手动指定的词表）→ 这篇文章 / 这本书。
 * 书里的章节不再各自单开一个词表，而是跟着书走：
 *   - 文件夹取书的分组（章节自己的 groupId 可能没跟上，以书为准）
 *   - 词表取书这一本，名字是书名
 * 原来按章节开的、落在「未分组生词」里的，用 relocateReadingVocab 搬过去。
 */
import type { Article } from '@/shared/types/Article'
import type { useWordStore } from '@/shared/stores/wordStore'
import type { useReaderStore } from './stores/readerStore'

type WordStore = ReturnType<typeof useWordStore>
type ReaderStore = ReturnType<typeof useReaderStore>

export const UNGROUPED_ROOT = 'book-notes-ungrouped'
const AUTO_ROOT_PREFIX = 'book-notes-'
const LIST_PREFIX = 'book-reading-'

export interface VocabTarget {
  rootId: string
  rootName: string
  rootDesc: string
  /** 根是自动建的（文件夹同名 / 未分组），不是用户手动指定的词表 */
  autoRoot: boolean
  listId: string
  listName: string
  listDesc: string
  /** 这篇是书里的一章，生词记在书上 */
  viaBook: boolean
}

/** 这篇文章的生词归谁：书里的章节归书，其余归自己 */
export function vocabOwner(a: Article, reader: ReaderStore): Article {
  if (a.partOfBook) {
    const book = reader.articles.find(x => x.id === a.partOfBook)
    if (book) return book
  }
  return a
}

export function vocabTargetOf(a: Article, reader: ReaderStore, words: WordStore): VocabTarget {
  const owner = vocabOwner(a, reader)
  const viaBook = owner.id !== a.id
  const listId = LIST_PREFIX + owner.id
  const listName = owner.title
  const listDesc = viaBook || owner.isBook ? `来自《${owner.title}》的标注生词` : `来自文章《${owner.title}》的标注生词`

  // 手动指定的词表：书上指定的优先，其次是这一章自己的
  const manualId = [owner.vocabBookId, a.vocabBookId].find(id => id && words.groups.some(g => g.id === id))
  if (manualId) {
    const g = words.groups.find(x => x.id === manualId)!
    return { rootId: manualId, rootName: g.name, rootDesc: g.description || '', autoRoot: false, listId, listName, listDesc, viaBook }
  }

  const folderId = owner.groupId || a.groupId
  const folder = folderId ? reader.groups.find(g => g.id === folderId) : null
  return folder
    ? {
        rootId: `${AUTO_ROOT_PREFIX}for-artgroup-${folder.id}`, rootName: folder.name,
        rootDesc: `来自文章文件夹「${folder.name}」的划线生词`, autoRoot: true, listId, listName, listDesc, viaBook
      }
    : {
        rootId: UNGROUPED_ROOT, rootName: '未分组生词', rootDesc: '没有归到具体文件夹的文章生词',
        autoRoot: true, listId, listName, listDesc, viaBook
      }
}

/** 建好（或校正）两层词表，返回下层词表的 id */
export async function ensureVocabTarget(t: VocabTarget, words: WordStore): Promise<string> {
  const now = new Date().toISOString()
  const root = words.groups.find(g => g.id === t.rootId)
  if (!root) {
    await words.createGroup({ id: t.rootId, name: t.rootName, description: t.rootDesc, wordIds: [], createdAt: now, updatedAt: now })
  } else if (t.autoRoot && root.name !== t.rootName) {
    // 文件夹改了名，词表跟着改
    await words.updateGroup(t.rootId, { name: t.rootName })
  }
  const list = words.groups.find(g => g.id === t.listId)
  if (!list) {
    await words.createGroup({
      id: t.listId, name: t.listName, description: t.listDesc, parentId: t.rootId,
      wordIds: [], createdAt: now, updatedAt: now
    })
  } else {
    const patch: Record<string, string> = {}
    if (list.parentId !== t.rootId) patch.parentId = t.rootId
    if (list.name !== t.listName) patch.name = t.listName
    if (Object.keys(patch).length) await words.updateGroup(t.listId, patch)
  }
  return t.listId
}

/**
 * 把已有的阅读生词词表搬到该在的位置。
 *
 * 两种情况要搬：
 *  - 书里的章节原来各开一个词表 → 并进书的词表，章节词表删掉
 *  - 文章 / 书换了文件夹，词表还挂在旧的根下 → 挂到新根下
 * 词从旧根里拿掉（旧根下别的词表还用着的除外），自动建的根空了就删掉。
 * 幂等：已经在对的位置的不动。返回搬了几个词。
 */
let relocating: Promise<number> | null = null
export function relocateReadingVocab(words: WordStore, reader: ReaderStore): Promise<number> {
  // 词汇中心和阅读助手都会调；同时进来的共用一次，别两边一起搬
  if (!relocating) relocating = doRelocate(words, reader).finally(() => { relocating = null })
  return relocating
}

async function doRelocate(words: WordStore, reader: ReaderStore): Promise<number> {
  let moved = 0
  const lists = words.groups.filter(g => g.id.startsWith(LIST_PREFIX) && g.parentId)
  const touchedRoots = new Set<string>()

  for (const g of lists) {
    const art = reader.articles.find(a => a.id === g.id.slice(LIST_PREFIX.length))
    if (!art) continue
    const t = vocabTargetOf(art, reader, words)
    if (g.id === t.listId && g.parentId === t.rootId) continue

    const oldRoot = g.parentId!
    const ids = [...g.wordIds]
    await ensureVocabTarget(t, words)
    for (const id of ids) {
      await words.addWordToGroup(id, t.listId)
      await words.addWordToGroup(id, t.rootId)
    }
    if (g.id !== t.listId) await words.deleteGroup(g.id)
    moved += ids.length

    if (oldRoot !== t.rootId) {
      touchedRoots.add(oldRoot)
      const stillUsed = new Set(words.groups.filter(x => x.parentId === oldRoot).flatMap(x => x.wordIds))
      for (const id of ids) if (!stillUsed.has(id)) await words.removeWordFromGroup(id, oldRoot)
    }
  }

  // 自动建的根，搬空了就删掉，免得词汇中心里挂一个 0 词的「未分组生词」
  for (const rid of touchedRoots) {
    if (!rid.startsWith(AUTO_ROOT_PREFIX)) continue
    const root = words.groups.find(x => x.id === rid)
    const hasKids = words.groups.some(x => x.parentId === rid)
    if (root && !hasKids && !root.wordIds.length) await words.deleteGroup(rid)
  }
  return moved
}

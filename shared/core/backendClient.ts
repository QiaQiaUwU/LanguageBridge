import type { Article, ArticleGroup } from '@/shared/types/Article'
import type { WordItem, WordGroup } from '@/shared/types/WordItem'

const BACKEND_BASE = ''
const TIMEOUT_MS = 2500

async function beFetch<T>(path: string, options?: RequestInit): Promise<T | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BACKEND_BASE}${path}`, { ...options, signal: controller.signal })
    if (!res.ok) return null
    const text = await res.text()
    return text ? (JSON.parse(text) as T) : (null as T)
  } catch {
    return null // fetch 本身失败（连不上/超时/CORS），当"这次没同步上"处理，不是错误
  } finally {
    clearTimeout(timer)
  }
}

export async function beIsAvailable(): Promise<boolean> {
  const r = await beFetch<{ ok: boolean }>('/api/health')
  return !!r?.ok
}

export async function beListArticles(): Promise<Article[] | null> {
  return beFetch<Article[]>('/api/articles')
}

export async function beSaveArticle(article: Article): Promise<boolean> {
  const r = await beFetch(`/api/articles/${encodeURIComponent(article.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(article)
  })
  return r !== null
}

export async function beDeleteArticle(id: string): Promise<boolean> {
  const r = await beFetch(`/api/articles/${encodeURIComponent(id)}`, { method: 'DELETE' })
  return r !== null
}

export async function beListArticleGroups(): Promise<ArticleGroup[] | null> {
  return beFetch<ArticleGroup[]>('/api/article-groups')
}

export async function beSaveArticleGroup(group: ArticleGroup): Promise<boolean> {
  const r = await beFetch(`/api/article-groups/${encodeURIComponent(group.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: group.name })
  })
  return r !== null
}

export async function beDeleteArticleGroup(id: string): Promise<boolean> {
  const r = await beFetch(`/api/article-groups/${encodeURIComponent(id)}`, { method: 'DELETE' })
  return r !== null
}

const AUDIO_BACKEND_BASE = 'http://127.0.0.1:8787'

export async function beUploadAudio(articleId: string, file: File): Promise<{ audioFileName: string } | null> {
  const form = new FormData()
  form.append('file', file)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${AUDIO_BACKEND_BASE}/api/articles/${encodeURIComponent(articleId)}/audio`, {
      method: 'POST',
      body: form,
      signal: controller.signal
    })
    if (!res.ok) return null
    return (await res.json()) as { audioFileName: string }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function beAudioUrl(articleId: string): string {
  return `${AUDIO_BACKEND_BASE}/api/articles/${encodeURIComponent(articleId)}/audio`
}

export async function beDeleteAudio(articleId: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${AUDIO_BACKEND_BASE}/api/articles/${encodeURIComponent(articleId)}/audio`, {
      method: 'DELETE',
      signal: controller.signal
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function beAlignAudio(articleId: string): Promise<{ sentences: Article['sentences'] } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000) // 10分钟，长文章+慢机器留够余量
  try {
    const res = await fetch(`${AUDIO_BACKEND_BASE}/api/articles/${encodeURIComponent(articleId)}/align`, {
      method: 'POST',
      signal: controller.signal
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(detail || `对齐失败（HTTP ${res.status}）`)
    }
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

export async function beListWords(): Promise<WordItem[] | null> {
  return await beFetch('/api/words')
}

export async function beListWordGroups(): Promise<WordGroup[] | null> {
  return await beFetch('/api/word-groups')
}

export async function beBulkSaveWords(words: WordItem[]): Promise<boolean> {
  if (!words.length) return true
  const r = await beFetch('/api/words/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(words)
  })
  return r !== null
}

export async function bePatchWordLibrary(
  updates: {
    word: string
    exam_tags?: string[]
    topics?: string[]
    morphemes?: unknown
    word_family?: string[]
    create?: boolean
    phonetic?: string
    pos_definitions?: unknown[]
    example_sentences?: unknown[]
    source?: string
  }[]
): Promise<{ patched: number; skipped: number } | null> {
  if (!updates.length) return { patched: 0, skipped: 0 }
  return await beFetch('/api/word-explanations/patch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates })
  })
}

export async function beRebuildWordCache(): Promise<
  { ok: boolean; total: number; fromLib: number; keptLocalOnly: number; reason?: string } | null
> {
  return await beFetch('/api/word-explanations/rebuild-cache', { method: 'POST' })
}

export async function beReindexWordLibrary(): Promise<{ count: number; ms: number } | null> {
  return await beFetch('/api/word-explanations/reindex', { method: 'POST' })
}

export async function beBulkSaveWordGroups(groups: WordGroup[]): Promise<boolean> {
  if (!groups.length) return true
  const r = await beFetch('/api/word-groups/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(groups)
  })
  return r !== null
}

export async function beGetExplanationTags(): Promise<Record<string, string[]> | null> {
  return await beFetch('/api/word-explanations/tags')
}

export async function beListFsrs(): Promise<{ id: string; card: any }[] | null> {
  return await beFetch('/api/fsrs')
}

export async function beBulkSaveFsrs(rows: { id: string; card: any }[]): Promise<boolean> {
  if (!rows.length) return true
  const r = await beFetch('/api/fsrs/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rows)
  })
  return r !== null
}

export async function beListMastered(): Promise<{ id: string }[] | null> {
  return await beFetch('/api/mastered')
}

export async function beBulkSaveMastered(rows: { id: string }[]): Promise<boolean> {
  if (!rows.length) return true
  const r = await beFetch('/api/mastered/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rows)
  })
  return r !== null
}

export async function beDeleteMastered(id: string): Promise<boolean> {
  const r = await beFetch(`/api/mastered/${encodeURIComponent(id)}`, { method: 'DELETE' })
  return r !== null
}

export async function beSaveWord(word: WordItem): Promise<boolean> {
  const r = await beFetch(`/api/words/${encodeURIComponent(word.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(word)
  })
  return r !== null
}

export async function beDeleteWord(id: string): Promise<boolean> {
  const r = await beFetch(`/api/words/${encodeURIComponent(id)}`, { method: 'DELETE' })
  return r !== null
}

export async function beSaveWordGroup(group: WordGroup): Promise<boolean> {
  const r = await beFetch(`/api/word-groups/${encodeURIComponent(group.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(group)
  })
  return r !== null
}

export async function beDeleteWordGroup(id: string): Promise<boolean> {
  const r = await beFetch(`/api/word-groups/${encodeURIComponent(id)}`, { method: 'DELETE' })
  return r !== null
}

export async function beSaveTodo(todo: { id: number; text: string; due: string; done: boolean; createdAt: string }): Promise<boolean> {
  const r = await beFetch(`/api/todos/${todo.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(todo)
  })
  return r !== null
}

export async function beDeleteTodo(id: number): Promise<boolean> {
  const r = await beFetch(`/api/todos/${id}`, { method: 'DELETE' })
  return r !== null
}

export async function bePatchTodoDone(id: number, done: boolean): Promise<boolean> {
  const r = await beFetch(`/api/todos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ done })
  })
  return r !== null
}

export async function beSaveActivity(record: {
  date: string
  newWords: number
  reviewCount: number
  correctCount: number
  minutesActive: number
}): Promise<boolean> {
  const r = await beFetch(`/api/activity/${encodeURIComponent(record.date)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record)
  })
  return r !== null
}

export async function beSaveHabit(habit: {
  id: number
  name: string
  goal: number
  medalAt: string
  createdAt: string
}): Promise<boolean> {
  const r = await beFetch(`/api/habits/${habit.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(habit)
  })
  return r !== null
}

export async function beDeleteHabit(id: number): Promise<boolean> {
  const r = await beFetch(`/api/habits/${id}`, { method: 'DELETE' })
  return r !== null
}

export async function beCheckinHabit(id: number, date: string): Promise<boolean> {
  const r = await beFetch(`/api/habits/${id}/checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date })
  })
  return r !== null
}

import type { WordItem, WordGroup } from '@/shared/types/WordItem'

export type ScopeKind = 'all' | 'group' | 'tag' | 'adhoc'

export interface StudyScope {
  kind: ScopeKind
  groupId?: string
  tag?: string
  ids?: string[]
  label: string
}

const SCOPE_KEY = 'lb-study-scope'
const LEGACY_IDS_KEY = 'lb-adhoc-study'

export function studyRoute(scope: StudyScope, mode?: 'free' | 'review'): string {
  const q = new URLSearchParams()
  if (scope.kind === 'group' && scope.groupId) q.set('group', scope.groupId)
  else if (scope.kind === 'tag' && scope.tag) q.set('scope', 'tag')
  else if (scope.kind === 'adhoc') q.set('scope', 'adhoc')
  if (mode) q.set('mode', mode)
  const s = q.toString()
  return s ? `/study?${s}` : '/study'
}

export function commitScope(scope: StudyScope): string {
  if (scope.kind === 'adhoc' || scope.kind === 'tag') {
    try {
      sessionStorage.setItem(SCOPE_KEY, JSON.stringify(scope))
    } catch {
    }
  } else {
    try { sessionStorage.removeItem(SCOPE_KEY) } catch { /* 同上 */ }
  }
  return studyRoute(scope)
}

export function readScope(query: Record<string, any>): StudyScope {
  const kindParam = String(query.scope || '')
  const groupId = String(query.group || '')

  if (kindParam === 'adhoc' || kindParam === 'tag') {
    try {
      const raw = sessionStorage.getItem(SCOPE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as StudyScope
        if (parsed && (parsed.kind === 'adhoc' || parsed.kind === 'tag')) return parsed
      }
    } catch {
    }
    if (kindParam === 'adhoc') {
      try {
        const raw = sessionStorage.getItem(LEGACY_IDS_KEY)
        if (raw) {
          const ids = JSON.parse(raw)
          if (Array.isArray(ids)) return { kind: 'adhoc', ids: ids.map(String), label: `临时范围 · ${ids.length} 词` }
        }
      } catch {
      }
    }
    return { kind: 'all', label: '全部单词' }
  }

  if (groupId) return { kind: 'group', groupId, label: '' }
  return { kind: 'all', label: '全部单词' }
}

export function wordsOfScope(scope: StudyScope, allWords: WordItem[], groups: WordGroup[]): WordItem[] {
  if (scope.kind === 'adhoc') {
    const want = new Set(scope.ids || [])
    return allWords.filter(w => want.has(w.id))
  }
  if (scope.kind === 'tag') {
    const tags = String(scope.tag || '').split(' + ').map(x => x.trim()).filter(Boolean)
    if (!tags.length) return allWords
    const hit = (w: WordItem, t: string) => {
      if (w.tags?.includes(t)) return true
      if (w.topics?.includes(t)) return true
      const m = w.morphemes
      return !!m && [m.prefix?.form, m.root?.form, m.suffix?.form].includes(t)
    }
    return allWords.filter(w => tags.every(t => hit(w, t)))
  }
  if (scope.kind === 'group' && scope.groupId) {
    const g = groups.find(x => x.id === scope.groupId)
    if (!g) return allWords
    const ids = new Set(g.wordIds)
    return allWords.filter(w => ids.has(w.id))
  }
  return allWords
}

export function groupOfScope(scope: StudyScope, groups: WordGroup[]): WordGroup | null {
  if (scope.kind !== 'group' || !scope.groupId) return null
  return groups.find(g => g.id === scope.groupId) || null
}

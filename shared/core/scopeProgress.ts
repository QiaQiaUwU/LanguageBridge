
const KEY = 'lb.scopeProgress.v1'

export interface ScopeProgress {
  lastLearnIndex: number
  perDayStudyNumber: number
  complete?: boolean
}

type Store = Record<string, ScopeProgress>

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Store) : {}
  } catch {
    return {}
  }
}

function write(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
  }
}

export function scopeKeyOfTag(tag: string): string {
  return `tag:${tag}`
}

export function getScopeProgress(key: string): ScopeProgress {
  const hit = read()[key]
  return {
    lastLearnIndex: hit?.lastLearnIndex ?? 0,
    perDayStudyNumber: hit?.perDayStudyNumber ?? 20,
    complete: hit?.complete ?? false
  }
}

export function saveScopeProgress(key: string, patch: Partial<ScopeProgress>): ScopeProgress {
  const all = read()
  const next = { ...getScopeProgress(key), ...patch }
  all[key] = next
  write(all)
  return next
}

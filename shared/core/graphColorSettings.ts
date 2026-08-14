import { SOURCE_COLORS, MASTERY_COLORS, RELATION_COLORS, topicColor as factoryTopicColor } from '@/apps/word-core/components/graphColors'

export type ColorDimension = 'source' | 'topic' | 'mastery' | 'relation'

const KEY = 'lb.graphColorOverrides.v1'

type Overrides = Record<ColorDimension, Record<string, string>>

function emptyOverrides(): Overrides {
  return { source: {}, topic: {}, mastery: {}, relation: {} }
}

let cache: Overrides | null = null

function read(): Overrides {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) { cache = emptyOverrides(); return cache }
    const parsed = JSON.parse(raw)
    cache = {
      source: parsed?.source && typeof parsed.source === 'object' ? parsed.source : {},
      topic: parsed?.topic && typeof parsed.topic === 'object' ? parsed.topic : {},
      mastery: parsed?.mastery && typeof parsed.mastery === 'object' ? parsed.mastery : {},
      relation: parsed?.relation && typeof parsed.relation === 'object' ? parsed.relation : {}
    }
  } catch {
    cache = emptyOverrides()
  }
  return cache
}

function write(v: Overrides) {
  cache = v
  try {
    localStorage.setItem(KEY, JSON.stringify(v))
  } catch {
  }
  bump()
}

let version = 0
const listeners = new Set<() => void>()
function bump() {
  version++
  listeners.forEach(fn => { try { fn() } catch { /* 单个订阅者出错不该影响其它订阅者 */ } })
}
export function colorVersion(): number { return version }
export function onColorChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function sourceColor(name: string): string {
  const fb = SOURCE_COLORS[name] || SOURCE_COLORS.default
  return safeColor(read().source[name], fb)
}

export function sourceColorsOf(sources?: string[]): string[] {
  const list = (sources || [])
    .map(s => read().source[s] || SOURCE_COLORS[s])
    .filter(Boolean) as string[]
  return list.length ? list : [sourceColor('default')]
}

export function relationColor(type: string): string {
  return safeColor(read().relation?.[type], RELATION_COLORS[type as keyof typeof RELATION_COLORS] || '#cccccc')
}

export function masteryColor(key: string): string {
  return safeColor(read().mastery[key], MASTERY_COLORS[key] || MASTERY_COLORS.unmarked)
}

export function topicColor(topic: string, allTopics: string[]): string {
  return safeColor(read().topic[topic], factoryTopicColor(topic, allTopics))
}

export function morphemeColor(form: string, allForms: string[]): string {
  return safeColor(read().topic[form], factoryTopicColor(form, allForms))
}

export function overridesOf(dim: ColorDimension): Record<string, string> {
  return { ...read()[dim] }
}

export function hasOverrides(dim: ColorDimension): boolean {
  return Object.keys(read()[dim]).length > 0
}

export function safeColor(c: unknown, fallback: string): string {
  if (typeof c !== 'string') return fallback
  const v = c.trim()
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : fallback
}

export function setColor(dim: ColorDimension, key: string, color: string) {
  const cur = read()
  write({ ...cur, [dim]: { ...cur[dim], [key]: color } })
}

export function applyPalette(dim: ColorDimension, keys: string[], palette: string[]) {
  if (!keys.length || !palette.length) return
  const cur = read()
  const next: Record<string, string> = { ...cur[dim] }
  keys.forEach((k, i) => { next[k] = palette[i % palette.length] })
  write({ ...cur, [dim]: next })
}

export function resetDimension(dim: ColorDimension) {
  const cur = read()
  write({ ...cur, [dim]: {} })
}

export function resetAll() {
  write(emptyOverrides())
}

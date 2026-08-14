import type { WordItem } from '@/shared/types/WordItem'

export type RelType = 'synonym' | 'antonym' | 'word_family' | 'morphology'

export const REL_WEIGHT: Record<RelType, number> = {
  synonym: 0.8,
  word_family: 0.7,
  antonym: 0.6,
  morphology: 0.4
}

export interface ModelLink {
  source: string
  target: string
  type: RelType
  difference?: string
  weight: number
  bridge?: boolean
}

export function relationEdges(list: WordItem[]): ModelLink[] {
  const byWord = new Map<string, WordItem>(list.map(w => [w.word.toLowerCase(), w]))
  const out: ModelLink[] = []
  const seen = new Set<string>()
  const add = (from: string, rawTarget: any, type: RelType, difference?: string) => {
    const t = String(rawTarget ?? '').trim().toLowerCase()
    const hit = byWord.get(t)
    if (!hit || !t || t === from.toLowerCase()) return
    const key = [from.toLowerCase(), t].sort().join('|') + '|' + type
    if (seen.has(key)) return
    seen.add(key)
    out.push({ source: from, target: hit.word, type, difference, weight: REL_WEIGHT[type] })
  }
  for (const w of list) {
    for (const f of w.word_family || []) add(w.word, f, 'word_family')
    for (const s of w.synonyms || []) add(w.word, s.word, 'synonym', s.difference)
    for (const a of w.antonyms || []) add(w.word, a.word, 'antonym')
  }
  return out
}

export function relatedNames(w: WordItem): string[] {
  const out: string[] = []
  for (const f of w.word_family || []) out.push(String(f))
  for (const s of w.synonyms || []) out.push(String(s.word))
  for (const a of w.antonyms || []) out.push(String(a.word))
  return out
}

export function centerNetwork(all: WordItem[], root: WordItem, depth = 1): WordItem[] {
  const byWord = new Map<string, WordItem>(all.map(w => [w.word.toLowerCase(), w]))
  const picked = new Map<string, WordItem>([[root.word.toLowerCase(), root]])
  let frontier: WordItem[] = [root]
  for (let d = 0; d < depth; d++) {
    const next: WordItem[] = []
    for (const w of frontier) {
      for (const name of relatedNames(w)) {
        const k = name.toLowerCase()
        if (picked.has(k)) continue
        const hit = byWord.get(k)
        if (!hit) continue
        picked.set(k, hit)
        next.push(hit)
      }
    }
    frontier = next
    if (!frontier.length) break
  }
  return [...picked.values()]
}

export function morphOf(w: WordItem): { form: string; label: string }[] {
  const m = w.morphology
  if (!m) return []
  const pairs: [string | undefined, string][] = [
    [m.plural, '复数'],
    [m.past_tense, '过去式'],
    [m.past_participle, '过去分词'],
    [m.present_participle, '现在分词'],
    [m.third_person, '第三人称单数'],
    [m.comparative, '比较级'],
    [m.superlative, '最高级']
  ]
  const out: { form: string; label: string }[] = []
  const seen = new Set<string>()
  for (const [form, label] of pairs) {
    const f = String(form || '').trim()
    if (!f || f.toLowerCase() === w.word.toLowerCase() || seen.has(f.toLowerCase())) continue
    seen.add(f.toLowerCase())
    out.push({ form: f, label })
  }
  return out
}

export function sourcesOf(w: WordItem): string[] {
  return w.tags?.length ? w.tags : w.level ? [w.level] : []
}

export function morphemeKeyOf(w: WordItem): string {
  const m = w.morphemes
  return m?.root?.form || m?.prefix?.form || m?.suffix?.form || ''
}

import { canonicalExamTags } from './examTags'
import type { WordItem } from '@/shared/types/WordItem'
import * as be from './backendClient'

type ExpIndex = Record<string, string>

let indexCache: ExpIndex | null = null
let indexLoaded = false

async function loadIndex(): Promise<ExpIndex> {
  if (indexLoaded) return indexCache || {}
  indexLoaded = true
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/word_explanations_index.json`)
    if (res.ok) indexCache = await res.json()
  } catch {
    indexCache = null
  }
  return indexCache || {}
}

export function applyExplanation(item: WordItem, exp: any, opts: { preserveMeanings?: boolean } = {}): boolean {
  if (!exp) return false
  let touched = false
  if (exp.pronunciation && !item.phonetic) {
    item.phonetic = exp.pronunciation
    touched = true
  }
  const hasRealMeaning = item.meanings?.some(m => m.chinese?.trim())
  if (Array.isArray(exp.pos_definitions) && exp.pos_definitions.length) {
    if (opts.preserveMeanings && hasRealMeaning) {
      if (item.meanings && item.meanings[0] && !item.meanings[0].partOfSpeech) {
        item.meanings[0].partOfSpeech = exp.pos_definitions[0].pos || ''
        touched = true
      }
    } else {
      const importedCn = item.meanings?.[0]?.chinese || ''
      item.meanings = exp.pos_definitions.map((d: any) => ({
        chinese: d.definition_zh || '',
        english: d.definition_en || '',
        partOfSpeech: d.pos || ''
      }))
      if (importedCn && !item.meanings.some(m => m.chinese)) {
        item.meanings[0].chinese = importedCn
      }
      touched = true
    }
  }
  if (exp.morphology) {
    item.morphology = exp.morphology
    touched = true
  }
  if (exp.detailed_explanation) item.detailed_explanation = exp.detailed_explanation
  if (exp.etymology) item.etymology = exp.etymology
  if (exp.memory_tips) item.memory_tips = exp.memory_tips
  if (Array.isArray(exp.word_family)) item.word_family = exp.word_family
  if (Array.isArray(exp.synonyms)) {
    item.synonyms = exp.synonyms.map((s: any) =>
      typeof s === 'string' ? { word: s } : { word: s.word, difference: s.difference }
    )
  }
  if (Array.isArray(exp.antonyms)) {
    item.antonyms = exp.antonyms.map((s: any) =>
      typeof s === 'string' ? { word: s } : { word: s.word, note: s.note }
    )
  }
  if (!item.tags?.length) {
    let cats: string[] = []
    if (Array.isArray(exp.categories) && exp.categories.length) cats = exp.categories
    else if (Array.isArray(exp.sources) && exp.sources.length) cats = exp.sources
    else if (typeof exp.category === 'string' && exp.category.trim()) cats = exp.category.split(/[,，]/)
    cats = cats.map((c: any) => String(c).trim()).filter(Boolean)
    if (cats.length) {
      item.tags = [...new Set(cats)]
      touched = true
    }
  }
  if (Array.isArray(exp.common_phrases)) item.common_phrases = exp.common_phrases
  if (Array.isArray(exp.example_sentences)) {
    item.example_sentences = exp.example_sentences.map((e: any) => ({
      en: e.en || e.english || '',
      zh: e.zh || e.chinese || ''
    }))
    touched = true
  }
  return touched
}

async function enrichFromLocal(item: WordItem): Promise<boolean> {
  const key = item.word.toLowerCase().trim()

  const index = await loadIndex()
  const file = index[key]
  if (!file) return false
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/word_explanations/${file}`)
    if (!res.ok) return false
    const exp = await res.json()
    return applyExplanation(item, exp)
  } catch {
    return false
  }
}

async function enrichFromApi(item: WordItem): Promise<boolean> {
  if (/\s/.test(item.word.trim())) return false
  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(item.word.trim())}`
    )
    if (!res.ok) return false
    const data = await res.json()
    const entry = Array.isArray(data) ? data[0] : null
    if (!entry) return false
    let touched = false
    if (!item.phonetic) {
      const ph =
        entry.phonetic ||
        (entry.phonetics || []).map((p: any) => p.text).find((t: string) => t)
      if (ph) {
        item.phonetic = ph.startsWith('/') ? ph : `/${ph.replace(/^\/|\/$/g, '')}/`
        touched = true
      }
    }
    const meanings = entry.meanings || []
    if (meanings.length) {
      const posAbbr = (p: string) =>
        ({
          noun: 'n.',
          verb: 'v.',
          adjective: 'adj.',
          adverb: 'adv.',
          preposition: 'prep.',
          conjunction: 'conj.',
          pronoun: 'pron.',
          interjection: 'int.',
          exclamation: 'int.'
        } as Record<string, string>)[p] || p

      const first = item.meanings?.[0]
      if (first && !first.partOfSpeech && meanings[0].partOfSpeech) {
        first.partOfSpeech = posAbbr(meanings[0].partOfSpeech)
        touched = true
      }
      if (first && !first.english) {
        const def = meanings[0].definitions?.[0]?.definition
        if (def) {
          first.english = def
          touched = true
        }
      }
      if (!item.example_sentences || !item.example_sentences.length) {
        for (const m of meanings) {
          const ex = (m.definitions || []).map((d: any) => d.example).find((e: string) => e)
          if (ex) {
            item.example_sentences = [{ en: ex, zh: '' }]
            touched = true
            break
          }
        }
      }
    }
    return touched
  } catch {
    return false
  }
}

export interface EnrichProgress {
  done: number
  total: number
  current: string
}

export async function backfillTagsFromLibrary(
  items: WordItem[],
  groups: { id: string; name: string; wordIds: string[] }[],
  onProgress?: (p: { done: number; total: number }) => void
): Promise<WordItem[]> {
  const targets = items.filter(w => !w.tags?.length)
  if (!targets.length) return []

  const catByWordId = new Map<string, string[]>()
  for (const g of groups) {
    if (!g.id.startsWith('book-lib-cat-')) continue
    const cat = g.id.slice('book-lib-cat-'.length) || g.name
    if (!cat) continue
    for (const id of g.wordIds) {
      const arr = catByWordId.get(id)
      if (arr) arr.push(cat)
      else catByWordId.set(id, [cat])
    }
  }

  const changed: WordItem[] = []
  let done = 0
  for (const item of targets) {
    const cats = catByWordId.get(item.id)
    if (cats?.length) {
      item.tags = canonicalExamTags(cats)
      item.updatedAt = new Date().toISOString()
      changed.push(item)
    }
    done++
    if (done % 500 === 0 || done === targets.length) onProgress?.({ done, total: targets.length })
  }
  return changed
}

export async function enrichWords(
  items: WordItem[],
  onProgress?: (p: EnrichProgress) => void
): Promise<WordItem[]> {
  const changed: WordItem[] = []
  let done = 0
  const CONCURRENCY = 5
  const queue = [...items]

  async function worker() {
    while (queue.length) {
      const item = queue.shift()!
      let touched = await enrichFromLocal(item)
      if (!touched) {
        const needApi =
          !item.phonetic ||
          !item.example_sentences?.length ||
          !item.meanings?.[0]?.partOfSpeech
        if (needApi) touched = (await enrichFromApi(item)) || touched
      }
      // 不管补没补上都盖戳：这次确实为这个词查过词典和接口了
      const stamped = !item.basicEnrichedAt
      item.basicEnrichedAt = new Date().toISOString()
      if (touched || stamped) {
        item.updatedAt = new Date().toISOString()
        changed.push(item)
      }
      done++
      onProgress?.({ done, total: items.length, current: item.word })
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return changed
}

import * as be from './backendClient'

export const SIMPLE_WORDS: string[] = [
  'a', 'an', 'i', 'my', 'me', 'you', 'your', 'he', 'his', 'she', 'her', 'it',
  'what', 'who', 'where', 'how', 'when', 'which',
  'be', 'am', 'is', 'was', 'are', 'were', 'do', 'did',
  'can', 'could', 'will', 'would',
  'the', 'that', 'this', 'and', 'not', 'no', 'yes',
  'to', 'of', 'for', 'at', 'in'
]

const LOCAL_KEY = 'lb-mastered-words'

let mastered: Set<string> | null = null

function readLocal(): Set<string> {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    const arr: string[] = raw ? JSON.parse(raw) : []
    return new Set<string>(arr)
  } catch {
    return new Set<string>()
  }
}

function writeLocal(set: Set<string>) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify([...set]))
  } catch {
  }
}

export async function loadMasteredWords(): Promise<Set<string>> {
  if (mastered) return mastered
  const remote = await be.beListMastered()
  if (remote !== null) {
    const set = new Set<string>(remote.map(r => String(r.id).toLowerCase()))
    if (!remote.length) {
      const local = readLocal()
      if (local.size) {
        await be.beBulkSaveMastered([...local].map(id => ({ id })))
        mastered = local
        return local
      }
    }
    mastered = set
    writeLocal(set)
    return set
  }
  mastered = readLocal()
  return mastered
}

export function getMasteredSet(): Set<string> {
  return mastered || (mastered = readLocal())
}

export function isMastered(word: string): boolean {
  return getMasteredSet().has(word.toLowerCase())
}

export function getIgnoreSet(ignoreSimpleWord: boolean): Set<string> {
  const base = getMasteredSet()
  if (!ignoreSimpleWord) return base
  const all = new Set(base)
  for (const w of SIMPLE_WORDS) all.add(w)
  return all
}

export async function toggleMastered(word: string): Promise<boolean> {
  const set = getMasteredSet()
  const key = word.toLowerCase()
  const now = !set.has(key)
  now ? set.add(key) : set.delete(key)
  writeLocal(set)
  if (now) await be.beBulkSaveMastered([{ id: key }])
  else await be.beDeleteMastered(key)
  return now
}

export async function addMastered(word: string): Promise<void> {
  const set = getMasteredSet()
  const key = word.toLowerCase()
  if (set.has(key)) return
  set.add(key)
  writeLocal(set)
  await be.beBulkSaveMastered([{ id: key }])
}

export async function removeMastered(word: string): Promise<void> {
  const set = getMasteredSet()
  const key = word.toLowerCase()
  if (!set.delete(key)) return
  writeLocal(set)
  await be.beDeleteMastered(key)
}

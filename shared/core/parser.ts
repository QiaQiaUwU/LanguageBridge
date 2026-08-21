import type { WordItem } from '@/shared/types/WordItem'

const POS_RE = /^(n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|aux|phr|abbr|det|modal)\.\s*/i

function extractPos(text: string): { pos: string; rest: string } {
  let rest = text.trim()
  const posList: string[] = []
  let m: RegExpMatchArray | null
  while ((m = rest.match(POS_RE))) {
    posList.push(m[1].toLowerCase() + '.')
    rest = rest.slice(m[0].length).replace(/^[&/、\s]+/, '')
    if (posList.length > 4) break
  }
  return { pos: posList.join(' & '), rest }
}

function extractPhonetic(text: string): { phonetic: string; rest: string } {
  const m = text.match(/[/\[]([^/\]\u4e00-\u9fa5]{1,40})[/\]]/)
  if (m) {
    return {
      phonetic: `/${m[1].trim()}/`,
      rest: (text.slice(0, m.index) + text.slice((m.index || 0) + m[0].length)).trim()
    }
  }
  return { phonetic: '', rest: text }
}

export interface ParsedEntry {
  word: string
  phonetic: string
  partOfSpeech: string
  chinese: string
}

export function parseLine(raw: string): ParsedEntry | null {
  let line = raw.replace(/^\uFEFF/, '').trim()
  if (!line || line.startsWith('#') || line.startsWith('//')) return null

  // 去掉行首编号：「1. abandon」「12、abandon」「3) abandon」。
  // 词表从 PDF / Word 复制出来几乎都带编号，不去掉整行都解析不出。
  line = line.replace(/^\s*\d{1,4}\s*[.、)．]\s+/, '')
  if (!line) return null

  let word = ''
  let rest = ''

  // 冒号和「词 - 释义」也是常见分隔写法
  const colon = line.match(/^([A-Za-z][A-Za-z '().\-/]*?)\s*[:：]\s*(.+)$/)
  if (colon) {
    const ph = extractPhonetic(colon[2].trim())
    const po = extractPos(ph.rest)
    return { word: colon[1].trim(), phonetic: ph.phonetic, partOfSpeech: po.pos, chinese: po.rest }
  }
  const dash = line.match(/^([A-Za-z][A-Za-z '().\/]*?)\s+[-—–]\s+(.+)$/)
  if (dash) {
    const ph = extractPhonetic(dash[2].trim())
    const po = extractPos(ph.rest)
    return { word: dash[1].trim(), phonetic: ph.phonetic, partOfSpeech: po.pos, chinese: po.rest }
  }

  // 分号当分隔符只在「分号左边确实像一个单词」时才成立。
  // 「accommodation n. 住处；膳宿」里的分号是释义内部的顿开，
  // 按分号切会把词切成「accommodation n. 住处」。
  let sepMatch = line.match(/[;；\t]/)
  if (sepMatch && sepMatch.index !== undefined && /[;；]/.test(sepMatch[0])) {
    const left = line.slice(0, sepMatch.index).trim()
    if (!/^[A-Za-z][A-Za-z '().\-/]*$/.test(left)) sepMatch = null
  }
  if (sepMatch && sepMatch.index !== undefined) {
    word = line.slice(0, sepMatch.index).trim()
    rest = line.slice(sepMatch.index + 1).trim()
  } else if (line.includes(',') && /^[A-Za-z][A-Za-z '.-]*,/.test(line)) {
    const parts = line.split(',').map(p => p.trim())
    word = parts[0]
    const phonetic = parts[1] && /[/\[]/.test(parts[1]) ? parts[1] : ''
    const chinese = phonetic ? (parts[2] || '') : (parts[1] || '')
    const posRaw = phonetic ? (parts[3] || '') : (parts[2] || '')
    const { pos, rest: cnRest } = extractPos(chinese)
    return word
      ? { word, phonetic, partOfSpeech: pos || posRaw || '', chinese: cnRest || chinese }
      : null
  } else {
    const m = line.match(
      /^([A-Za-z][A-Za-z '().\-/]*?)\s+((?:\/[^/]+\/\s*)?(?:(?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|aux|phr)\.\s*)?[\u4e00-\u9fa5].*|\/[^/]+\/.*)$/
    )
    if (m) {
      word = m[1].trim()
      rest = m[2].trim()
    } else if (/^[A-Za-z][A-Za-z '.-]*$/.test(line)) {
      return { word: line, phonetic: '', partOfSpeech: '', chinese: '' }
    } else {
      return null
    }
  }

  if (!word) return null
  const ph = extractPhonetic(rest)
  const po = extractPos(ph.rest)
  return { word, phonetic: ph.phonetic, partOfSpeech: po.pos, chinese: po.rest }
}

export function parseText(content: string): ParsedEntry[] {
  return content
    .split(/\r?\n/)
    .map(parseLine)
    .filter((e): e is ParsedEntry => !!e && !!e.word)
}

export function parseJson(content: string): ParsedEntry[] {
  let data: any
  try {
    data = JSON.parse(content)
  } catch {
    return []
  }
  const arr = Array.isArray(data) ? data : [data]
  const out: ParsedEntry[] = []
  for (const it of arr) {
    if (!it) continue
    if (typeof it === 'string') {
      const p = parseLine(it)
      if (p) out.push(p)
      continue
    }
    const word = it.word || it.english || it.en || ''
    if (!word) continue
    if (Array.isArray(it.pos_definitions) && it.pos_definitions.length) {
      out.push({
        word,
        phonetic: it.pronunciation || it.phonetic || '',
        partOfSpeech: it.pos_definitions[0].pos || '',
        chinese: it.pos_definitions.map((d: any) => d.definition_zh).filter(Boolean).join('；')
      })
      continue
    }
    if (Array.isArray(it.meanings) && it.meanings.length) {
      out.push({
        word,
        phonetic: it.phonetic || '',
        partOfSpeech: it.meanings[0].partOfSpeech || '',
        chinese: it.meanings.map((mm: any) => mm.chinese).filter(Boolean).join('；')
      })
      continue
    }
    const cn = it.chinese || it.meaning || it.zh || it.translation || ''
    const { pos, rest } = extractPos(String(cn))
    out.push({
      word,
      phonetic: it.phonetic || it.pronunciation || '',
      partOfSpeech: it.partOfSpeech || it.pos || pos || '',
      chinese: rest || String(cn)
    })
  }
  return out
}

export function toWordItem(e: ParsedEntry, source: string): WordItem {
  const now = new Date().toISOString()
  return {
    id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    word: e.word,
    phonetic: e.phonetic,
    meanings: [
      {
        chinese: e.chinese,
        partOfSpeech: e.partOfSpeech || '',
      }
    ],
    level: 'IELTS',
    source,
    status: 'unmarked',
    createdAt: now,
    updatedAt: now
  }
}

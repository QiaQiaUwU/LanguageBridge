/**
 * TypeWords 词典接入。
 *
 * 逐行移植自 typing-word（GPL-3.0）：
 *   packages/core/src/utils/index.ts  →  convertToWord / _getDictDataByUrl
 *   packages/core/src/types/types.ts  →  Word 类型
 *
 * 它的例句、短语、近义词、词根、词源都是**词典自带的字段**，不是生成的。
 * 词典 JSON 托管在 https://files.typewords.cc/ ，仓库里不含数据。
 * 所以这里不做任何 AI 生成，只做「拉取 + 按它的规则解析」。
 */

export interface TwTrans {
  pos: string
  cn: string
}
export interface TwPair {
  c: string
  cn: string
}
export interface TwSyno {
  pos: string
  cn: string
  ws: string[]
}
export interface TwRelWords {
  root: string
  rels: { pos: string; words: TwPair[] }[]
}
export interface TwEtymology {
  t: string
  d: string
}

export interface TwWord {
  id?: string
  word: string
  phonetic0: string
  phonetic1: string
  trans: TwTrans[]
  sentences: TwPair[]
  phrases: TwPair[]
  synos: TwSyno[]
  relWords: TwRelWords
  etymology: TwEtymology[]
}

export const TW_RESOURCE_URL = 'https://files.typewords.cc/'

export function twDictListUrl(): string {
  return `${TW_RESOURCE_URL}list/word.json`
}

export function twDictUrl(language: string, url: string): string {
  return `${TW_RESOURCE_URL}dicts/${language}/word/${url}`
}

function safeString(str: unknown): string {
  return typeof str === 'string' ? str.trim() : ''
}

function safeSplit(str: unknown, sep: string): string[] {
  const s = safeString(str)
  return s ? s.split(sep).filter(Boolean) : []
}

function emptyWord(): TwWord {
  return {
    word: '',
    phonetic0: '',
    phonetic1: '',
    trans: [],
    sentences: [],
    phrases: [],
    synos: [],
    relWords: { root: '', rels: [] },
    etymology: []
  }
}

/** 原样移植 convertToWord：把词典 JSON 里的扁平字符串字段解析成结构 */
export function convertToWord(raw: any): TwWord {
  const trans: TwTrans[] = safeSplit(raw.trans, '\n').map(line => {
    const match = safeString(line).match(/^([^\s.]+\.?)\s*(.*)$/)
    if (match) {
      let pos = safeString(match[1])
      let cn = safeString(match[2])
      // pos 不是常规词性（例如「【名】」）时整行放进 cn
      if (!/^[a-zA-Z]+\.?$/.test(pos)) {
        cn = safeString(line)
        pos = ''
      }
      return { pos, cn }
    }
    return { pos: '', cn: safeString(line) }
  })

  const sentences: TwPair[] = safeSplit(raw.sentences, '\n\n').map(block => {
    const [c, cn] = block.split('\n')
    return { c: safeString(c), cn: safeString(cn) }
  })

  const phrases: TwPair[] = safeSplit(raw.phrases, '\n\n').map(block => {
    const [c, cn] = block.split('\n')
    return { c: safeString(c), cn: safeString(cn) }
  })

  const synos: TwSyno[] = safeSplit(raw.synos, '\n\n').map(block => {
    const lines = block.split('\n').map(safeString)
    const [posCn, wsStr] = lines
    let pos = ''
    let cn = ''
    if (posCn) {
      const posMatch = posCn.match(/^([a-zA-Z.]+)(.*)$/)
      pos = posMatch ? safeString(posMatch[1]) : ''
      cn = posMatch ? safeString(posMatch[2]) : safeString(posCn)
    }
    const ws = wsStr ? wsStr.split('/').map(safeString) : []
    return { pos, cn, ws }
  })

  const relWordsText = safeString(raw.relWords)
  let root = ''
  const rels: { pos: string; words: TwPair[] }[] = []
  if (relWordsText) {
    const relLines = relWordsText.split('\n').filter(Boolean)
    if (relLines.length > 0) {
      root = safeString(relLines[0].replace(/^词根:/, ''))
      let currentPos = ''
      let currentWords: TwPair[] = []
      for (let i = 1; i < relLines.length; i++) {
        const line = relLines[i].trim()
        if (!line) continue
        if (/^[a-z]+\./i.test(line)) {
          if (currentPos && currentWords.length > 0) {
            rels.push({ pos: currentPos, words: currentWords })
          }
          currentPos = safeString(line.replace(':', ''))
          currentWords = []
        } else if (line.includes(':')) {
          const [c, cn] = line.split(':')
          currentWords.push({ c: safeString(c), cn: safeString(cn) })
        }
      }
      if (currentPos && currentWords.length > 0) {
        rels.push({ pos: currentPos, words: currentWords })
      }
    }
  }

  const etymology: TwEtymology[] = safeSplit(raw.etymology, '\n\n').map(block => {
    const lines = block.split('\n').map(safeString)
    const t = lines.shift() || ''
    const d = lines.join('\n').trim()
    return { t, d }
  })

  return {
    ...emptyWord(),
    id: raw.id,
    word: safeString(raw.name || raw.word),
    phonetic0: safeString(raw.usphone || raw.phonetic0),
    phonetic1: safeString(raw.ukphone || raw.phonetic1),
    trans,
    sentences,
    phrases,
    synos,
    relWords: { root, rels },
    etymology
  }
}

/** 拉一本词典，返回解析好的词表。对应 _getDictDataByUrl。 */
export async function fetchTwDict(language: string, url: string): Promise<TwWord[]> {
  const res = await fetch(twDictUrl(language, url))
  if (!res.ok) throw new Error(`词典下载失败：${res.status} ${twDictUrl(language, url)}`)
  const raw = await res.json()
  if (!Array.isArray(raw)) throw new Error('词典格式不对：顶层不是数组')
  return raw.map(convertToWord)
}

/** 拉词典清单 */
export async function fetchTwDictList(): Promise<any[]> {
  const res = await fetch(twDictListUrl())
  if (!res.ok) throw new Error(`词典清单下载失败：${res.status}`)
  const list = await res.json()
  return Array.isArray(list) ? list : []
}

/**
 * 把 TypeWords 的词条合并进我们的 WordItem。
 *
 * 字段对照（左边是它的，右边是我们 WordItem 里真实存在的字段）：
 *   sentences → example_sentences: { en, zh }[]
 *   phrases   → common_phrases:    { phrase_en, phrase_zh }[]
 *   synos.ws  → synonyms:          { word }[]
 *   relWords  → morphemes.root
 *   etymology → etymology: string
 *   phonetic0 → phonetic
 *
 * 只补空缺，不覆盖已有内容 —— 本地可能已经人工改过。
 * 返回可以直接喂给 wordStore.updateWordFields 的 patch，没有可补的返回 null。
 */
export function buildTwPatch(item: any, tw: TwWord): Record<string, any> | null {
  const patch: Record<string, any> = {}

  if (!item.phonetic && tw.phonetic0) {
    patch.phonetic = `/${tw.phonetic0.replace(/^\/|\/$/g, '')}/`
  }

  if (tw.sentences.length && !item.example_sentences?.length) {
    patch.example_sentences = tw.sentences
      .filter(s => s.c)
      .map(s => ({ en: s.c, zh: s.cn }))
  }

  if (tw.phrases.length && !item.common_phrases?.length) {
    patch.common_phrases = tw.phrases
      .filter(p => p.c)
      .map(p => ({ phrase_en: p.c, phrase_zh: p.cn }))
  }

  if (tw.synos.length && !item.synonyms?.length) {
    const seen = new Set<string>()
    const out: { word: string; difference?: string }[] = []
    for (const s of tw.synos) {
      for (const w of s.ws) {
        const k = w.trim()
        if (!k || seen.has(k.toLowerCase())) continue
        seen.add(k.toLowerCase())
        out.push({ word: k, difference: s.cn || undefined })
      }
    }
    if (out.length) patch.synonyms = out
  }

  if (tw.etymology.length && !item.etymology) {
    patch.etymology = tw.etymology.map(e => (e.d ? `${e.t}：${e.d}` : e.t)).join('\n')
  }

  return Object.keys(patch).length ? patch : null
}

/**
 * 把一条 TypeWords 词条转成我们自己的 WordItem。
 *
 * 转换发生在边界上：TwWord 只是解析中间态，进库的永远是 WordItem，
 * 所以不存在「库里有两种结构」的问题。字段对不上的（它的 relWords.rels、
 * synos 的词性分组）取能对上的部分，取不到的留空，不硬塞。
 */
export function twToWordItem(tw: TwWord, source: string): any {
  const now = new Date().toISOString()
  const meanings = tw.trans.length
    ? tw.trans.map(t => ({ chinese: t.cn, partOfSpeech: t.pos }))
    : [{ chinese: '', partOfSpeech: '' }]

  const synonyms: { word: string; difference?: string }[] = []
  const seen = new Set<string>()
  for (const s of tw.synos) {
    for (const w of s.ws) {
      const k = w.trim()
      if (!k || seen.has(k.toLowerCase())) continue
      seen.add(k.toLowerCase())
      synonyms.push({ word: k, difference: s.cn || undefined })
    }
  }

  const wordFamily: string[] = []
  for (const r of tw.relWords.rels) {
    for (const w of r.words) if (w.c) wordFamily.push(w.c)
  }

  return {
    id: `tw-${tw.word.toLowerCase()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    word: tw.word,
    phonetic: tw.phonetic0 ? `/${tw.phonetic0.replace(/^\/|\/$/g, '')}/` : '',
    meanings,
    level: 'unknown',
    source,
    isCustom: true,
    createdAt: now,
    updatedAt: now,
    example_sentences: tw.sentences.filter(s => s.c).map(s => ({ en: s.c, zh: s.cn })),
    common_phrases: tw.phrases.filter(p => p.c).map(p => ({ phrase_en: p.c, phrase_zh: p.cn })),
    synonyms: synonyms.length ? synonyms : undefined,
    word_family: wordFamily.length ? wordFamily : undefined,
    etymology: tw.etymology.length
      ? tw.etymology.map(e => (e.d ? `${e.t}：${e.d}` : e.t)).join('\n')
      : undefined,
    morphemes: tw.relWords.root ? { root: { form: tw.relWords.root, meaning: '' } } : undefined
  }
}

/**
 * 词汇笔记生成引擎。
 *
 * 参考的手写笔记分四种，数据要求各不一样：
 *   root      词根族   port = carry → export / import / transport …（按前缀分支，附易混词 distort）
 *   synonym   同义族   贫穷的 poor → impoverished / destitute / impecunious …（按词性，附派生与延伸）
 *   topic     话题族   信息传播 → disseminate / circulate / rumor …（话题下再分语义小组）
 *   decompose 拆解图   atmosphere → atmo + sphere → hydrosphere → hydro → hydrogen …（多层思维导图）
 *
 * 所有关系都带证据（evidence）和置信度（confidence）。只凭字符串猜出来的关系
 * 置信度低，界面上标成待确认，不直接当事实展示。
 *
 * 本文件不依赖 Vue 和路径别名，可以被 scripts/family-check.ts 直接在 Node 里跑。
 */
import type { WordItem } from '../types/WordItem'

/* ================================================================== */
/*  输出结构                                                           */
/* ================================================================== */

export type NoteKind = 'root' | 'synonym' | 'topic' | 'decompose'
export type LinkKind = 'syn' | 'ant' | 'root' | 'confuse' | 'base'

export interface NoteLink { kind: LinkKind; word: string; zh?: string }
export interface NoteDeriv { word: string; zh?: string; pos?: string }
export interface NotePhrase { en: string; zh?: string }

export interface NoteWord {
  word: string
  zh?: string
  pos?: string
  /** 拆解公式：de-（向下）+ posit（放置） */
  formula?: string
  derivs: NoteDeriv[]
  phrases: NotePhrase[]
  links: NoteLink[]
  evidence: string[]
  confidence: number
  /** 词库里没有、由 AI 补进来的 */
  added?: boolean
}

export interface NoteBranch {
  /** 分支名：前缀 ex-（向外）/ 形容词 / 传播 */
  label: string
  sub?: string
  words: NoteWord[]
}

export interface TreeNode {
  id: string
  label: string
  zh?: string
  kind: 'word' | 'morpheme'
  children: TreeNode[]
  links?: NoteLink[]
  confidence?: number
}

export interface FamilyNote {
  kind: NoteKind
  title: string
  hub: { label: string; sub?: string }
  branches: NoteBranch[]
  /** 右侧便签：同义补充、易混词、辨析 */
  side: { label: string; items: NoteLink[] }[]
  tree?: TreeNode
  /** 生成时的统计，给诊断用 */
  stats: { candidates: number; kept: number; lowConfidence: number }
  createdFrom: string
}

/* ================================================================== */
/*  基础工具                                                           */
/* ================================================================== */

const lc = (s: string) => (s || '').trim().toLowerCase()

/** 主释义（第一个义项的中文，去掉括号与词性） */
export function zhOf(w?: WordItem): string {
  if (!w) return ''
  const m = w.meanings?.[0]
  const raw = (m?.chinese || '').replace(/^[a-z]+\.\s*/i, '')
  let first = raw.split(/[；;]/)[0].replace(/[（(][^）)]*[)）]/g, '').trim()
  // 百科式长释义（「水圈，指地球表面……」）只留逗号前的词
  if (first.length > 10) first = first.split(/[，,。]/)[0].trim()
  if (first.length > 14) first = first.slice(0, 14) + '…'
  return first
}

/** 多词短语、带空格的条目不当成单词参与笔记 */
export const isPhrase = (w: string) => /\s/.test((w || '').trim())

/** 条目信息量，重复词条时留信息多的 */
function richness(w: WordItem): number {
  return (w.morphemes ? 3 : 0) + (w.meanings?.[0]?.chinese ? 3 : 0) + (w.synonyms?.length ? 1 : 0) +
    (w.topics?.length ? 1 : 0) + (w.word_family?.length ? 1 : 0) + (w.common_phrases?.length ? 1 : 0)
}

export function posOf(w?: WordItem): string {
  const p = lc(w?.meanings?.[0]?.partOfSpeech || '')
  if (/^(n|noun)/.test(p)) return 'n'
  if (/^(v|verb)/.test(p)) return 'v'
  if (/^(adj|a\b|a\.)/.test(p)) return 'adj'
  if (/^(adv)/.test(p)) return 'adv'
  return p.replace(/\.$/, '')
}

const FUNCTION_CHARS = /[的地得之者性化了着过和与或及等某人物事一个种使被把为是在对于]/g
/** 词条头尾可去的虚字。只去头尾：「矿化作用」「过度开发」「动物」中间和词内的字不能动 */
const LEAD_FN = /^(?:使|被|把|对|为|在|于|与|和|某)/
const TRAIL_FN = /(?:的|地|得|之|者|性|了|着|等)$/
/** 义项编号：1. ①  (1)  a) */
const SENSE_NUM = /(?:^|\s)(?:\d+[.．、)]|[①-⑳]|[（(]\d+[)）]|[a-z][)）])\s*/gi
function trimTerm(part: string): string {
  let t = part.replace(/[^\u4e00-\u9fffA-Za-z]/g, '')
  for (const re of [TRAIL_FN, LEAD_FN, TRAIL_FN]) {
    const next = t.replace(re, '')
    if (next.length >= 2) t = next
  }
  return t
}
/** 中文义项切成「词条」：贫穷的；贫困的 → [贫穷, 贫困] */
export function senseTerms(w?: WordItem): string[] {
  if (!w) return []
  const out = new Set<string>()
  for (const m of w.meanings || []) {
    const raw = (m.chinese || '')
      .replace(/^[a-z]+\.\s*/i, '')
      .replace(SENSE_NUM, '；')
      .replace(/[（(][^）)]*[)）]/g, '')
    for (const part of raw.split(/[；;，,、/\s。]+/)) {
      const t = trimTerm(part)
      if (t.length >= 2 && t.length <= 6 && /[\u4e00-\u9fff]/.test(t)) out.add(t)
    }
  }
  return [...out]
}

/** 只取第一个义项的中文词条 */
export function senseTermsOfFirst(w?: WordItem): string[] {
  if (!w?.meanings?.length) return []
  return senseTerms({ ...w, meanings: [w.meanings[0]] } as WordItem)
}

function charSet(s: string): Set<string> {
  return new Set(s.replace(FUNCTION_CHARS, '').replace(/[^\u4e00-\u9fff]/g, '').split(''))
}

/** 两个词中文释义的字重合度 0~1 */
export function glossOverlap(a?: WordItem, b?: WordItem): number {
  const x = charSet(senseTerms(a).join('')), y = charSet(senseTerms(b).join(''))
  if (!x.size || !y.size) return 0
  let n = 0
  for (const c of x) if (y.has(c)) n++
  return n / Math.min(x.size, y.size)
}

export function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m || !n) return m || n
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[n]
}

/* ================================================================== */
/*  词素归一                                                           */
/* ================================================================== */

/**
 * 同一个词根/词缀的不同写法。左边是归一后的键。
 * 这里只放高频的；其余靠「前缀包含 + 释义一致」自动合并（见 buildMorphemeIndex）。
 */
/** 常见词素的内置释义（词库里没有这个词素时兜底） */
export const MORPHEME_MEANINGS: Record<string, string> = {
  atmo: '蒸汽，空气', sphere: '球，圈', hydro: '水', litho: '石头', geo: '地', bio: '生命', auto: '自己',
  tele: '远', photo: '光', phon: '声音', graph: '写，画', micro: '小', macro: '大', port: '搬运',
  terr: '恐惧', pecun: '钱', hemi: '半', neo: '新', epi: '在上', ana: '分开', therm: '热', chron: '时间',
  ex: '向外', trans: '跨越', sub: '在下', de: '离开，向下', pro: '向前', com: '共同', dis: '分开，否定'
}

export const MORPHEME_VARIANTS: Record<string, string[]> = {
  // 前缀
  'ex': ['ex', 'e', 'ef', 'exo'],
  'in(内)': ['in', 'im', 'il', 'ir', 'en', 'em'],
  'in(否)': ['in', 'im', 'il', 'ir', 'un', 'non'],
  'com': ['com', 'con', 'col', 'cor', 'co'],
  'sub': ['sub', 'sup', 'suf', 'sug', 'sum', 'sus', 'suc'],
  'ad': ['ad', 'ac', 'af', 'ag', 'al', 'an', 'ap', 'ar', 'as', 'at', 'a'],
  'dis': ['dis', 'di', 'dif'],
  'ob': ['ob', 'op', 'oc', 'of'],
  'pro': ['pro', 'pur', 'por'],
  'trans': ['trans', 'tra', 'tran'],
  'syn': ['syn', 'sym', 'syl'],
  // 词根
  'port': ['port', 'portat'],
  'terr': ['terr', 'terri', 'terror', 'terrif'],
  'pos': ['pos', 'posit', 'pon', 'pound'],
  'ject': ['ject', 'jac', 'jet'],
  'leg': ['leg', 'legis', 'lex', 'legal'],
  'mit': ['mit', 'miss', 'mis'],
  'duc': ['duc', 'duct', 'duce'],
  'spect': ['spect', 'spic', 'spec'],
  'vid': ['vid', 'vis', 'vise'],
  'dict': ['dict', 'dic'],
  'hydro': ['hydro', 'hydr'],
  'litho': ['litho', 'lith'],
  'sphere': ['sphere', 'spher'],
  'atmo': ['atmo', 'atmos'],
  'pecun': ['pecun', 'pecu'],
  'plode': ['plode', 'plos'],
  'clude': ['clude', 'clus', 'clos', 'clud'],
  'cede': ['cede', 'ceed', 'cess'],
  'pand': ['pand', 'pans'],
  'tort': ['tort', 'tors'],
  'semin': ['semin', 'semen'],
  'priv': ['priv', 'privi'],
  'gen': ['gen', 'gene', 'genit'],
  'graph': ['graph', 'gram'],
  'tom': ['tom', 'tome'],
  'dem': ['dem', 'demo'],
  'hemi': ['hemi', 'semi'],
  'lat': ['lat', 'late']
}

const NOT_MEANING = /不|非|无|否|相反|反/

/**
 * 词素释义的概念组。用来判断两条释义是不是一个意思（拿、带、搬运、carry 同属携带）。
 * 认不出的释义不参与拆分，宁可合在一起，也不把真同族拆散。
 */
const CONCEPTS: [string, RegExp][] = [
  ['carry', /搬|运|拿|带|携|载|carry|bring|bear/i],
  ['put', /放|置|摆|put|place|set/i],
  ['fear', /恐|怖|惧|怕|吓|fear|frighten|terrif/i],
  ['land', /土|地|领|陆|earth|land|ground/i],
  ['write', /写|书|记|write|scrib/i],
  ['see', /看|视|见|观|察|see|look|watch|spect|vis/i],
  ['say', /说|言|讲|称|语|say|speak|tell|dict/i],
  ['go', /走|行|去|进|go|walk|move|cede/i],
  ['send', /送|派|发|投|send|throw|mit|ject/i],
  ['pull', /拉|拖|引|画|draw|pull|drag/i],
  ['push', /推|压|push|press/i],
  ['twist', /扭|绞|拧|twist|tort/i],
  ['water', /水|液|water|hydr/i],
  ['stone', /石|岩|stone|rock|lith/i],
  ['money', /钱|金|财|币|money|pecun/i],
  ['birth', /生|产|育|种|birth|born|produce|gen/i],
  ['cut', /切|割|剪|cut|sect|tom/i],
  ['people', /民|人|众|people|dem/i],
  ['ball', /球|圈|sphere|ball/i],
  ['air', /气|air|atmo/i],
  ['law', /法|律|law|leg/i],
  ['lead', /引导|领导|lead|duc/i],
  ['private', /私|个人|单独|private|priv/i],
  ['seed', /种子|播|seed|semin/i],
  ['break', /爆|破|裂|break|burst|plode|rupt/i],
  ['close', /关|闭|close|shut|clud/i],
  ['stretch', /伸|展|扩|stretch|spread|pand/i],
  ['harbor', /港|码头|口岸|harbou?r/i],
  ['part', /部分|份额|part\b|portion/i]
]
export function conceptOf(meaning: string): string {
  for (const [c, re] of CONCEPTS) if (re.test(meaning)) return c
  return ''
}
const FORM_TO_KEYS = new Map<string, string[]>()
for (const [key, forms] of Object.entries(MORPHEME_VARIANTS)) {
  for (const f of forms) {
    const arr = FORM_TO_KEYS.get(f) || []
    arr.push(key)
    FORM_TO_KEYS.set(f, arr)
  }
}

export function cleanForm(form: string): string {
  return lc(form).replace(/^[-‐]+|[-‐]+$/g, '').replace(/[^a-z]/g, '')
}

const PREFIX_KEYS = new Set(['ex', 'in(内)', 'in(否)', 'com', 'sub', 'ad', 'dis', 'ob', 'pro', 'trans', 'syn'])

/**
 * 表层形式 + 释义 + 角色 → 归一键。
 * 后缀用「-ible」这样的键，和词根、前缀分开（june 的 -e 不能算成前缀 ex-）；
 * 前缀变体表只用于前缀，词根变体表只用于词根。
 */
export function canonicalMorpheme(form: string, meaning = '', role: 'prefix' | 'root' | 'suffix' | '' = ''): string {
  const f = cleanForm(form)
  if (!f) return ''
  if (role === 'suffix') return '-' + f
  const keys = (FORM_TO_KEYS.get(f) || []).filter(k =>
    !role ? true : role === 'prefix' ? PREFIX_KEYS.has(k) : !PREFIX_KEYS.has(k))
  if (!keys.length) return f
  if (keys.length === 1) return keys[0]
  // in / im 这类有两个意思的，按释义分开
  const neg = NOT_MEANING.test(meaning)
  return keys.find(k => (neg ? /否/.test(k) : !/否/.test(k))) || keys[0]
}

/** 常见前缀（用于判断「词里含词根」是不是在词素边界上） */
const PREFIXES = [
  'anti', 'auto', 'bene', 'circum', 'com', 'con', 'col', 'cor', 'co', 'contra', 'counter', 'de', 'dis', 'di', 'en', 'em',
  'ex', 'e', 'extra', 'fore', 'hyper', 'im', 'in', 'il', 'ir', 'inter', 'intro', 'mal', 'micro', 'mis', 'multi', 'non',
  'ob', 'op', 'out', 'over', 'per', 'post', 'pre', 'pro', 'pur', 're', 'se', 'semi', 'sub', 'sup', 'suf', 'super', 'sur',
  'tele', 'trans', 'tri', 'un', 'under', 'uni', 'ad', 'ac', 'ap', 'as', 'at', 'bi', 'epi', 'ana', 'neo', 'hemi', 'a'
]
const SUFFIXES = [
  '', 'e', 's', 'es', 'ed', 'ing', 'er', 'or', 'ee', 'ist', 'ism', 'ion', 'ation', 'ition', 'ure', 'ment', 'ance', 'ence',
  'ant', 'ent', 'able', 'ible', 'ive', 'ative', 'al', 'ial', 'ic', 'ical', 'ous', 'ious', 'ful', 'less', 'ly', 'ally',
  'ity', 'ness', 'ify', 'ize', 'ise', 'ary', 'ery', 'ory', 'age', 'y', 'ation', 'ability', 'ibility', 'er', 'ers', 'ship',
  'ance', 'ancy', 'ency', 'et', 'ile', 'ite', 'ate', 'ator', 'ation', 'ogy', 'ology', 'ic', 'ics', 'ite', 'ous', 'ure'
]
const SUFFIX_SET = new Set(SUFFIXES)

/** word 是不是「前缀* + form + 后缀*」的结构 */
export function containsAtBoundary(word: string, form: string): { prefix: string; rest: string } | null {
  const w = lc(word)
  let from = 0
  while (true) {
    const i = w.indexOf(form, from)
    if (i < 0) return null
    const head = w.slice(0, i)
    const tail = w.slice(i + form.length)
    if (isPrefixChain(head) && isSuffixChain(tail, 0, form.slice(-1))) return { prefix: head, rest: tail }
    from = i + 1
  }
}
function isPrefixChain(s: string): boolean {
  if (!s) return true
  return PREFIXES.some(p => s.startsWith(p) && isPrefixChain(s.slice(p.length)))
}
/** last：前面词干的最后一个字母，只有跟它相同才算双写（plan-n-ing；kid-ney 不算） */
function isSuffixChain(s: string, depth = 0, last = ''): boolean {
  if (SUFFIX_SET.has(s)) return true
  if (depth > 2) return false
  for (const x of SUFFIXES) if (x && s.startsWith(x) && isSuffixChain(s.slice(x.length), depth + 1)) return true
  // 双写辅音 + 后缀：plan-n-ing
  if (depth === 0 && s.length > 1 && s[0] === last && /[bcdfgklmnprstvz]/.test(s[0]) && isSuffixChain(s.slice(1), depth + 1)) return true
  return false
}

/* ================================================================== */
/*  派生：word → base                                                  */
/* ================================================================== */

/** [后缀, 还原成的结尾…]，长的放前面 */
const DERIV_RULES: [string, string[]][] = [
  ['ically', ['ic', 'ical']], ['osity', ['ous']], ['ably', ['able']], ['ibly', ['ible']], ['ability', ['able']], ['ibility', ['ible']], ['iveness', ['ive']],
  ['ousness', ['ous']], ['fulness', ['ful']], ['lessness', ['less']], ['ization', ['ize']],
  ['isation', ['ise']], ['ication', ['y', 'icate']], ['ation', ['ate', 'e', '']], ['ition', ['ite', 'e', '']],
  ['ssion', ['ss', 't', 'd', 'de']], ['sion', ['de', 'se', 'd', 't', 'ce']], ['tion', ['te', 't', 'be']],
  ['ment', ['']], ['iness', ['y']], ['ness', ['']], ['ously', ['ous']], ['fully', ['ful']], ['ally', ['al', '']],
  ['ily', ['y']], ['ly', ['', 'le', 'e']], ['ility', ['le', 'il']], ['ity', ['e', '', 'ous']], ['ancy', ['ant']],
  ['ency', ['ent']], ['ance', ['', 'e', 'ant']], ['ence', ['', 'e', 'ent']], ['ative', ['ate', 'e', '']],
  ['ive', ['e', '', 'ion']], ['ure', ['e', '']], ['ial', ['y', 'e', '']], ['ical', ['ic', 'y', 'e']],
  ['ic', ['y', 'e', '', 'ism']], ['al', ['e', '', 'um']], ['ious', ['y', 'ion', 'e']], ['ous', ['', 'e', 'y', 'on']],
  ['ful', ['']], ['less', ['', 'y']], ['able', ['', 'e', 'ate']], ['ible', ['', 'e']], ['ee', ['', 'e']],
  ['ator', ['ate']], ['ist', ['', 'ism', 'y', 'e', 'ic']], ['ism', ['', 'e', 'ic']], ['ize', ['', 'e', 'y']],
  ['ise', ['', 'e', 'y']], ['ify', ['', 'y', 'ic', 'or']], ['ent', ['', 'e']], ['ant', ['', 'e', 'ate']],
  ['er', ['', 'e']], ['or', ['', 'e', 'ate']], ['y', ['', 'e']], ['ed', ['', 'e']], ['age', ['', 'e']],
  ['ship', ['']], ['hood', ['']], ['dom', ['']]
]
const DERIV_PREFIXES = ['un', 'in', 'im', 'il', 'ir', 'dis', 'mis', 'non', 'under', 'over', 're', 'de', 'counter', 'anti', 'super', 'cash-', 'world-']

export interface DerivLink { base: string; how: string; score: number }

/**
 * 找 word 在词库里的派生基词。has(word) 判断是否在词库。
 * 短后缀 + 短基词容易误判（rumor → rum），这类要求中文释义有重合。
 */
export function derivationBase(word: string, has: (w: string) => WordItem | undefined): DerivLink | null {
  const w = lc(word)
  const self = has(w)
  const tryBase = (b: string, how: string, strictShort: boolean, needGloss = false): DerivLink | null => {
    if (b.length < 3 || b === w) return null
    const hit = has(b)
    if (!hit) return null
    if (b.length < w.length * 0.45) return null
    const g = glossOverlap(self, hit)
    const short = b.length <= 4 || strictShort
    if (short && g < 0.2) return null
    // 拼写改动过的基词（stable → st+ate、compliment → compli→comply）要释义相关才算
    if (needGloss && g < 0.1) return null
    return { base: hit.word, how, score: 0.6 + Math.min(0.4, g) }
  }
  // y 变 i 只在这些后缀前常见；-ment 前不变（employment），compliment 不是 comply 的派生
  const Y_TO_I = /^(?:ness|less|ly|ful|er|est|ous|ance|ant|ed|es|ly|ty|al)$/
  for (const [suf, reps] of DERIV_RULES) {
    if (!w.endsWith(suf) || w.length - suf.length < 2) continue
    const stem = w.slice(0, -suf.length)
    // 候选 → 是否改过拼写
    const cands = new Map<string, boolean>()
    const add = (b: string, changed: boolean) => { if (!cands.has(b) || !changed) cands.set(b, changed) }
    const shortStem = stem.length < 3
    for (const r of reps) {
      add(stem + r, shortStem || r !== '')                              // 补回结尾（-e、-ate）的基词不再是原词前缀，要释义佐证
      if (/(.)\1$/.test(stem)) add(stem.slice(0, -1) + r, false)       // 双写：planning → plan
      if (stem.endsWith('i')) add(stem.slice(0, -1) + 'y' + r, !Y_TO_I.test(suf))  // happiness → happy
      if (stem.endsWith('at')) add(stem.slice(0, -2) + r, true)        // circulation 已由 ation 处理
    }
    for (const [b, changed] of cands) {
      const got = tryBase(b, `-${suf}`, suf.length <= 2, changed)
      if (got) return got
    }
  }
  for (const p of DERIV_PREFIXES) {
    const pp = p.replace(/-$/, '')
    if (!w.startsWith(pp) || w.length - pp.length < 4) continue
    const rest = w.slice(pp.length).replace(/^-/, '')
    // 基词太短时误判多（report 不是 port 的派生）
    if (rest.length < 5) continue
    const hit = has(rest)
    if (!hit) continue
    if (rest.length <= 6 && glossOverlap(self, hit) < 0.2) continue
    return { base: hit.word, how: `${pp}-`, score: 0.75 }
  }
  return null
}

/* ================================================================== */
/*  索引                                                               */
/* ================================================================== */

export interface ExternalData {
  /** ECDICT resemble.txt 解析后的同义组：[['poor','impoverished',…], …] */
  resembleGroups?: string[][]
  /** ECDICT wordroot.txt：词根 → { meaning, examples } */
  wordRoots?: Record<string, { meaning: string; examples: string[] }>
}

export interface LexIndex {
  words: WordItem[]
  byWord: Map<string, WordItem>
  /** 归一词素键 → [{词, 角色, 表层形式}] */
  morph: Map<string, { word: string; role: 'prefix' | 'root' | 'suffix'; form: string; meaning: string }[]>
  morphMeaning: Map<string, string>
  /** 词 → 派生基词 */
  baseOf: Map<string, DerivLink>
  /** 基词 → 派生词 */
  derivsOf: Map<string, string[]>
  /** 词 → 屈折变化形式（不当成独立词条） */
  inflectionOf: Map<string, string>
  syn: Map<string, Map<string, number>>
  ant: Map<string, Set<string>>
  /** 中文义项词条 → 词；以及每个词条的 IDF */
  sense: Map<string, Set<string>>
  senseIdf: Map<string, number>
  topic: Map<string, Set<string>>
  rank: Map<string, number>
  ext: ExternalData
  /** 输入词条数与其中的同名重复条数 */
  inputCount: number
  duplicates: number
}

const LEVEL_RANK: Record<string, number> = { 初中: 1, 高考: 2, CET4: 3, CET6: 4, 考研: 5, IELTS: 5, TOEFL: 6, SAT: 7, GRE: 8 }

function addSyn(idx: Map<string, Map<string, number>>, a: string, b: string, w: number) {
  if (!a || !b || a === b) return
  for (const [x, y] of [[a, b], [b, a]]) {
    let m = idx.get(x)
    if (!m) idx.set(x, (m = new Map()))
    m.set(y, Math.max(m.get(y) || 0, w))
  }
}

export function buildIndex(words: WordItem[], ext: ExternalData = {}): LexIndex {
  const inputCount = words.length
  // 同名词条合并：以信息最多的一条为主，缺的字段从其他条补上
  const byWord = new Map<string, WordItem>()
  let duplicates = 0
  for (const w of words) {
    if (!w?.word) continue
    const k = lc(w.word)
    const old = byWord.get(k)
    if (!old) { byWord.set(k, w); continue }
    duplicates++
    const [main, other] = richness(w) > richness(old) ? [w, old] : [old, w]
    const merged: any = { ...main }
    for (const [f, v] of Object.entries(other)) {
      const cur = merged[f]
      const empty = cur == null || (Array.isArray(cur) && !cur.length) || cur === ''
      if (empty && v != null) merged[f] = v
    }
    if (!main.meanings?.[0]?.chinese && other.meanings?.[0]?.chinese) merged.meanings = other.meanings
    byWord.set(k, merged)
  }
  words = [...byWord.values()]
  const has = (s: string) => byWord.get(lc(s))

  // 屈折形式：morphology 里列出的形式如果也作为词条存在，就标成屈折形式
  const inflectionOf = new Map<string, string>()
  for (const w of words) {
    const m = w.morphology
    if (!m) continue
    for (const v of Object.values(m)) {
      for (const f of String(v || '').split(/[,，/;；\s]+/)) {
        const k = lc(f)
        if (k && k !== lc(w.word) && byWord.has(k)) inflectionOf.set(k, w.word)
      }
    }
  }

  // 没有 morphology 字段时，按规则认复数、三单、过去式、进行式（exports → export）
  for (const w of words) {
    const k = lc(w.word)
    if (inflectionOf.has(k)) continue
    const cands: string[] = []
    if (/[^s]s$/.test(k)) cands.push(k.slice(0, -1))
    if (/(ses|xes|ches|shes|zes)$/.test(k)) cands.push(k.slice(0, -2))
    if (/ies$/.test(k)) cands.push(k.slice(0, -3) + 'y')
    if (/ing$/.test(k)) cands.push(k.slice(0, -3), k.slice(0, -3) + 'e', k.slice(0, -4))
    for (const c of cands) {
      const b = byWord.get(c)
      const samePos = posOf(w) === posOf(b) || /s$/.test(k)
      if (b && c.length >= 3 && glossOverlap(w, b) >= 0.5 && samePos) { inflectionOf.set(k, b.word); break }
    }
  }

  // 英美拼写变体（rumour / rumor、organise / organize）并到常见写法下
  const VARIANT_RULES: [RegExp, string][] = [[/our$/, 'or'], [/our(?=[a-z]+$)/, 'or'], [/ise$/, 'ize'], [/isation$/, 'ization'], [/tre$/, 'ter'], [/ogue$/, 'og'], [/ence$/, 'ense'], [/lled$/, 'led']]
  for (const w of words) {
    const k = lc(w.word)
    if (inflectionOf.has(k)) continue
    for (const [re, rep] of VARIANT_RULES) {
      if (!re.test(k)) continue
      const alt = k.replace(re, rep)
      const b = byWord.get(alt)
      if (b && glossOverlap(w, b) >= 0.5) { inflectionOf.set(k, b.word); break }
    }
  }

  // 词素
  const morph: LexIndex['morph'] = new Map()
  const morphMeaning = new Map<string, string>()
  const pushMorph = (key: string, e: { word: string; role: 'prefix' | 'root' | 'suffix'; form: string; meaning: string }) => {
    if (!key) return
    const arr = morph.get(key) || []
    if (!arr.some(x => x.word === e.word)) arr.push(e)
    morph.set(key, arr)
    if (e.meaning && !morphMeaning.has(key)) morphMeaning.set(key, e.meaning)
  }
  for (const w of words) {
    const m = w.morphemes
    if (!m) continue
    for (const role of ['prefix', 'root', 'suffix'] as const) {
      const p = m[role]
      if (!p?.form) continue
      const key = canonicalMorpheme(p.form, p.meaning, role)
      pushMorph(key, { word: w.word, role, form: cleanForm(p.form), meaning: p.meaning || '' })
    }
  }
  // 自动合并：terri / terr、legis / leg 这类「一个是另一个的前缀且释义一致」
  const keys = [...morph.keys()].filter(k => !/[()]/.test(k) && !k.startsWith('-')).sort((a, b) => a.length - b.length)
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i], b = keys[j]
      // sphere 与 spheric、terr 与 terrif：去掉结尾 e 再比前缀
      const sa = a.length > 4 ? a.replace(/e$/, '') : a
      if (sa.length < 3 || !b.startsWith(sa) || !morph.has(a) || !morph.has(b)) continue
      const ma = morphMeaning.get(a) || '', mb = morphMeaning.get(b) || ''
      const sameMeaning = ma && mb && [...charSet(ma)].some(c => charSet(mb).has(c))
      if (!sameMeaning) continue
      for (const e of morph.get(b)!) pushMorph(a, e)
      morph.delete(b)
    }
  }
  // 同形异义：terr（恐惧）与 terr（土地）分成两个键。英文释义当通配，并入最大的一组
  const isAscii = (x: string) => !/[\u4e00-\u9fff]/.test(x)
  for (const key of [...morph.keys()]) {
    if (key.includes('(')) continue
    const list = morph.get(key)!
    if (key.startsWith('-')) continue
    const known = list.filter(e => e.meaning && conceptOf(e.meaning))
    const concepts = new Set(known.map(e => conceptOf(e.meaning)))
    if (concepts.size < 2) continue
    const byC = new Map<string, typeof list>()
    for (const e of known) {
      const c = conceptOf(e.meaning)
      if (!byC.has(c)) byC.set(c, [])
      byC.get(c)!.push(e)
    }
    const clusters = [...byC.values()]
    // 两组释义只要有共同的字，就还是同一个意思
    const chars = clusters.map(c => new Set(c.flatMap(e => [...charSet(e.meaning)])))
    let overlap = false
    for (let i = 0; i < chars.length && !overlap; i++) for (let j = i + 1; j < chars.length && !overlap; j++) overlap = [...chars[i]].some(ch => chars[j].has(ch))
    if (overlap) continue
    clusters.sort((a, b) => b.length - a.length)
    const main = clusters[0]
    const rest = new Set(clusters.slice(1).flat())
    void isAscii
    morph.set(key, list.filter(e => !rest.has(e)))
    morphMeaning.set(key, main[0].meaning)
    for (const c of clusters.slice(1)) {
      const sub = `${key}(${c[0].meaning.slice(0, 4)})`
      morph.set(sub, c)
      morphMeaning.set(sub, c[0].meaning)
    }
  }

  // 键的释义取出现最多的中文说法
  for (const [key, list] of morph) {
    const votes = new Map<string, number>()
    for (const e of list) if (e.meaning && /[\u4e00-\u9fff]/.test(e.meaning)) votes.set(e.meaning, (votes.get(e.meaning) || 0) + 1)
    const top = [...votes.entries()].sort((x, y) => y[1] - x[1])[0]
    if (top) morphMeaning.set(key, top[0])
  }

  // 外部词根表：把例词里在词库中的也挂上（中等证据）
  for (const [form, info] of Object.entries(ext.wordRoots || {})) {
    const key = canonicalMorpheme(form, info.meaning, 'root')
    if (info.meaning && !morphMeaning.has(key)) morphMeaning.set(key, info.meaning)
    for (const ex of info.examples) {
      const hit = has(ex)
      if (hit) pushMorph(key, { word: hit.word, role: 'root', form: cleanForm(form), meaning: info.meaning })
    }
  }

  // 派生
  const baseOf = new Map<string, DerivLink>()
  const derivsOf = new Map<string, string[]>()
  for (const w of words) {
    const k = lc(w.word)
    if (inflectionOf.has(k)) continue
    const d = derivationBase(k, has)
    if (!d) continue
    baseOf.set(k, d)
    const arr = derivsOf.get(lc(d.base)) || []
    arr.push(w.word)
    derivsOf.set(lc(d.base), arr)
  }
  // word_family 字段：短的当基词
  for (const w of words) {
    for (const f of w.word_family || []) {
      const hit = has(String(f))
      if (!hit || lc(hit.word) === lc(w.word)) continue
      const [short, long] = hit.word.length <= w.word.length ? [hit, w] : [w, hit]
      const lk = lc(long.word)
      if (baseOf.has(lk) || inflectionOf.has(lk) || isPhrase(lk)) continue
      // 只有长词以短词词干开头才算派生（export 不是 port 的派生，transport 不是 portable 的派生）
      const st = lc(short.word).replace(/(e|y|le)$/, '')
      if (st.length < 3 || lk.length <= lc(short.word).length || !lk.startsWith(st)) continue
      // 余下部分要像后缀（port → portuguese 不算），否则要求释义相关
      if (!isSuffixChain(lk.slice(st.length), 0, st.slice(-1)) && glossOverlap(short, long) < 0.2) continue
      // 词干削过结尾（state → stat-ion）时，词源相关不等于学习上相关：释义要沾边
      if (st !== lc(short.word) && glossOverlap(short, long) < 0.1) continue
      baseOf.set(lk, { base: short.word, how: 'word_family', score: 0.7 })
      const arr = derivsOf.get(lc(short.word)) || []
      if (!arr.includes(long.word)) arr.push(long.word)
      derivsOf.set(lc(short.word), arr)
    }
  }

  // 同义 / 反义
  const syn = new Map<string, Map<string, number>>()
  const ant = new Map<string, Set<string>>()
  for (const w of words) {
    const a = lc(w.word)
    for (const s of w.synonyms || []) if (has(s.word)) addSyn(syn, a, lc(s.word), 1)
    for (const m of w.meanings || []) for (const s of m.synonyms || []) if (has(s)) addSyn(syn, a, lc(s), 0.9)
    for (const x of w.antonyms || []) {
      if (!has(x.word)) continue
      const b = lc(x.word)
      if (!ant.has(a)) ant.set(a, new Set())
      if (!ant.has(b)) ant.set(b, new Set())
      ant.get(a)!.add(b); ant.get(b)!.add(a)
    }
  }
  for (const g of ext.resembleGroups || []) {
    const inLib = g.map(lc).filter(x => byWord.has(x))
    for (let i = 0; i < inLib.length; i++) for (let j = i + 1; j < inLib.length; j++) addSyn(syn, inLib[i], inLib[j], 0.95)
  }

  // 中文义项
  const sense = new Map<string, Set<string>>()
  for (const w of words) {
    const k = lc(w.word)
    if (inflectionOf.has(k)) continue
    for (const t of senseTerms(w)) {
      if (!sense.has(t)) sense.set(t, new Set())
      sense.get(t)!.add(k)
    }
  }
  const senseIdf = new Map<string, number>()
  const N = Math.max(1, words.length)
  for (const [t, s] of sense) senseIdf.set(t, Math.log(1 + N / s.size))

  // 话题
  const topic = new Map<string, Set<string>>()
  for (const w of words) {
    for (const t of w.topics || []) {
      if (!topic.has(t)) topic.set(t, new Set())
      topic.get(t)!.add(lc(w.word))
    }
  }

  // 常用度：级别越低越常用；已标注学习状态的优先
  const rank = new Map<string, number>()
  for (const w of words) {
    let r = 5
    for (const t of [w.level, ...(w.tags || [])]) if (t && LEVEL_RANK[t] != null) r = Math.min(r, LEVEL_RANK[t])
    if (w.status && w.status !== 'unmarked') r -= 0.5
    rank.set(lc(w.word), r)
  }

  const out: LexIndex = { words, byWord, morph, morphMeaning, baseOf, derivsOf, inflectionOf, syn, ant, sense, senseIdf, topic, rank, ext, inputCount, duplicates }
  lastIdx = out
  return out
}

/* ================================================================== */
/*  公共：把一个词展开成笔记条目                                        */
/* ================================================================== */

export interface ExpandOptions {
  maxDerivs?: number
  maxPhrases?: number
  maxLinks?: number
  /** 这些词已经作为主词出现，不再重复挂成派生或延伸 */
  exclude?: Set<string>
}

/** 基词的全部派生（两层），按长度排 */
export function derivTree(idx: LexIndex, word: string, depth = 2): string[] {
  const out: string[] = []
  const seen = new Set<string>([lc(word)])
  let frontier = [lc(word)]
  for (let d = 0; d < depth; d++) {
    const next: string[] = []
    for (const f of frontier) {
      for (const x of idx.derivsOf.get(f) || []) {
        const k = lc(x)
        if (isPhrase(k)) continue
        if (seen.has(k) || isPrefixDeriv(idx.baseOf.get(k))) continue
        seen.add(k); out.push(x); next.push(k)
      }
    }
    frontier = next
  }
  return out.sort((a, b) => a.length - b.length)
}

export function formulaOf(idx: LexIndex, w: WordItem): string {
  const m = w.morphemes
  if (!m) return ''
  const parts: string[] = []
  for (const role of ['prefix', 'root', 'suffix'] as const) {
    const p = m[role]
    if (!p?.form) continue
    const f = cleanForm(p.form)
    const label = role === 'prefix' ? `${f}-` : role === 'suffix' ? `-${f}` : f
    parts.push(p.meaning ? `${label}（${p.meaning}）` : label)
  }
  return parts.length >= 2 ? parts.join(' + ') : ''
}

export function expandWord(idx: LexIndex, word: string, opts: ExpandOptions = {}, evidence: string[] = [], confidence = 1): NoteWord | null {
  const w = idx.byWord.get(lc(word))
  if (!w) return null
  const ex = opts.exclude || new Set<string>()
  const derivs = derivTree(idx, w.word)
    .filter(d => !ex.has(lc(d)))
    .slice(0, opts.maxDerivs ?? 4)
    .map(d => { const x = idx.byWord.get(lc(d)); return { word: d, zh: zhOf(x), pos: posOf(x) } })
  const phrases = (w.common_phrases || [])
    .slice(0, opts.maxPhrases ?? 2)
    .map(p => ({ en: p.phrase_en, zh: p.phrase_zh }))
  const links: NoteLink[] = []
  const base = idx.baseOf.get(lc(w.word))
  if (base && !ex.has(lc(base.base))) links.push({ kind: 'base', word: base.base, zh: zhOf(idx.byWord.get(lc(base.base))) })
  const syns = [...(idx.syn.get(lc(w.word)) || new Map()).entries()]
    .filter(([s]) => !ex.has(s))
    .sort((a, b) => b[1] - a[1] || (idx.rank.get(a[0]) ?? 5) - (idx.rank.get(b[0]) ?? 5))
  for (const [s] of syns.slice(0, 2)) links.push({ kind: 'syn', word: idx.byWord.get(s)!.word, zh: zhOf(idx.byWord.get(s)) })
  for (const a of [...(idx.ant.get(lc(w.word)) || [])].filter(a => !ex.has(a)).slice(0, 1)) links.push({ kind: 'ant', word: idx.byWord.get(a)!.word, zh: zhOf(idx.byWord.get(a)) })
  return {
    word: w.word, zh: zhOf(w), pos: posOf(w), formula: formulaOf(idx, w),
    derivs, phrases, links: links.slice(0, opts.maxLinks ?? 3), evidence, confidence
  }
}

/** 形近易混：拼写很像、但词根不同 */
export function confusablesOf(idx: LexIndex, word: string, rootKey?: string, limit = 3): string[] {
  const w = lc(word)
  const out: { k: string; d: number }[] = []
  const myRoot = rootKey || rootKeyOf(idx.byWord.get(w))
  for (const [k, item] of idx.byWord) {
    if (k === w || idx.inflectionOf.has(k) || isPhrase(k) || Math.abs(k.length - w.length) > 2 || k.length < 5) continue
    if (k[0] !== w[0] && k.slice(-3) !== w.slice(-3)) continue
    const d = editDistance(k, w)
    if (d > 2 || d === 0) continue
    // 同一词族的不算易混
    if (sameFamily(idx, k, w)) continue
    const r = rootKeyOf(item)
    if (myRoot && r && r === myRoot) continue
    out.push({ k, d })
  }
  return out.sort((a, b) => a.d - b.d || (idx.rank.get(a.k) ?? 5) - (idx.rank.get(b.k) ?? 5)).slice(0, limit).map(x => idx.byWord.get(x.k)!.word)
}

let lastIdx: LexIndex | null = null
function rootKeyOf(w?: WordItem): string {
  const r = w?.morphemes?.root
  if (!r?.form) return ''
  const base = canonicalMorpheme(r.form, r.meaning, 'root')
  // 同形异义拆过键的，按词实际所在的键返回
  if (lastIdx && w) {
    for (const [k, list] of lastIdx.morph) {
      if ((k === base || k.startsWith(base + '(')) && list.some(e => e.word === w.word && e.role === 'root')) return k
    }
    for (const [k, list] of lastIdx.morph) if (list.some(e => e.word === w.word && e.role === 'root')) return k
  }
  return base
}

/** 前缀派生（mis-represent、un-happy）词义变了，不算同一词族，只作为「基词」链接 */
function isPrefixDeriv(d?: DerivLink): boolean {
  return !!d && /-$/.test(d.how)
}
function familyHead(idx: LexIndex, word: string): string {
  let k = lc(word)
  const seen = new Set<string>()
  while (idx.baseOf.has(k) && !seen.has(k) && !isPrefixDeriv(idx.baseOf.get(k))) { seen.add(k); k = lc(idx.baseOf.get(k)!.base) }
  return k
}
export function sameFamily(idx: LexIndex, a: string, b: string): boolean {
  return familyHead(idx, a) === familyHead(idx, b)
}

/* ================================================================== */
/*  1. 词根族                                                          */
/* ================================================================== */

export function findMorphemeKey(idx: LexIndex, query: string): string {
  const q = cleanForm(query)
  if (idx.morph.has(q)) return q
  const c = canonicalMorpheme(q)
  if (idx.morph.has(c)) return c
  for (const [k, forms] of Object.entries(MORPHEME_VARIANTS)) if (forms.includes(q) && idx.morph.has(k)) return k
  // 输入的是一个单词：取它的词根
  const w = idx.byWord.get(lc(query))
  if (!w) return ''
  const own = rootKeyOf(w)
  if (own && idx.morph.has(own)) return own
  // 没有词素字段：看派生基词的词根
  const b = idx.baseOf.get(lc(w.word))
  if (b) {
    const bk = rootKeyOf(idx.byWord.get(lc(b.base)))
    if (bk && idx.morph.has(bk)) return bk
  }
  // 再不行：在词素边界上找成员最多的已知词根（export → port）
  let best = '', bestN = 2
  for (const [k, list] of idx.morph) {
    const f = k.replace(/\(.*\)/, '')
    if (f.length < 3 || list.length <= bestN || !lc(w.word).includes(f)) continue
    if (!list.some(e => e.role === 'root')) continue
    if (containsAtBoundary(w.word, f)) { best = k; bestN = list.length }
  }
  return best || own
}

export function buildRootNote(idx: LexIndex, query: string, opts: { maxWords?: number } = {}): FamilyNote | null {
  const key = findMorphemeKey(idx, query)
  if (!key) return null
  const meaning = idx.morphMeaning.get(key) || ''
  const forms = new Set<string>([key.replace(/\(.*\)/, ''), ...(MORPHEME_VARIANTS[key] || [])])
  for (const e of idx.morph.get(key) || []) forms.add(e.form)

  const cand = new Map<string, { ev: Set<string>; conf: number }>()
  const give = (word: string, ev: string, conf: number) => {
    const k = lc(word)
    if (idx.inflectionOf.has(k) || isPhrase(k)) return
    const c = cand.get(k) || { ev: new Set(), conf: 0 }
    c.ev.add(ev)
    c.conf = Math.min(1, Math.max(c.conf, conf) + (c.ev.size > 1 ? 0.1 : 0))
    cand.set(k, c)
  }
  // 强证据：词素字段
  for (const e of idx.morph.get(key) || []) give(e.word, `词素 ${e.role}`, 0.95)
  // 词条自己没有词素字段、但词素归到了这个键的派生词，跟着基词显示
  // 中证据：词里在词素边界上含这个形式（port 在 export 里，不在 sport / portrait 里）
  const stem = (x: string) => x.replace(/\(.*\)/, '').replace(/e$/, '')
  const related = (recorded: string) => {
    if (!recorded || recorded === key) return true
    // 按义项拆开的键（terr(土地)）是有意区分的，不再按词干合并
    if (recorded.includes('(') || key.includes('(')) return false
    const a = stem(recorded), b = stem(key)
    if (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))) return true
    const ca = conceptOf(idx.morphMeaning.get(recorded) || ''), cb = conceptOf(meaning)
    return !!ca && ca === cb
  }
  const lookalike = new Set<string>()
  // 同形异义拆开的兄弟键（terr(土地)）的词，直接算易混
  const bare = key.replace(/\(.*\)/, '')
  for (const [k2, list] of idx.morph) {
    if (k2 === key || k2.replace(/\(.*\)/, '') !== bare) continue
    for (const e of list) if (e.role !== 'suffix') lookalike.add(lc(e.word))
  }
  /** 沿派生链（含前缀派生）往上找，碰到候选词就说明是自家的 */
  const inFamily = (k: string) => {
    let cur = k
    for (let i = 0; i < 4; i++) {
      const b = idx.baseOf.get(cur)
      if (!b) return false
      cur = lc(b.base)
      if (cand.has(cur)) return true
    }
    return false
  }
  for (const [k] of idx.byWord) {
    if (cand.has(k) || idx.inflectionOf.has(k) || isPhrase(k) || lookalike.has(k)) continue
    if (inFamily(k)) continue
    for (const f of forms) {
      if (f.length < 3 || !k.includes(f)) continue
      // 词根不在词首、也不在词素边界上的（interrelate 里的 terr），不算相关也不算易混
      if (!k.startsWith(f) && !containsAtBoundary(k, f)) continue
      const hit = containsAtBoundary(k, f)
      const recorded = rootKeyOf(idx.byWord.get(k))
      // 没有词素记录、也没有前缀的（port 港口），要求释义与词根是同一概念
      if (hit && !recorded && !hit.prefix) {
        const c = conceptOf(senseTerms(idx.byWord.get(k)).join(' '))
        if (!c || c !== conceptOf(meaning)) { lookalike.add(k); break }
      }
      if (hit && related(recorded)) { give(k, `拼写 ${hit.prefix ? hit.prefix + '-' : ''}${f}`, recorded ? 0.8 : 0.55); break }
      if (!related(recorded)) { lookalike.add(k); break }
    }
  }
  // 派生词跟着基词走，不单列
  const heads = [...cand.keys()].filter(k => {
    const b = idx.baseOf.get(k)
    return !(b && cand.has(lc(b.base)))
  })

  // 按前缀分支
  const branchOf = (k: string): string => {
    const w = idx.byWord.get(k)!
    const p = w.morphemes?.prefix
    if (p?.form) return `${cleanForm(p.form)}-${p.meaning ? `（${p.meaning}）` : ''}`
    for (const f of forms) {
      const hit = containsAtBoundary(k, f)
      if (hit) return hit.prefix ? `${hit.prefix}-` : '本词'
    }
    return '其他'
  }
  const max = opts.maxWords ?? 14
  const ranked = heads
    .sort((a, b) => cand.get(b)!.conf - cand.get(a)!.conf || (idx.rank.get(a) ?? 5) - (idx.rank.get(b) ?? 5) || a.length - b.length)
    .slice(0, max)
  const exclude = new Set(ranked)
  const branches = new Map<string, NoteWord[]>()
  for (const k of ranked) {
    const c = cand.get(k)!
    const nw = expandWord(idx, k, { exclude, maxDerivs: 3 }, [...c.ev], c.conf)
    if (!nw) continue
    const b = branchOf(k)
    if (!branches.has(b)) branches.set(b, [])
    branches.get(b)!.push(nw)
  }

  // 易混：拼写上含这个形式但词根不是它（distort 之于 port），再加上跟主词形近的
  const confuse = new Set<string>()
  for (const k of lookalike) confuse.add(idx.byWord.get(k)!.word)
  for (const k of ranked) for (const x of confusablesOf(idx, k, key, 1)) if (!exclude.has(lc(x))) confuse.add(x)

  if (branches.size === 1 && branches.has('本词')) {
    const flat = new Set<string>()
    for (const k of ranked) { flat.add(k); for (const d of derivTree(idx, k)) flat.add(lc(d)) }
    branches.clear()
    const ex2 = new Set(flat)
    for (const k of flat) {
      const w = idx.byWord.get(k)!
      const suf = w.morphemes?.suffix
      const how = idx.baseOf.get(k)?.how
      const tailSuf = [...SUFFIX_SET].filter(x => x.length >= 2 && k.endsWith(x) && k.length - x.length >= 3).sort((a, b) => b.length - a.length)[0]
      const label = suf?.form ? `-${cleanForm(suf.form)}${suf.meaning ? `（${suf.meaning}）` : ''}`
        : how && how.startsWith('-') ? how
        : tailSuf && !forms.has(k) ? `-${tailSuf}` : '本词'
      const c = cand.get(k)
      const nw = expandWord(idx, k, { exclude: ex2, maxDerivs: 0 }, c ? [...c.ev] : ['派生'], c?.conf ?? 0.8)
      if (!nw) continue
      if (!branches.has(label)) branches.set(label, [])
      branches.get(label)!.push(nw)
    }
  }

  const allWords = [...branches.values()].flat()
  return {
    kind: 'root',
    title: `${key.replace(/\(.*\)/, '')}${meaning ? ' = ' + meaning : ''}`,
    hub: { label: key.replace(/\(.*\)/, ''), sub: meaning },
    branches: [...branches.entries()]
      .sort((a, b) => (a[0] === '本词' ? -1 : b[0] === '本词' ? 1 : b[1].length - a[1].length))
      .map(([label, words]) => ({ label, words })),
    side: confuse.size
      ? [{ label: '易混', items: [...confuse].slice(0, 6).map(x => ({ kind: 'confuse' as const, word: x, zh: zhOf(idx.byWord.get(lc(x))) })) }]
      : [],
    stats: { candidates: cand.size, kept: allWords.length, lowConfidence: allWords.filter(x => x.confidence < 0.7).length },
    createdFrom: query
  }
}

/* ================================================================== */
/*  2. 同义族                                                          */
/* ================================================================== */

function senseScore(idx: LexIndex, a: string, b: string): number {
  const A = senseTerms(idx.byWord.get(a)), B = new Set(senseTerms(idx.byWord.get(b)))
  let s = 0
  for (const t of A) if (B.has(t)) s += idx.senseIdf.get(t) || 0
  // 词条不完全相同时，看字重合（贫穷 / 贫困）
  if (!s) s = glossOverlap(idx.byWord.get(a), idx.byWord.get(b)) >= 0.5 ? 1.2 : 0
  return s
}

export function buildSynonymNote(idx: LexIndex, seed: string, opts: { maxWords?: number; sense?: string } = {}): FamilyNote | null {
  const s0 = lc(seed)
  const sw = idx.byWord.get(s0)
  if (!sw) return null
  const pos = posOf(sw)
  const score = new Map<string, { s: number; ev: Set<string> }>()
  const bump = (k: string, v: number, ev: string) => {
    if (k === s0 || idx.inflectionOf.has(k) || isPhrase(k)) return
    const cur = score.get(k) || { s: 0, ev: new Set() }
    cur.s += v; cur.ev.add(ev)
    score.set(k, cur)
  }
  // 一跳同义
  for (const [k, w] of idx.syn.get(s0) || []) bump(k, 1.2 * w, '同义')
  // 两跳：至少两条路径支持才算
  const twoHop = new Map<string, number>()
  for (const [k] of idx.syn.get(s0) || []) for (const [k2] of idx.syn.get(k) || []) if (k2 !== s0) twoHop.set(k2, (twoHop.get(k2) || 0) + 1)
  for (const [k, n] of twoHop) if (n >= 2) bump(k, 0.35 * n, `同义链×${n}`)
  // 同义项（中文）
  const terms = opts.sense ? [opts.sense] : senseTerms(sw)
  const N = idx.byWord.size
  // 一跳同义词的释义也算，打六折（poor 的「贫穷」能找到 penniless）
  // 主义项（第一个义项）权重 1，其余义项 0.5（terrible 的「非常」「极度」不该拉进 deadly、mighty）
  const primary = new Set(senseTermsOfFirst(sw))
  const weightOf = new Map<string, number>(terms.map(t => [t, primary.has(t) || opts.sense ? 1 : 0.5]))
  if (!opts.sense) {
    for (const [k] of idx.syn.get(s0) || []) for (const t of senseTerms(idx.byWord.get(k))) if (!weightOf.has(t)) weightOf.set(t, 0.6)
  }
  for (const [t, tw] of weightOf) {
    const members = idx.sense.get(t) || new Set()
    // 词条太泛（占词库一成以上）不算证据
    if (members.size > Math.max(8, N * 0.1)) continue
    const idf = idx.senseIdf.get(t) || 0
    for (const k of members) {
      const main = senseTermsOfFirst(idx.byWord.get(k)).includes(t) ? 1 : 0.5
      bump(k, tw * main * Math.min(0.9, 0.45 * idf), `释义「${t}」`)
    }
  }
  for (const [k] of idx.byWord) {
    if (k === s0) continue
    if (glossOverlap(sw, idx.byWord.get(k)) >= 0.66 && senseScore(idx, s0, k) > 0) bump(k, 0.5, '释义相近')
  }

  // 同词性、去掉派生重复
  const kept = [...score.entries()]
    .filter(([k, v]) => v.s >= (v.ev.has('同义') ? 0.75 : 1.0) && (!pos || posOf(idx.byWord.get(k)) === pos || v.ev.has('同义')))
    .sort((a, b) => b[1].s - a[1].s)
  const heads: string[] = [s0]
  for (const [k] of kept) {
    if (heads.length >= (opts.maxWords ?? 9)) break
    if (heads.some(h => sameFamily(idx, h, k))) continue
    heads.push(k)
  }
  if (heads.length < 2) return null

  // 标题：最常见的中文义项 + 最常用的英文词
  const termVotes = new Map<string, number>()
  for (const h of heads) for (const t of senseTerms(idx.byWord.get(h))) termVotes.set(t, (termVotes.get(t) || 0) + 1)
  const topTerm = opts.sense || [...termVotes.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] || zhOf(sw)
  const plain = [...heads].sort((a, b) => (idx.rank.get(a) ?? 5) - (idx.rank.get(b) ?? 5) || a.length - b.length)[0]

  const exclude = new Set(heads)
  const words: NoteWord[] = []
  for (const h of heads) {
    const v = score.get(h)
    const conf = h === s0 ? 1 : Math.min(1, 0.4 + v!.s / 2.5)
    const nw = expandWord(idx, h, { exclude, maxDerivs: 3, maxLinks: 2 }, h === s0 ? ['起点'] : [...v!.ev], conf)
    if (!nw) continue
    // 延伸：同词根的其他词（impecunious → pecuniary）
    const rk = rootKeyOf(idx.byWord.get(h))
    if (rk) {
      const cousin = (idx.morph.get(rk) || []).map(e => lc(e.word)).find(x => !exclude.has(x) && !sameFamily(idx, x, h))
      if (cousin) nw.links.push({ kind: 'root', word: idx.byWord.get(cousin)!.word, zh: zhOf(idx.byWord.get(cousin)) })
    }
    words.push(nw)
  }
  // 易混
  const confuse = new Set<string>()
  for (const h of heads) for (const x of confusablesOf(idx, h, undefined, 1)) if (!exclude.has(lc(x))) confuse.add(x)

  return {
    kind: 'synonym',
    title: `${topTerm} ${idx.byWord.get(plain)!.word}`,
    hub: { label: topTerm, sub: idx.byWord.get(plain)!.word },
    branches: [{ label: pos || '同义', words }],
    side: confuse.size ? [{ label: '易混', items: [...confuse].slice(0, 4).map(x => ({ kind: 'confuse' as const, word: x, zh: zhOf(idx.byWord.get(lc(x))) })) }] : [],
    stats: { candidates: score.size, kept: words.length, lowConfidence: words.filter(x => x.confidence < 0.7).length },
    createdFrom: seed
  }
}

/* ================================================================== */
/*  3. 话题族 + 多级话题树                                              */
/* ================================================================== */

/** 词与词的语义边（同义、释义、派生），用于话题内再分组 */
function semanticEdges(idx: LexIndex, keys: string[], opts: { charOverlap?: boolean } = {}): Map<string, Map<string, number>> {
  const set = new Set(keys)
  const adj = new Map<string, Map<string, number>>()
  const add = (a: string, b: string, w: number) => {
    if (a === b || !set.has(a) || !set.has(b)) return
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!adj.has(x)) adj.set(x, new Map())
      adj.get(x)!.set(y, (adj.get(x)!.get(y) || 0) + w)
    }
  }
  for (const a of keys) {
    for (const [b, w] of idx.syn.get(a) || []) add(a, b, 1.5 * w)
    const b = idx.baseOf.get(a)
    if (b) add(a, lc(b.base), 2)
  }
  // 小集合里再补释义字重合（流传 / 传播）
  if (opts.charOverlap !== false && keys.length <= 150) {
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const g = glossOverlap(idx.byWord.get(keys[i]), idx.byWord.get(keys[j]))
        if (g >= 0.5) add(keys[i], keys[j], 0.5 * g)
      }
    }
  }
  // 释义词条：同一词条下的词两两相连（词条太泛的跳过）
  for (const [t, members] of idx.sense) {
    const inSet = [...members].filter(m => set.has(m))
    if (inSet.length < 2 || inSet.length > 12) continue
    const w = Math.min(1.2, (idx.senseIdf.get(t) || 0) / 4)
    for (let i = 0; i < inSet.length; i++) for (let j = i + 1; j < inSet.length; j++) add(inSet[i], inSet[j], w)
  }
  return adj
}

/** 加权标签传播，得到语义小组 */
export function communities(adj: Map<string, Map<string, number>>, keys: string[], rounds = 12): Map<string, string> {
  const label = new Map(keys.map(k => [k, k]))
  const order = [...keys].sort()
  for (let r = 0; r < rounds; r++) {
    let changed = false
    for (const k of order) {
      const nb = adj.get(k)
      if (!nb) continue
      const votes = new Map<string, number>()
      for (const [n, w] of nb) votes.set(label.get(n)!, (votes.get(label.get(n)!) || 0) + w)
      let best = label.get(k)!, bw = votes.get(best) || 0
      for (const [l, w] of votes) if (w > bw || (w === bw && l < best)) { best = l; bw = w }
      if (best !== label.get(k)) { label.set(k, best); changed = true }
    }
    if (!changed) break
  }
  return label
}

function groupLabel(idx: LexIndex, members: string[]): string {
  // 组内越多词共有的词条越合适；出现在主义项里的加分；都只出现一次时退回最常见的两字片段
  const score = new Map<string, number>()
  const cnt = new Map<string, number>()
  for (const m of members) {
    const w = idx.byWord.get(m)
    const first = new Set(senseTermsOfFirst(w))
    for (const t of new Set(senseTerms(w))) {
      cnt.set(t, (cnt.get(t) || 0) + 1)
      score.set(t, (score.get(t) || 0) + 1 + (first.has(t) ? 0.5 : 0))
    }
  }
  const shared = [...score.entries()].filter(([t]) => (cnt.get(t) || 0) >= 2)
  if (shared.length) {
    return shared.sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0]
  }
  const bi = new Map<string, number>()
  for (const m of members) {
    const seen = new Set<string>()
    for (const t of senseTermsOfFirst(idx.byWord.get(m))) {
      for (let i = 0; i + 2 <= t.length; i++) seen.add(t.slice(i, i + 2))
    }
    for (const b of seen) bi.set(b, (bi.get(b) || 0) + 1)
  }
  const topBi = [...bi.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0]
  return topBi ? topBi[0] : zhOf(idx.byWord.get(members[0]))
}

export interface TopicTreeNode {
  id: string
  label: string
  /** 1 大类，2 话题，3 及以下为逐层细分 */
  level: number
  words: string[]
  children: TopicTreeNode[]
  /** 还没细分（懒加载），展开时调用 expandTopicNode */
  pending?: boolean
  /** 叶子里和本组相似度偏低、归类存疑的词 */
  weak?: string[]
}

const POS_NAME: Record<string, string> = { n: '名词', v: '动词', adj: '形容词', adv: '副词' }

type Vec = Map<string, number>

function norm(v: Vec): Vec {
  let s = 0
  for (const x of v.values()) s += x * x
  const n = Math.sqrt(s) || 1
  const out: Vec = new Map()
  for (const [k, x] of v) out.set(k, x / n)
  return out
}
function dot(a: Vec, b: Vec): number {
  const [x, y] = a.size < b.size ? [a, b] : [b, a]
  let d = 0
  for (const [k, v] of x) { const w = y.get(k); if (w) d += v * w }
  return d
}

/** 词的释义特征：主义项的字权重 1，其余 0.5；再加上主义项里的完整词条（权重 2，最能区分） */
function wordFeatures(idx: LexIndex, k: string): Vec {
  const w = idx.byWord.get(k)
  const v: Vec = new Map()
  const first = senseTermsOfFirst(w)
  for (const t of first) {
    v.set('#' + t, (v.get('#' + t) || 0) + 2)
    for (const c of charSet(t)) v.set(c, (v.get(c) || 0) + 1)
  }
  for (const t of senseTerms(w)) {
    if (first.includes(t)) continue
    for (const c of charSet(t)) v.set(c, (v.get(c) || 0) + 0.5)
  }
  // 单字释义（「宽的」）切不出词条，直接取字
  if (!v.size) for (const c of charSet(zhOf(w))) v.set(c, 1)
  if (!v.size) return v
  // 同义词作为共同特征：互为同义的词更容易分到一起
  v.set('@' + k, 1.5)
  for (const [sy] of idx.syn.get(k) || []) v.set('@' + sy, 1.5)
  const rk = w?.morphemes?.root?.form
  if (rk) v.set('%' + canonicalMorpheme(rk, w?.morphemes?.root?.meaning, 'root'), 0.8)
  return v
}

interface FineGroup { words: string[]; vec: Vec }

/** 话题内最细的一层：同义、派生、同释义词条连在一起的词先抱成小团 */
function fineGroups(idx: LexIndex, keys: string[]): FineGroup[] {
  // 只用同义、派生、同释义词条；「释义有一个字相同」太弱，会把 noise 和「干旱」连在一起
  const adj = semanticEdges(idx, keys, { charOverlap: false })
  const lab = communities(adj, keys)
  const byLab = new Map<string, string[]>()
  for (const k of keys) {
    const l = lab.get(k)!
    if (!byLab.has(l)) byLab.set(l, [])
    byLab.get(l)!.push(k)
  }
  const groups: string[][] = []
  for (const g of byLab.values()) {
    if (g.length <= 12) { groups.push(g); continue }
    // 大团只用强关系再切
    const strong = new Map<string, Map<string, number>>()
    for (const [a, nb] of semanticEdges(idx, g, { charOverlap: false })) for (const [b, w] of nb) if (w >= 0.9) {
      if (!strong.has(a)) strong.set(a, new Map())
      strong.get(a)!.set(b, w)
    }
    const sub = communities(strong, g)
    const parts = new Map<string, string[]>()
    for (const k of g) { const l = sub.get(k)!; if (!parts.has(l)) parts.set(l, []); parts.get(l)!.push(k) }
    groups.push(...parts.values())
  }
  // 特征按字在话题内的稀有度加权（「的」「性」这类到处都有的字不起作用）
  const raw = groups.map(g => {
    const v: Vec = new Map()
    for (const k of g) for (const [f, x] of wordFeatures(idx, k)) v.set(f, (v.get(f) || 0) + x)
    return v
  })
  const df = new Map<string, number>()
  for (const v of raw) for (const f of v.keys()) df.set(f, (df.get(f) || 0) + 1)
  const N = raw.length
  return groups.map((g, i) => {
    const v: Vec = new Map()
    for (const [f, x] of raw[i]) v.set(f, x * Math.log(1 + N / (df.get(f) || 1)))
    return { words: g, vec: norm(v) }
  })
}

/** 带权球面 k-means，确定性初始化（先取最大的组，再逐个取离已选中心最远的） */
function kmeans(items: FineGroup[], k: number): number[] {
  const n = items.length
  if (n <= k) return items.map((_, i) => i)
  const size = items.map(x => x.words.length)
  const centers: Vec[] = []
  const first = size.indexOf(Math.max(...size))
  centers.push(items[first].vec)
  // 只让成员较多的组当初始中心，避免选中离群的单个词，切出来一条长链
  const sorted = [...size].sort((a, b) => b - a)
  const minSeed = Math.max(1, sorted[Math.min(sorted.length - 1, k * 3)] || 1)
  while (centers.length < k) {
    let best = -1, bestD = -1
    for (let i = 0; i < n; i++) {
      if (size[i] < minSeed) continue
      const sim = Math.max(...centers.map(c => dot(c, items[i].vec)))
      const d = (1 - sim) * Math.sqrt(size[i])
      if (d > bestD) { bestD = d; best = i }
    }
    if (best < 0) break
    centers.push(items[best].vec)
  }
  let assign = new Array(n).fill(0)
  for (let it = 0; it < 10; it++) {
    const next = items.map(x => {
      let b = 0, bs = -1
      centers.forEach((c, j) => { const s = dot(c, x.vec); if (s > bs) { bs = s; b = j } })
      return b
    })
    const changed = next.some((v, i) => v !== assign[i])
    assign = next
    for (let j = 0; j < centers.length; j++) {
      const v: Vec = new Map()
      items.forEach((x, i) => {
        if (assign[i] !== j) return
        for (const [f, w] of x.vec) v.set(f, (v.get(f) || 0) + w * size[i])
      })
      if (v.size) centers[j] = norm(v)
    }
    if (!changed && it > 0) break
  }
  return assign
}

/** 这一组相对兄弟组最有区分度的名字（最多两个词条） */
function distinctLabel(idx: LexIndex, members: string[], parentMembers: string[], avoid: Set<string> = new Set()): string {
  const inGroup = new Map<string, number>()
  const inParent = new Map<string, number>()
  const firstBonus = new Map<string, number>()
  for (const m of parentMembers) for (const t of new Set(senseTerms(idx.byWord.get(m)))) inParent.set(t, (inParent.get(t) || 0) + 1)
  for (const m of members) {
    const first = new Set(senseTermsOfFirst(idx.byWord.get(m)))
    for (const t of new Set(senseTerms(idx.byWord.get(m)))) {
      inGroup.set(t, (inGroup.get(t) || 0) + 1)
      if (first.has(t)) firstBonus.set(t, (firstBonus.get(t) || 0) + 1)
    }
  }
  const P = Math.max(1, parentMembers.length)
  const scored = [...inGroup.entries()]
    .filter(([t, c]) => (c >= 2 || members.length <= 2) && !avoid.has(t))
    .map(([t, c]) => {
      const cover = (c + 0.5 * (firstBonus.get(t) || 0)) / members.length
      const spec = Math.log(1 + P / (inParent.get(t) || 1))
      return [t, cover * spec] as const
    })
    .sort((a, b) => b[1] - a[1])
  const picked: string[] = []
  for (const [t] of scored) {
    if (picked.length >= 2) break
    // 与已选词条字面重复的不要（「污染」「污染物」）
    if (picked.some(p => p.includes(t) || t.includes(p))) continue
    picked.push(t)
  }
  if (picked.length) return picked.join('·')
  return groupLabel(idx, members)
}

function uniqueLabels(nodes: TopicTreeNode[]) {
  const seen = new Map<string, number>()
  for (const n of nodes) {
    const c = (seen.get(n.label) || 0) + 1
    seen.set(n.label, c)
    if (c > 1) n.label = `${n.label} ${c}`
  }
}

export interface HierarchyOptions {
  /** 一组不超过这么多词就不再往下切 */
  leafSize?: number
  maxBranch?: number
  maxDepth?: number
}

/**
 * 把一个话题的词逐层切细：每一层 2~7 个分支，直到一组不超过 leafSize 个词。
 * 最底层再列出词族（派生合并，至少两个成员）。
 */
export function topicHierarchy(idx: LexIndex, keys: string[], idPrefix: string, startLevel: number, opts: HierarchyOptions = {}): TopicTreeNode[] {
  const leaf = opts.leafSize ?? 24
  const maxBranch = opts.maxBranch ?? 7
  const maxDepth = opts.maxDepth ?? 6
  const fine = fineGroups(idx, keys)
  // 没有中文释义的词单独放
  const empty = fine.filter(g => !g.vec.size)
  const usable = fine.filter(g => g.vec.size)

  const familyNodes = (words: string[], parentId: string, level: number): TopicTreeNode[] => {
    const fam = new Map<string, string[]>()
    for (const k of words) {
      const h = familyHead(idx, k)
      const head = words.includes(h) ? h : k
      if (!fam.has(head)) fam.set(head, [])
      fam.get(head)!.push(k)
    }
    return [...fam.entries()].filter(([, m]) => m.length >= 2)
      .map(([h, m]) => ({ id: `${parentId}/@${h}`, label: idx.byWord.get(h)?.word || h, level, words: m, children: [] }))
  }

  /** 太小的分支并进最像的大分支 */
  const balance = (groups: FineGroup[], assign: number[], total: number): FineGroup[][] => {
    const m = new Map<number, FineGroup[]>()
    groups.forEach((g, i) => { if (!m.has(assign[i])) m.set(assign[i], []); m.get(assign[i])!.push(g) })
    const minSize = Math.max(3, Math.round(total * 0.05))
    const sizeOf = (l: FineGroup[]) => l.reduce((s, g) => s + g.words.length, 0)
    const big = [...m.values()].filter(l => sizeOf(l) >= minSize)
    const small = [...m.values()].filter(l => sizeOf(l) < minSize).flat()
    if (!big.length) return [...m.values()]
    const cent = big.map(l => {
      const v: Vec = new Map()
      for (const g of l) for (const [f, w] of g.vec) v.set(f, (v.get(f) || 0) + w * g.words.length)
      return norm(v)
    })
    for (const g of small) {
      let b = 0, bs = -1
      cent.forEach((c, j) => { const sc = dot(c, g.vec); if (sc > bs) { bs = sc; b = j } })
      big[b].push(g)
    }
    return big
  }

  const centroid = (list: FineGroup[]): Vec => {
    const v: Vec = new Map()
    for (const g of list) for (const [f, w] of g.vec) v.set(f, (v.get(f) || 0) + w * g.words.length)
    return norm(v)
  }
  /** 和所有分支都不像的单词，不硬塞，最后放进「零散」 */
  const strays: string[] = []
  const MIN_FIT = 0.1
  const WEAK_FIT = 0.18

  const leafOf = (groups: FineGroup[], parentId: string, level: number): TopicTreeNode[] => {
    return familyNodes(groups.flatMap(g => g.words), parentId, level)
  }
  const markWeak = (node: TopicTreeNode, groups: FineGroup[]) => {
    if (groups.length < 3) return
    const c = centroid(groups)
    const weak = groups.filter(g => g.words.length === 1 && dot(c, g.vec) < WEAK_FIT).map(g => g.words[0])
    if (weak.length) node.weak = weak
  }

  const build = (groups: FineGroup[], parentWords: string[], parentId: string, level: number, depth: number, avoid: Set<string>): TopicTreeNode[] => {
    const total = groups.reduce((s, g) => s + g.words.length, 0)
    if (total <= leaf || groups.length <= 2 || depth >= maxDepth) return leafOf(groups, parentId, level)
    const k = Math.max(2, Math.min(maxBranch, Math.round(Math.sqrt(total / 6)), groups.length))
    let lists = balance(groups, kmeans(groups, k), total)
    // 还是一边倒：退回用最大的几组做种子，其余按相似度归过去
    if (lists.length < 2 || Math.max(...lists.map(l => l.reduce((s, g) => s + g.words.length, 0))) > total * 0.85) {
      const order = groups.map((g, i) => i).sort((a, b) => groups[b].words.length - groups[a].words.length)
      const seeds = order.slice(0, k)
      const assign = groups.map((g, i) => {
        const si = seeds.indexOf(i)
        if (si >= 0) return si
        let b = 0, bs = -1
        seeds.forEach((sIdx, j) => { const sc = dot(groups[sIdx].vec, g.vec); if (sc > bs) { bs = sc; b = j } })
        return b
      })
      lists = balance(groups, assign, total)
    }
    if (lists.length < 2) return leafOf(groups, parentId, level)

    // 离群的单个词拿出来
    lists = lists.map(l => {
      const c = centroid(l)
      return l.filter(g => {
        if (g.words.length > 1 || dot(c, g.vec) >= MIN_FIT) return true
        strays.push(g.words[0])
        return false
      })
    }).filter(l => l.length)

    const nodes: (TopicTreeNode & { __groups?: FineGroup[] })[] = []
    for (const list of lists) {
      const words = list.flatMap(g => g.words)
      const label = distinctLabel(idx, words, parentWords, avoid)
      nodes.push({ id: '', label, level, words, children: [], __groups: list })
    }
    nodes.sort((a, b) => b.words.length - a.words.length)
    uniqueLabels(nodes)

    const out: TopicTreeNode[] = []
    for (const n of nodes) {
      const list = n.__groups!
      delete n.__groups
      n.id = `${parentId}/${n.label}`
      const childAvoid = new Set(avoid)
      for (const t of n.label.split('·')) childAvoid.add(t.replace(/ \d+$/, ''))
      n.children = build(list, n.words, n.id, level + 1, depth + 1, childAvoid)
      if (!n.children.some(c => !c.id.includes('/@'))) markWeak(n, list)
      out.push(n)
    }
    // 防「剥皮」：某个子组占了父组七成以上，说明这一层没切开，把它的下一层直接提上来
    const lifted: TopicTreeNode[] = []
    for (const n of out) {
      const real = n.children.filter(c => !c.id.includes('/@'))
      if (n.words.length > total * 0.7 && real.length >= 2) {
        const fix = (x: TopicTreeNode, lv: number) => { x.level = lv; x.children.forEach(c => fix(c, lv + 1)) }
        real.forEach(c => fix(c, level))
        lifted.push(...real)
      } else lifted.push(n)
    }
    uniqueLabels(lifted)
    return lifted
  }

  const out = build(usable, keys, idPrefix, startLevel, 0, new Set())
  // 只切出一个子分支时这一层没有意义
  if (strays.length) {
    const byPos = new Map<string, string[]>()
    for (const k of strays) {
      const p = POS_NAME[posOf(idx.byWord.get(k))] || '其他'
      if (!byPos.has(p)) byPos.set(p, [])
      byPos.get(p)!.push(k)
    }
    out.push({
      id: `${idPrefix}/零散`, label: '零散', level: startLevel, words: strays,
      children: [...byPos.entries()].map(([p, w]) => ({ id: `${idPrefix}/零散/${p}`, label: p, level: startLevel + 1, words: w, children: [] }))
    })
  }
  if (empty.length) {
    const words = empty.flatMap(g => g.words)
    const byPos = new Map<string, string[]>()
    for (const k of words) {
      const p = POS_NAME[posOf(idx.byWord.get(k))] || '其他'
      if (!byPos.has(p)) byPos.set(p, [])
      byPos.get(p)!.push(k)
    }
    out.push({
      id: `${idPrefix}/无释义`, label: '无释义', level: startLevel, words,
      children: [...byPos.entries()].map(([p, w]) => ({ id: `${idPrefix}/无释义/${p}`, label: p, level: startLevel + 1, words: w, children: [] }))
    })
  }
  return out
}

/** 懒加载的话题节点：第一次展开时再细分 */
export function expandTopicNode(idx: LexIndex, node: TopicTreeNode, opts: HierarchyOptions = {}) {
  if (!node.pending) return
  node.children = topicHierarchy(idx, node.words, node.id, node.level + 1, opts)
  node.pending = false
}

/** 兼容旧接口：话题 → 主题 → 小组 两级（buildNote 用） */
export function splitTopic(idx: LexIndex, keys: string[]): { label: string; groups: { label: string; words: string[] }[] }[] {
  return topicHierarchy(idx, keys, 'T', 3, { maxDepth: 2 }).map(n => ({
    label: n.label,
    groups: n.children.length && !n.children[0].id.includes('/@')
      ? n.children.map(c => ({ label: c.label, words: c.words }))
      : [{ label: n.label, words: n.words }]
  }))
}

/**
 * 多级话题树：
 *   L1 大类（由 superTopicOf 给出）
 *   L2 话题（词条自带的 topics）
 *   L3 起逐层细分，层数随词量自动决定；最底层列词族
 */
export function buildTopicTree(
  idx: LexIndex,
  words: WordItem[],
  superTopicOf: (t: string) => string = () => '全部',
  opts: HierarchyOptions & { lazy?: boolean } = {}
): TopicTreeNode[] {
  const byTopic = new Map<string, Set<string>>()
  for (const w of words) {
    const k = lc(w.word)
    if (idx.inflectionOf.has(k) || isPhrase(k)) continue
    const t = w.topics?.[0] || '未分类'
    if (!byTopic.has(t)) byTopic.set(t, new Set())
    byTopic.get(t)!.add(k)
  }
  const l1 = new Map<string, TopicTreeNode>()
  for (const [t, set] of byTopic) {
    const keys = [...set]
    const sup = superTopicOf(t)
    if (!l1.has(sup)) l1.set(sup, { id: sup, label: sup, level: 1, words: [], children: [] })
    const id = `${sup}/${t}`
    const node: TopicTreeNode = opts.lazy
      ? { id, label: t, level: 2, words: keys, children: [], pending: keys.length > 1 }
      : { id, label: t, level: 2, words: keys, children: topicHierarchy(idx, keys, id, 3, opts) }
    l1.get(sup)!.words.push(...keys)
    l1.get(sup)!.children.push(node)
  }
  for (const n of l1.values()) n.children.sort((a, b) => b.words.length - a.words.length)
  return [...l1.values()].sort((a, b) => b.words.length - a.words.length)
}

/** 话题 / 小组笔记：members 是这一组的词 */
export function buildTopicNote(idx: LexIndex, title: string, members: string[], opts: { maxGroups?: number; perGroup?: number; groups?: { label: string; words: string[] }[] } = {}): FamilyNote | null {
  const keys = [...new Set(members.map(lc))].filter(k => idx.byWord.has(k) && !idx.inflectionOf.has(k) && !isPhrase(k))
  if (!keys.length) return null
  // 派生词并到基词下面
  const heads = keys.filter(k => {
    const h = familyHead(idx, k)
    return h === k || !keys.includes(h)
  })
  const adj = semanticEdges(idx, heads)
  const groups = new Map<string, string[]>()
  const headSet = new Set(heads)
  if (opts.groups?.length) {
    // 与话题树保持一致：直接用树里的小组做分支
    for (const g of opts.groups) {
      const ws = g.words.map(lc).filter(k => headSet.has(k))
      if (ws.length) groups.set(g.label, ws)
    }
  } else {
    const lab = communities(adj, heads)
    for (const k of heads) {
      const l = lab.get(k)!
      if (!groups.has(l)) groups.set(l, [])
      groups.get(l)!.push(k)
    }
  }
  const deg = (k: string) => [...(adj.get(k) || new Map()).values()].reduce((s, x) => s + x, 0)
  const sorted = [...groups.values()].sort((a, b) => b.length - a.length)
  const exclude = new Set(heads)
  const branches: NoteBranch[] = []
  const loose: NoteWord[] = []
  for (const g of sorted) {
    const picked = g
      .sort((a, b) => deg(b) - deg(a) || (idx.rank.get(a) ?? 5) - (idx.rank.get(b) ?? 5))
      .slice(0, opts.perGroup ?? 6)
    const words = picked
      .map(k => expandWord(idx, k, { exclude, maxDerivs: 3 }, [`话题「${title}」`], g.length > 1 ? 0.85 : 0.6))
      .filter(Boolean) as NoteWord[]
    if (g.length === 1 && !opts.groups) { loose.push(...words); continue }
    const label = opts.groups ? [...groups.entries()].find(([, v]) => v === g)?.[0] || groupLabel(idx, g) : groupLabel(idx, g)
    if (branches.length < (opts.maxGroups ?? (opts.groups ? 12 : 5))) branches.push({ label, words })
  }
  if (loose.length) branches.push({ label: '其他', words: loose.slice(0, opts.perGroup ?? 6) })
  const all = branches.flatMap(b => b.words)
  // 话题外的同义补充（popularize / suppress 那种便签）
  const extra = new Map<string, NoteLink>()
  for (const w of all) for (const l of w.links) if (l.kind === 'syn' && !exclude.has(lc(l.word))) extra.set(lc(l.word), l)
  return {
    kind: 'topic',
    title,
    hub: { label: title, sub: `${keys.length} 词` },
    branches,
    side: extra.size ? [{ label: '拓展', items: [...extra.values()].slice(0, 6) }] : [],
    stats: { candidates: keys.length, kept: all.length, lowConfidence: all.filter(x => x.confidence < 0.7).length },
    createdFrom: title
  }
}

/* ================================================================== */
/*  4. 拆解图（atmosphere → atmo + sphere → …）                         */
/* ================================================================== */

interface MorphPart { key: string; form: string; meaning: string; role: string }

/** 取词的词素；没有词素字段时试着按已知词素切分（atmo + sphere） */
export function partsOf(idx: LexIndex, word: string): MorphPart[] {
  const w = idx.byWord.get(lc(word))
  const out: MorphPart[] = []
  const m = w?.morphemes
  if (m) {
    for (const role of ['prefix', 'root', 'suffix'] as const) {
      const p = m[role]
      if (!p?.form) continue
      const key = canonicalMorpheme(p.form, p.meaning, role)
      // 后缀（-ical、-ly）不展开，展开出来是一串不相干的词
      if (role === 'suffix') continue
      out.push({ key, form: cleanForm(p.form), meaning: p.meaning || idx.morphMeaning.get(key) || '', role })
    }
  }
  if (m || out.length >= 2 || !w) return out
  const k = lc(word)
  const known = (x: string): string | undefined => {
    if (idx.morph.has(x)) return x
    for (const [key, forms] of Object.entries(MORPHEME_VARIANTS)) if (forms.includes(x) && x.length >= 3) return key
    if (MORPHEME_MEANINGS[x]) return x
    return undefined
  }
  const meaningOf = (key: string, form: string) =>
    idx.morphMeaning.get(key) || MORPHEME_MEANINGS[key] || MORPHEME_MEANINGS[form] || zhOf(idx.byWord.get(form))
  for (let i = 3; i <= k.length - 3; i++) {
    const a = k.slice(0, i), b = k.slice(i)
    const ka = known(a)
    const kb = known(b) || (idx.byWord.has(b) ? b : undefined)
    if (ka && kb) {
      return [
        { key: ka, form: a, meaning: meaningOf(ka, a), role: 'prefix' },
        { key: kb, form: b, meaning: meaningOf(kb, b), role: 'root' }
      ]
    }
  }
  return out
}

export function membersOfPart(idx: LexIndex, p: MorphPart): string[] {
  const entries = (idx.morph.get(p.key) || []).filter(e => {
    if (p.role !== 'prefix') return true
    // 常规前缀（in / ex / com…）变体多、意思多：只要同一写法、同一个意思的（im-（使）不带出 in、enemy）
    // hydro、litho 这类实义前缀不限写法
    const generic = PREFIX_KEYS.has(p.key) || (idx.morph.get(p.key)?.length || 0) > 80
    if (generic && e.form !== p.form) return false
    if (!p.meaning || !e.meaning) return true
    // 词素释义很短（「使」「不」），不能过滤虚字
    const raw = (x: string) => new Set(x.replace(/[^\u4e00-\u9fffa-z]/gi, '').split(''))
    const a = raw(p.meaning), b = raw(e.meaning)
    return [...a].some(c => b.has(c)) || (!!conceptOf(p.meaning) && conceptOf(p.meaning) === conceptOf(e.meaning))
  })
  const set = new Set(entries.map(e => lc(e.word)).filter(k => k !== p.form && k.length >= p.form.length + 3))
  if (p.form.length >= 4) {
    for (const [k, item] of idx.byWord) {
      if (set.has(k) || k === p.form) continue
      const hit = containsAtBoundary(k, p.form)
      if (!hit) continue
      const rk = rootKeyOf(item)
      if (rk ? rk === p.key : !!hit.prefix) set.add(k)
    }
  }
  // 词素本身也是单词（sphere），且记录的词根就是它
  const selfWord = idx.byWord.get(p.key)
  if (selfWord && (!rootKeyOf(selfWord) || rootKeyOf(selfWord) === p.key)) set.add(p.key)
  return [...set].filter(k => !idx.inflectionOf.has(k))
}

export function buildDecomposeNote(idx: LexIndex, word: string, opts: { depth?: number; fanout?: number; budget?: number } = {}): FamilyNote | null {
  const root = idx.byWord.get(lc(word))
  if (!root) return null
  const depth = opts.depth ?? 3
  const fanout = opts.fanout ?? 4
  let budget = opts.budget ?? 36
  const used = new Set<string>([lc(root.word)])
  /** 已经出现过的词族，同族的词不再在别处重复出现（atmospheric 不会挂到 atmo 下面） */
  const usedHeads = new Set<string>([lc(root.word)])
  const usedMorph = new Set<string>()
  let seq = 0

  const wordNode = (k: string, level: number): TreeNode => {
    const w = idx.byWord.get(k)!
    const node: TreeNode = { id: `w${seq++}`, label: w.word, zh: zhOf(w), kind: 'word', children: [] }
    const syn = [...(idx.syn.get(k) || new Map()).keys()].find(s => !used.has(s))
    if (syn) node.links = [{ kind: 'syn', word: idx.byWord.get(syn)!.word, zh: zhOf(idx.byWord.get(syn)) }]
    if (level >= depth || budget <= 0) return node
    // 先挂派生（atomic → atomically）
    for (const d of derivTree(idx, k, 1).slice(0, 2)) {
      const dk = lc(d)
      if (used.has(dk) || budget <= 0) continue
      used.add(dk); budget--
      node.children.push({ id: `w${seq++}`, label: d, zh: zhOf(idx.byWord.get(dk)), kind: 'word', children: [] })
    }
    // 再展开它的其他词素（hydrosphere → hydro → …）
    for (const p of partsOf(idx, k)) {
      if (usedMorph.has(p.key) || budget <= 0) continue
      // 第二层以后不展开成员很多的泛化词素（re-、dis-、ex-），展开出来是一串不相干的常用词
      if ((idx.morph.get(p.key)?.length || 0) > 80) continue
      if (!membersOfPart(idx, p).some(x => !used.has(x))) continue
      node.children.push(morphNode(p, level + 1))
    }
    return node
  }

  const morphNode = (p: MorphPart, level: number): TreeNode => {
    usedMorph.add(p.key)
    const node: TreeNode = { id: `m${seq++}`, label: p.form, zh: p.meaning, kind: 'morpheme', children: [] }
    const members = membersOfPart(idx, p)
      .filter(k => !used.has(k) && !isPhrase(k) && ![...usedHeads].some(h => sameFamily(idx, h, k)))
      .sort((a, b) => (idx.rank.get(a) ?? 5) - (idx.rank.get(b) ?? 5) || a.length - b.length)
    // 同一词族只取一个代表
    const reps: string[] = []
    for (const k of members) {
      if (reps.length >= fanout) break
      if (reps.some(r => sameFamily(idx, r, k))) continue
      reps.push(k)
    }
    for (const k of reps) {
      if (budget <= 0) break
      used.add(k); usedHeads.add(k); budget--
      node.children.push(wordNode(k, level + 1))
    }
    return node
  }

  const tree: TreeNode = { id: 'root', label: root.word, zh: zhOf(root), kind: 'word', children: [] }
  for (const p of partsOf(idx, root.word)) tree.children.push(morphNode(p, 1))
  for (const d of derivTree(idx, lc(root.word), 1).slice(0, 2)) {
    used.add(lc(d))
    tree.children.push({ id: `w${seq++}`, label: d, zh: zhOf(idx.byWord.get(lc(d))), kind: 'word', children: [] })
  }
  if (!tree.children.length) return null

  // 形近易混挂在便签
  const confuse = confusablesOf(idx, root.word, undefined, 3)
  const count = (n: TreeNode): number => (n.kind === 'word' ? 1 : 0) + n.children.reduce((s, c) => s + count(c), 0)
  return {
    kind: 'decompose',
    title: root.word,
    hub: { label: root.word, sub: zhOf(root) },
    branches: [],
    side: confuse.length ? [{ label: '易混', items: confuse.map(x => ({ kind: 'confuse' as const, word: x, zh: zhOf(idx.byWord.get(lc(x))) })) }] : [],
    tree,
    stats: { candidates: used.size, kept: count(tree), lowConfidence: 0 },
    createdFrom: word
  }
}

/* ================================================================== */
/*  自动选择                                                           */
/* ================================================================== */

/** 给一个词，列出它能生成哪些笔记，按信息量排 */
export function noteOptionsFor(idx: LexIndex, word: string): { kind: NoteKind; label: string; size: number }[] {
  const out: { kind: NoteKind; label: string; size: number }[] = []
  const w = idx.byWord.get(lc(word))
  if (!w) return out
  const rk = findMorphemeKey(idx, word)
  if (rk) out.push({ kind: 'root', label: `词根 ${rk.replace(/\(.*\)/, '')}`, size: idx.morph.get(rk)?.length || 0 })
  const syn = idx.syn.get(lc(word))?.size || 0
  out.push({ kind: 'synonym', label: '同义', size: syn + (senseTerms(w).length ? 1 : 0) })
  if (partsOf(idx, word).length) out.push({ kind: 'decompose', label: '拆解', size: partsOf(idx, word).length * 3 })
  if (w.topics?.[0]) out.push({ kind: 'topic', label: `话题 ${w.topics[0]}`, size: idx.topic.get(w.topics[0])?.size || 0 })
  return out.sort((a, b) => b.size - a.size)
}

export function buildNote(idx: LexIndex, kind: NoteKind, word: string): FamilyNote | null {
  if (kind === 'root') return buildRootNote(idx, word)
  if (kind === 'synonym') return buildSynonymNote(idx, word)
  if (kind === 'decompose') return buildDecomposeNote(idx, word)
  const w = idx.byWord.get(lc(word))
  const t = w?.topics?.[0]
  if (!t) return null
  // 话题太大时，只取这个词所在的主题
  const members = [...(idx.topic.get(t) || [])].filter(k => !isPhrase(k))
  if (members.length <= 40) return buildTopicNote(idx, t, members)
  const themes = splitTopic(idx, members)
  const mine = themes.find(th => th.groups.some(g => g.words.includes(lc(word))))
  if (!mine) return buildTopicNote(idx, t, members.slice(0, 40))
  return buildTopicNote(idx, `${t} · ${mine.label}`, mine.groups.flatMap(g => g.words), { groups: mine.groups })
}

/* ================================================================== */
/*  外部数据解析（ECDICT）                                              */
/* ================================================================== */

/**
 * resemble.txt：每组以 % 开头的一行是中文标题，之后 "- word1, word2" 与说明。
 * 只取词表，不取说明文字。
 */
export function parseResemble(text: string): string[][] {
  const groups: string[][] = []
  let cur: string[] | null = null
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('%')) { if (cur?.length) groups.push(cur); cur = []; continue }
    const m = /^-\s*([a-zA-Z ,'-]+)$/.exec(line.trim())
    if (m && cur) cur.push(...m[1].split(',').map(s => s.trim()).filter(Boolean))
  }
  if (cur?.length) groups.push(cur)
  return groups
}

/**
 * wordroot.txt：JSON 字典，键是词根，值含 meaning / example 等。
 * 格式在不同版本里有差异，这里尽量宽松。
 */
export function parseWordRoots(text: string): Record<string, { meaning: string; examples: string[] }> {
  const out: Record<string, { meaning: string; examples: string[] }> = {}
  let data: any
  try { data = JSON.parse(text) } catch { return out }
  for (const [k, v] of Object.entries<any>(data || {})) {
    const meaning = String(v?.meaning || v?.class || '').slice(0, 30)
    const ex = v?.example || v?.examples || []
    const examples = (Array.isArray(ex) ? ex : String(ex).split(/[,，\s]+/)).map((x: any) => String(x).trim()).filter(Boolean)
    for (const form of k.split(/[,，/\s]+/)) {
      const f = cleanForm(form)
      if (f) out[f] = { meaning, examples }
    }
  }
  return out
}

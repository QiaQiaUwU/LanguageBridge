/**
 * 两棵树的 AI 梳理。
 *
 * 话题树：第 3 层往下原来是本地按释义字符聚类出来的，分得不准，名字也是挑出来的词条。
 *   梳理分两步 —— 先让模型给每个话题设计「小类 → 细类」两级目录，
 *   再把这个话题的词一批批交给模型，逐个归到某个细类里。
 *   词归到哪由模型决定，树按这个结果重建；没梳理到的词仍走本地算法，放在「未梳理」下。
 *
 * 词根树：spec / spect / spic、fac / fect / fic 这种同源异形，本地只能靠变体表猜，
 *   表里没有的就分成了好几个词根。把全部词根交给模型，让它判断哪些是同一个，
 *   合并成一个代表写法、给一个统一释义。
 *
 * 两份结果都存在 localStorage，随时能「还原」回本地算法。每批跑完立刻存，中途停下下次接着跑。
 */
import { askAi } from './aiClient'
import { readJson } from './safeStorage'
import {
  cleanForm, canonicalMorpheme, zhOf, familyLeafNodes, topicHierarchy, reloadRootAliases, ROOT_ALIAS_KEY,
  type LexIndex, type TopicTreeNode
} from './wordFamily'

export interface TidyProgress { done: number; total: number; stage: string }
export interface TidyResult {
  changed: number
  total: number
  failedBatches: number
  lastError?: string
  aborted?: boolean
  /** 还没处理的：失败的批次、中途停下没跑到的。再跑一次只送这些 */
  left: number
}
interface RunOpts { shouldStop?: () => boolean; onProgress?: (p: TidyProgress) => void }

/* ------------------------------------------------------------------ */
/*  通用：解析、失败处理                                                */
/* ------------------------------------------------------------------ */

function parseJsonLoose(raw: string): any {
  const text = String(raw || '').replace(/```json/gi, '').replace(/```/g, '')
    .replace(/[\u201C\u201D]/g, '"').replace(/,\s*([\]}])/g, '$1').trim()
  try { return JSON.parse(text) } catch { /* 往下 */ }
  // 夹着解释文字：分别试最外层的 [..] 和 {..}，取能解析的
  for (const [o, c] of [['{', '}'], ['[', ']']]) {
    const a = text.indexOf(o), b = text.lastIndexOf(c)
    if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)) } catch { /* 下一个 */ } }
  }
  return null
}

/** 连续失败的计数器：开头连续两批都失败就停，别把几百批请求白白烧完 */
function failGate(res: TidyResult) {
  let streak = 0
  return {
    ok() { streak = 0 },
    fail(msg: string): boolean {
      res.failedBatches++
      res.lastError = msg
      streak++
      if (streak >= 2 && res.changed === 0) { res.aborted = true; return true }
      return streak >= 5   // 跑通过之后又连着坏 5 批，多半是额度或网络出事了
    }
  }
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const shortZh = (idx: LexIndex, k: string) => zhOf(idx.byWord.get(k)).replace(/\s+/g, '').slice(0, 10)

/* ------------------------------------------------------------------ */
/*  话题树                                                              */
/* ------------------------------------------------------------------ */

const PLAN_KEY = 'lb-topic-plan'

export interface TopicPlan {
  /** 两级目录：小类，以及它下面的细类 */
  groups: { name: string; children: string[] }[]
  /** 词 → 目录编号：「2」是第 2 个小类本身，「2.3」是它下面第 3 个细类，「0」是哪类都不像 */
  assign: Record<string, string>
}

let plans: Record<string, TopicPlan> | null = null
function loadPlans(): Record<string, TopicPlan> {
  if (!plans) plans = readJson<Record<string, TopicPlan>>(PLAN_KEY, {})
  return plans
}
function savePlans() { localStorage.setItem(PLAN_KEY, JSON.stringify(loadPlans())) }

export function topicPlanStats(): { topics: number; words: number } {
  const all = Object.values(loadPlans())
  return { topics: all.filter(p => p.groups?.length).length, words: all.reduce((s, p) => s + Object.keys(p.assign || {}).length, 0) }
}
export function clearTopicPlans() { plans = {}; savePlans() }

/** L2 节点 id 是「大类/话题」，取后半截 */
export function topicOfNode(node: TopicTreeNode): string {
  return node.id.slice(node.id.indexOf('/') + 1)
}

/** 太小的话题不用分小类 */
const MIN_TOPIC = 15
/** 一个细类超过这么多词，下面再用本地算法切一层 */
const LEAF_MAX = 30

/**
 * 按梳理结果重建一个话题下面的树。没有梳理结果返回 null，调用方走本地算法。
 */
export function plannedChildren(idx: LexIndex, node: TopicTreeNode): TopicTreeNode[] | null {
  const plan = loadPlans()[topicOfNode(node)]
  if (!plan?.groups?.length) return null
  const bucket = new Map<string, string[]>()
  const rest: string[] = []
  for (const k of node.words) {
    const code = plan.assign[k]
    if (code === undefined) { rest.push(k); continue }
    if (!bucket.has(code)) bucket.set(code, [])
    bucket.get(code)!.push(k)
  }
  const leaf = (words: string[], id: string, level: number): TopicTreeNode[] =>
    words.length > LEAF_MAX ? topicHierarchy(idx, words, id, level, { maxDepth: 2 }) : familyLeafNodes(idx, words, id, level)

  const L = node.level + 1
  const out: TopicTreeNode[] = []
  plan.groups.forEach((g, gi) => {
    const gid = `${node.id}/${g.name}`
    const kids: TopicTreeNode[] = []
    g.children.forEach((c, ci) => {
      const words = bucket.get(`${gi + 1}.${ci + 1}`) || []
      if (!words.length) return
      const id = `${gid}/${c}`
      kids.push({ id, label: c, level: L + 1, words, children: leaf(words, id, L + 2) })
    })
    const direct = bucket.get(`${gi + 1}`) || []
    // 归到小类本身、没细分下去的词：有细类时单列一组，没细类时直接当叶子
    if (direct.length && kids.length) {
      const id = `${gid}/其他`
      kids.push({ id, label: '其他', level: L + 1, words: direct, children: leaf(direct, id, L + 2) })
    }
    const words = [...kids.flatMap(k => k.words), ...(kids.length ? [] : direct)]
    if (!words.length) return
    kids.sort((a, b) => b.words.length - a.words.length)
    out.push({ id: gid, label: g.name, level: L, words, children: kids.length ? kids : leaf(direct, gid, L + 1) })
  })
  out.sort((a, b) => b.words.length - a.words.length)
  const other = bucket.get('0') || []
  if (other.length) out.push({ id: `${node.id}/其他`, label: '其他', level: L, words: other, children: leaf(other, `${node.id}/其他`, L + 1) })
  if (rest.length) out.push({ id: `${node.id}/未梳理`, label: '未梳理', level: L, words: rest, children: topicHierarchy(idx, rest, `${node.id}/未梳理`, L + 1, { maxDepth: 3 }) })
  return out
}

const SYS_TAXONOMY = `你在给一个英语词库的某个话题设计下级分类目录。
规则：
1. 给 4 到 10 个小类，每个小类下 0 到 6 个细类。
2. 按「这些词说的是什么事物、场景、动作」来分，不要按词性、字母、难度分。
3. 名字 2 到 6 个汉字，同级之间不重叠，不要「其他」「综合」「相关」这种兜底名。
4. 目录要能装下给你的全部样本词，也要能装下同话题里没列出来的常见词。
5. 只返回 JSON：{"groups":[{"name":"小类","children":["细类","细类"]}]}，不要任何别的文字。`

const SYS_ASSIGN = `你在把英语单词归到分类目录里。
规则：
1. 每个词选一个最贴切的编号。能归到细类（如 2.3）就归细类；只贴合小类、不贴合任何细类的，用小类编号（如 2）。
2. 哪一类都明显不合适的用 0，不要硬塞。
3. 按词的主要意思归类，括号里是它的中文释义。
4. 只返回 JSON 对象：{"单词":"编号", ...}，每个给出的词都要有，不要任何别的文字。`

function pickSample(words: string[], n: number): string[] {
  if (words.length <= n) return words
  const step = words.length / n
  return Array.from({ length: n }, (_, i) => words[Math.floor(i * step)])
}

function parseTaxonomy(raw: string): TopicPlan['groups'] | null {
  const data = parseJsonLoose(raw)
  const list = Array.isArray(data) ? data : Array.isArray(data?.groups) ? data.groups
    : (data && typeof data === 'object' ? Object.values(data).find(Array.isArray) : null)
  if (!Array.isArray(list)) return null
  const clean = (x: unknown) => String(x ?? '').trim().replace(/[「」"'\s]/g, '').slice(0, 10)
  const seen = new Set<string>()
  const groups = list.map((g: any) => {
    const name = clean(g?.name ?? g?.label ?? g?.title)
    const kids = (Array.isArray(g?.children) ? g.children : Array.isArray(g?.sub) ? g.sub : [])
      .map((c: any) => clean(typeof c === 'string' ? c : c?.name))
      .filter((c: string, i: number, a: string[]) => c && a.indexOf(c) === i)
      .slice(0, 8)
    return { name, children: kids }
  }).filter(g => g.name && !seen.has(g.name) && seen.add(g.name))
  return groups.length >= 2 ? groups.slice(0, 12) : null
}

function codebook(groups: TopicPlan['groups']): { text: string; valid: Set<string> } {
  const lines: string[] = []
  const valid = new Set<string>(['0'])
  groups.forEach((g, gi) => {
    lines.push(`${gi + 1} ${g.name}`)
    valid.add(`${gi + 1}`)
    g.children.forEach((c, ci) => { lines.push(`  ${gi + 1}.${ci + 1} ${c}`); valid.add(`${gi + 1}.${ci + 1}`) })
  })
  lines.push('0 都不合适')
  return { text: lines.join('\n'), valid }
}

function parseAssign(raw: string, batch: string[], valid: Set<string>): Map<string, string> {
  const out = new Map<string, string>()
  const want = new Set(batch)
  const data = parseJsonLoose(raw)
  const put = (w: unknown, code: unknown) => {
    // 模型常把我们给的「proboscis(长鼻)」整个原样当键写回来，括号和后面的释义去掉再认
    const k = String(w ?? '').replace(/[（(\[【].*$/, '').replace(/^\d+[.、)]\s*/, '').trim().toLowerCase()
    const c = String(code ?? '').trim().replace(/[^\d.]/g, '').replace(/\.$/, '')
    if (want.has(k) && valid.has(c)) out.set(k, c)
  }
  if (Array.isArray(data)) {
    for (const x of data) if (x && typeof x === 'object') put(x.word ?? x.w, x.code ?? x.id ?? x.category ?? x.c)
  } else if (data && typeof data === 'object') {
    const inner = Object.values(data).find(v => v && typeof v === 'object' && !Array.isArray(v))
    const src = Object.keys(data).some(k => want.has(k.toLowerCase())) ? data : inner || data
    for (const [k, v] of Object.entries(src)) put(k, v)
  }
  return out
}

/**
 * 梳理话题树。topics 是第 2 层的话题和它的词。
 * 已经归好的词不再送；新加进词库的词再跑一次就会补进去。
 */
export async function tidyTopicTree(
  idx: LexIndex,
  topics: { topic: string; words: string[] }[],
  opts: RunOpts = {}
): Promise<TidyResult> {
  const all = loadPlans()
  const work = topics.filter(t => t.words.length >= MIN_TOPIC)
  const pendingWords = work.reduce((s, t) => s + t.words.filter(w => all[t.topic]?.assign?.[w] === undefined).length, 0)
  const needTax = work.filter(t => !all[t.topic]?.groups?.length).length
  const res: TidyResult = { changed: 0, total: pendingWords, failedBatches: 0, left: 0 }
  const gate = failGate(res)
  const BATCH = 80
  let done = 0
  let taxDone = 0

  for (const t of work) {
    if (opts.shouldStop?.() || res.aborted) break
    let plan = all[t.topic]

    if (!plan?.groups?.length) {
      opts.onProgress?.({ done, total: pendingWords, stage: `设计目录 ${taxDone + 1}/${needTax}：${t.topic}` })
      const sample = pickSample(t.words, 160).map(k => `${idx.byWord.get(k)?.word || k}(${shortZh(idx, k)})`)
      try {
        const raw = await askAi(`话题：${t.topic}（共 ${t.words.length} 词）\n样本：${sample.join('、')}`, SYS_TAXONOMY, 3000, 90_000, true)
        const groups = parseTaxonomy(raw)
        if (!groups) {
          if (gate.fail(`「${t.topic}」的目录没解析出来：${String(raw || '（空）').trim().slice(0, 100)}`)) break
          continue
        }
        plan = all[t.topic] = { groups, assign: {} }
        savePlans()
        gate.ok()
      } catch (e) {
        if (gate.fail(errText(e))) break
        continue
      } finally {
        taxDone++
      }
    }

    const { text: book, valid } = codebook(plan.groups)
    const todo = t.words.filter(w => plan!.assign[w] === undefined)
    for (let i = 0; i < todo.length; i += BATCH) {
      if (opts.shouldStop?.()) break
      const batch = todo.slice(i, i + BATCH)
      opts.onProgress?.({ done, total: pendingWords, stage: `归类：${t.topic}` })
      try {
        const lines = batch.map(k => `${k}(${shortZh(idx, k)})`).join('\n')
        const raw = await askAi(`话题：${t.topic}\n目录：\n${book}\n\n单词：\n${lines}`, SYS_ASSIGN, 4000, 120_000, true)
        const got = parseAssign(raw, batch, valid)
        if (!got.size) {
          if (gate.fail(`「${t.topic}」这批没归上：${String(raw || '（空）').trim().slice(0, 100)}`)) break
        } else {
          for (const [k, c] of got) plan.assign[k] = c
          res.changed += got.size
          savePlans()
          gate.ok()
        }
      } catch (e) {
        if (gate.fail(errText(e))) break
      }
      done += batch.length
      opts.onProgress?.({ done, total: pendingWords, stage: `归类：${t.topic}` })
    }
    if (res.aborted) break
  }
  res.left = work.reduce((s, t) => s + t.words.filter(w => all[t.topic]?.assign?.[w] === undefined).length, 0)
  return res
}

/* ------------------------------------------------------------------ */
/*  词根树                                                              */
/* ------------------------------------------------------------------ */

interface RootStore { v: number; alias: Record<string, string>; meaning: Record<string, string>; reviewed: string[] }
function loadRoots(): RootStore {
  const s = readJson<Partial<RootStore>>(ROOT_ALIAS_KEY, {})
  return { v: s.v || 0, alias: s.alias || {}, meaning: s.meaning || {}, reviewed: s.reviewed || [] }
}
function saveRoots(s: RootStore) {
  s.v = Date.now()
  localStorage.setItem(ROOT_ALIAS_KEY, JSON.stringify(s))
  reloadRootAliases()
}

export function rootMergeStats(): { merged: number; reviewed: number } {
  const s = loadRoots()
  return { merged: Object.keys(s.alias).length, reviewed: s.reviewed.length }
}
export function clearRootMerges() {
  localStorage.removeItem(ROOT_ALIAS_KEY)
  reloadRootAliases()
}

const SYS_ROOTS = `下面是一个英语词库里的词根（拉丁、希腊构词成分），每行：编号｜写法｜现有释义｜例词。
任务：找出同源异形的写法并合并。
1. 只合并确实同源的：spec / spect / spic 都是「看」，fac / fect / fic 都是「做」，duc / duct 都是「引导」。
2. 写法相同或相近但来源不同的不要合并（port「搬运」和 port「港口」、ped「脚」和 ped「儿童」）。
3. 每组选最常见、最完整的写法做代表，给一个统一的中文释义，2 到 4 个字。
4. 只返回需要合并的组（2 个及以上编号），不需要合并的不用列。
5. 只返回 JSON 数组：[{"root":"代表写法","meaning":"释义","ids":[编号,编号]}]，不要任何别的文字。没有要合并的返回 []。`

interface RootEntry { key: string; forms: string[]; meaning: string; count: number; sample: string[] }

function collectRoots(idx: LexIndex): RootEntry[] {
  const out: RootEntry[] = []
  // 已经按意思拆开的同形异义词根（port(港口) / port(搬运)）整组不参与：
  // 拆开本来就是对的，合并时统一释义会把它们又并回一个意思
  const split = new Set([...idx.morph.keys()].filter(k => k.includes('(')).map(k => k.replace(/\(.*$/, '')))
  for (const [key, list] of idx.morph) {
    if (key.startsWith('-') || key.includes('(') || split.has(key)) continue
    const roots = list.filter(e => e.role === 'root')
    if (!roots.length) continue
    const formsAll = [...new Set([key, ...roots.map(e => e.form)].filter(Boolean))]
    if (formsAll.some(f => split.has(f))) continue
    out.push({
      key,
      forms: [...new Set([key, ...roots.map(e => e.form)].filter(Boolean))],
      meaning: idx.morphMeaning.get(key) || roots.find(e => e.meaning)?.meaning || '',
      count: roots.length,
      sample: roots.slice(0, 3).map(e => e.word)
    })
  }
  // 同首字母、同释义的挨在一起，同源异形才落在同一批里
  const mk = (e: RootEntry) => e.meaning.replace(/[^\u4e00-\u9fff]/g, '').slice(0, 1)
  return out.sort((a, b) => a.key[0].localeCompare(b.key[0]) || mk(a).localeCompare(mk(b)) || a.key.localeCompare(b.key))
}

/** 顺着别名链走到底，防环 */
function resolve(alias: Record<string, string>, f: string): string {
  const seen = new Set<string>()
  while (alias[f] && !seen.has(f)) { seen.add(f); f = alias[f] }
  return f
}

export async function tidyRoots(idx: LexIndex, opts: RunOpts = {}): Promise<TidyResult> {
  const store = loadRoots()
  const reviewed = new Set(store.reviewed)
  const entries = collectRoots(idx).filter(e => !reviewed.has(e.key))
  const res: TidyResult = { changed: 0, total: entries.length, failedBatches: 0, left: 0 }
  const gate = failGate(res)
  const BATCH = 250

  for (let i = 0; i < entries.length; i += BATCH) {
    if (opts.shouldStop?.()) break
    const batch = entries.slice(i, i + BATCH)
    opts.onProgress?.({ done: i, total: entries.length, stage: '合并词根' })
    const lines = batch.map((e, k) => `${k}｜${e.forms.join('/')}｜${e.meaning || '？'}｜${e.sample.join(',')}`)
    try {
      const raw = await askAi(lines.join('\n'), SYS_ROOTS, 4000, 120_000, true)
      const data = parseJsonLoose(raw)
      const list = Array.isArray(data) ? data : (data && typeof data === 'object' ? Object.values(data).find(Array.isArray) : null)
      if (!Array.isArray(list)) {
        if (gate.fail(`回复不是能读懂的 JSON：${String(raw || '（空）').trim().slice(0, 100)}`)) break
        continue
      }
      for (const g of list) {
        const ids = (Array.isArray(g?.ids) ? g.ids : Array.isArray(g?.merge) ? g.merge : [])
          .map(Number).filter((n: number) => Number.isInteger(n) && batch[n])
        const members = [...new Set(ids)].map(n => batch[n as number])
        if (members.length < 2) continue
        // 代表写法必须是组里真有的，不认模型自己编的；没对上就取成员最多的那个
        const want = cleanForm(String(g?.root || ''))
        const head = members.find(m => m.forms.includes(want))
          ? want
          : members.slice().sort((a, b) => b.count - a.count)[0].key
        const target = resolve(store.alias, head)
        for (const m of members) for (const f of m.forms) {
          const cf = cleanForm(f)
          if (!cf || cf === target || store.alias[cf] === target) continue
          store.alias[cf] = target
          res.changed++
        }
        const meaning = String(g?.meaning || '').trim().slice(0, 8)
        // 释义按索引里的归一键存，界面和建索引都按这个键取
        if (meaning) store.meaning[canonicalMorpheme(target, meaning, 'root') || target] = meaning
      }
      // 合并过程中可能出现 a→b、b→c，统一指到链尾
      for (const k of Object.keys(store.alias)) {
        const t = resolve(store.alias, k)
        if (t === k) delete store.alias[k]
        else store.alias[k] = t
      }
      for (const e of batch) reviewed.add(e.key)
      store.reviewed = [...reviewed]
      saveRoots(store)
      gate.ok()
    } catch (e) {
      if (gate.fail(errText(e))) break
    }
    opts.onProgress?.({ done: Math.min(i + BATCH, entries.length), total: entries.length, stage: '合并词根' })
  }
  res.left = entries.filter(e => !reviewed.has(e.key)).length
  return res
}

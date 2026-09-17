/**
 * 词汇笔记的前端服务：索引缓存、外部数据、AI 校对、保存。
 * 算法本体在 wordFamily.ts。
 */
import type { WordItem } from '@/shared/types/WordItem'
import {
  buildIndex, buildNote, buildTopicNote, buildTopicTree, noteOptionsFor,
  parseResemble, parseWordRoots, zhOf, expandTopicNode,
  type LexIndex, type FamilyNote, type NoteKind, type NoteWord, type ExternalData, type TopicTreeNode
} from './wordFamily'
import { superTopicOf } from './topicTaxonomy'
import { saveStudyRecord, newRecordId, todayStr, type FamilyNoteRecord } from './studyRecords'

let cached: { key: string; idx: LexIndex } | null = null
let extPromise: Promise<ExternalData> | null = null

async function loadExternal(): Promise<ExternalData> {
  if (!extPromise) {
    extPromise = (async () => {
      const ext: ExternalData = {}
      try {
        const r = await fetch('/api/lexicon/resemble')
        if (r.ok) ext.resembleGroups = parseResemble(await r.text())
      } catch { /* 没放置就不用 */ }
      try {
        const r = await fetch('/api/lexicon/wordroot')
        if (r.ok) ext.wordRoots = parseWordRoots(await r.text())
      } catch { /* 同上 */ }
      return ext
    })()
  }
  return extPromise
}

/** 词库变了（数量或最后修改时间变了）才重建索引 */
export async function getIndex(words: WordItem[]): Promise<LexIndex> {
  let last = ''
  for (const w of words) if (w.updatedAt > last) last = w.updatedAt
  const key = `${words.length}|${last}`
  if (cached?.key === key) return cached.idx
  const ext = await loadExternal()
  // 让出主线程，免得点击后界面卡住看不到加载状态
  await new Promise(r => setTimeout(r, 0))
  const idx = buildIndex(words, ext)
  cached = { key, idx }
  return idx
}

export function invalidateIndex() { cached = null }

export { noteOptionsFor, buildNote, buildTopicNote }

export function topicTree(idx: LexIndex, words: WordItem[]): TopicTreeNode[] {
  return buildTopicTree(idx, words, superTopicOf, { lazy: true })
}

export async function expandTopic(idx: LexIndex, node: TopicTreeNode) {
  if (!node.pending) return
  await new Promise(r => setTimeout(r, 0))
  expandTopicNode(idx, node)
}

export async function saveFamilyNote(note: FamilyNote, layout: 'radial' | 'list'): Promise<FamilyNoteRecord> {
  const rec: FamilyNoteRecord = {
    id: newRecordId('fam'),
    type: 'familyNote',
    title: note.title,
    date: todayStr(),
    createdAt: new Date().toISOString(),
    layout,
    note: JSON.parse(JSON.stringify(note))
  }
  await saveStudyRecord(rec)
  return rec
}

/* ---------------- AI 校对 ---------------- */

interface AiReview {
  remove?: { word: string; reason?: string }[]
  add?: { word: string; zh?: string; branch?: string; reason?: string }[]
  formula?: Record<string, string>
  note?: Record<string, string>
}

/**
 * 把本地算出来的笔记交给 AI 校对：删掉不属于这一组的、补上明显漏掉的、给难词补拆解。
 * AI 补进来的词：词库里有就正常显示；词库里没有的标「补」，置信度 0.5，由用户决定留不留。
 * AI 不许改已有词的释义，避免它编造。
 */
export async function aiReviewNote(note: FamilyNote, idx: LexIndex): Promise<{ note: FamilyNote; removed: string[]; added: string[] }> {
  const { askAi, salvageJson } = await import('./aiClient')
  const brief = {
    kind: note.kind,
    title: note.title,
    branches: note.branches.map(b => ({ label: b.label, words: b.words.map(w => ({ word: w.word, zh: w.zh, derivs: w.derivs.map(d => d.word) })) }))
  }
  const kindHint: Record<NoteKind, string> = {
    root: '这是词根族笔记：只保留真正含这个词根（同一词源、同一意思）的词，拼写碰巧相同的要删掉，放进易混。',
    synonym: '这是同义词笔记：只保留与标题意思相同、词性一致的词。',
    topic: '这是话题笔记：只保留属于这个话题的高频词，分组名要准确。',
    decompose: '这是拆解图。'
  }
  const system = '你是严谨的英语词汇学老师。只输出 JSON，不要任何解释。不确定的不要写。词源必须是公认的，不能编造。'
  const prompt = `${kindHint[note.kind]}
下面是程序生成的笔记：
${JSON.stringify(brief)}

请输出 JSON：
{
  "remove": [{"word": "要删掉的词", "reason": "不超过10字"}],
  "add": [{"word": "漏掉的常用词（最多6个）", "zh": "中文", "branch": "放到哪个分组", "reason": "不超过10字"}],
  "formula": {"难词": "前缀（意思）+ 词根（意思）+ 后缀（意思）"},
  "note": {"词": "一句辨析或词义演变，不超过20字"}
}`
  const raw = await askAi(prompt, system, 1500, 60_000, true)
  let review: AiReview = {}
  try { review = JSON.parse(salvageJson(raw) || raw) } catch { throw new Error('AI 返回格式错误') }

  const out: FamilyNote = JSON.parse(JSON.stringify(note))
  const rm = new Set((review.remove || []).map(r => r.word.toLowerCase()))
  const removed: string[] = []
  for (const b of out.branches) {
    b.words = b.words.filter(w => {
      if (!rm.has(w.word.toLowerCase())) return true
      removed.push(w.word)
      return false
    })
  }
  const existing = new Set(out.branches.flatMap(b => b.words.map(w => w.word.toLowerCase())))
  const added: string[] = []
  for (const a of review.add || []) {
    const k = String(a.word || '').trim().toLowerCase()
    if (!/^[a-z][a-z' -]{1,30}$/.test(k) || existing.has(k)) continue
    const hit = idx.byWord.get(k)
    const nw: NoteWord = {
      word: hit?.word || a.word.trim(),
      zh: hit ? zhOf(hit) : (a.zh || ''),
      derivs: [], phrases: [], links: [],
      evidence: [`AI：${a.reason || '补充'}`],
      confidence: hit ? 0.75 : 0.5,
      added: !hit
    }
    let branch = out.branches.find(b => b.label === a.branch)
    if (!branch) { branch = { label: a.branch || '补充', words: [] }; out.branches.push(branch) }
    branch.words.push(nw)
    existing.add(k)
    added.push(nw.word)
  }
  for (const b of out.branches) {
    for (const w of b.words) {
      const f = review.formula?.[w.word]
      if (f && !w.formula) w.formula = f
      const n = review.note?.[w.word]
      if (n) w.evidence.push(`辨析：${n}`)
    }
  }
  if (removed.length) {
    const side = out.side.find(s => s.label === '易混') || (out.side.push({ label: '易混', items: [] }), out.side[out.side.length - 1])
    for (const r of removed) if (note.kind === 'root') side.items.push({ kind: 'confuse', word: r })
  }
  out.branches = out.branches.filter(b => b.words.length)
  return { note: out, removed, added }
}

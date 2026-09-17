/**
 * 词汇笔记诊断：用你本机的真实词库跑一遍，看每种笔记能找出哪些词、凭什么找出来、缺什么数据。
 *
 * 先启动 LanguageBridge，再运行：
 *   node --experimental-strip-types scripts/family-check.ts terrible export impoverished atmosphere
 *   node --experimental-strip-types scripts/family-check.ts --topic 信息传播
 *   node --experimental-strip-types scripts/family-check.ts --coverage
 * 需要 Node 22.6 及以上。
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import {
  buildIndex, buildRootNote, buildSynonymNote, buildTopicNote, buildDecomposeNote, buildTopicTree,
  parseResemble, parseWordRoots, type FamilyNote, type TreeNode
} from '../shared/core/wordFamily.ts'

const port = existsSync('port.txt') ? readFileSync('port.txt', 'utf8').trim() : '58712'
const base = `http://127.0.0.1:${port}`
const args = process.argv.slice(2)

async function get(path: string, text = false): Promise<any> {
  const r = await fetch(base + path)
  if (!r.ok) return null
  return text ? r.text() : r.json()
}

function print(n: FamilyNote | null, title: string) {
  console.log(`\n━━ ${title} ━━`)
  if (!n) { console.log('  没有生成出来（缺少对应数据）'); return }
  console.log(`  标题：${n.title}　候选 ${n.stats.candidates}　保留 ${n.stats.kept}　低置信 ${n.stats.lowConfidence}`)
  for (const b of n.branches) {
    console.log(`  [${b.label}]`)
    for (const w of b.words) {
      const flag = w.confidence < 0.7 ? '?' : ' '
      console.log(`   ${flag} ${w.word.padEnd(18)} ${(w.zh || '').padEnd(10)} ${w.evidence.join(' / ')}`)
      if (w.formula) console.log(`       = ${w.formula}`)
      if (w.derivs.length) console.log(`       ↳ ${w.derivs.map(d => d.word).join(', ')}`)
      if (w.links.length) console.log(`       ~ ${w.links.map(l => `${l.kind}:${l.word}`).join(', ')}`)
    }
  }
  for (const s of n.side) console.log(`  {${s.label}} ${s.items.map(i => i.word).join(', ')}`)
  const tree = (t: TreeNode, d: number) => {
    console.log('  ' + '  '.repeat(d) + (t.kind === 'morpheme' ? '◇ ' : '• ') + t.label + ' ' + (t.zh || ''))
    t.children.forEach(c => tree(c, d + 1))
  }
  if (n.tree) tree(n.tree, 0)
}

const words = await get('/api/words')
if (!Array.isArray(words)) {
  console.error(`连不上 ${base}，先启动 LanguageBridge`)
  process.exit(1)
}
const resemble = await get('/api/lexicon/resemble', true)
const wordroot = await get('/api/lexicon/wordroot', true)
const ext = {
  resembleGroups: resemble ? parseResemble(resemble) : undefined,
  wordRoots: wordroot ? parseWordRoots(wordroot) : undefined
}
const t0 = Date.now()
const idx = buildIndex(words, ext)
console.log(`词库 ${words.length} 词，建索引 ${Date.now() - t0} ms；外部同义组 ${ext.resembleGroups?.length ?? '未放置'}，外部词根 ${ext.wordRoots ? Object.keys(ext.wordRoots).length : '未放置'}`)

if (args.includes('--coverage') || !args.length) {
  const pct = (n: number) => `${((n / words.length) * 100).toFixed(1)}%`
  const c = (f: (w: any) => boolean) => pct(words.filter(f).length)
  console.log('\n数据覆盖率（笔记质量主要取决于这几项）')
  console.log(`  有词素字段     ${c(w => !!(w.morphemes?.root || w.morphemes?.prefix))}`)
  console.log(`  有同义词       ${c(w => (w.synonyms?.length || 0) > 0)}`)
  console.log(`  有反义词       ${c(w => (w.antonyms?.length || 0) > 0)}`)
  console.log(`  有 word_family ${c(w => (w.word_family?.length || 0) > 0)}`)
  console.log(`  有话题         ${c(w => (w.topics?.length || 0) > 0)}`)
  console.log(`  有常用短语     ${c(w => (w.common_phrases?.length || 0) > 0)}`)
  console.log(`  识别出派生基词 ${pct(idx.baseOf.size)}`)
  console.log(`  词素键 ${idx.morph.size} 个，其中成员 ≥3 的 ${[...idx.morph.values()].filter(v => v.length >= 3).length} 个`)
  const multi = [...idx.morph.entries()].filter(([k]) => k.includes('(')).map(([k]) => k)
  if (multi.length) console.log(`  同形异义拆开的词素：${multi.slice(0, 20).join('、')}`)
}

const ti = args.indexOf('--topic')
if (ti >= 0) {
  const t = args[ti + 1]
  const members = [...(idx.topic.get(t) || [])]
  print(buildTopicNote(idx, t, members), `话题 ${t}（${members.length} 词）`)
  const tree = buildTopicTree(idx, words.filter((w: any) => w.topics?.[0] === t))
  for (const l1 of tree) for (const l2 of l1.children) {
    console.log(`\n  ${l2.label}`)
    for (const l3 of l2.children) console.log(`    ${l3.label}（${l3.words.length}）：${l3.words.slice(0, 12).join(' ')}`)
  }
}

const dump: Record<string, any> = {}
for (const w of args.filter(a => !a.startsWith('--') && a !== args[ti + 1])) {
  const notes = {
    root: buildRootNote(idx, w),
    synonym: buildSynonymNote(idx, w),
    decompose: buildDecomposeNote(idx, w)
  }
  print(notes.root, `${w} · 词根族`)
  print(notes.synonym, `${w} · 同义族`)
  print(notes.decompose, `${w} · 拆解`)
  const item = idx.byWord.get(w.toLowerCase())
  if (item) {
    console.log(`\n  原始数据 ${w}: morphemes=${JSON.stringify(item.morphemes || null)} synonyms=${(item.synonyms || []).map((s: any) => s.word).join(',')} family=${(item.word_family || []).join(',')} topics=${(item.topics || []).join(',')}`)
  } else console.log(`\n  词库里没有 ${w}`)
  dump[w] = notes
}
if (args.includes('--json')) {
  writeFileSync('family-check.json', JSON.stringify(dump, null, 2))
  console.log('\n已写出 family-check.json')
}

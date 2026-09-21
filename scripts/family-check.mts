/**
 * 词汇笔记诊断：用你本机的真实词库跑一遍，看每种笔记能找出哪些词、凭什么找出来、缺什么数据。
 *
 * 先启动 LanguageBridge，再运行：
 *   npm run family:check -- terrible export impoverished atmosphere
 *   npm run family:check -- --topic 信息传播
 *   npm run family:check -- --coverage
 * 需要 Node 22.6 及以上。
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import {
  buildIndex, buildRootNote, buildSynonymNote, buildTopicNote, buildDecomposeNote, buildTopicTree,
  parseResemble, parseWordRoots, MORPHEME_VARIANTS, realMorphemes, isPlaceholderMorphemes, type FamilyNote, type TreeNode, type TopicTreeNode
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
console.log(`词库 ${words.length} 条，合并同名后 ${idx.byWord.size} 词（重复 ${idx.duplicates} 条），建索引 ${Date.now() - t0} ms；外部同义组 ${ext.resembleGroups?.length ?? '未放置'}，外部词根 ${ext.wordRoots ? Object.keys(ext.wordRoots).length : '未放置'}`)

if (args.includes('--coverage') || !args.length) {
  const pct = (n: number) => `${((n / words.length) * 100).toFixed(1)}%`
  const c = (f: (w: any) => boolean) => pct(words.filter(f).length)
  console.log('\n数据覆盖率（笔记质量主要取决于这几项）')
  console.log(`  有词素字段     ${c(w => !!realMorphemes(w))}`)
  console.log(`  有同义词       ${c(w => (w.synonyms?.length || 0) > 0)}`)
  console.log(`  有反义词       ${c(w => (w.antonyms?.length || 0) > 0)}`)
  console.log(`  有 word_family ${c(w => (w.word_family?.length || 0) > 0)}`)
  console.log(`  有话题         ${c(w => (w.topics?.length || 0) > 0)}`)
  console.log(`  有常用短语     ${c(w => (w.common_phrases?.length || 0) > 0)}`)
  console.log(`  识别出派生基词 ${pct(idx.baseOf.size)}`)
  console.log(`  词素键 ${idx.morph.size} 个，其中成员 ≥3 的 ${[...idx.morph.values()].filter(v => v.length >= 3).length} 个`)
  const multi = [...idx.morph.keys()].filter(k => k.includes('(') && !(k in MORPHEME_VARIANTS))
  if (multi.length) console.log(`  同形异义拆开的词素：${multi.slice(0, 20).join('、')}`)
  rootReport(words)
}

/**
 * 词根树为什么建不好：「有词根词缀」只说明字段不空，不说明能不能把词串起来。
 * 这里把能串起来的和串不起来的分开数，并各举几个例子。
 */
function rootReport(words: any[]) {
  const singles = words.filter((w: any) => !/\s/.test(w.word || ''))
  const n = singles.length || 1
  const pct = (k: number) => `${k}（${((k / n) * 100).toFixed(1)}%）`
  const cleanF = (f: string) => String(f || '').toLowerCase().replace(/[^a-z]/g, '')
  const eg = (arr: any[], f: (w: any) => string) => arr.slice(0, 8).map(f).join('  ')

  const placeholder = singles.filter(w => isPlaceholderMorphemes(w.morphemes))
  const real = singles.filter(w => realMorphemes(w))
  const withRoot = real.filter(w => realMorphemes(w)!.root?.form)
  const noRoot = real.filter(w => !realMorphemes(w)!.root?.form)
  const selfRoot = withRoot.filter(w => cleanF(realMorphemes(w)!.root!.form) === cleanF(w.word))
  const noMeaning = withRoot.filter(w => !String(realMorphemes(w)!.root!.meaning || '').trim())

  // 同一个词根键下有几个词
  const idx = buildIndex(words)
  const rootGroups = [...idx.morph.entries()]
    .map(([k, list]) => [k, list.filter(e => e.role === 'root')] as const)
    .filter(([, list]) => list.length)
  const grouped = new Set<string>()
  let lonely = 0
  for (const [, list] of rootGroups) {
    if (list.length >= 2) list.forEach(e => grouped.add(e.word.toLowerCase()))
    else lonely++
  }
  // 写法很像、却分成了两个键的词根（spect / spec、duc / duct）
  const keys = rootGroups.map(([k]) => k).filter(k => /^[a-z]+$/.test(k) && k.length >= 3)
  const near: string[] = []
  const keySet = new Set(keys)
  for (const k of keys) {
    for (const cut of [1, 2]) {
      const shorter = k.slice(0, -cut)
      if (shorter.length >= 3 && keySet.has(shorter)) near.push(`${shorter}/${k}`)
    }
    if (near.length >= 12) break
  }

  console.log('\n词根树体检（只算单词，不算短语）')
  console.log(`  有真实词根词缀 ${pct(real.length)}　其中有词根 ${pct(withRoot.length)}`)
  console.log(`  只有前缀/后缀、没有词根 ${pct(noRoot.length)}　例：${eg(noRoot, w => w.word)}`)
  console.log(`  词根就是这个词本身 ${pct(selfRoot.length)}　例：${eg(selfRoot, w => w.word)}`)
  console.log(`  词根没有释义 ${pct(noMeaning.length)}　例：${eg(noMeaning, w => `${w.word}=${realMorphemes(w)!.root!.form}`)}`)
  console.log(`  TypeWords 占位（领头词冒充词根） ${pct(placeholder.length)}`)
  console.log(`  词根键 ${rootGroups.length} 个，只有 1 个词的 ${lonely} 个`)
  console.log(`  能跟别的词串进同一词根的 ${pct(grouped.size)}`)
  if (near.length) console.log(`  写法相近却没合并的词根：${near.join('  ')}`)
  const top = rootGroups.sort((a, b) => b[1].length - a[1].length).slice(0, 12)
  console.log(`  最大的词根：${top.map(([k, l]) => `${k}(${l.length})`).join(' ')}`)
}

const ti = args.indexOf('--topic')
const topicArg = ti >= 0 ? args[ti + 1] : undefined
if (ti >= 0) {
  const t = topicArg!
  const members = [...(idx.topic.get(t) || [])]
  print(buildTopicNote(idx, t, members), `话题 ${t}（${members.length} 词）`)
  const tree = buildTopicTree(idx, words.filter((w: any) => w.topics?.[0] === t))
  const show = (n: TopicTreeNode, d: number) => {
    const kids = n.children.filter(c => !c.id.includes('/@'))
    const pad = '  '.repeat(d)
    console.log(`${pad}▸ ${n.label}（${n.words.length}）${kids.length ? '' : '：' + n.words.slice(0, 12).join(' ')}`)
    if (n.weak?.length) console.log(`${pad}    存疑：${n.weak.join(' ')}`)
    for (const c of kids) show(c, d + 1)
  }
  let maxDepth = 0
  const depthOf = (n: TopicTreeNode, d: number) => { maxDepth = Math.max(maxDepth, d); n.children.filter(c => !c.id.includes('/@')).forEach(c => depthOf(c, d + 1)) }
  for (const l1 of tree) for (const l2 of l1.children) {
    show(l2, 1)
    depthOf(l2, 0)
    const stray = l2.children.find(c => c.label === '零散')
    console.log(`\n  共 ${l2.words.length} 词，最深 ${maxDepth} 层，零散 ${stray?.words.length || 0} 词（${(((stray?.words.length || 0) / l2.words.length) * 100).toFixed(1)}%）`)
  }
}

const dump: Record<string, any> = {}
// 之前这里用 args[ti + 1] 过滤，没有 --topic 时 ti 是 -1，第一个词被误删
for (const w of args.filter(a => !a.startsWith('--') && a !== topicArg)) {
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

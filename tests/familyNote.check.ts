import { LIB } from './fixtures/familyLib.ts'
import { buildIndex, buildRootNote, buildSynonymNote, buildTopicNote, buildDecomposeNote, buildTopicTree, derivationBase } from '../shared/core/wordFamily.ts'
const idx = buildIndex(LIB as any)
const show = (n: any) => {
  if (!n) return console.log('  (null)')
  console.log(`■ ${n.kind} 《${n.title}》 候选${n.stats.candidates} 保留${n.stats.kept} 低置信${n.stats.lowConfidence}`)
  for (const b of n.branches) {
    console.log(`  [${b.label}]`)
    for (const w of b.words) console.log(`    ${w.word} ${w.zh}${w.formula ? '  = ' + w.formula : ''}  (${Math.round(w.confidence * 100)} ${w.evidence.join('/')})` +
      (w.derivs.length ? `\n       ↳ ${w.derivs.map((d: any) => d.word).join(', ')}` : '') +
      (w.phrases.length ? `\n       ☐ ${w.phrases.map((p: any) => p.en).join('; ')}` : '') +
      (w.links.length ? `\n       ~ ${w.links.map((l: any) => l.kind + ':' + l.word).join(', ')}` : ''))
  }
  for (const s of n.side) console.log(`  {${s.label}} ${s.items.map((i: any) => i.word).join(', ')}`)
  const pr = (t: any, d: number) => { console.log('  ' + '  '.repeat(d) + (t.kind === 'morpheme' ? '◇' : '•') + ' ' + t.label + ' ' + (t.zh || '') + (t.links ? ' ≈' + t.links.map((l: any) => l.word) : '')); t.children.forEach((c: any) => pr(c, d + 1)) }
  if (n.tree) pr(n.tree, 0)
}
const mode = process.argv[2] || 'all'
if (mode === 'all' || mode === 'root') { show(buildRootNote(idx, 'port')); show(buildRootNote(idx, 'terrible')) }
if (mode === 'all' || mode === 'syn') { show(buildSynonymNote(idx, 'impoverished')); }
if (mode === 'all' || mode === 'topic') {
  show(buildTopicNote(idx, '信息传播', [...idx.topic.get('信息传播')!]))
  show(buildTopicNote(idx, '商业经济金融', [...idx.topic.get('商业经济金融')!]))
  const tree = buildTopicTree(idx, LIB as any, t => (t === '信息传播' ? '人与社会' : '其他'))
  const pt = (x: any, d = 0) => { console.log('  ' + '  '.repeat(d) + `L${x.level} ${x.label} (${x.words.length})`); x.children.forEach((c: any) => pt(c, d + 1)) }
  tree.forEach(t => pt(t))
}
if (mode === 'all' || mode === 'dec') show(buildDecomposeNote(idx, 'atmosphere'))
if (mode === 'deriv') for (const w of ['rumor', 'exporter', 'distortion', 'impecuniosity', 'underprivileged', 'penniless', 'terrorism', 'atomically', 'deportation', 'hydrate', 'exports', 'transportation', 'supportive']) console.log(w, derivationBase(w, s => idx.byWord.get(s)))

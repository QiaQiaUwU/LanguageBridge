/**
 * 分类/派生回归：这些是 2026-09 抽检「环境」「社会生活」时发现的真实误判。
 * node --experimental-strip-types tests/familyRegress.check.ts
 */
import { buildIndex, expandWord, derivationBase, senseTerms } from '../shared/core/wordFamily.ts'

const W = (word: string, zh: string, pos = 'n', family: string[] = []) =>
  ({ id: word, word, meanings: [{ partOfSpeech: pos, chinese: zh }], word_family: family }) as any

const lib = [
  W('kid', '小孩', 'n', ['kidney']), W('kidney', '肾脏'),
  W('state', '状态', 'n', ['station', 'stature', 'stable']), W('station', '车站'), W('stature', '身高'), W('stable', '稳定的', 'adj'),
  W('comply', '遵守，服从', 'v'), W('compliment', '赞美'), W('compliance', '顺从，服从'),
  W('plan', '计划', 'v'), W('planner', '计划者，规划师'), W('close', '关闭', 'v'), W('closure', '关闭，封闭'),
  W('happy', '快乐的', 'adj'), W('happiness', '快乐，幸福'),
  W('create', '创造', 'v'), W('creation', '创造，创作'),
  W('govern', '统治，管理', 'v'), W('government', '政府'),
]
const idx = buildIndex(lib)
const has = (s: string) => idx.byWord.get(s)
let fail = 0
const expect = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? '✓' : '✗'} ${label}：${JSON.stringify(got)}${ok ? '' : `，应为 ${JSON.stringify(want)}`}`)
}
const baseOf = (w: string) => idx.baseOf.get(w)?.base ?? derivationBase(w, has)?.base ?? null

expect('kidney 不是 kid 的派生', baseOf('kidney'), null)
expect('station 不是 state 的派生', baseOf('station'), null)
expect('stature 不是 state 的派生', baseOf('stature'), null)
expect('stable 不是 state 的派生', baseOf('stable'), null)
expect('compliment 不是 comply 的派生', baseOf('compliment'), null)
expect('compliance ← comply', baseOf('compliance'), 'comply')
expect('planner ← plan（双写）', baseOf('planner'), 'plan')
expect('closure ← close（补 e）', baseOf('closure'), 'close')
expect('happiness ← happy', baseOf('happiness'), 'happy')
expect('creation ← create', baseOf('creation'), 'create')
expect('government ← govern', baseOf('government'), 'govern')

/* 同义、反义要跟释义对得上：抽检「环境」「社会生活」时出现的错例 */
const lib2 = [
  W('barren', '贫瘠的，不毛的', 'adj'), W('childless', '无子女的', 'adj'), W('arid', '干旱的，贫瘠的', 'adj'),
  W('prince', '王子', 'n'), W('toad', '蟾蜍', 'n'), W('princess', '公主', 'n'),
  W('brook', '小溪，小河', 'n'), W('tolerate', '容忍，忍受', 'v'), W('stream', '溪流，小河', 'n')
]
lib2[0].synonyms = [{ word: 'childless' }, { word: 'arid' }]
lib2[3].antonyms = ['toad']
lib2[6].synonyms = [{ word: 'tolerate' }, { word: 'stream' }]
const idx2 = buildIndex(lib2)
const linksOf = (w: string) =>
  (expandWord(idx2, w)?.links || []).map(l => `${l.kind}:${l.word}`)
expect('barren 只留贫瘠这一义的同义词', linksOf('barren'), ['syn:arid'])
expect('prince 不连 toad', linksOf('prince'), [])
expect('brook 只留小河这一义', linksOf('brook'), ['syn:stream'])

const st = (zh: string) => senseTerms(W('x', zh))
expect('矿化作用不被截断', st('矿化作用'), ['矿化作用'])
expect('过度开发不被截断', st('过度开发'), ['过度开发'])
expect('动物、反对、统一保留', st('动物；反对；统一'), ['动物', '反对', '统一'])
expect('头尾虚字去掉', st('贫穷的；使干燥；统治者'), ['贫穷', '干燥', '统治'])
expect('义项编号不进词条', st('1.模糊不清 2.阴暗'), ['模糊不清', '阴暗'])

console.log(fail ? `\n✗ ${fail} 项失败` : '\n✓ 全部通过')
process.exitCode = fail ? 1 : 0

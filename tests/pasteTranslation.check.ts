/** 贴译文：解析 + 对齐 */
import { parseBilingual, applyTranslation } from '../shared/core/pasteTranslation.ts'

const raw = `2.Shoulder the Responsibility of Being a Writer2.肩负起作为一名作家的责任He must learn them again. He must teach himself that the basest of all things is to be afraid;创作者必须重新学会这一切；必须教会自己认识到一切事物的本质是恐惧；I decline to accept the end of man.我拒绝接受人类的终结。`
const pairs = parseBilingual(raw)
let fail = 0
const check = (label: string, ok: boolean, extra = '') => { if (!ok) fail++; console.log(`${ok ? '✓' : '✗'} ${label}${extra ? '：' + extra : ''}`) }

check('拆出 3 对', pairs.length === 3, String(pairs.length))
check('去掉小节编号', pairs[0]?.en.startsWith('Shoulder'), pairs[0]?.en.slice(0, 20))
check('中文不混进英文', !/[A-Za-z]/.test(pairs[2]?.zh || 'x'), pairs[2]?.zh)

const sentences = [
  'He must learn them again.',
  'He must teach himself that the basest of all things is to be afraid;',
  'I decline to accept the end of man.',
  'This sentence is not in the material at all.'
]
const r = applyTranslation(sentences, pairs)
check('第 3 句贴上', r.zh[2] === '我拒绝接受人类的终结。', String(r.zh[2]))
check('材料里没有的句子不乱贴', r.zh[3] === null, String(r.zh[3]))
check('同一条译文不会贴两句', new Set(r.zh.filter(Boolean)).size === r.matched, `${r.matched} 条`)

console.log(fail ? `\n✗ ${fail} 项失败` : '\n✓ 全部通过')
process.exitCode = fail ? 1 : 0

/* 整篇重排后，划线标记要跟着对到新句子上 */
import { reanchorMarks } from '../shared/core/pasteTranslation.ts'
const marks = [
  { text: 'endure', sentIdx: 0, localStart: 3, localEnd: 9 },
  { text: 'nowhere-to-be-found', sentIdx: 1, localStart: 0, localEnd: 19 }
]
const re = reanchorMarks(marks, ['He will endure.', 'I decline to accept the end of man.'])
check('划线重新锚定', re.kept.length === 1 && re.kept[0].sentIdx === 0 && re.kept[0].localStart === 8, JSON.stringify(re.kept[0]))
check('找不到的划线被丢掉', re.dropped === 1, String(re.dropped))
console.log(fail ? `\n✗ ${fail} 项失败` : '\n✓ 全部通过')
process.exitCode = fail ? 1 : 0

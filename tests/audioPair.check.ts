/** 音频批量配对回归：编号要能区分篇目，名字也要对得上 */
import { matchAudioToChapters } from '../shared/core/audioPairing.ts'

const files = ['4242-每日听写 5-2(本周汇总).mp3', '4320-每日听写 8-1.mp3', '4326-每日听写 8-8.mp3', '4248-每日听写 5-9.mp3']
const chaps = ['每日听写 9-19', '每日听写 8-29', '每日听写 8-1（本周汇总）_原文', '每日听写 5-2（本周汇总）_原文', '每日听写 5-9（本周汇总）_原文']
const got = new Map(matchAudioToChapters(files, chaps).map(p => [files[p.fileIndex], { chap: chaps[p.chapterIndex], score: p.score, reason: p.reason }]))

let fail = 0
const check = (label: string, ok: boolean, extra = '') => {
  if (!ok) fail++
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? '：' + extra : ''}`)
}
for (const [file, chap] of [
  ['4320-每日听写 8-1.mp3', '每日听写 8-1（本周汇总）_原文'],
  ['4242-每日听写 5-2(本周汇总).mp3', '每日听写 5-2（本周汇总）_原文'],
  ['4248-每日听写 5-9.mp3', '每日听写 5-9（本周汇总）_原文']
]) {
  const g = got.get(file)
  check(`${file} 配到 ${chap}`, g?.chap === chap && g.score >= 0.7, `${g?.chap} ${g?.score.toFixed(2)}`)
}
const weak = got.get('4326-每日听写 8-8.mp3')
check('8-8 没有对应章节时不靠"序号都是 8"硬配', !weak || weak.score < 0.5, `${weak?.chap} ${weak?.score.toFixed(2)}`)

console.log(fail ? `\n✗ ${fail} 项失败` : '\n✓ 全部通过')
process.exitCode = fail ? 1 : 0

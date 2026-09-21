/**
 * 看看磁盘被谁占了：npm run size
 *
 * 只统计，不删任何东西。会额外指出几处「同一份东西存了两遍」的情况。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function size(p) {
  if (!existsSync(p)) return null
  const st = statSync(p)
  if (!st.isDirectory()) return { bytes: st.size, files: 1 }
  let bytes = 0, files = 0
  for (const name of readdirSync(p)) {
    const r = size(join(p, name))
    if (r) { bytes += r.bytes; files += r.files }
  }
  return { bytes, files }
}
const mb = b => (b / 1048576).toFixed(1).padStart(8) + ' MB'

const rows = [
  ['你的数据（文章、笔记、单词、记录）', 'data'],
  ['释义库', 'resources/word_explanations'],
  ['音频 / 视频', 'resources/media'],
  ['ECDICT 词根词表', 'resources/ecdict'],
  ['前端构建产物（可删，启动会重建）', 'dist'],
  ['依赖（可删，启动会重装）', 'node_modules'],
  ['打包出来的桌面版（可删）', 'dist-desktop'],
  ['对齐运行时（从 node_modules 拷的）', 'public/ort']
]

let total = 0
console.log('')
for (const [label, rel] of rows) {
  const r = size(join(ROOT, rel))
  if (!r) { console.log(`${'—'.padStart(11)}   ${label}（没有）`); continue }
  total += r.bytes
  console.log(`${mb(r.bytes)}   ${label}　${r.files} 个文件　${rel}`)
}
console.log(`${mb(total)}   合计\n`)

// 重复副本
const dups = [
  ['resources/media', 'data/media', '音频搬过家，老目录还留着'],
  ['resources/word_explanations', 'vendor-data/word_explanations', '释义库改过名，老目录还留着'],
  ['resources/word_explanations', 'public/data/word_explanations', '释义库更早的位置，老目录还留着']
]
let found = false
for (const [now, old, why] of dups) {
  const a = size(join(ROOT, now)), b = size(join(ROOT, old))
  if (a && b && b.bytes > 0) {
    found = true
    console.log(`重复：${old}（${mb(b.bytes).trim()}）—— ${why}，现在用的是 ${now}`)
  }
}
if (!found) console.log('没有发现重复目录')
console.log('')

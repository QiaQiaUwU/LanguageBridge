/**
 * 桌面版打包，带进度条。
 *
 * electron-builder 本身只在下载运行时的时候有进度条，真正的打包阶段
 * （拷贝 → 生成 asar → 压缩成 portable exe）几分钟里一行输出都没有，
 * 看着像卡死。第一次跑的人多半会 Ctrl+C，然后从头再来一次。
 *
 * 这里的办法是**按产物体积估进度**：打包过程就是往 dist-desktop 里写文件，
 * 每秒扫一次目录大小，跟上一次打包记下来的最终体积一比就是百分比。
 * 第一次跑没有参考值，用 electron 31 win-x64 的经验值 260MB 兜底，
 * 跑完把真实值记进 .lb-pack-size，第二次开始就准了。
 *
 * 这不是精确进度 —— 压缩阶段体积增长不是线性的。但它回答了唯一要紧的问题：
 * 「它还在动吗，大概还要多久」。
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'dist-desktop')
const SIZE_FILE = join(ROOT, '.lb-pack-size')

/** 上次打包的最终体积，第一次跑用经验值 */
const FALLBACK_BYTES = 260 * 1024 * 1024
function expectedBytes() {
  try {
    const n = Number(readFileSync(SIZE_FILE, 'utf8').trim())
    if (Number.isFinite(n) && n > 10 * 1024 * 1024) return n
  } catch { /* 没有就用兜底 */ }
  return FALLBACK_BYTES
}

function dirSize(dir) {
  let total = 0
  let stack = [dir]
  while (stack.length) {
    const d = stack.pop()
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) stack.push(p)
      else {
        try { total += statSync(p).size } catch { /* 正在写的文件可能读不到 */ }
      }
    }
  }
  return total
}

const BAR_WIDTH = 34
function drawBar(ratio, elapsedSec, note) {
  const r = Math.max(0, Math.min(1, ratio))
  const filled = Math.round(r * BAR_WIDTH)
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
  const pct = String(Math.round(r * 100)).padStart(3)
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0')
  const ss = String(elapsedSec % 60).padStart(2, '0')

  // 估剩余时间：进度太小时估不准，就不显示
  let eta = ''
  if (r > 0.08 && r < 0.995) {
    const total = elapsedSec / r
    const left = Math.max(0, Math.round(total - elapsedSec))
    eta = ` · 约剩 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
  }

  // \r 回到行首原地刷新，不刷屏
  process.stdout.write(`\r  ${bar} ${pct}%  已用 ${mm}:${ss}${eta}  ${note}   `)
}

const started = Date.now()
const expect = expectedBytes()
const firstRun = expect === FALLBACK_BYTES

console.log('')
console.log('  正在打包桌面版 EXE')
console.log(firstRun
  ? '  第一次打包没有参考体积，进度是估的；跑完会记下来，下次就准了。'
  : `  参考上次的产物体积 ${(expect / 1024 / 1024).toFixed(0)}MB 估算进度。`)
console.log('')

/**
 * electron-builder 的输出照常透传。
 *
 * 它自己那些行（下载运行时的进度、packaging 提示）是有用的，
 * 不能吞掉；只是在没有输出的那几分钟里由进度条顶上。
 * 每次它打印一行，就先把进度条那行擦掉，免得两边打架。
 */
const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['electron-builder', '--win', '--x64'],
  { cwd: ROOT, shell: process.platform === 'win32' }
)

let lastNote = '准备中'
const clearLine = () => process.stdout.write('\r' + ' '.repeat(90) + '\r')

function onOutput(buf) {
  const text = String(buf)
  clearLine()
  process.stdout.write(text)
  // 从它的输出里认出当前阶段，显示在进度条右边
  if (/packaging/i.test(text)) lastNote = '打包中'
  else if (/downloading/i.test(text)) lastNote = '下载运行时'
  else if (/building.*portable|portable/i.test(text)) lastNote = '压缩成 exe'
  else if (/signing|winCodeSign/i.test(text)) lastNote = '处理签名工具'
}
child.stdout.on('data', onOutput)
child.stderr.on('data', onOutput)

const timer = setInterval(() => {
  if (!existsSync(OUT)) return
  const now = dirSize(OUT)
  const elapsed = Math.round((Date.now() - started) / 1000)
  drawBar(now / expect, elapsed, lastNote)
}, 1000)

child.on('close', code => {
  clearInterval(timer)
  clearLine()

  const elapsed = Math.round((Date.now() - started) / 1000)
  const mm = Math.floor(elapsed / 60)
  const ss = elapsed % 60

  if (code !== 0) {
    console.log('')
    console.log(`  打包失败（用时 ${mm}:${String(ss).padStart(2, '0')}），往上翻看报错。`)
    process.exit(code || 1)
  }

  // 记下这次的真实体积，下次估得准
  try {
    const finalSize = dirSize(OUT)
    if (finalSize > 10 * 1024 * 1024) writeFileSync(SIZE_FILE, String(finalSize))
  } catch { /* 记不下就下次还用兜底 */ }

  const exe = join(OUT, 'LanguageBridge-桌面版.exe')
  console.log('')
  console.log(`  打包完成，用时 ${mm}:${String(ss).padStart(2, '0')}`)
  if (existsSync(exe)) {
    console.log(`  产物：dist-desktop\\LanguageBridge-桌面版.exe（${(statSync(exe).size / 1024 / 1024).toFixed(0)}MB）`)
  }
  console.log('')
})

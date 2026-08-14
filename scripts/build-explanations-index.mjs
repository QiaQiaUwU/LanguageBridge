#!/usr/bin/env node
/**
 * 【兼容用途 / 一般不需要再用了】生成本地释义库索引（复制文件到项目里）
 *
 * 新版本已经改用"关联释义库文件夹"（词汇中心页面里的按钮），
 * 直接读取你本地的释义库文件夹，不复制任何文件，见 shared/core/libraryFolder.ts。
 * 这个脚本只在浏览器不支持文件夹关联（非 Chrome/Edge）时才需要用到。
 *
 * 用法（在 LanguageBridge 项目根目录下执行；cmd 和 PowerShell 通用，
 * 注意 PowerShell 不支持 `cd /d`，直接 cd 到路径就行）：
 *   node scripts/build-explanations-index.mjs "你的释义库文件夹路径"
 *
 * 会把该文件夹下的 JSON 复制到 vendor-data/word_explanations/，
 * 并生成 vendor-data/word_explanations_index.json（单词 → 文件名 映射）。
 * （这两个目录都不在 public/ 或 dist/ 下——放 public/ 里会被 Vite 构建当成静态资源，
 * 15000+ 个文件每次构建反复清空/复制，Windows 下容易因为文件被占用导致构建失败；
 * 由 scripts/server.mjs 单独开了一条 /data/word_explanations/* 路由伺服这批文件，
 * 浏览器端请求路径不受影响。）
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// 资源目录：优先新名字 resources/，老装机可能还是 vendor-data/，两个都认。
const RES_ROOT = existsSync(join(__dirname, '..', 'resources')) ? 'resources' : 'vendor-data'
const targetDir = join(__dirname, '..', RES_ROOT, 'word_explanations')
const indexFile = join(__dirname, '..', RES_ROOT, 'word_explanations_index.json')

const srcDir = process.argv[2]

mkdirSync(targetDir, { recursive: true })

// 若提供了源目录，先复制
if (srcDir) {
  if (!existsSync(srcDir)) {
    console.error(`源目录不存在: ${srcDir}`)
    process.exit(1)
  }
  const files = readdirSync(srcDir).filter(f => f.endsWith('.json'))
  console.log(`从源目录复制 ${files.length} 个 JSON ...`)
  let copied = 0
  for (const f of files) {
    copyFileSync(join(srcDir, f), join(targetDir, f))
    copied++
    if (copied % 500 === 0) console.log(`  已复制 ${copied}/${files.length}`)
  }
  console.log(`复制完成: ${copied} 个文件`)
}

// 建索引
const files = readdirSync(targetDir).filter(f => f.endsWith('.json'))
if (!files.length) {
  console.warn('word_explanations 目录为空，索引未生成。请先复制释义 JSON。')
  process.exit(0)
}

const index = {}
let ok = 0
let bad = 0
for (const f of files) {
  try {
    const data = JSON.parse(readFileSync(join(targetDir, f), 'utf-8'))
    const word = String(data.word || '').toLowerCase().trim()
    if (word) {
      index[word] = f
      ok++
    } else {
      bad++
    }
  } catch {
    bad++
  }
}

writeFileSync(indexFile, JSON.stringify(index))
console.log(`索引已生成: ${indexFile}`)
console.log(`  收录 ${ok} 个词条${bad ? `，跳过 ${bad} 个无效文件` : ''}`)
console.log('提示：新版本"导入完整释义库"功能改用文件夹关联方式了，这个脚本只用于补全匹配，不再需要生成合并文件')

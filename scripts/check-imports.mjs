/**
 * 查「用了 shared/core 里的函数却没 import」。
 *
 * 这类错误构建时不报：Vite / esbuild 把没定义的名字当成全局变量放过去，
 * 直到页面运行到那一行才抛 ReferenceError，整页白屏。
 * （设置页的 readJson 就是这么出的事。）
 *
 * 做法很朴素：收集 shared/core/*.ts 导出的函数名，
 * 再看每个文件里「调用了、但既没 import 也没本地定义」的。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const CORE = join(ROOT, 'shared', 'core')

const exported = new Set()
for (const f of readdirSync(CORE)) {
  if (!f.endsWith('.ts')) continue
  const src = readFileSync(join(CORE, f), 'utf8')
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) exported.add(m[1])
}
// 太通用的名字（很多文件都有同名本地函数）不查，免得误报
for (const n of ['load', 'save', 'init', 'reset', 'start', 'stop', 'run', 'update', 'remove', 'add', 'get', 'set']) exported.delete(n)

function* walk(dir) {
  for (const f of readdirSync(dir)) {
    if (['node_modules', 'dist', 'dist-desktop', '.git', 'public'].includes(f)) continue
    const p = join(dir, f)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.(vue|ts)$/.test(f) && !p.endsWith('.d.ts')) yield p
  }
}

const problems = []
for (const file of [...walk(join(ROOT, 'apps')), ...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'shared'))]) {
  let src = readFileSync(file, 'utf8')
  if (file.endsWith('.vue')) {
    const m = src.match(/<script[^>]*>([\s\S]*?)<\/script>/g)
    if (!m) continue
    src = m.join('\n') + '\n' + (src.split('<script')[0] || '')   // 模板里也会调用
  }
  // 注释里提到的函数名不算调用
  src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const imported = new Set()
  // 静态 import { a } from，和动态 const { a } = await import(...) 两种都算
  const importRe = /(?:import\s*(?:type\s*)?\{([^{}]*)\}\s*from|\{([^{}]*)\}\s*=\s*await\s+import\()/g
  for (const m of src.matchAll(importRe)) {
    for (const part of (m[1] ?? m[2]).split(',')) {
      const name = part.trim().split(/\s+as\s+|\s*:\s*/).pop()?.trim()
      if (name) imported.add(name)
    }
  }
  for (const name of exported) {
    const called = new RegExp(`(?<![\\w$.])${name}\\s*\\(`).test(src)
    if (!called || imported.has(name)) continue
    // 本地定义：function / const / 对象里的方法简写（可能带 async 和返回类型）
    const local = new RegExp(
      `(function\\s+${name}\\b|(const|let|var)\\s+${name}\\b|\\b${name}\\s*:\\s*(async\\s*)?\\(|` +
      `(^|[\\s,{])(async\\s+)?${name}\\s*(<[^>]*>)?\\([^)]*\\)\\s*(:\\s*[^{=]+)?\\{)`, 'm'
    ).test(src)
    if (local) continue
    problems.push(`${relative(ROOT, file)}：调用了 ${name}() 但没有 import`)
  }
}

if (problems.length) {
  for (const p of problems) console.log('✗ ' + p)
  console.log(`\n✗ ${problems.length} 处缺 import`)
  process.exit(1)
}
console.log('✓ import 检查通过')

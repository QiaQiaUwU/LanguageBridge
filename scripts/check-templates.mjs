#!/usr/bin/env node
/**
 * Vue 模板结构自检。
 *
 * ── 为什么要有这个 ──
 * 之前的自检只把 <script setup> 抠出来用 node 剥类型跑一遍，
 * **模板一个字都没检查**。结果是我把一个 <audio> 插进了 v-if / v-else-if 链的中间，
 * 把链打断了，本地一切正常、到你机器上 vite build 直接失败。
 * 这个脚本补上那一半：标签有没有配对、v-else/v-else-if 前面有没有相邻的 v-if。
 *
 * 不是完整的 Vue 编译器，只查这两类最容易被批量编辑弄坏的结构问题。
 *
 * 用法：node scripts/check-templates.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (name.endsWith('.vue')) out.push(full)
  }
  return out
}

/** 抠出 <template> 块的内容（只取最外层那一个） */
function templateOf(src) {
  const start = src.indexOf('<template>')
  if (start < 0) return null
  // 从后往前找收尾，避免匹配到内层 <template v-if> 的收尾
  const end = src.lastIndexOf('</template>')
  if (end <= start) return null
  return { text: src.slice(start + 10, end), offset: start + 10 }
}

function lineOf(text, idx) {
  return text.slice(0, idx).split('\n').length
}

/**
 * 扫一遍标签，维护一个栈。
 * 每层记住"最近一个兄弟元素带的是 v-if / v-else-if / v-else 里的哪个"，
 * 这样遇到 v-else 时就能判断它前面是不是真的挨着一个 v-if。
 */
function checkTemplate(file, tpl) {
  const problems = []
  const stack = []
  // 每一层的"上一个兄弟带了什么条件指令"
  let lastSibling = [null]

  const tagRe = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z][\w.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/)?>/g
  let m
  while ((m = tagRe.exec(tpl.text))) {
    if (m[0].startsWith('<!--')) continue
    const [full, closing, tag, attrs = '', selfClose] = m
    const ln = lineOf(tpl.text, m.index)

    if (closing) {
      const top = stack.pop()
      lastSibling.pop()
      if (!top) {
        problems.push(`第 ${ln} 行：多出来的 </${tag}>`)
      } else if (top.tag !== tag) {
        problems.push(`第 ${ln} 行：</${tag}> 对不上，最近打开的是第 ${top.line} 行的 <${top.tag}>`)
      }
      continue
    }

    const hasIf = /\sv-if[=\s>]/.test(' ' + attrs + ' ')
    const hasElseIf = /\sv-else-if[=\s>]/.test(' ' + attrs + ' ')
    const hasElse = /\sv-else(?![-\w])/.test(' ' + attrs + ' ')

    if (hasElseIf || hasElse) {
      const prev = lastSibling[lastSibling.length - 1]
      if (prev !== 'if' && prev !== 'else-if') {
        problems.push(
          `第 ${ln} 行：<${tag}> 上的 ${hasElse ? 'v-else' : 'v-else-if'} 前面没有相邻的 v-if` +
          (prev === null ? '（它是这一层的第一个元素）' : `（上一个兄弟元素没有条件指令）`)
        )
      }
    }

    // 记下这个元素给下一个兄弟看
    const mark = hasIf ? 'if' : hasElseIf ? 'else-if' : hasElse ? 'else' : null
    lastSibling[lastSibling.length - 1] = mark

    if (!selfClose && !VOID_TAGS.has(tag)) {
      stack.push({ tag, line: ln })
      lastSibling.push(null)
    }
  }

  for (const left of stack) {
    problems.push(`第 ${left.line} 行的 <${left.tag}> 没有闭合`)
  }
  return problems
}

let bad = 0
let checked = 0
for (const dir of ['apps', 'src']) {
  let files = []
  try { files = walk(join(ROOT, dir)) } catch { continue }
  for (const f of files) {
    const src = readFileSync(f, 'utf-8')
    const tpl = templateOf(src)
    if (!tpl) continue
    checked++
    const problems = checkTemplate(f, tpl)
    if (problems.length) {
      bad++
      console.error(`\n✗ ${relative(ROOT, f)}`)
      for (const p of problems.slice(0, 8)) console.error('   ' + p)
      if (problems.length > 8) console.error(`   …还有 ${problems.length - 8} 处`)
    }
  }
}

console.log(`\n检查了 ${checked} 个模板，${bad ? bad + ' 个有问题' : '全部通过'}`)
process.exit(bad ? 1 : 0)

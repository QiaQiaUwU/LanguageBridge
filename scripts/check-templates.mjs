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

/**
 * 样式块花括号配对。
 *
 * 批量改 CSS 时很容易删掉一个选择器却留下它的 }，sass 只会在 build 时报
 * 「unmatched "}"」并且给的是样式块内的行号，跟文件行号对不上，很难找。
 * 这里提前查出来，并把上下文打出来。
 */
function checkStyles(src) {
  const problems = []
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g
  let m
  while ((m = re.exec(src))) {
    const lines = m[1].split('\n')
    let depth = 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // 去掉字符串和注释里的花括号，避免误判
      const clean = line
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/, '')
        .replace(/'[^']*'|"[^"]*"/g, '')
      depth += (clean.match(/\{/g) || []).length
      depth -= (clean.match(/\}/g) || []).length
      if (depth < 0) {
        const ctx = lines.slice(Math.max(0, i - 3), i + 1)
          .map((l, k) => `      ${i - Math.min(i, 3) + k + 1} | ${l}`)
          .join('\n')
        problems.push(`样式第 ${i + 1} 行多出一个 }\n${ctx}`)
        depth = 0
      }
    }
    if (depth > 0) problems.push(`样式块结尾还缺 ${depth} 个 }`)
  }
  return problems
}

/**
 * 带 immediate 的 watch 引用了后面才声明的 const —— 暂时性死区。
 *
 * setup 阶段 immediate 会立刻执行回调，此时下面的 const 还没初始化，
 * 运行时报 "Cannot access 'X' before initialization"，而且压缩后变量名变成
 * 单字母，报错信息完全看不出是谁。构建期发现不了，只有真跑起来才炸。
 */
function checkImmediateWatch(src) {
  const problems = []
  const m = src.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)
  if (!m) return problems
  const code = m[1]

  // 收集每个顶层 const 的声明位置
  const declAt = new Map()
  for (const d of code.matchAll(/^const\s+([A-Za-z_$][\w$]*)/gm)) {
    if (!declAt.has(d[1])) declAt.set(d[1], d.index)
  }

  // 找出 watch(...) { immediate: true } 这种调用
  for (const w of code.matchAll(/watch\s*\(/g)) {
    const start = w.index
    // 粗略取这次调用的范围：到下一个顶层 watch/function/const 之前
    // 只看这一次 watch 调用本身：从 watch( 到括号配平为止。
    // 之前粗暴地取后面 1200 个字符，会把不相干的代码也算进来，产生误报。
    let depth = 0
    let end = start
    for (let i = start; i < code.length; i++) {
      const c = code[i]
      if (c === '(') depth++
      else if (c === ')') {
        depth--
        if (depth === 0) { end = i + 1; break }
      }
    }
    if (end <= start) continue
    const tail = code.slice(start, end)
    if (!/immediate:\s*true/.test(tail)) continue
    for (const [name, at] of declAt) {
      if (at <= start) continue
      // 这个 watch 里用到了后面才声明的变量
      const used = new RegExp('(^|[^\\w$.])' + name + '(\\.|\\s|,|\\)|$)').test(tail)
      if (used) {
        const line = code.slice(0, start).split('\n').length
        problems.push(
          `第 ${line} 行的 watch 带 immediate，但用到了第 ` +
          `${code.slice(0, at).split('\n').length} 行才声明的 ${name} —— 运行时会报 ` +
          `"Cannot access '${name}' before initialization"`
        )
        break
      }
    }
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
    const problems = [...checkTemplate(f, tpl), ...checkStyles(src), ...checkImmediateWatch(src)]
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

#!/usr/bin/env node
/**
 * 界面规范检查。npm run lint:ui
 * 查的是「同一种结构不许各写一套」这类问题，规则来源：docs/界面规范.md
 * 退出码：有 error 级问题时为 1；色值类（warn）只报数，按基线收紧。
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const BASELINE = join(ROOT, 'scripts', 'lint-ui-baseline.json')
const files = []
;(function walk(d) {
  for (const n of readdirSync(d)) {
    if (['node_modules', 'dist', 'vendor-data', 'data'].includes(n) || n.startsWith('.')) continue
    const f = join(d, n)
    if (statSync(f).isDirectory()) walk(f)
    else if (n.endsWith('.vue')) files.push(f)
  }
})(ROOT)

const RULES = [
  { id: 'back', level: 'error', re: /<button[^>]*>\s*[←‹](?!\s*上一)[^<]*<\/button>/g, msg: '返回按钮用 <BackLink>' },
  { id: 'close', level: 'error', re: /<button[^>]*>\s*[×✕]\s*<\/button>/g, msg: '关闭按钮用 <CloseButton>' },
  { id: 'star-char', level: 'error', re: />\s*[★☆]\s*</g, msg: '收藏用 <StarToggle>' },
  { id: 'search-ph', level: 'error', re: /placeholder="搜(?!索")[^"]*"|placeholder="搜索[^"]+"/g, msg: '搜索框占位只写「搜索」' },
  { id: 'please-first', level: 'error', re: /['"`>]\s*(?:请先|先[^'"`<]{1,12}再)[^'"`<]*['"`<]/g, msg: '错误提示用状态词，不写「请先/先…再」' },
  { id: 'fold-text', level: 'error', re: /<button[^>]*>\s*(?:收起\s*›|‹|›|▾|▴)\s*</g, msg: '折叠按钮用 <FoldToggle>' },
  { id: 'native-drag', level: 'error', re: /<button[^>]*draggable="true"/g, msg: '可管理列表用 useManageList，不在 button 上用原生拖拽' },
  // 说明文字：desc/hint/tip/help/note/sub 类元素里的静态长句（插值不算）
  { id: 'explain', level: 'error', re: /<(?:p|span|div|small|label|em)\b[^>]*\bclass="[^"]*\b(?:desc|hint|tip|help|note|sub|intro|caption|cost)[\w-]*\b[^"]*"[^>]*>(?:[^<{]|\{\{[^}]*\}\})*?(?:[\u4e00-\u9fff][^<{]*?){12,}</g, msg: '界面不写说明文字' },
  { id: 'guide', level: 'error', re: />[^<]*(?:点一下|再点|可以在|会自动|建议用)[^<]*</g, msg: '不写操作指引' },
  { id: 'placeholder', level: 'error', re: /(?<![:\w-])placeholder="(?:[^"]*(?:比如|例如|如[：:]|（|可选|留空)[^"]*|[^"]{11,})"/g, msg: '占位符只写名词' },
  { id: 'plus-named', level: 'error', re: /<button[^>]*>\s*[+＋]\s*[^\s<]+[^<]*<\/button>/g, msg: '添加入口只写 ＋，名称放 title' },
  { id: 'hex', level: 'warn', re: /#[0-9a-fA-F]{3,8}\b/g, style: true, msg: '样式里写死色值，改用 tokens.css 的 --c-*' },
  { id: 'palette-var', level: 'error', re: /var\(--r-(?:ink2?|paper|border|accent|ui)\b/g, style: true, msg: '样式直接用调色板变量，改用语义 token' },
]

const out = []
const counts = {}
for (const f of files) {
  if (f.includes(`${join('src', 'components', 'ui')}`)) continue
  const s = readFileSync(f, 'utf8')
  const si = s.indexOf('<script'), st = s.lastIndexOf('<style')
  const tpl = s.slice(0, si >= 0 ? si : s.length)
  const css = st >= 0 ? s.slice(st) : ''
  for (const r of RULES) {
    const src = r.style ? css : tpl
    const hits = src.match(r.re) || []
    if (!hits.length) continue
    const rel = relative(ROOT, f)
    counts[r.id] = (counts[r.id] || 0) + hits.length
    if (r.level === 'error') out.push(`${rel}  [${r.id}] ${r.msg}：${hits.slice(0, 3).join(' | ')}`)
    else counts[`${r.id}:${rel}`] = hits.length
  }
}

const errors = out.length
for (const l of out) console.log('✗ ' + l)
const hexTotal = counts.hex || 0
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null
console.log(`\n写死色值 ${hexTotal} 处${base ? `（基线 ${base.hex}）` : ''}`)
Object.entries(counts).filter(([k]) => k.startsWith('hex:')).sort((a, b) => b[1] - a[1]).slice(0, 8)
  .forEach(([k, v]) => console.log(`  ${v}\t${k.slice(4)}`))
if (process.argv.includes('--update-baseline')) writeFileSync(BASELINE, JSON.stringify({ hex: hexTotal }, null, 2))
if (base && hexTotal > base.hex) { console.log('✗ 色值比基线多了'); process.exitCode = 1 }
if (errors) { console.log(`\n✗ ${errors} 处不合规`); process.exitCode = 1 } else console.log('\n✓ 结构规范 0 处问题')

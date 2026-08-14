#!/usr/bin/env node
/**
 * 把 LanguageBridge 打包成单个 Windows .exe（不需要对方装 Node/npm）。
 * 用法：npm run build:exe
 *
 * 这几步都是在沙盒里真跑通、用 wine 实测过 HTTP 服务能正常响应的，不是空想的流程：
 *   1. vite build 出最新的 dist/（已经在 npm run build:exe 里先跑过）
 *   2. 把 dist/ 临时复制一份到 scripts/dist/——pkg 打包资源用的相对路径是相对于
 *      "打包用的那份 package.json" 所在目录算的，scripts/ 下专门放了一份不含前端依赖
 *      （vue/pinia那些）的干净 package.json（scripts/package.json），避免 pkg 把整个
 *      项目的 node_modules 都误打包进 exe 里，体积会离谱地大
 *   3. 用 pkg 把 scripts/server-standalone.cjs + 复制过去的 dist/ 一起打包成一个 exe
 *   4. 打包完删掉临时复制的 scripts/dist/
 *
 * 关于 exe 图标：**故意不做**。试过用 rcedit 给 pkg 打出来的 exe 嵌入图标，
 * 嵌入本身能成功，但改完的 exe 直接打不开、报 "Pkg: Error reading from file"——
 * 查了一圈，这是 pkg 生态里一个公开已知、没有官方修复的兼容性问题（不管用 rcedit
 * 还是 Resource Hacker 改图标都会破坏 pkg 塞进 exe 里的那份数据），vercel/pkg 的
 * GitHub issue #1109、#1894，electron/rcedit 的 issue #107 都是这个问题，没人修好过。
 * 与其为了图标好看换来一个打不开的 exe，不如老老实实用默认图标，保证能跑。
 * 想要好看图标的话：在 Windows 上给这个 exe 建一个快捷方式，右键快捷方式→属性→
 * 更改图标，快捷方式的图标是独立存储的，不会碰 exe 本体，不会有这个问题。
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DIST = join(ROOT, 'dist')
const SCRIPTS_DIR = join(ROOT, 'scripts')
const TEMP_DIST_COPY = join(SCRIPTS_DIR, 'dist')
const OUT_DIR = join(ROOT, 'dist-exe')
const EXE_PATH = join(OUT_DIR, 'LanguageBridge.exe')

if (!existsSync(DIST)) {
  console.error('找不到 dist/ 目录，先跑一次 `npm run build` 或者直接用 `npm run build:exe`（会自动先构建）')
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })

console.log('正在准备打包资源...')
if (existsSync(TEMP_DIST_COPY)) rmSync(TEMP_DIST_COPY, { recursive: true, force: true })
cpSync(DIST, TEMP_DIST_COPY, { recursive: true })

/**
 * 把三个 ESM 模块转成 CJS 一起打包。
 *
 * exe 用的 server-standalone 是 CJS（pkg 对 CJS 的支持成熟得多），
 * 而词库接口那三个文件是 ESM。以前的做法是**干脆不打包它们**，
 * 于是 exe 版本连一个 /api/ 都没有：查不到词库、存不了、AI 补全也跑不了，
 * 等于只是个静态页面。
 *
 * 这三个文件的 import/export 形态很规整（只有具名导入导出、没有默认导出、
 * 没有顶层 await），所以做一次文本转换就够了，不用引 rollup/esbuild。
 * 转换结果每次构建重新生成，不进版本库，源文件永远只有 ESM 一份。
 */
function esmToCjs(src) {
  let out = src
  // import { a, b } from 'x'  →  const { a, b } = require('x')
  out = out.replace(/^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?\s*$/gm,
    (_m, names, mod) => `const {${names}} = require('${mod.replace(/\.mjs$/, '.cjs')}')`)
  // import x from 'y'
  out = out.replace(/^import\s+(\w+)\s+from\s*['"]([^'"]+)['"];?\s*$/gm,
    (_m, name, mod) => `const ${name} = require('${mod.replace(/\.mjs$/, '.cjs')}')`)
  // 收集具名导出
  const names = []
  out = out.replace(/^export\s+(async\s+)?function\s+(\w+)/gm, (_m, a, n) => {
    names.push(n); return `${a || ''}function ${n}`
  })
  out = out.replace(/^export\s+(const|let|var)\s+(\w+)/gm, (_m, k, n) => {
    names.push(n); return `${k} ${n}`
  })
  if (names.length) out += `\n\nmodule.exports = { ${names.join(', ')} }\n`
  return out
}

const CJS_SOURCES = ['dataStore.mjs', 'dataApi.mjs', 'importVocabverse.mjs']
const generatedCjs = []
for (const f of CJS_SOURCES) {
  const src = join(SCRIPTS_DIR, f)
  if (!existsSync(src)) {
    console.error(`缺少 ${f}，exe 将没有词库接口`)
    continue
  }
  const outFile = join(SCRIPTS_DIR, f.replace(/\.mjs$/, '.cjs'))
  writeFileSync(outFile, esmToCjs(readFileSync(src, 'utf-8')), 'utf-8')
  generatedCjs.push(outFile)
}

try {
  console.log('正在用 pkg 打包（第一次跑会下载 Node 运行时二进制，可能要等一会）...')
  execSync(
    `npx pkg server-standalone.cjs --targets node18-win-x64 --output "${EXE_PATH}" -c package.json`,
    { cwd: SCRIPTS_DIR, stdio: 'inherit' }
  )
} finally {
  // 不管打包成功还是失败，都把临时产物清掉，不留在 scripts/ 目录里
  rmSync(TEMP_DIST_COPY, { recursive: true, force: true })
  for (const f of generatedCjs) rmSync(f, { force: true })
}

if (!existsSync(EXE_PATH)) {
  console.error('打包失败：没有生成 exe 文件')
  process.exit(1)
}

// port.txt 放在 exe 旁边（默认 58712，想固定端口改这个文件）
const portFile = join(OUT_DIR, 'port.txt')
if (!existsSync(portFile)) writeFileSync(portFile, '58712')

/**
 * 把词库和学习数据一起带上。
 *
 * exe 读写的是**自己旁边**的 resources/ 和 data/（见 server-standalone.cjs 顶部），
 * 所以这两个目录必须跟着一起发出去，否则对方打开是个空库。
 * 不塞进 exe 内部是因为 pkg 打进去的是只读快照，而 AI 补全、收生词、
 * 改标签全都要往 resources/word_explanations/ 里写。
 */
for (const dir of ['resources', 'data']) {
  const from = join(ROOT, dir)
  if (!existsSync(from)) continue
  const to = join(OUT_DIR, dir)
  rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { recursive: true })
  console.log(`已随包带上 ${dir}/`)
}

// 双击就能开、不弹黑窗的启动器。exe 本身跑起来会留一个控制台窗口，
// 这个 vbs 把它藏起来，跟源码版那个 LanguageBridge.vbs 是同一个思路。
writeFileSync(join(OUT_DIR, '双击打开 LanguageBridge.vbs'),
  '\ufeff' + [
    "' 双击这个文件即可打开 LanguageBridge（不会弹出黑色命令行窗口）。",
    "' 首次运行会在桌面建一个图标，之后从桌面点就行。",
    "' 停止：任务管理器里结束 LanguageBridge.exe。",
    'Dim fso, shell, dir, desktop, lnkPath, lnk, port',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'Set shell = CreateObject("WScript.Shell")',
    'dir = fso.GetParentFolderName(WScript.ScriptFullName)',
    'shell.CurrentDirectory = dir',
    '',
    "' 首次运行建桌面快捷方式",
    'desktop = shell.SpecialFolders("Desktop")',
    'lnkPath = desktop & "\\LanguageBridge.lnk"',
    'If Not fso.FileExists(lnkPath) Then',
    '  Set lnk = shell.CreateShortcut(lnkPath)',
    '  lnk.TargetPath = WScript.ScriptFullName',
    '  lnk.WorkingDirectory = dir',
    '  lnk.Description = "LanguageBridge 英语学习"',
    '  lnk.Save',
    'End If',
    '',
    'shell.Run """" & dir & "\\LanguageBridge.exe""", 0, False',
    '',
    "' 等服务起来再开浏览器，直接开会看到连接失败",
    'WScript.Sleep 2500',
    'port = "58712"',
    'If fso.FileExists(dir & "\\port.txt") Then',
    '  port = Trim(fso.OpenTextFile(dir & "\\port.txt", 1).ReadAll())',
    'End If',
    'shell.Run "http://127.0.0.1:" & port & "/", 1, False'
  ].join('\r\n'), 'utf-8')

console.log('========================================')
console.log(`打包完成：${OUT_DIR}`)
console.log('把整个 dist-exe 文件夹发给别人即可，对方双击「双击打开 LanguageBridge.vbs」就能用')
console.log('里面是：exe + resources（词库）+ data（学习数据）+ port.txt')
console.log('exe 图标是系统默认的（原因见本文件顶部注释）')
console.log('========================================')

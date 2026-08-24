#!/usr/bin/env node
/**
 * LanguageBridge 静态服务器
 * 不依赖任何 npm 包，只用 Node 内置模块。
 * 用途：给"双击图标即用"的启动脚本调用，避免占用其他项目的固定端口。
 *
 * 逻辑：
 *   1. 依赖是否需要安装：对 package.json + package-lock.json 的内容算哈希，变了才 npm install
 *   2. 构建产物是否需要更新：对全部源码文件的内容算哈希，变了才重新构建
 *      （不再是"每次启动都无脑重装/重建"，减少磁盘读写，避免磁盘空间紧张时反复写入报错；
 *      也不再是比较文件修改时间——见下面 hashFiles 函数上的注释，时间戳这条路在
 *      "整个项目文件夹被 zip 解压覆盖"这种用法下经常不可靠，判断经常合错）
 *   3. 从 PREFERRED_PORT 开始向后寻找一个空闲端口
 *   4. 启动静态文件服务器，托管 dist/
 *   5. 自动打开系统默认浏览器
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec, spawn, spawnSync } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { createDataStore } from './dataStore.mjs'
import { handleDataApi, setMediaRoot } from './dataApi.mjs'
import { runVocabverseImportIfNeeded } from './importVocabverse.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DIST = join(ROOT, 'dist')
// VocabVerse 词汇解释数据的落脚点——刻意不放进 public/ 或 dist/，避免被 Vite 构建
// 当成静态资源反复清空/复制（这批文件量大，之前放在 public/data/ 下时，
// 每次 npm run build 都要清空重来，Windows 下容易因为文件被占用而构建失败）。
/**
 * 学习资源目录：词库释义 + 文章。
 *
 * 原来叫 vendor-data，那个名字是错的，也确实误导过——vendor 听起来像"外来的、
 * 可以整个删掉重灌的第三方数据"，但里面放的是用户自己的词库释义，
 * 现在还要跟文章放在一起。既然两样都是用户的学习材料，目录就该叫 resources。
 *
 * 改名是一次性的：老目录存在而新目录不存在时整个 rename 过去（同盘符下是原子操作，
 * 一万五千个文件也是瞬间完成，不是逐个复制）。rename 失败就继续用老目录，
 * 不让改名这种收尾工作把能跑的东西弄坏。
 */
const RESOURCES_DIR = (() => {
  const next = join(ROOT, 'resources')
  const legacy = join(ROOT, 'vendor-data')
  if (!existsSync(next) && existsSync(legacy)) {
    try {
      renameSync(legacy, next)
      console.log('资源目录已从 vendor-data/ 改名为 resources/（词库释义和文章都放这里）')
      return next
    } catch (e) {
      console.warn('资源目录改名失败，继续用 vendor-data/：', e.message)
      return legacy
    }
  }
  // 两个都在：说明改名那次只成功了一半，或者用户自己建过。以新的为准，
  // 老的留着不动——里面可能还有东西，删了就找不回来了。
  if (existsSync(next)) return next
  return next
})()
/** 老名字仍然导出，是因为下面几处路径拼接和 dataApi 还在用这个变量名。
 *  值已经指向 resources/，只是不想为了改个名字去动一堆调用点。 */
const VENDOR_DATA_DIR = RESOURCES_DIR
// 数据（文章/笔记/单词/待办/习惯/打卡）从这次改动起直接落盘在项目文件夹的 data/ 目录下，
// 由这个本来就常驻运行的进程负责，不再需要用户单独启动 backend/ 那个 Python 服务——
// 这是修复"文章和笔记丢失"问题的核心：以前数据只活在浏览器 IndexedDB 里，backend/
// 需要手动启动，实际使用中几乎从没真正跑起来过，双写的另一半一直在往空气里写。
const dataStore = createDataStore(ROOT, RESOURCES_DIR)
// 音频存 <项目>/resources/media/，跟文章、词库释义放在一起。
// 老版本落在 data/media/，setMediaRoot 里会自动搬过来。
setMediaRoot(ROOT, RESOURCES_DIR)

const PORT_FILE = join(ROOT, 'port.txt')
const DEFAULT_PORT = 58712
// 这两个哈希标记文件特意放在项目根目录，不放 dist/ 里面——vite.config.ts 里
// build.emptyOutDir=true，dist/ 每次构建都会被清空重建，标记存里面的话下次构建前
// 就被自己删掉了，等于白存，永远检测不到"没变"。
const BUILD_HASH_FILE = join(ROOT, '.lb-build-hash')
const DEPS_HASH_FILE = join(ROOT, '.lb-deps-hash')

function readConfiguredPort() {
  // 优先级：命令行参数 --port=xxxx > port.txt 文件里的数字 > 默认值
  const argPort = process.argv.find(a => a.startsWith('--port='))
  if (argPort) {
    const n = parseInt(argPort.split('=')[1], 10)
    if (n > 0) return n
  }
  if (existsSync(PORT_FILE)) {
    const n = parseInt(readFileSync(PORT_FILE, 'utf-8').trim(), 10)
    if (n > 0) return n
  }
  return DEFAULT_PORT
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  // .mjs 单独列一条：pdfjs-dist 的 worker 文件（pdf.worker.min-xxxx.mjs）是靠动态 import()
  // 加载的 ES module，浏览器对模块的 MIME 类型卡得很严——之前没有这一条，走的是下面兜底的
  // application/octet-stream，浏览器直接拒绝当模块执行，报"Failed to fetch dynamically
  // imported module"，看着像文件没找到，其实文件在，是内容类型给错了
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
}

/** 递归收集一批文件/目录下的所有文件路径，跳过 node_modules/dist 之类的产物目录；
 *  排序一下保证同一批文件每次收集顺序都一样，哈希才能稳定复现。 */
function collectFiles(paths) {
  const files = []
  function walk(p) {
    let st
    try {
      st = statSync(p)
    } catch {
      return
    }
    if (st.isDirectory()) {
      const base = p.split(/[\\/]/).pop()
      if (base === 'node_modules' || base === 'dist' || base === '.git') return
      for (const entry of readdirSync(p)) walk(join(p, entry))
    } else {
      files.push(p)
    }
  }
  for (const p of paths) walk(p)
  return files.sort()
}

/** 对一批文件的内容算一个哈希，用来判断"这批文件跟上次比有没有真的变化"。
 *  故意不比较文件修改时间（mtime）——"整个项目文件夹被覆盖/解压"这种用法下，mtime
 *  经常不可靠：不少解压工具会把压缩包里记录的原始时间戳写回去，而不是设成解压这一刻；
 *  zip 格式里的时间戳本身又是不带时区信息的 DOS 格式，跨时区解压时算出来的时间甚至
 *  可能比原来还早。结果就是"源码明明改了，可比较出来却是没变新"，重新构建被误判跳过。
 *  改成对文件内容直接算哈希，只要内容真的变了，不管时间戳是什么，都能测出来。 */
function hashFiles(files) {
  const hash = createHash('sha256')
  for (const f of files) {
    hash.update(f)
    try {
      hash.update(readFileSync(f))
    } catch {
      // 收集路径之后、读取之前文件被删了之类的极端情况，跳过这一个，不让整体哈希算不出来
    }
  }
  return hash.digest('hex')
}

/** 依赖是否需要安装：package.json/package-lock.json 内容哈希变了才装 */
/**
 * 跑一个 npm 命令，并在失败时明确抛出、打印退出码，不静默吞掉。
 *
 * 用 spawnSync 而不是 execSync：这是 Node.js 在 Windows 上一个长期存在、被多次独立
 * 报告过的已知问题（node/node#19801、node/help#1200、npm/npm#20624 等）——execSync
 * 调用 npm 时，npm.cmd 在 Windows 上会额外 fork 出子进程，某些情况下子进程真正的
 * "退出"信号没能正确传递回父进程，导致 execSync 永远卡在那一行不返回、不报错、
 * 也不超时，父进程后面的代码（找端口、启动 HTTP 服务、打开浏览器）全都执行不到，
 * 表现就是"黑窗停在构建完成那一行，之后再无任何反应"。
 * spawnSync + shell:true 的组合是社区公认能规避这个问题的写法。
 */
function runNpmCommand(args, description) {
  // 这里**故意不再设 --max-old-space-size**。
  //
  // 曾经设过 4096，想着"堆大一点就不会 OOM"，结果适得其反：
  // Rollup 4 的转换是 Rust 原生模块做的，它申请的内存**不走 Node 堆**。
  // 把 Node 堆上限调高，只会让 Node 侧占住更多物理内存，留给原生模块的反而更少，
  // 于是报 `memory allocation of N bytes failed`（这是 Rust 的分配失败信息，
  // 不是 Node 的 heap out of memory，两者来源不同、解法相反）。
  //
  // 真正有效的是**减少要处理的量**：大依赖改懒加载、拆 chunk（见 vite.config.ts）。
  // 用户自己设了 NODE_OPTIONS 的话照他的来，不动。
  const result = spawnSync('npm', args, { cwd: ROOT, stdio: 'inherit', shell: true })
  if (result.error) {
    throw new Error(`${description}失败：${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`${description}失败，退出码 ${result.status}。请检查上面的输出信息。`)
  }
}

/**
 * 一次性把用户之前放进 public/data/word_explanations/ 的文件，自动搬到新位置
 * vendor-data/word_explanations/——这批文件之前放在 public/ 下会被 Vite 构建
 * 当成静态资源，反复清空/复制导致构建变慢、Windows 下容易因文件占用而构建失败
 * （ENOTEMPTY）。这个函数必须在 ensureBuilt()（会触发 npm run build）之前跑，
 * 不然旧目录还在 public/ 下，构建这一步依然会先撞上同样的问题。
 *
 * 用 rename（而不是先复制再删除）：同一块磁盘上 rename 是原子操作、瞬间完成，
 * 不会有"复制到一半" 的中间状态；15000+ 个文件如果走"读一个写一个再删一个"
 * 那种逐文件复制，会比直接搬移整个目录慢得多。
 */
/** 列一个目录下的 .json 文件名。目录不存在或读不动都返回空数组——
 *  这个函数只用来判断"旧目录里还有没有东西"，读失败时按"没东西"处理会误删，
 *  所以读失败单独抛出去由调用方当成"有东西"保守处理。 */
function safeListJson(dir) {
  try {
    return readdirSync(dir).filter(f => f.toLowerCase().endsWith('.json'))
  } catch {
    // 读不动就当成"里面有东西"，返回一个占位名，走保守分支（不会被当成空目录删掉）
    return ['__unreadable__']
  }
}

function migrateOldWordExplanationsLocation() {
  const oldDir = join(ROOT, 'public', 'data', 'word_explanations')
  const oldIndexFile = join(ROOT, 'public', 'data', 'word_explanations_index.json')
  const newDir = join(VENDOR_DATA_DIR, 'word_explanations')
  const newIndexFile = join(VENDOR_DATA_DIR, 'word_explanations_index.json')

  if (!existsSync(oldDir)) return // 没有旧目录，说明是全新安装或者已经搬过了，不用做任何事

  console.log('检测到词汇解释数据还在旧位置（public/data/word_explanations/），正在搬到新位置，避免影响构建...')
  mkdirSync(VENDOR_DATA_DIR, { recursive: true })

  if (existsSync(newDir)) {
    // 新位置已经有文件了（上次搬过了，或者用户自己放过一份）。
    //
    // 这里**不能只打印提醒就返回**——那正是之前构建崩溃的原因：
    // 一万五千个 JSON 原样留在 public/ 下，Vite 构建时会把整个 publicDir
    // 逐个复制进 dist，进程直接被撑崩（Windows 上表现为退出码 3221226505，
    // 连一行错误信息都没有，非常难查）。
    //
    // 但上一版的做法（一律 rename 成 .old-word_explanations-<时间戳>/）有个恶性副作用：
    // **搬完之后 public/data/word_explanations/ 这个空目录还留在项目里**
    // （压缩包里带着它、解压又会重建它），于是每次启动都满足 existsSync(oldDir)，
    // 每次都拿一个空目录去 rename 一遍，项目根下就一次启动多出一个空的
    // .old-word_explanations-xxxxx 文件夹，越攒越多，还完全看不出是干什么的。
    //
    // 现在按旧目录里到底有没有东西分三种情况处理：
    const oldFiles = safeListJson(oldDir)
    if (!oldFiles.length) {
      // 情况一：空目录（绝大多数情况）。没有任何数据可丢，直接删掉，
      // 从此不再触发这段逻辑，也不再产生 .old- 文件夹。
      try {
        rmSync(oldDir, { recursive: true, force: true })
        console.log('清掉了 public/data/word_explanations/ 这个空目录（数据早已在 vendor-data/ 下）')
      } catch (e) {
        console.warn('旧的空目录删不掉，可以自己手动删：', oldDir, e.message)
      }
      return
    }

    // 情况二：旧目录里有文件，但新位置已经都有了 → 同样没有数据可丢，删掉。
    const missing = oldFiles.filter(f => !existsSync(join(newDir, f)))
    if (!missing.length) {
      try {
        rmSync(oldDir, { recursive: true, force: true })
        console.log(`public/data/word_explanations/ 里的 ${oldFiles.length} 个文件在 vendor-data/ 下都有，已清掉旧目录`)
      } catch (e) {
        console.warn('旧目录删不掉，可以自己手动删：', oldDir, e.message)
      }
      return
    }

    // 情况三：旧目录里有新位置没有的文件 → 把这些补过去，再删旧目录。
    // 不整个 rename 覆盖：新位置那份是当前在用的，不能被旧的盖掉。
    let moved = 0
    for (const f of missing) {
      try { renameSync(join(oldDir, f), join(newDir, f)); moved++ } catch { /* 单个失败跳过 */ }
    }
    try { rmSync(oldDir, { recursive: true, force: true }) } catch { /* 留着也不影响，下次再试 */ }
    console.log(`从旧目录补了 ${moved} 个 vendor-data/ 里没有的释义文件，旧目录已清理`)
    return
  }

  renameSync(oldDir, newDir)
  if (existsSync(oldIndexFile) && !existsSync(newIndexFile)) {
    renameSync(oldIndexFile, newIndexFile)
  }
  console.log(`搬家完成：词汇解释数据现在在 vendor-data/word_explanations/`)
}

/**
 * 一次性搬家：data/articles/ → resources/articles/。
 *
 * 文章和词库释义都是学习资源，放在一起才好整体备份、拷到别的机器上。
 * data/ 留给应用状态（词条、分组、记忆卡片、活动日志）。
 *
 * 用整目录 rename，不逐个复制：同盘符下是原子操作，要么整个成功要么原样不动，
 * 中途断电也不会出现"一半文章在新位置一半在旧位置"。
 * 目标已经存在就什么都不做——那说明搬过了，或者用户自己放了东西进去，
 * 这两种情况下动手都可能盖掉数据。
 */
function migrateArticlesToResources() {
  const oldDir = join(ROOT, 'data', 'articles')
  const newDir = join(RESOURCES_DIR, 'articles')
  if (!existsSync(oldDir) || existsSync(newDir)) return
  try {
    mkdirSync(RESOURCES_DIR, { recursive: true })
    renameSync(oldDir, newDir)
    console.log('文章已从 data/articles/ 搬到 resources/articles/（跟词库释义放在一起）')
  } catch (e) {
    console.warn('文章目录搬家失败，仍然从 data/articles/ 读：', e.message)
  }
}

function ensureDepsInstalled() {
  const nodeModules = join(ROOT, 'node_modules')
  const relevant = [join(ROOT, 'package.json'), join(ROOT, 'package-lock.json')].filter(existsSync)
  const currentHash = hashFiles(relevant)
  const previousHash = existsSync(DEPS_HASH_FILE) ? readFileSync(DEPS_HASH_FILE, 'utf-8').trim() : null

  /**
   * 除了比哈希，还要逐个确认 dependencies 里的包真的躺在 node_modules 里。
   *
   * 只比 package.json 的哈希有个漏洞：更新代码包时 deps-hash 文件常常跟着一起被
   * 覆盖成新的，于是"哈希没变"，但新加的依赖其实一个都没装 —— 表现就是运行时
   * 报「没有安装 xxx，先运行 npm install」，而启动脚本还在说"依赖已是最新"。
   */
  /**
   * 强制安装标记。
   *
   * 只靠 package.json 的哈希有个洞：更新代码包时 deps-hash 文件常常被一起覆盖成
   * 新值，于是"哈希没变"，新加的依赖一个都没装。scripts/deps-version.txt 里是
   * 一个手动递增的数字，只要它比上次记录的大，就无条件跑一次 npm install。
   */
  let forceByVersion = false
  try {
    const vf = join(ROOT, 'scripts', 'deps-version.txt')
    const stamp = join(ROOT, 'node_modules', '.lb-deps-version')
    if (existsSync(vf)) {
      const want = readFileSync(vf, 'utf-8').trim()
      const have = existsSync(stamp) ? readFileSync(stamp, 'utf-8').trim() : ''
      if (want && want !== have) forceByVersion = true
    }
  } catch {
    /* 读不到就交给下面的判断 */
  }

  let missing = []
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'))
    const names = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) })
    missing = names.filter(n => !existsSync(join(nodeModules, ...n.split('/'))))
  } catch {
    /* package.json 读不了的话交给下面的哈希判断 */
  }

  const needInstall =
    !existsSync(nodeModules) || currentHash !== previousHash || missing.length > 0 || forceByVersion

  if (!needInstall) {
    console.log('依赖已是最新，跳过安装')
    // 拷贝要放在 return 前面：依赖没变但 public/ort 可能还是空的
    // （比如上一版没有这一步、或者 public 被清理过）
    ensureOrtAssets()
    return
  }
  if (forceByVersion) console.log('这一版更新了依赖，强制安装一次')
  if (missing.length) {
    console.log(`检测到缺少依赖：${missing.slice(0, 6).join('、')}${missing.length > 6 ? ` 等 ${missing.length} 个` : ''}`)
  }
  console.log('检测到依赖需要安装/更新，正在执行 npm install（可能需要一些时间）...')
  runNpmCommand(['install', '--no-audit', '--no-fund'], 'npm install')
  writeFileSync(DEPS_HASH_FILE, currentHash)
  ensureOrtAssets()
  try {
    const vf = join(ROOT, 'scripts', 'deps-version.txt')
    if (existsSync(vf)) {
      writeFileSync(join(ROOT, 'node_modules', '.lb-deps-version'), readFileSync(vf, 'utf-8').trim())
    }
  } catch {
    /* 记不上不影响这次安装，下次会再装一遍 */
  }
}

/**
 * 把 onnxruntime-web 的 dist 拷一份到 public/ort/。
 *
 * 对轴要在 Worker 里 importScripts 运行时。走 CDN 的话网络不通就用不了
 * （jsdelivr / unpkg 在某些网络下连不上），拷到本地就彻底不依赖外网。
 * 只在缺文件时拷，已有就跳过。
 */
function ensureOrtAssets() {
  try {
    const src = join(ROOT, 'node_modules', 'onnxruntime-web', 'dist')
    const dest = join(ROOT, 'public', 'ort')
    if (!existsSync(src)) return
    if (existsSync(join(dest, 'ort.min.js'))) return
    mkdirSync(dest, { recursive: true })
    let n = 0
    for (const f of readdirSync(src)) {
      // 只要运行时和 wasm，其余（.d.ts、map）不用
      if (!/\.(js|mjs|wasm)$/.test(f)) continue
      copyFileSync(join(src, f), join(dest, f))
      n++
    }
    if (n) console.log(`已把语音对齐运行时拷到 public/ort/（${n} 个文件），之后离线可用`)
  } catch (e) {
    console.log('拷贝对齐运行时失败（不影响其他功能）:', e && e.message ? e.message : e)
  }
}

/** 构建产物是否需要更新：全部源码文件的内容哈希变了才重新构建 */
function ensureBuilt() {
  const indexHtml = join(DIST, 'index.html')
  // 注意：不要把 data/ 目录加进这个列表——那是用户的文章/笔记/单词等数据文件，
  // 每次保存都会变化，一旦被这里当成"源码"扫描，用户随便存一篇文章就会触发一次
  // 不必要的 npm run build，既拖慢启动也没道理。
  const sourceRoots = [
    join(ROOT, 'apps'),
    join(ROOT, 'shared'),
    join(ROOT, 'src'),
    join(ROOT, 'public'),
    join(ROOT, 'index.html'),
    join(ROOT, 'vite.config.ts'),
    join(ROOT, 'package.json')
  ]

  const currentHash = hashFiles(collectFiles(sourceRoots))
  const previousHash = existsSync(BUILD_HASH_FILE) ? readFileSync(BUILD_HASH_FILE, 'utf-8').trim() : null

  const needBuild = !existsSync(indexHtml) || currentHash !== previousHash

  if (!needBuild) {
    console.log('构建产物已是最新，跳过重新构建')
    return
  }
  console.log('检测到源码有更新，正在重新构建...')
  runNpmCommand(['run', 'build'], 'npm run build')
  writeFileSync(BUILD_HASH_FILE, currentHash)
}

async function tryPort(port) {
  return new Promise(resolve => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => {
      srv.close(() => resolve(true))
    })
    srv.listen(port, '0.0.0.0')
  })
}

async function findFreePort(start) {
  let port = start
  for (let i = 0; i < 50; i++) {
    if (await tryPort(port)) return port
    port++
  }
  throw new Error('未找到空闲端口')
}

/**
 * Windows 上常见的浏览器可执行文件位置。用来开"应用模式"窗口。
 *
 * 应用模式（--app=URL）开出来的是一个**没有地址栏、没有标签页、没有书签栏**的
 * 独立窗口，任务栏里也是独立的一项，看起来跟一个装好的桌面程序没有区别。
 * 这是不引入 Electron（几十上百 MB、还要单独打包）就能拿到"像个 app"的最省办法：
 * 用的还是你机器上已经装好的浏览器内核，体积零增加。
 */
const WIN_BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
]

/**
 * 那个端口上跑的是不是我们自己。
 * 拿 /api/health 认——本项目的服务会回 {"ok":true}，别的程序不会。
 */
async function isOurServer(p) {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 800)
    const r = await fetch(`http://127.0.0.1:${p}/api/health`, { signal: ctl.signal })
    clearTimeout(t)
    if (!r.ok) return false
    const j = await r.json()
    return !!j.ok
  } catch {
    return false
  }
}

function openBrowser(url) {
  // Electron 壳里由它自己开窗口，不要再弹一个浏览器出来
  if (process.env.LB_NO_OPEN_BROWSER === '1') return

  const platform = process.platform
  if (platform === 'win32') {
    /**
     * 应用模式开一个独立窗口：没有地址栏、没有标签页，任务栏独立一项。
     *
     * ⚠ **绝对不要加 --user-data-dir。**
     *
     * 上一版加了，理由是"不指的话新进程会转交给已有实例、又变成普通标签页"。
     * 这个理由本身没错，但代价大得多：--user-data-dir 会开出一个**全新的浏览器
     * 配置文件**，而这个应用有一大半状态存在浏览器本地——
     * IndexedDB 里的词条副本、localStorage 里的学习设置、FSRS 记忆卡片、
     * 已掌握词表、词汇宇宙配色。换了配置文件等于换了一台机器：
     * 打开之后是一个空壳，用户会以为数据全没了。
     *
     * 所以宁可接受"浏览器已经开着时可能落成一个标签页"，也要用默认配置文件。
     * 何况 Chrome/Edge 对 --app 的处理是：即使转交给已有实例，多数情况下
     * 仍然会开成应用窗口，只有少数版本会退化成标签页——这个代价可以接受，
     * 数据看起来消失不行。
     */
    const exe = WIN_BROWSERS.find(p => existsSync(p))
    if (exe) {
      const child = spawn(exe, [
        `--app=${url}`,
        '--no-first-run',
        '--no-default-browser-check'
      ], { detached: true, stdio: 'ignore' })
      child.unref()
      return
    }
    // 找不到 Edge/Chrome 就退回普通方式开默认浏览器。
    // 用 rundll32 调用系统的 URL 协议处理器，比 `start` 命令更稳：
    // 以管理员/提权终端运行时，`start` 经常因为 UAC 权限隔离而弹出
    // "Application not found"，rundll32 这条路径不受影响。
    exec(`rundll32 url.dll,FileProtocolHandler ${url}`, err => {
      if (err) exec(`start "" "${url}"`)
    })
    return
  }
  const cmd = platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`
  exec(cmd)
}

/**
 * 找一个"看起来能连外网"的局域网 IP（跟 MyLibrary get_local_ip 一个思路，
 * 只是它是 UDP connect 到 8.8.8.8 探测，这里直接用 Node 自带的网卡列表，
 * 过滤掉回环地址和虚拟网卡，取第一个普通局域网段的 IPv4）。
 * 手机/平板连同一个 WiFi，用这个地址就能访问，不需要联网。
 */
function getLocalIP() {
  const nets = networkInterfaces()
  const candidates = []
  for (const name of Object.keys(nets)) {
    if (/^(vEthernet|VMware|VirtualBox|Loopback|docker|veth)/i.test(name)) continue
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) candidates.push(net.address)
    }
  }
  // 常见私网段优先（192.168.x.x / 10.x.x.x / 172.16-31.x.x），排在候选列表最前面的更可能是真实局域网卡
  candidates.sort((a, b) => {
    const score = ip => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3)
    return score(a) - score(b)
  })
  return candidates[0] || '127.0.0.1'
}

/**
 * AI 请求本地代理：浏览器把「目标地址 + 请求头 + 请求体」发给这个同源接口，
 * 由本机 Node 进程代为向服务商发起请求再把结果原样返回。
 * 目的：绕开浏览器跨域限制——大部分 OpenAI 兼容中转服务不会给浏览器开
 * Access-Control-Allow-Origin，直接从网页发请求基本都会被拦截；
 * Node 发 HTTP 请求不存在"跨域"这个浏览器专属概念，天然没有这个问题。
 * 全程只在本机内部转发，Key 不会经过任何我们自建的远程服务器。
 */
async function handleAiProxy(req, res) {
  // 同 dataApi.readJsonBody：先收 Buffer 再整体解码。
  // 这里的请求体是发给模型的提示词，一批十几个词加上说明文字很容易过一个 chunk，
  // 按 chunk 逐个解码会把跨界的汉字弄成乱码——提示词被弄坏了模型只会答得莫名其妙，
  // 比数据坏掉还难查。
  const chunks = []
  req.on('data', chunk => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) })
  req.on('end', async () => {
    /**
     * 把浏览器那边的中断透传给上游。
     *
     * 浏览器 60 秒（批量补全那条路会更长）超时之后会 abort 掉到本地服务的连接，
     * 但**上游那次模型请求原来还在跑**：模型照样把两三千个 token 生成完、
     * 钱照样扣，回来之后这段响应没人要，直接丢掉。
     * 一轮补全里超时几十次，白烧的就是几十次请求的钱。
     * 现在客户端一断，这边立刻把上游也掐掉。
     */
    const ac = new AbortController()
    req.on('aborted', () => ac.abort())
    res.on('close', () => { if (!res.writableEnded) ac.abort() })
    try {
      const body = Buffer.concat(chunks).toString('utf8')
      const { url, method, headers, payload } = JSON.parse(body)
      if (!url || typeof url !== 'string') throw new Error('缺少目标地址')
      const reqMethod = method === 'GET' ? 'GET' : 'POST'
      const upstream = await fetch(url, {
        method: reqMethod,
        headers: headers || {},
        body: reqMethod === 'GET' ? undefined : JSON.stringify(payload),
        signal: ac.signal
      })
      const text = await upstream.text()
      if (res.writableEnded) return
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8'
      })
      res.end(text)
    } catch (e) {
      // 客户端自己断的连接不用再回什么，写回去只会报 ERR_STREAM_WRITE_AFTER_END
      if (ac.signal.aborted || res.writableEnded) return
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ __proxyError: e instanceof Error ? e.message : String(e) }))
    }
  })
}

async function main() {
  migrateOldWordExplanationsLocation()
  migrateArticlesToResources()
  ensureDepsInstalled()
  ensureBuilt()
  const preferred = readConfiguredPort()
  // let 而不是 const：端口被别的程序占住时下面的 error 处理会改它
  let port = await findFreePort(preferred)
  if (port !== preferred) {
    console.log(`端口 ${preferred} 被占用，改用 ${port}`)
  }

  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0])

      if (req.method === 'POST' && urlPath === '/__ai_proxy') {
        await handleAiProxy(req, res)
        return
      }

      if (urlPath === '/api/health' || urlPath.startsWith('/api/')) {
        const handled = await handleDataApi(req, res, dataStore, urlPath)
        if (handled) return
      }

      if (req.method === 'GET' && urlPath === '/__serverinfo') {
        const ip = getLocalIP()
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ lan_url: `http://${ip}:${port}/`, ip, port }))
        return
      }

      // VocabVerse 词汇解释数据（15000+ 个小文件）单独伺服，不走 dist/ 里的静态资源路径。
      // 之前这批文件放在 public/data/word_explanations/，Vite 构建时 public/ 目录整个会被
      // 原样复制进 dist/，build.emptyOutDir=true 又意味着每次构建前要先把 dist/ 清空重来——
      // 15000+ 个文件反复清空/复制，不仅慢，Windows 下一旦有杀毒软件、云盘同步或者上一个
      // 服务器进程还占着某个文件没释放，删不干净就会直接导致构建失败（ENOTEMPTY 报错）。
      // 这批数据只是给 Node 端读一次用来导入词库、以及浏览器端按需补全用，不需要真的
      // 经过 Vite 处理，所以移到 VENDOR_DATA_DIR（项目根目录下，dist/public 之外的独立目录），
      // 这里单独拦截，URL 路径保持不变（前端 fetch 代码不用跟着改）。
      if (req.method === 'GET' && (urlPath === '/data/word_explanations_index.json' || urlPath.startsWith('/data/word_explanations/'))) {
        const relPath = urlPath.replace(/^\/data\//, '')
        const vendorFilePath = join(VENDOR_DATA_DIR, relPath)
        if (existsSync(vendorFilePath) && (await stat(vendorFilePath)).isFile()) {
          const data = await readFile(vendorFilePath)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(data)
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('Not found')
        }
        return
      }

      let filePath = join(DIST, urlPath)

      const st = existsSync(filePath) ? await stat(filePath) : null
      const hasExt = /\.[a-zA-Z0-9]+$/.test(urlPath) // 有扩展名 = 静态资源请求，没有 = 页面路由

      if (st && !st.isDirectory()) {
        // 文件真实存在，直接返回
      } else if (!hasExt) {
        // 页面路由（如 /words、/dictation）没有对应文件，回退到 index.html 交给前端路由处理
        filePath = join(DIST, 'index.html')
      } else {
        // 静态资源请求但文件不存在（如缺失的 word_explanations_full.json），如实返回 404
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Not found')
        return
      }

      const data = await readFile(filePath)
      const ext = extname(filePath)
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
      res.end(data)
    } catch (e) {
      res.writeHead(404)
      res.end('Not found')
    }
  })

  /**
   * 端口已经被占了怎么办。
   *
   * 照 MyLibrary launcher.py 的做法分两种情况处理，而不是直接崩：
   *   · 占着的就是本程序（上次没关干净、或者你又双击了一次）→ 不再起一个，
   *     直接把浏览器指过去。这就是"像个真 app"的关键：重复点击不会开出第二份。
   *   · 占着的是别的程序 → 往上找一个空的端口用，并把新端口写回 port.txt，
   *     免得下次启动又撞。
   */
  server.on('error', async err => {
    if (err && err.code === 'EADDRINUSE') {
      const mine = await isOurServer(port)
      if (mine) {
        const url = `http://127.0.0.1:${port}`
        console.log('========================================')
        console.log('LanguageBridge 已经在运行了，直接打开：' + url)
        console.log('========================================')
        openBrowser(url)
        setTimeout(() => process.exit(0), 1500)
        return
      }
      const next = await findFreePort(port + 1).catch(() => null)
      if (next) {
        console.log(`端口 ${port} 被别的程序占着，改用 ${next}`)
        try { writeFileSync(PORT_FILE, String(next)) } catch { /* 写不了就只影响下次 */ }
        port = next
        server.listen(port, '0.0.0.0')
        return
      }
    }
    console.error('启动失败：', err && err.message ? err.message : err)
    process.exit(1)
  })

  server.listen(port, '0.0.0.0', () => {
    const url = `http://127.0.0.1:${port}`
    // 每次成功监听都把端口写下来：Electron 壳靠这个文件找服务，
    // 只在换端口时写的话，壳可能读到上一次的旧端口。
    try { writeFileSync(PORT_FILE, String(port)) } catch { /* 写不了不影响本次运行 */ }
    const lanIp = getLocalIP()
    console.log('========================================')
    console.log(`LanguageBridge 已启动：${url}`)
    if (lanIp !== '127.0.0.1') {
      console.log(`同一 WiFi 下的手机/平板可以访问：http://${lanIp}:${port}/`)
    }
    console.log('如果没有自动弹出浏览器，请手动复制上面这个网址打开')
    console.log('关闭这个窗口即可停止服务')
    console.log('========================================')
    openBrowser(url)

    // VocabVerse 词库导入放在这里（服务器已经在监听、浏览器已经打开之后）异步跑，
    // 不阻塞用户看到界面的时间。之前这段代码在模块顶层同步跑，1万5千个文件读取
    // 完成前用户会一直盯着黑窗、浏览器迟迟不弹出来，体验上跟"卡死了"没区别。
    // 现在改成这里之后：用户能立刻开始用已有词库，新词导入在后台默默进行，
    // 跑完之后下次刷新页面/重新进词汇中心就能看到——不需要死等。
    setImmediate(() => {
      try {
        const importResult = runVocabverseImportIfNeeded(ROOT, dataStore)
        if (!importResult.skipped) {
          console.log(`VocabVerse 词库导入完成：新增 ${importResult.newWords} 词，补全 ${importResult.enrichedWords} 词——刷新一下网页就能看到`)
        }
      } catch (e) {
        console.error('VocabVerse 词库导入失败（不影响其它功能正常使用）：', e.message)
      }
    })
  })

  process.on('SIGINT', () => {
    console.log('\n正在停止服务...')
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1000)
  })
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})

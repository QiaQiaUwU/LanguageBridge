/**
 * LanguageBridge 数据持久化层（Node 内置模块实现，不依赖任何 npm 包）。
 *
 * 背景：这台服务器（server.mjs）从启动脚本双击那一刻起就一直在跑；而 backend/ 那个
 * 独立 FastAPI 后端需要用户自己另外手动执行 `cd backend && python main.py` 才会启动——
 * 实际使用中它几乎从来没被启动过，"IndexedDB 正常写 + 后端尽力再写一份"这个双写策略里
 * 后端那一半一直是往空气里写，等于没有真正的持久化，最终导致浏览器 IndexedDB 被清空后
 * 文章/笔记数据永久丢失，词库因为另有存路径而幸免。
 *
 * 这次改法：数据 API 直接并进这个本来就常驻运行的 Node 服务器进程，不再需要用户单独
 * 启动任何东西。存储用 JSON 文件（不是 SQLite）——不需要额外装 better-sqlite3 这种
 * 原生编译依赖，Node 内置的 fs 模块就够，跟这个项目"不依赖任何 npm 包"的既有原则一致。
 *
 * 每类数据存一个 JSON 文件在 <项目根目录>/data/ 下，写入时先写临时文件再原子性
 * rename，避免进程被强杀（比如直接关黑窗）时写到一半导致 JSON 文件损坏。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 这些集合改成"一条记录一个文件"，存在 data/<集合名>/ 目录下。
 *
 * 为什么单独拎出来：文章不像待办、活动记录那样是一堆小条目，一篇长文带着分句、
 * 译文、划线标记、笔记，本身就好几百 KB。全挤在一个 articles.json 里有三个实际问题：
 *   1. 改一篇文章的一个标记，要把整个大文件重写一遍，文章越多越慢
 *   2. 文件一旦损坏（写到一半断电），所有文章一起完蛋，而不是坏一篇
 *   3. 你没法直接用文件管理器去看/备份/搬运某一篇——想手动整理分类也无从下手
 * 拆成一文件一篇之后，data/articles/ 就是一个可以直接打开翻看的文件夹。
 */
const PER_FILE_COLLECTIONS = new Set(['articles'])

/**
 * 文件名安全化。
 *
 * 只挡真正会出问题的字符：路径分隔符、Windows 保留字符、控制字符、以及开头的点
 * （避免生成隐藏文件）。**中文必须保留**——这个目录是给人翻的，
 * 一开始我用了 [^\w.-] 一刀切，结果 \w 在 JS 里不含中文，"雅思"直接变成 "__"，
 * 分类文件夹全成了下划线，可读性这个目标就完全落空了。
 *
 * 另外挡掉 Windows 的保留设备名（CON、PRN、NUL 这些），
 * 在 Windows 上以它们命名的文件是建不出来的。
 */
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
function safeName(id) {
  let out = String(id)
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')  // 路径分隔符 + Windows 非法字符 + 控制字符
    .replace(/^\.+/, '_')                     // 开头的点：避免生成隐藏文件
    .replace(/[. ]+$/, '')                    // 结尾的点和空格：Windows 会自动截掉，导致名字对不上
    .trim()
  if (!out) out = '_'
  if (WIN_RESERVED.test(out)) out = `_${out}`
  return out
}

export function createDataStore(rootDir, resourcesDir) {
  const DATA_DIR = join(rootDir, 'data')
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

  /**
   * 学习资源目录。词库释义（word_explanations）和文章都放这里。
   *
   * 这两样是同一类东西：用户的**学习材料**，体积大、想直接用文件管理器翻、
   * 会单独备份、会拷到别的机器上。放一起是用户提的，理由是"都属于资源类型的"，
   * 这个归类比按"谁生成的"来分更贴近实际用法。
   *
   * data/ 留给应用状态：词条本身、分组、记忆卡片、活动日志、设置。
   * 这些是软件运行产生的，跟着软件走，单独拿出来给别人没有意义。
   */
  // 由调用方传进来：改名那一步万一失败，server 会退回老目录，
  // 两边必须用同一个值，否则会出现文章在 resources/、释义库还在 vendor-data/ 的割裂。
  const RESOURCES_DIR = resourcesDir || join(rootDir, 'resources')
  if (!existsSync(RESOURCES_DIR)) mkdirSync(RESOURCES_DIR, { recursive: true })

  /** 哪些集合归到资源目录。目前只有文章。 */
  const RESOURCE_COLLECTIONS = new Set(['articles'])
  function rootOf(name) {
    return RESOURCE_COLLECTIONS.has(name) ? RESOURCES_DIR : DATA_DIR
  }

  function filePath(name) {
    return join(rootOf(name), `${name}.json`)
  }

  function dirPath(name) {
    const d = join(rootOf(name), name)
    if (!existsSync(d)) mkdirSync(d, { recursive: true })
    return d
  }

  /** 一条记录一个文件：读整个目录 */
  function readPerFile(name) {
    const root = dirPath(name)
    const out = []
    // 递归一层：articles 下面按分组名分了子目录，其它 per-file 集合是平铺的。
    // 只递归一层是刻意的——再深就说明用户自己在里面套了目录，那不是我们生成的结构，
    // 盲目深挖可能把无关的 json 也读进来。
    const scan = (dir, depth) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, f.name)
        if (f.isDirectory()) {
          if (depth < 1) scan(full, depth + 1)
          continue
        }
        // 只读 json：md 是同一篇文章的人类可读副本，读进来会变成重复的一篇
        if (!f.name.endsWith('.json') || f.name.endsWith('.tmp')) continue
        try {
          const item = JSON.parse(readFileSync(full, 'utf-8'))
          if (item && typeof item === 'object') out.push(item)
        } catch (e) {
          // 单篇坏掉不影响其它篇——这正是拆分存储的意义所在，
          // 大 JSON 时代一篇坏掉是全部读不出来
          console.error(`${name}/${f.name} 解析失败，跳过这一条：`, e.message)
        }
      }
    }
    scan(root, 0)
    return out
  }

  /**
   * 按分组建子文件夹。
   *
   * 文章带 groupId 的话，文件落在 data/articles/<分组名>/ 下，没分组的落在
   * data/articles/_未分组/。这样这个目录就是一个能直接用文件管理器翻的
   * 分类结构，而不是一堆 id 命名的散文件——用户想手动整理、备份某个分类、
   * 或者把某一类发给别人，都能直接操作。
   *
   * 文件名用「标题__id」而不是纯 id：纯 id 的话打开文件夹全是 art-1735... 看不出是什么。
   * 带上 id 是因为标题可能重名，也可能被改。
   */
  function perFileTarget(name, item, idKey = 'id') {
    const base = dirPath(name)
    if (name !== 'articles') return { dir: base, file: `${safeName(item[idKey])}.json` }
    const groupName = item.__groupName ? safeName(item.__groupName) : '_未分组'
    const dir = join(base, groupName)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const title = item.title ? safeName(item.title).slice(0, 40) : 'untitled'
    return { dir, file: `${title}__${safeName(item[idKey])}.json` }
  }

  /**
   * 文章额外导出一份 .md，跟 .json 并排放在同一个分类文件夹里。
   *
   * 为什么是"额外一份"而不是"改用 md 存"：一篇文章除了正文，还挂着分句对齐、
   * 划线标记的句内偏移、笔记 HTML、音频对轴时间点、章节索引——这些结构 md 表达不了，
   * 硬塞进去要么丢数据，要么写成一堆没人看得懂的注释块。
   *
   * 所以分工是：**.json 是程序读的真数据源，.md 是给人看和搬运的**。
   * 你可以直接用任何编辑器打开 md 读、复制、发给别人，而程序始终读 json，
   * 两边不会因为格式转换丢东西。md 顶部带 YAML frontmatter，标题分类都在里面。
   */
  function articleToMarkdown(item) {
    const esc = v => String(v ?? '').replace(/"/g, '\\"')
    const lines = ['---']
    lines.push(`title: "${esc(item.title)}"`)
    if (item.__groupName) lines.push(`group: "${esc(item.__groupName)}"`)
    lines.push(`id: "${esc(item.id)}"`)
    if (item.createdAt) lines.push(`created: "${esc(item.createdAt)}"`)
    if (item.updatedAt) lines.push(`updated: "${esc(item.updatedAt)}"`)
    lines.push('---', '', `# ${item.title || '未命名'}`, '')

    const sentences = Array.isArray(item.sentences) ? item.sentences : []
    if (sentences.length) {
      // 中英对照按段落输出：英文一行，中文紧跟一行斜体。
      // 不用表格——长句在表格里会被挤成很窄的两列，读起来很难受。
      for (const st of sentences) {
        const en = (st?.en ?? st?.english ?? '').toString().trim()
        const zh = (st?.zh ?? st?.chinese ?? '').toString().trim()
        if (en) lines.push(en, '')
        if (zh) lines.push(`*${zh}*`, '')
      }
    } else if (item.content) {
      lines.push(String(item.content), '')
    }

    if (item.notes) {
      lines.push('---', '', '## 笔记', '')
      // 笔记是 contenteditable 存的 HTML，粗暴转纯文本：块级标签换成换行，
      // 其余标签去掉。做不到完美还原格式，但至少读得通顺，
      // 而这份 md 的定位本来就是"给人读"，不是往回导入的。
      const text = String(item.notes)
        .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      if (text) lines.push(text, '')
    }
    return lines.join('\n')
  }

  function writePerFileItem(name, item, idKey = 'id') {
    if (name === 'articles') {
      // 分组或标题改了的话，旧位置那个文件要删掉，否则会留下一个同 id 的孤儿文件，
      // 下次读目录时同一篇文章会出现两次
      removePerFileItem(name, item[idKey])
      const { dir, file } = perFileTarget(name, item, idKey)
      const p = join(dir, file)
      const tmp = `${p}.tmp`
      const toWrite = { ...item }
      delete toWrite.__groupName   // 这个字段只用来决定落盘位置，不进文件内容
      writeFileSync(tmp, JSON.stringify(toWrite, null, 2), 'utf-8')
      renameSync(tmp, p)

      // 并排写一份 md。失败不影响主流程——md 只是给人看的副本，
      // 写不出来（比如文件名冲突、磁盘满）不该让文章本身保存失败。
      try {
        const mdPath = p.replace(/\.json$/, '.md')
        const mdTmp = `${mdPath}.tmp`
        writeFileSync(mdTmp, articleToMarkdown(item), 'utf-8')
        renameSync(mdTmp, mdPath)
      } catch (e) {
        console.error('导出 md 失败（不影响文章保存）：', e.message)
      }
      return
    }
    const d = dirPath(name)
    const p = join(d, `${safeName(item[idKey])}.json`)
    const tmp = `${p}.tmp`
    writeFileSync(tmp, JSON.stringify(item, null, 2), 'utf-8')
    renameSync(tmp, p)
  }

  /** 按 id 删。articles 的文件名是「标题__id.json」而且分散在各个分组子目录里，
   *  没法直接算出路径，只能扫一遍按后缀匹配。 */
  function removePerFileItem(name, id) {
    const safe = safeName(id)
    if (name !== 'articles') {
      const p = join(dirPath(name), `${safe}.json`)
      if (!existsSync(p)) return false
      unlinkSync(p)
      return true
    }
    const root = dirPath(name)
    let removed = false
    const scan = (dir, depth) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, f.name)
        if (f.isDirectory()) { if (depth < 1) scan(full, depth + 1); continue }
        // json 和它并排的 md 一起删，不然会留下一个没有对应数据的孤儿 md
        if (f.name === `${safe}.json` || f.name.endsWith(`__${safe}.json`) ||
            f.name === `${safe}.md` || f.name.endsWith(`__${safe}.md`)) {
          unlinkSync(full)
          if (f.name.endsWith('.json')) removed = true
        }
      }
    }
    scan(root, 0)
    return removed
  }

  /**
   * 一次性迁移：把旧的 data/articles.json 拆成 data/articles/<id>.json。
   *
   * 迁移完把旧文件改名成 .migrated 而不是删掉——万一拆分过程有问题，
   * 原始数据还在，重命名过的文件也不会被再次当成待迁移的输入。
   */
  function migrateToPerFile(name, idKey = 'id') {
    const legacy = filePath(name)
    if (!existsSync(legacy)) return
    const list = readLegacyFile(name)
    if (!list.length) {
      renameSync(legacy, `${legacy}.migrated`)
      return
    }
    const d = dirPath(name)
    let n = 0
    for (const item of list) {
      if (!item?.[idKey]) continue
      const target = join(d, `${safeName(item[idKey])}.json`)
      // 已经拆出来的不覆盖：拆分之后用户可能又改过，旧大文件是过期数据
      if (existsSync(target)) continue
      writePerFileItem(name, item, idKey)
      n++
    }
    renameSync(legacy, `${legacy}.migrated`)
    console.log(`[LanguageBridge] 已把 ${name}.json 拆成 ${n} 个独立文件，放在 data/${name}/，旧文件改名为 ${name}.json.migrated`)
  }

  /** 读一个集合。
   *  per-file 集合走目录，其余走单个 JSON 文件。调用方不用关心区别。 */
  /**
   * 单文件集合的内存缓存 + 延迟落盘。
   *
   * ── 为什么需要 ──
   * words 是一个单文件集合：全部一万五千个词条（连释义、例句、近反义、词族）
   * 都在 data/words.json 这一个文件里，几十 MB。而每保存一批（AI 补全是 12 个词）
   * 走的是 upsertMany：**把整个文件读进来 JSON.parse、改 12 条、再整个 stringify 写回去**。
   * 一轮全库补全一千两百多批，就是一千两百多次几十 MB 的读+解析+序列化+写。
   * 光解析和序列化的时间就能到分钟级，磁盘写入量是几十 GB——
   * 而真正变了的只有那 12 条。
   *
   * ── 怎么改 ──
   * 读：解析结果缓存住，按文件 mtime 失效（用户在外面手改过文件也能发现）。
   * 写：先更到缓存，落盘延迟合并——800ms 内的多次写只落一次。
   * 进程退出前强制落盘一次，Ctrl+C、关窗口、正常退出都盖到。
   * 代价是崩溃时可能丢最后不到一秒的改动；换来的是同一轮补全从"几十 GB 写入"
   * 降到"几百 MB"，而且中途停止仍然是每批都算数的（缓存里是最新的，
   * 下一次 flush 或退出时一起落盘）。
   */
  const memCache = new Map()   // name -> { data, mtimeMs }
  const dirtyNames = new Set()
  let flushTimer = null
  /**
   * ⚠ 延迟落盘已经关掉（0 = 立即写）。
   *
   * 上一版设成 800ms 合并写入，想省掉每批都重写几十 MB 的开销。但那个方案有个
   * 我当时没算到的失败模式：**进程被硬杀时，还在窗口期里的改动全丢**。
   * process.on('exit') 在 Ctrl+C 和正常退出时能兜住，但用户是双击 bat 启动的，
   * 直接关命令行窗口在 Windows 上走的是 CTRL_CLOSE_EVENT，Node 只有很短的时间、
   * 而且 'exit' 回调不一定跑得完。断电更不用说。
   * 用户跑了几小时的补全结果因此丢过一次，这个代价远大于省下的磁盘写入。
   *
   * 省开销的那一半保留：**读缓存**。真正贵的是每批都把几十 MB 重新 JSON.parse 一遍，
   * 缓存住之后这部分开销直接归零，而缓存没有任何丢数据的风险。
   * 写这一侧老老实实每次落盘——慢一点，但跑完就是跑完了。
   */
  const FLUSH_DELAY = 0

  function flushOne(name) {
    const entry = memCache.get(name)
    if (!entry) return
    const p = filePath(name)
    const tmp = `${p}.tmp`
    writeFileSync(tmp, JSON.stringify(entry.data, null, 2), 'utf-8')
    renameSync(tmp, p)
    try { entry.mtimeMs = statSync(p).mtimeMs } catch { entry.mtimeMs = Date.now() }
  }

  function flushAll() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
    for (const name of dirtyNames) {
      try { flushOne(name) } catch (e) { console.error(`落盘 ${name}.json 失败：`, e.message) }
    }
    dirtyNames.clear()
  }

  function scheduleFlush(name) {
    dirtyNames.add(name)
    if (FLUSH_DELAY <= 0) { flushAll(); return }
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = setTimeout(flushAll, FLUSH_DELAY)
  }

  // 退出前一定要落盘。exit 里只能做同步操作，flushAll 全是同步写，正好。
  process.on('exit', flushAll)
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { flushAll(); process.exit(0) })
  }

  function readCollection(name) {
    if (PER_FILE_COLLECTIONS.has(name)) return readPerFile(name)
    const p = filePath(name)
    const cached = memCache.get(name)
    if (cached) {
      // 有待落盘的改动时，缓存就是最新的，不去比 mtime（文件还是旧的）
      if (dirtyNames.has(name)) return cached.data
      let cur = -1
      try { cur = statSync(p).mtimeMs } catch { cur = -1 }
      if (cur === cached.mtimeMs) return cached.data
    }
    const data = readLegacyFile(name)
    let mtimeMs = -1
    try { mtimeMs = statSync(p).mtimeMs } catch { mtimeMs = -1 }
    memCache.set(name, { data, mtimeMs })
    return data
  }

  /** 读单个 <name>.json。迁移逻辑要读旧的大文件，所以单独留一个不分流的入口，
   *  否则 readCollection 分流之后迁移会读到刚建好的空目录，把旧数据当成不存在。 */
  function readLegacyFile(name) {
    const p = filePath(name)
    if (!existsSync(p)) return []
    try {
      const text = readFileSync(p, 'utf-8')
      const data = JSON.parse(text)
      return Array.isArray(data) ? data : []
    } catch (e) {
      console.error(`数据文件 ${name}.json 读取/解析失败，当作空集合处理（原文件不会被覆盖，可以手动检查）：`, e.message)
      return []
    }
  }

  /** 原子性写入：先写 .tmp 再 rename，避免进程中途被杀导致文件损坏 */
  function writeCollection(name, data) {
    if (PER_FILE_COLLECTIONS.has(name)) {
      // per-file 集合整表写 = 逐条写。注意不删除目录里多出来的文件——
      // 删除必须走 remove()，这里静默清理很容易在一次不完整的整表写入中
      // 把用户的文章误删光。
      for (const item of data) if (item?.id) writePerFileItem(name, item)
      return
    }
    // 先更缓存、再排一次延迟落盘。同一秒内连着存好几批只会真正写一次。
    const entry = memCache.get(name)
    if (entry) entry.data = data
    else memCache.set(name, { data, mtimeMs: -1 })
    scheduleFlush(name)
  }

  /** 需要确保已经落盘的场合（比如导出、备份前）调一下 */
  function flushNow() { flushAll() }

  /** upsert：按 id 字段找到就替换，找不到就追加，返回替换/插入后的那条 */
  function upsert(name, item, idKey = 'id') {
    if (PER_FILE_COLLECTIONS.has(name)) {
      writePerFileItem(name, item, idKey)
      return item
    }
    const list = readCollection(name)
    const idx = list.findIndex(x => x[idKey] === item[idKey])
    if (idx >= 0) list[idx] = item
    else list.push(item)
    writeCollection(name, list)
    return item
  }

  function remove(name, id, idKey = 'id') {
    if (PER_FILE_COLLECTIONS.has(name)) return removePerFileItem(name, id)
    const list = readCollection(name)
    const idx = list.findIndex(x => x[idKey] === id)
    if (idx < 0) return false
    list.splice(idx, 1)
    writeCollection(name, list)
    return true
  }

  function nextAutoId(name) {
    const list = readCollection(name)
    return list.reduce((max, x) => Math.max(max, x.id || 0), 0) + 1
  }

  /**
   * 批量 upsert：一次读、内存里合并、一次写。
   *
   * 为什么必须有这个：词库有 15000+ 条，如果走 upsert() 逐条来，等于把整个
   * words.json 读进来又整个写回去 15000 次（每次还带一次原子 rename），几百 MB 的
   * 磁盘读写，实测会卡到用户以为程序死了。这里读一次、写一次。
   *
   * 返回 { inserted, updated }，方便调用方打日志说清楚到底发生了什么。
   */
  function upsertMany(name, items, idKey = 'id') {
    if (!Array.isArray(items) || !items.length) return { inserted: 0, updated: 0 }
    const list = readCollection(name)
    const indexById = new Map(list.map((x, i) => [x[idKey], i]))
    let inserted = 0
    let updated = 0
    for (const item of items) {
      const idx = indexById.get(item[idKey])
      if (idx === undefined) {
        indexById.set(item[idKey], list.length)
        list.push(item)
        inserted++
      } else {
        list[idx] = item
        updated++
      }
    }
    writeCollection(name, list)
    return { inserted, updated }
  }

  // 启动时自动迁移一次。放在返回之前执行，保证服务器一起来数据就是新结构，
  // 前端第一次请求 /api/articles 读到的已经是拆好的文件。
  for (const name of PER_FILE_COLLECTIONS) migrateToPerFile(name)

  return { readCollection, writeCollection, upsert, upsertMany, remove, nextAutoId, migrateToPerFile, flushNow, DATA_DIR, RESOURCES_DIR }
}

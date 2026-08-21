/**
 * LanguageBridge 数据 API：文章/分组/单词/词书/待办/习惯/活动。
 *
 * 接口形状对齐原来 backend/ 里的 FastAPI 路由（同样的路径、同样的字段名），
 * 这样前端 shared/core/backendClient.ts 的调用方式基本不用改，只需要把请求地址
 * 从独立的 8787 端口改成跟页面同源（因为现在数据 API 和静态页面是同一个进程）。
 *
 * audio 上传/强制对齐这块因为依赖 MFA（重量级、只有 Python 生态方便装），
 * 这次没有搬过来，仍然留在 backend/ 里，作为需要用户自己装 Python 环境才能用的
 * 可选功能；其余全部数据（文章/笔记/单词/待办/习惯/打卡）这次全部变成"开箱即用，
 * 不需要用户做任何多余操作"。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, statSync, unlinkSync, createWriteStream, createReadStream } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { join, dirname } from 'node:path'
import { mapToWordItem } from './importVocabverse.mjs'

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(data === undefined ? '' : JSON.stringify(data))
}

/**
 * 读请求体。
 *
 * ⚠ 必须先把 Buffer 收齐再一次性解码，不能写成 `body += chunk`。
 *
 * req 是二进制流，chunk 是 Buffer。`body += chunk` 会对**每一个 chunk 单独**做
 * UTF-8 解码，而 chunk 的切分点是按字节数来的（通常 64KB 一块），完全不管字符边界。
 * 一个汉字占 3 个字节，只要它正好横跨两个 chunk，前半截和后半截各自解码都不是合法字符，
 * 于是双双变成替换字符 U+FFFD（显示成 ）。
 *
 * 这就是词汇宇宙来源列表里那两个「高」「托」的来历——它们本该是「高中」「托福」，
 * 在某次全库批量保存（一万五千个词，几 MB 的请求体）时正好被切在了那个字上。
 * 这种坏数据一旦写进库就一直留着，而且每次只坏一两个、看起来像随机灵异事件，
 * 极难联想到是读请求体的方式有问题。
 */
async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (!chunks.length) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

/**
 * 单词 → 文件名 的索引。
 *
 * 文件名是内容哈希（word_0000aa21….json），从单词本身推不出来，只能扫一遍目录读
 * 每个文件的 word 字段。一万五千个文件扫一次大约几百毫秒，所以缓存住——
 * 但要按目录的修改时间失效，不然新导入的词永远进不了索引。
 */
let wordFileIndex = null
let wordFileIndexStamp = 0

/**
 * 扫一遍释义库，同时产出两样东西：
 *   · 内存里的「单词 → 文件名」映射（写回时定位文件用）
 *   · 落盘的**分类索引** resources/word_index.json
 *
 * 索引这件事是用户提的，而且提得对。现在每个词的完整资料（释义、例句、
 * 近反义、词族、词根）都摊在一万五千个文件里，光是"按考纲筛一批词"这种事
 * 就得把一万五千个文件全读一遍——而筛选真正需要的只有单词、分类、话题、词根这几项。
 * 把这几项抽出来单独存一份，文件小两个数量级，一次读取就能驱动全部分类和筛选，
 * 完整资料留在原文件里、点开某个词的时候再按文件名去取。
 *
 * 索引是**纯派生数据**：任何时候删掉都能重新扫出来，不承载任何原始信息。
 * 所以它不算"多出来的一份数据"，它是那一万五千个文件的目录。
 */
function buildWordFileIndex(dir, writeIndexFile = false) {
  const stamp = statSync(dir).mtimeMs
  if (wordFileIndex && wordFileIndexStamp === stamp && !writeIndexFile) return wordFileIndex
  const map = new Map()
  const entries = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    try {
      const doc = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
      const w = String(doc?.word ?? '').trim().toLowerCase()
      if (!w || map.has(w)) continue
      map.set(w, f)
      if (writeIndexFile) {
        // 只抽筛选真正用得上的字段。键名用一个字母，一万五千条能省下不少体积——
        // 这份文件是要每次启动整个读进来的。
        const cats = Array.isArray(doc.categories) && doc.categories.length
          ? doc.categories
          : (Array.isArray(doc.sources) ? doc.sources : [])
        const m = doc.morphemes || {}
        const forms = [m.prefix?.form, m.root?.form, m.suffix?.form].filter(Boolean)
        entries.push({
          w: doc.word,
          f,
          c: cats.map(x => String(x).trim()).filter(Boolean),
          t: Array.isArray(doc.topics) ? doc.topics : [],
          m: forms,
          n: Array.isArray(doc.word_family) ? doc.word_family.length : 0
        })
      }
    } catch {
      // 单个文件坏了跳过，不影响其余
    }
  }
  wordFileIndex = map
  wordFileIndexStamp = stamp
  if (writeIndexFile) {
    const out = join(dirname(dir), 'word_index.json')
    const tmp = `${out}.tmp`
    writeFileSync(tmp, JSON.stringify({ builtAt: nowIso(), count: entries.length, words: entries }), 'utf-8')
    renameSync(tmp, out)
  }
  return map
}

function nowIso() {
  return new Date().toISOString()
}

/**
 * 尝试处理一个 /api/... 请求。命中就自己写完响应并返回 true；不认识的路径返回 false，
 * 交给调用方（server.mjs）继续走静态文件那套逻辑。
 */
let MEDIA_ROOT = ''
/** 由 server 在启动时告诉这个模块音频存哪。没设过就退回进程当前目录。 */
export function setMediaRoot(dir) { MEDIA_ROOT = dir }
function mediaDir() {
  const d = join(MEDIA_ROOT || process.cwd(), 'data', 'media')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

let ffmpegOk = null
/** ffmpeg 装没装。只探一次，探不到就一直是 false，不用每次请求都 spawn。 */
function hasFfmpeg() {
  if (ffmpegOk !== null) return ffmpegOk
  try {
    const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    ffmpegOk = r.status === 0
  } catch {
    ffmpegOk = false
  }
  return ffmpegOk
}

/**
 * 收一个视频，抽出音轨，删掉视频。
 *
 * 视频原样存下来没有意义：一小时的课几百兆，而跟读只用得到声音。
 * 抽完就删是这个功能的重点，不是顺手做的清理。
 */
/**
 * 探测本机可用的语音识别工具。
 *
 * 常见的装法有好几种，命令名各不相同，挨个试而不是只认一种：
 *   · whisper-cli / main —— whisper.cpp 编译出来的可执行文件（新版叫 whisper-cli）
 *   · whisper —— OpenAI 官方 Python 包
 *   · faster-whisper 没有命令行入口，只能靠 python -m，单独探
 * 都没有时把安装建议一起返回，而不是只说一句"不可用"——
 * 用户看到"不可用"接下来还得自己去查装什么。
 */
let asrCache = null
function detectAsr() {
  if (asrCache) return asrCache
  const tryCmd = (cmd, args) => {
    try { return spawnSync(cmd, args, { stdio: 'ignore' }).status === 0 } catch { return false }
  }
  let kind = ''
  let cmd = ''
  if (tryCmd('whisper-cli', ['--help'])) { kind = 'whisper.cpp'; cmd = 'whisper-cli' }
  else if (tryCmd('main', ['--help'])) { kind = 'whisper.cpp'; cmd = 'main' }
  else if (tryCmd('whisper', ['--help'])) { kind = 'openai-whisper'; cmd = 'whisper' }

  asrCache = {
    ok: !!kind,
    kind,
    cmd,
    hint: kind
      ? ''
      : '没找到语音识别工具。推荐 whisper.cpp（本机跑、免费、出词级时间戳）：编译后把 whisper-cli 加进 PATH，模型放 models/ggml-base.en.bin。或者 pip install openai-whisper。'
  }
  return asrCache
}

/**
 * 音频转写成字幕。
 *
 * 输出统一成 SRT 交给前端——前端已经有一套 SRT 解析和对轴（subtitles.ts），
 * 转写和"导入字幕"这两条路在前端就合流了，不用为转写单写一套时间戳处理。
 */
async function handleTranscribe(req, res) {
  // ⚠ 先校验参数再探工具。反过来的话，装了 whisper 的机器上
  // 路径穿越会一路走到拼路径那一步；没装 whisper 只是碰巧挡住了。
  const url = new URL(req.url, 'http://x')
  const name = url.searchParams.get('file') || ''
  if (!name || /[\\/]|\.\./.test(name)) { sendJson(res, 400, { error: '缺少或非法的 file 参数' }); return }

  const asr = detectAsr()
  if (!asr.ok) { sendJson(res, 500, { error: asr.hint }); return }
  const audio = join(mediaDir(), name)
  if (!existsSync(audio)) { sendJson(res, 404, { error: '音频不存在，先抽音轨或上传音频' }); return }

  const outBase = join(mediaDir(), name.replace(/\.[^.]+$/, ''))
  const model = url.searchParams.get('model') || ''
  try {
    await new Promise((resolve, reject) => {
      let args
      if (asr.kind === 'whisper.cpp') {
        // -osrt 直接出 srt；-l en 指定英语，自动检测会慢且偶尔判错
        args = ['-f', audio, '-osrt', '-of', outBase, '-l', 'en']
        if (model) args.push('-m', model)
      } else {
        args = [audio, '--model', model || 'base.en', '--output_format', 'srt',
                '--output_dir', mediaDir(), '--language', 'en']
      }
      const p = spawn(asr.cmd, args, { stdio: 'ignore' })
      p.on('error', reject)
      p.on('close', code => (code === 0 ? resolve() : reject(new Error(asr.cmd + ' 退出码 ' + code))))
    })

    const srtPath = outBase + '.srt'
    if (!existsSync(srtPath)) throw new Error('转写完成但没有生成 srt 文件')
    sendJson(res, 200, { ok: true, srt: readFileSync(srtPath, 'utf-8') })
  } catch (e) {
    sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
  }
}

async function handleMediaExtract(req, res) {
  if (!hasFfmpeg()) {
    sendJson(res, 500, { error: '没找到 ffmpeg。装好并加进 PATH 之后重启本服务即可。' })
    return
  }
  const id = randomUUID().slice(0, 8)
  // 视频先落到系统临时目录，不进项目目录：中途失败时不留垃圾在 data/ 里
  const tmp = join(tmpdir(), `lb-video-${id}`)
  const outName = `${id}.mp3`
  const out = join(mediaDir(), outName)

  try {
    await new Promise((resolve, reject) => {
      const ws = createWriteStream(tmp)
      req.pipe(ws)
      req.on('error', reject)
      ws.on('error', reject)
      ws.on('finish', resolve)
    })

    await new Promise((resolve, reject) => {
      // -vn 丢掉视频流，-q:a 4 是体积和音质的折中（约 128kbps 变码率）
      const p = spawn('ffmpeg', ['-y', '-i', tmp, '-vn', '-acodec', 'libmp3lame', '-q:a', '4', out], { stdio: 'ignore' })
      p.on('error', reject)
      p.on('close', code => (code === 0 ? resolve() : reject(new Error('ffmpeg 退出码 ' + code))))
    })

    const size = existsSync(out) ? statSync(out).size : 0
    sendJson(res, 200, { ok: true, file: outName, url: `/api/media/file/${outName}`, size })
  } catch (e) {
    try { if (existsSync(out)) unlinkSync(out) } catch { /* 清不掉就算了 */ }
    sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
  } finally {
    // 不管成没成，临时视频一定删掉
    try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* 同上 */ }
  }
}

export async function handleDataApi(req, res, store, urlPath) {
  const method = req.method

  // ===== 健康检查（前端探测"后端"在不在跑用）=====
  if (method === 'GET' && urlPath === '/api/health') {
    sendJson(res, 200, { ok: true })
    return true
  }

  // ===== 媒体：视频抽音轨 =====
  //
  // 浏览器里做不了这件事：抽音轨要 ffmpeg（WASM 版三十多兆、一小时视频要跑几分钟），
  // 删原视频要文件系统权限。所以走服务端：收视频 → 抽音轨 → 删视频 → 只留音频。
  if (urlPath === '/api/media/ffmpeg-check') {
    sendJson(res, 200, { ok: hasFfmpeg() })
    return true
  }
  if (urlPath === '/api/media/asr-check') {
    sendJson(res, 200, detectAsr())
    return true
  }
  if (req.method === 'POST' && urlPath === '/api/media/transcribe') {
    await handleTranscribe(req, res)
    return true
  }
  /**
   * 直接收一段音频存下来，返回它的文件名 —— 转写要的就是这个。
   *
   * 之前只有 /extract（收视频、调 ffmpeg 抽音轨）。音频已经在浏览器里抽好了
   * 的时候没有入口把它交给后端，转写按钮就一直是灰的。
   * 这条不碰 ffmpeg，纯落盘。
   */
  if (req.method === 'POST' && urlPath === '/api/media/put-audio') {
    const ext = 'wav'
    const outName = `audio-${Date.now().toString(36)}.${ext}`
    const out = join(mediaDir(), outName)
    try {
      await new Promise((resolve, reject) => {
        const ws = createWriteStream(out)
        req.pipe(ws)
        req.on('error', reject)
        ws.on('error', reject)
        ws.on('finish', resolve)
      })
      const size = existsSync(out) ? statSync(out).size : 0
      if (!size) throw new Error('收到的音频是空的')
      sendJson(res, 200, { ok: true, file: outName, url: `/api/media/file/${outName}`, size })
    } catch (e) {
      try { if (existsSync(out)) unlinkSync(out) } catch { /* 清不掉就算了 */ }
      sendJson(res, 500, { error: e && e.message ? e.message : String(e) })
    }
    return true
  }

  if (req.method === 'POST' && urlPath === '/api/media/extract') {
    await handleMediaExtract(req, res)
    return true
  }
  if (req.method === 'GET' && urlPath.startsWith('/api/media/file/')) {
    const name = decodeURIComponent(urlPath.slice('/api/media/file/'.length))
    // 只允许取这个目录下的文件名，挡掉 ../ 之类
    if (/[\\/]|\.\./.test(name)) { res.writeHead(400); res.end('bad name'); return true }
    const f = join(mediaDir(), name)
    if (!existsSync(f)) { res.writeHead(404); res.end('not found'); return true }
    const stat = statSync(f)
    res.writeHead(200, {
      'Content-Type': name.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream',
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes'
    })
    createReadStream(f).pipe(res)
    return true
  }

  // ===== 文章 =====
  if (urlPath === '/api/articles') {
    if (method === 'GET') {
      sendJson(res, 200, store.readCollection('articles'))
      return true
    }
  }
  let m = urlPath.match(/^\/api\/articles\/([^/]+)$/)
  if (m) {
    const id = decodeURIComponent(m[1])
    if (method === 'GET') {
      const item = store.readCollection('articles').find(a => a.id === id)
      if (!item) return sendJson(res, 404, { detail: '文章不存在' }), true
      sendJson(res, 200, item)
      return true
    }
    if (method === 'PUT') {
      const payload = await readJsonBody(req)
      if (payload.id !== id) return sendJson(res, 400, { detail: 'URL 里的 id 跟 body 里的 id 对不上' }), true
      // 文章按分组名落进 data/articles/<分组名>/ 子目录，这样这个文件夹是能直接翻的
      // 分类结构。前端传的是 groupId，落盘要的是分组名，在这里查一次表补上。
      // __groupName 只用于决定落盘位置，dataStore 写文件时会把它剔掉，不进文件内容。
      const groups = store.readCollection('article_groups')
      const g = payload.groupId ? groups.find(x => x.id === payload.groupId) : null
      sendJson(res, 200, store.upsert('articles', { ...payload, __groupName: g?.name }))
      return true
    }
    if (method === 'DELETE') {
      const ok = store.remove('articles', id)
      if (!ok) return sendJson(res, 404, { detail: '文章不存在' }), true
      sendJson(res, 200, { ok: true })
      return true
    }
  }

  // ===== 文章分组 =====
  if (urlPath === '/api/article-groups' && method === 'GET') {
    sendJson(res, 200, store.readCollection('article_groups'))
    return true
  }
  m = urlPath.match(/^\/api\/article-groups\/([^/]+)$/)
  if (m) {
    const id = decodeURIComponent(m[1])
    if (method === 'PUT') {
      const payload = await readJsonBody(req)
      const existing = store.readCollection('article_groups').find(g => g.id === id)
      const now = nowIso()
      const saved = {
        id,
        name: (payload.name || '').trim() || '未命名分组',
        createdAt: existing?.createdAt || now,
        updatedAt: now
      }
      sendJson(res, 200, store.upsert('article_groups', saved))
      return true
    }
    if (method === 'DELETE') {
      // 删分组不连带删文章：文章的 groupId 清空，退回"未分组"
      const articles = store.readCollection('articles').map(a => (a.groupId === id ? { ...a, groupId: undefined } : a))
      store.writeCollection('articles', articles)
      const ok = store.remove('article_groups', id)
      if (!ok) return sendJson(res, 404, { detail: '分组不存在' }), true
      sendJson(res, 200, { ok: true })
      return true
    }
  }

  // ===== 单词 =====
  if (urlPath === '/api/words' && method === 'GET') {
    sendJson(res, 200, store.readCollection('words'))
    return true
  }
  // 批量写：整库导入 / 一次导入一本几千词的词书走这条，不要逐条 PUT。
  // body 直接就是 WordItem 数组。
  if (urlPath === '/api/words/bulk' && method === 'POST') {
    const payload = await readJsonBody(req)
    if (!Array.isArray(payload)) return sendJson(res, 400, { detail: 'body 应该是一个数组' }), true
    sendJson(res, 200, store.upsertMany('words', payload))
    return true
  }
  m = urlPath.match(/^\/api\/words\/([^/]+)$/)
  if (m) {
    const id = decodeURIComponent(m[1])
    if (method === 'PUT') {
      const payload = await readJsonBody(req)
      if (payload.id !== id) return sendJson(res, 400, { detail: 'URL 里的 id 跟 body 里的 id 对不上' }), true
      sendJson(res, 200, store.upsert('words', payload))
      return true
    }
    if (method === 'DELETE') {
      const ok = store.remove('words', id)
      if (!ok) return sendJson(res, 404, { detail: '单词不存在' }), true
      sendJson(res, 200, { ok: true })
      return true
    }
  }

  // ===== 释义库标签提取 =====
  // 直接在服务端扫 resources/word_explanations/ 的全部 JSON，抽出
  // 「单词 → 考纲分类」这一张表返回给前端。
  //
  // 为什么放服务端做：之前这一步在浏览器里跑，靠一个 word_explanations_index.json
  // 索引文件定位每个词的文件名，然后逐个 fetch。问题是那个索引**没有任何环节自动生成**，
  // 文件不存在时 loadIndex() 静默返回空对象，于是回填一条也补不上、还不报错——
  // 用户只会看到"回填完成：0 个"。而且就算索引在，一万五千次 HTTP 往返也慢得离谱。
  // 服务端本来就守着这个目录，一次读完返回一张表，几百毫秒的事。
  if (urlPath === '/api/word-explanations/tags' && method === 'GET') {
    // 释义库在资源目录下。store 直接给出 RESOURCES_DIR，不再从 DATA_DIR 往上推算——
    // 那种推算在目录改过名之后就对不上了（vendor-data → resources）。
    const dir = join(store.RESOURCES_DIR, 'word_explanations')
    const out = {}
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.json')) continue
        try {
          const exp = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
          if (!exp?.word) continue
          let cats = []
          if (Array.isArray(exp.categories) && exp.categories.length) cats = exp.categories
          else if (Array.isArray(exp.sources) && exp.sources.length) cats = exp.sources
          else if (typeof exp.category === 'string' && exp.category.trim()) cats = exp.category.split(/[,，]/)
          cats = cats.map(c => String(c).trim()).filter(Boolean)
          if (cats.length) out[String(exp.word).toLowerCase()] = [...new Set(cats)]
        } catch {
          // 单个文件坏了跳过，不影响其余一万多个
        }
      }
    }
    sendJson(res, 200, out)
    return true
  }

  /**
   * 把补全出来的数据写回**单词自己的那个 JSON 文件**。
   *
   * 为什么要有这个接口：释义库 resources/word_explanations/ 是用户自己的资产，
   * 一个词一个文件，能直接打开看、能拷走、能给别人。补全跑出来的话题/词根/词族
   * 如果只落在 data/words.json 和浏览器 IndexedDB 里，那份"一个词一个文件"的库
   * 就永远停在导入时的样子——用户要的是那批文件本身变完整，而不是应用内部
   * 另存一份。所以这里做成写回去，让释义库始终是最全的那一份。
   *
   * 写法上有三条硬规矩：
   *  1. **只补不覆盖**。文件里已经有的字段一律不动——那是原始数据，比补出来的可信。
   *  2. **只写认识的字段**。别的键原样保留，连格式和顺序都不动，
   *     免得把用户自己加的东西洗掉。
   *  3. 找不到对应文件就跳过，不新建。用户手动录入的词本来就不在这个库里，
   *     凭空造一个文件会让这个目录变成两种来源混在一起。
   */
  if (urlPath === '/api/word-explanations/patch' && method === 'POST') {
    const payload = await readJsonBody(req)
    const updates = Array.isArray(payload?.updates) ? payload.updates : []
    const dir = join(store.RESOURCES_DIR, 'word_explanations')
    if (!existsSync(dir) || !updates.length) {
      sendJson(res, 200, { patched: 0, skipped: updates.length })
      return true
    }
    const index = buildWordFileIndex(dir)
    let patched = 0
    let skipped = 0
    for (const u of updates) {
      const key = String(u?.word ?? '').trim().toLowerCase()
      let file = key && index.get(key)
      /**
       * 库里没有这个词就**新建一个文件**。
       *
       * 以前是直接跳过，于是你从文章里点收的生词、手动录入的词
       * 永远只存在于 data/words.json 这份工作缓存里，词库里没有它们的位置。
       * 而这个项目定下的规矩是"词库是唯一的准、缓存随时可重建"，
       * 跳过等于让这批词永远不合规：拷走 resources/ 给别人，它们就丢了。
       * 文件名带 user_ 前缀，跟原始导入的 word_<哈希>.json 一眼分得开。
       */
      if (!file && key && u.create) {
        const safe = key.replace(/[^a-z0-9_-]+/g, '_').slice(0, 60) || 'word'
        file = `user_${safe}.json`
        try {
          const full = join(dir, file)
          if (!existsSync(full)) {
            writeFileSync(full, JSON.stringify({
              word: u.word,
              pos_definitions: u.pos_definitions || [],
              example_sentences: u.example_sentences || [],
              phonetic: u.phonetic || '',
              categories: [],
              source: u.source || 'user'
            }, null, 2), 'utf-8')
          }
          index.set(key, file)
        } catch { file = '' }
      }
      if (!file) { skipped++; continue }
      try {
        const full = join(dir, file)
        const doc = JSON.parse(readFileSync(full, 'utf-8'))
        let touched = false
        // categories / sources 是这个库自己表达考纲分类的两个字段，
        // 已经有值就绝对不动——那是原始数据，补出来的不该覆盖它。
        if (Array.isArray(u.exam_tags) && u.exam_tags.length &&
            !(Array.isArray(doc.categories) && doc.categories.length)) {
          doc.categories = u.exam_tags
          touched = true
        }
        if (Array.isArray(u.topics) && u.topics.length && !(Array.isArray(doc.topics) && doc.topics.length)) {
          doc.topics = u.topics
          touched = true
        }
        if (u.morphemes && typeof u.morphemes === 'object' && !doc.morphemes) {
          doc.morphemes = u.morphemes
          touched = true
        }
        if (Array.isArray(u.word_family) && u.word_family.length &&
            !(Array.isArray(doc.word_family) && doc.word_family.length)) {
          doc.word_family = u.word_family
          touched = true
        }
        if (touched) {
          writeFileSync(full, JSON.stringify(doc, null, 2), 'utf-8')
          patched++
        } else {
          skipped++
        }
      } catch {
        skipped++
      }
    }
    // 写回之后索引就旧了。这里只把内存里的映射作废（下次自然重扫），
    // 不顺手重建落盘索引——补全是一批一批来的，每批重扫一万五千个文件
    // 等于把刚省下的开销又加回去。整轮跑完点一次「重建索引」即可。
    if (patched > 0) { wordFileIndex = null; wordFileIndexStamp = 0 }
    sendJson(res, 200, { patched, skipped })
    return true
  }

  /**
   * 从词库重建工作缓存。
   *
   * ── 这一条落实的是"所有信息以单词库为准" ──
   * 之前的状态是：resources/word_explanations/ 和 data/words.json 两边都在写，
   * 但应用只从后者读——于是词库到底是不是"准"的，谁也说不清，
   * 而这正是用户从一开始就要的东西。
   *
   * 现在把关系定死：
   *   · **词库是原本**。一个词一个文件，能打开、能拷走、能给别人。
   *   · **data/words.json 是缓存**。它的唯一作用是让启动时读一个文件而不是
   *     一万五千个（后者要一两秒，每次开都等一下不可接受）。
   *     它随时可以删掉，点一次这个按钮就能从词库完整重建出来。
   *
   * 重建时**必须保住学习状态**：认识/模糊/不认识的标注、aiEnrichedAt 戳、
   * 词条 id（词表引用的是 id，换了 id 所有词表都会散架）、加入时间和来源。
   * 这些是用户自己产生的，词库里没有、也不该有——所以先从旧缓存里抠出来，
   * 重建之后逐条贴回去。抠不到的（词库里的新词）才用新生成的。
   */
  if (urlPath === '/api/word-explanations/rebuild-cache' && method === 'POST') {
    const dir = join(store.RESOURCES_DIR, 'word_explanations')
    if (!existsSync(dir)) return sendJson(res, 200, { ok: false, reason: '词库目录不存在' }), true

    // 1. 先把旧缓存里属于"用户"的那部分留下来
    const prev = store.readCollection('words')
    const keep = new Map()
    for (const w of prev) {
      const k = String(w?.word ?? '').trim().toLowerCase()
      if (k) keep.set(k, w)
    }

    // 2. 扫词库，逐个映射
    const now = nowIso()
    const rebuilt = []
    let fromLib = 0
    for (const f of readdirSync(dir)) {
      if (!f.toLowerCase().endsWith('.json')) continue
      try {
        const doc = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
        const item = mapToWordItem(doc, now)
        if (!item) continue
        const old = keep.get(item.word.toLowerCase())
        if (old) {
          // 词条内容以词库为准，学习状态以旧缓存为准，各取各的
          item.id = old.id
          item.status = old.status || 'unmarked'
          item.aiEnrichedAt = old.aiEnrichedAt
          item.createdAt = old.createdAt || item.createdAt
          item.source = old.source || item.source
          // 词库里没有、只存在于缓存里的补全结果也要留着
          // （比如免费词典补的音标、AI 补的话题——写回词库时"只补不覆盖"，
          //   如果词库那个字段原本就有值，补的那份只在缓存里）
          if (!item.topics?.length && old.topics?.length) item.topics = old.topics
          if (!item.morphemes && old.morphemes) item.morphemes = old.morphemes
          if (!item.phonetic && old.phonetic) item.phonetic = old.phonetic
          keep.delete(item.word.toLowerCase())
        }
        rebuilt.push(item)
        fromLib++
      } catch {
        // 单个文件坏了跳过，不让一个坏文件毁掉整次重建
      }
    }

    // 3. 词库里没有、只在缓存里的词（手动录入、从文章收的）原样留下。
    //    直接丢掉的话，用户自己加的词会在重建时凭空消失，那是不可接受的。
    let kept = 0
    for (const w of keep.values()) { rebuilt.push(w); kept++ }

    store.writeCollection('words', rebuilt)
    // 缓存重建了，分类索引也跟着重建一次，两者才对得上
    buildWordFileIndex(dir, true)
    sendJson(res, 200, { ok: true, total: rebuilt.length, fromLib, keptLocalOnly: kept })
    return true
  }

  /** 重建分类索引。整轮补全跑完之后点一次，之后所有按分类筛选都读这一份。 */
  if (urlPath === '/api/word-explanations/reindex' && method === 'POST') {
    const dir = join(store.RESOURCES_DIR, 'word_explanations')
    if (!existsSync(dir)) return sendJson(res, 200, { count: 0, ok: false }), true
    const t0 = Date.now()
    const map = buildWordFileIndex(dir, true)
    sendJson(res, 200, { count: map.size, ms: Date.now() - t0, ok: true })
    return true
  }

  /** 读分类索引。没有就现扫一次并落盘，所以第一次调用也一定有结果。 */
  if (urlPath === '/api/word-explanations/index' && method === 'GET') {
    const dir = join(store.RESOURCES_DIR, 'word_explanations')
    const idxFile = join(store.RESOURCES_DIR, 'word_index.json')
    if (!existsSync(idxFile) && existsSync(dir)) buildWordFileIndex(dir, true)
    if (!existsSync(idxFile)) return sendJson(res, 200, { count: 0, words: [] }), true
    try {
      sendJson(res, 200, JSON.parse(readFileSync(idxFile, 'utf-8')))
    } catch {
      sendJson(res, 200, { count: 0, words: [] })
    }
    return true
  }

  // ===== FSRS 记忆卡片 =====
  // 只提供"全量读"和"批量写"两个操作，没有单条接口——记忆卡片总是整轮学习结束时
  // 一次性更新一批（一轮几十个词），逐条写没有意义还慢。
  if (urlPath === '/api/fsrs' && method === 'GET') {
    sendJson(res, 200, store.readCollection('fsrs'))
    return true
  }
  if (urlPath === '/api/fsrs/bulk' && method === 'POST') {
    const payload = await readJsonBody(req)
    if (!Array.isArray(payload)) return sendJson(res, 400, { detail: 'body 应该是一个数组' }), true
    sendJson(res, 200, store.upsertMany('fsrs', payload))
    return true
  }

  // ===== 已掌握词表 =====
  if (urlPath === '/api/mastered' && method === 'GET') {
    sendJson(res, 200, store.readCollection('mastered'))
    return true
  }
  if (urlPath === '/api/mastered/bulk' && method === 'POST') {
    const payload = await readJsonBody(req)
    if (!Array.isArray(payload)) return sendJson(res, 400, { detail: 'body 应该是一个数组' }), true
    sendJson(res, 200, store.upsertMany('mastered', payload))
    return true
  }
  m = urlPath.match(/^\/api\/mastered\/([^/]+)$/)
  if (m && method === 'DELETE') {
    store.remove('mastered', decodeURIComponent(m[1]))
    // 取消已掌握是幂等的：本来就不在表里也算成功，不返回 404
    sendJson(res, 200, { ok: true })
    return true
  }

  // ===== 词书（WordGroup） =====
  if (urlPath === '/api/word-groups' && method === 'GET') {
    sendJson(res, 200, store.readCollection('word_groups'))
    return true
  }
  if (urlPath === '/api/word-groups/bulk' && method === 'POST') {
    const payload = await readJsonBody(req)
    if (!Array.isArray(payload)) return sendJson(res, 400, { detail: 'body 应该是一个数组' }), true
    sendJson(res, 200, store.upsertMany('word_groups', payload))
    return true
  }
  m = urlPath.match(/^\/api\/word-groups\/([^/]+)$/)
  if (m) {
    const id = decodeURIComponent(m[1])
    if (method === 'PUT') {
      const payload = await readJsonBody(req)
      if (payload.id !== id) return sendJson(res, 400, { detail: 'URL 里的 id 跟 body 里的 id 对不上' }), true
      sendJson(res, 200, store.upsert('word_groups', payload))
      return true
    }
    if (method === 'DELETE') {
      const ok = store.remove('word_groups', id)
      if (!ok) return sendJson(res, 404, { detail: '词书不存在' }), true
      sendJson(res, 200, { ok: true })
      return true
    }
  }

  // ===== 待办 =====
  if (urlPath === '/api/todos' && method === 'GET') {
    const list = store.readCollection('todos').slice().sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      const da = a.due || '9999', db = b.due || '9999'
      return da < db ? -1 : da > db ? 1 : 0
    })
    sendJson(res, 200, list)
    return true
  }
  m = urlPath.match(/^\/api\/todos\/(\d+)$/)
  if (m) {
    const id = Number(m[1])
    if (method === 'PUT') {
      const payload = await readJsonBody(req)
      if (payload.id !== id) return sendJson(res, 400, { detail: 'URL 里的 id 跟 body 里的 id 对不上' }), true
      sendJson(res, 200, store.upsert('todos', { ...payload, text: (payload.text || '').trim().slice(0, 200) }))
      return true
    }
    if (method === 'PATCH') {
      const patch = await readJsonBody(req)
      const list = store.readCollection('todos')
      const idx = list.findIndex(t => t.id === id)
      if (idx < 0) return sendJson(res, 404, { detail: '待办不存在' }), true
      list[idx] = { ...list[idx], ...patch }
      store.writeCollection('todos', list)
      sendJson(res, 200, list[idx])
      return true
    }
    if (method === 'DELETE') {
      const ok = store.remove('todos', id)
      if (!ok) return sendJson(res, 404, { detail: '待办不存在' }), true
      sendJson(res, 200, { ok: true })
      return true
    }
  }

  // ===== 每日学习活动（打卡/热力图） =====
  if (urlPath === '/api/activity' && method === 'GET') {
    sendJson(res, 200, store.readCollection('activity'))
    return true
  }
  m = urlPath.match(/^\/api\/activity\/([^/]+)$/)
  if (m) {
    const date = decodeURIComponent(m[1])
    if (method === 'PUT') {
      const payload = await readJsonBody(req)
      if (payload.date !== date) return sendJson(res, 400, { detail: 'URL 里的日期跟 body 里的日期对不上' }), true
      sendJson(res, 200, store.upsert('activity', payload, 'date'))
      return true
    }
  }

  // ===== 学习习惯 =====
  if (urlPath === '/api/habits' && method === 'GET') {
    sendJson(res, 200, store.readCollection('habits'))
    return true
  }
  m = urlPath.match(/^\/api\/habits\/(\d+)\/checkin$/)
  if (m && method === 'POST') {
    const habitId = Number(m[1])
    const payload = await readJsonBody(req)
    const habits = store.readCollection('habits')
    if (!habits.find(h => h.id === habitId)) return sendJson(res, 404, { detail: '习惯不存在' }), true
    const log = store.readCollection('habit_log')
    const dup = log.some(l => l.habitId === habitId && l.date === payload.date)
    if (dup) return sendJson(res, 200, { ok: true, inserted: false }), true
    const nextId = log.reduce((max, x) => Math.max(max, x.id || 0), 0) + 1
    log.push({ id: nextId, habitId, date: payload.date })
    store.writeCollection('habit_log', log)
    sendJson(res, 200, { ok: true, inserted: true })
    return true
  }
  m = urlPath.match(/^\/api\/habits\/(\d+)$/)
  if (m) {
    const id = Number(m[1])
    if (method === 'PUT') {
      const payload = await readJsonBody(req)
      if (payload.id !== id) return sendJson(res, 400, { detail: 'URL 里的 id 跟 body 里的 id 对不上' }), true
      sendJson(res, 200, store.upsert('habits', { ...payload, name: (payload.name || '').trim().slice(0, 40) }))
      return true
    }
    if (method === 'DELETE') {
      const log = store.readCollection('habit_log').filter(l => l.habitId !== id)
      store.writeCollection('habit_log', log)
      const ok = store.remove('habits', id)
      if (!ok) return sendJson(res, 404, { detail: '习惯不存在' }), true
      sendJson(res, 200, { ok: true })
      return true
    }
  }

  return false
}

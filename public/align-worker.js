/**
 * 对轴 Worker。
 *
 * 之前识别和对齐都在主线程：session.run 是同步的 WASM 计算，几万帧的 log-softmax
 * 也是纯循环。我加过 setTimeout 让出，但那只是把一次长卡顿切成很多次短卡顿 ——
 * 页面照样点不动，切到设置页就白屏、请求超时报"后端未连接"。
 *
 * 放进 Worker 之后计算在另一个线程，主线程只收进度消息，页面全程可用，
 * 切走再切回来任务照跑。
 */

let session = null
/**
 * 注意：这里**不能**叫 ort。
 *
 * ort.min.js 是 UMD 包，importScripts 进来时它要在 Worker 全局声明 ort，
 * 而我原来在顶部写了 let ort = null —— 同一个作用域里重复声明，
 * importScripts 直接抛 "Identifier 'ort' has already been declared"，
 * 表现成"本地文件也加载失败"，其实文件是好的。
 */
let ortRT = null

const W2V2_LABELS = [
  '<pad>', '<s>', '</s>', '<unk>', '|', 'E', 'T', 'A', 'O', 'N', 'I', 'H', 'S',
  'R', 'D', 'L', 'U', 'M', 'W', 'C', 'F', 'G', 'Y', 'P', 'B', 'V', 'K', "'",
  'X', 'J', 'Q', 'Z'
]
const FRAME_SEC = 0.02
/**
 * 运行时地址。几处坑：
 *  1. 写死版本号（@1.19.2）可能根本不存在，jsdelivr 直接 404 —— 不带版本用 latest 最稳。
 *  2. importScripts 进来之后，ort 默认去**当前站点根目录**找 .wasm，
 *     本地没有就 404。必须显式把 wasmPaths 指到 CDN 的 dist 目录。
 *     （onnxruntime issue #16102、#24325 讲的都是这个）
 *  3. ort.all.min.js 带 WebGPU，体积大但兼容性判断更全；主源用它，退回 ort.min.js。
 */
const ORT_CDNS = [
  // 本地优先：npm i onnxruntime-web 之后把 dist 拷到 public/ort/ 就能离线用
  '/ort/ort.min.js',
  '/ort/ort.all.min.js',
  'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.all.min.js',
  'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js',
  'https://unpkg.com/onnxruntime-web/dist/ort.min.js',
  // 国内常用镜像，jsdelivr/unpkg 连不上时试这些
  'https://registry.npmmirror.com/onnxruntime-web/latest/files/dist/ort.min.js',
  'https://cdn.bootcdn.net/ajax/libs/onnxruntime-web/1.19.0/ort.min.js'
]
let ORT_WASM_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/'
const CACHE_NAME = 'lb-w2v2-model'

function post(type, payload) {
  self.postMessage({ type, ...payload })
}

async function ensureOrt() {
  if (ortRT) return ortRT
  const errs = []
  let loadedFrom = ''
  for (const url of ORT_CDNS) {
    try {
      self.importScripts(url)
      if (self.ort) { loadedFrom = url; break }
    } catch (e) {
      errs.push(`${url}: ${e && e.message ? e.message : e}`)
    }
  }
  ortRT = self.ort
  if (!ortRT) {
    throw new Error(
      '运行时加载失败。\n' +
      '本地那份在 public/ort/，启动脚本会自动从 node_modules 拷过去；\n' +
      '如果没有，执行一次 npm i onnxruntime-web 再重启应用。\n\n' +
      '详细错误：\n' + errs.join('\n')
    )
  }

  // 不指这个的话，ort 会去站点根目录找 .wasm，本地没有就 404
  try {
    // 运行时从哪儿加载的，wasm 就从同一个目录拿，避免本地 js 配远程 wasm
    if (loadedFrom) ORT_WASM_BASE = loadedFrom.replace(/[^/]+$/, '')
    ortRT.env.wasm.wasmPaths = ORT_WASM_BASE
    // 线程版在 Worker 里常因为缺 COOP/COEP 头起不来，单线程更稳
    ortRT.env.wasm.numThreads = 1
    ortRT.env.wasm.proxy = false
  } catch {
    /* 老版本没有这些字段就算了 */
  }
  return ortRT
}

async function fetchModel(urls) {
  const cache = await caches.open(CACHE_NAME)
  for (const url of urls) {
    try {
      const hit = await cache.match(url)
      if (hit) {
        post('progress', { msg: '读取已下载的模型', ratio: 0.05 })
        return await hit.arrayBuffer()
      }
      const res = await fetch(url)
      if (!res.ok) continue
      const total = Number(res.headers.get('content-length') || 0)
      if (total && res.body) {
        const reader = res.body.getReader()
        const chunks = []
        let got = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          got += value.length
          post('progress', { msg: `下载模型 ${Math.round((got / total) * 100)}%`, ratio: 0.02 })
        }
        const buf = new Uint8Array(got)
        let off = 0
        for (const c of chunks) { buf.set(c, off); off += c.length }
        await cache.put(url, new Response(buf.slice(0)))
        return buf.buffer
      }
      const buf = await res.arrayBuffer()
      await cache.put(url, new Response(buf.slice(0)))
      return buf
    } catch {
      /* 换下一个源 */
    }
  }
  throw new Error('所有模型源都下不动，检查网络或自己放一份到 public/models/')
}

async function ensureSession(urls) {
  if (session) return session
  await ensureOrt()
  const bytes = await fetchModel(urls)
  post('progress', { msg: '初始化模型', ratio: 0.08 })
  session = await ortRT.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all'
  })
  return session
}

/** 跑模型拿 emission。切段时在静音处下刀，避免把词劈开。 */
/**
 * 先把切点全部算好，再逐段跑模型。
 *
 * 原来是边跑边切，而且犯了两个错：
 *  1. end 会被回退到静音点，但循环推进用的是固定的 off += CHUNK ——
 *     end 到 off+CHUNK 之间那段音频被整段跳过了
 *  2. 最后一次迭代 off 可能已经贴到音频末尾，切出长度只有 1 的片段，
 *     模型直接报 "ConvInteger ... Invalid input shape: {1}"
 *
 * 现在先算边界、合并过短的尾巴，再统一跑，两个问题一起没了。
 */
function planChunks(total) {
  const CHUNK = 30 * 16000
  // 卷积栈需要足够长的输入，太短的片段没法跑（也没有识别价值）
  const MIN = 4000            // 0.25 秒
  const WIN = 8000            // 在 ±0.5 秒内找静音点下刀

  const cuts = [0]
  let off = 0
  while (off < total) {
    let end = Math.min(total, off + CHUNK)
    if (end < total) {
      let best = end
      let bestE = Infinity
      for (let p = Math.max(off + MIN, end - WIN); p < Math.min(total, end + WIN); p += 160) {
        let e = 0
        for (let k = p; k < Math.min(total, p + 160); k++) e += PCM_REF[k] * PCM_REF[k]
        if (e < bestE) { bestE = e; best = p }
      }
      end = best
    }
    // 推进到 end，不是 off + CHUNK —— 否则中间那段会被跳过
    if (end <= off) end = Math.min(total, off + CHUNK)
    cuts.push(end)
    off = end
  }

  // 尾巴太短就并进上一段，不要单独送进模型
  if (cuts.length >= 3 && cuts[cuts.length - 1] - cuts[cuts.length - 2] < MIN) {
    cuts.splice(cuts.length - 2, 1)
  }
  return cuts
}

// planChunks 里要读采样算能量，用个模块级引用避免层层传参
let PCM_REF = null

async function runModel(pcm) {
  PCM_REF = pcm
  const emission = []
  const cuts = planChunks(pcm.length)
  const total = cuts.length - 1

  if (total < 1 || pcm.length < 4000) {
    throw new Error('音频太短，没法识别（至少要 0.25 秒）')
  }

  for (let no = 1; no <= total; no++) {
    const off = cuts[no - 1]
    const end = cuts[no]
    post('progress', { msg: `识别第 ${no}/${total} 段`, ratio: 0.1 + (off / pcm.length) * 0.7 })

  const slice = pcm.subarray(off, end)
    const out = await session.run({ input_values: new ortRT.Tensor('float32', slice, [1, slice.length]) })
    const logits = out[Object.keys(out)[0]]
    const [, frames, labels] = logits.dims
    const data = logits.data

    for (let t = 0; t < frames; t++) {
      const row = new Float32Array(labels)
      let max = -Infinity
      for (let c = 0; c < labels; c++) {
        const v = data[t * labels + c]
        row[c] = v
        if (v > max) max = v
      }
      let sum = 0
      for (let c = 0; c < labels; c++) sum += Math.exp(row[c] - max)
      const logSum = max + Math.log(sum)
      for (let c = 0; c < labels; c++) row[c] -= logSum
      emission.push(row)
    }
  }
  return emission
}

function greedyWords(emission) {
  const words = []
  let cur = ''
  let start = -1
  let prev = -1
  emission.forEach((frame, t) => {
    let best = 0
    for (let c = 1; c < frame.length; c++) if (frame[c] > frame[best]) best = c
    const ch = best === prev ? '' : (W2V2_LABELS[best] ?? '')
    prev = best
    if (!ch || best === 0) return
    if (ch === '|') {
      if (cur) words.push({ word: cur, start: start * FRAME_SEC, end: t * FRAME_SEC })
      cur = ''
      start = -1
      return
    }
    if (start < 0) start = t
    cur += ch
  })
  if (cur && start >= 0) words.push({ word: cur, start: start * FRAME_SEC, end: emission.length * FRAME_SEC })
  return words
}

self.onmessage = async e => {
  const { kind, pcm, modelUrls } = e.data
  try {
    await ensureSession(modelUrls)
    const emission = await runModel(pcm)
    post('progress', { msg: '整理结果', ratio: 0.92 })

    if (kind === 'transcribe') {
      post('done', { words: greedyWords(emission) })
      return
    }

    // 对齐所需的 emission 太大，不适合整块传回主线程；
    // 这里只回传贪心解码的词序列，由主线程做词级 DTW（那部分很快）。
    post('done', { words: greedyWords(emission) })
  } catch (err) {
    post('error', { message: err && err.message ? err.message : String(err) })
  }
}

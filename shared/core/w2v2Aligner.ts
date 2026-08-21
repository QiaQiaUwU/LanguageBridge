/**
 * 浏览器里跑 wav2vec2 CTC，产出 emission 供 ctcAlign 使用。
 *
 * 模型走 onnxruntime-web，全程本机、音频不出这台电脑。第一次用要下模型
 * （wav2vec2-base-960h 量化后约 100–150MB），之后走浏览器缓存。
 *
 * 参考：
 *  - torchaudio forced alignment 教程（emission → trellis → backtrack）
 *  - charsiu 的浏览器移植思路：onnxruntime-web + CTC 强制对齐，纯客户端
 */
import { alignWithEmission, type Segment } from './ctcAlign'

/** wav2vec2-base-960h 的标签表，顺序不能动 —— 要和模型输出的列一一对应 */
export const W2V2_LABELS = [
  '<pad>', '<s>', '</s>', '<unk>', '|', 'E', 'T', 'A', 'O', 'N', 'I', 'H', 'S',
  'R', 'D', 'L', 'U', 'M', 'W', 'C', 'F', 'G', 'Y', 'P', 'B', 'V', 'K', "'",
  'X', 'J', 'Q', 'Z'
]

/** 模型 stride：base 模型 20ms 一帧 */
export const W2V2_FRAME_SEC = 0.02

const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.webgpu.min.js'

/**
 * 加载 onnxruntime。
 *
 * 优先用本地装的包；没装就从 CDN 拉一份挂到 window 上。
 * 之前是"没装就报错让用户去 npm install" —— 但用户拿到的是打包好的应用，
 * 装依赖这件事不该甩给他，而且更新时那一步经常没跑到。
 * 走 CDN 就没有这个前提，第一次联网加载后浏览器自己会缓存。
 */
async function loadOrt(): Promise<any> {
  if ((window as any).ort) return (window as any).ort

  const pkg = 'onnxruntime-web'
  try {
    return await import(/* @vite-ignore */ pkg)
  } catch {
    /* 没装就走 CDN */
  }

  await new Promise<void>((resolve, reject) => {
    const el = document.createElement('script')
    el.src = ORT_CDN
    el.onload = () => resolve()
    el.onerror = () => reject(new Error('运行时下载失败，检查一下网络'))
    document.head.appendChild(el)
  })

  const ort = (window as any).ort
  if (!ort) throw new Error('运行时加载了但没挂上，换个网络环境再试')
  return ort
}

let session: any = null
let loading: Promise<any> | null = null

export interface ModelSource {
  /** onnx 模型地址。留空就用下面的默认源自动下载 */
  url?: string
}

/**
 * 默认模型源：Hugging Face 上 wav2vec2-base-960h 的 ONNX 版本。
 * 第一次用会自动下载（约 150MB），存进 Cache Storage，之后离线可用。
 * 想换成自己的就在设置里填地址。
 */
/**
 * 候选模型源，按顺序试。
 *
 * 之前只写了一个 `onnx-community/wav2vec2-base-960h`，那个仓库名是我拼错的，
 * HuggingFace 对不存在的仓库返回 401（不是 404），所以报"下载失败 401"。
 * 下面这几个是查证过确实存在的：
 *  - Xenova/wav2vec2-base-960h        Transformers.js 官方转的 ONNX 版
 *  - onnx-community/…-ONNX            onnx-community 的镜像
 *  - facebook/wav2vec2-base-960h      官方仓库里也有一份 onnx（378MB，未量化）
 */
export const MODEL_SOURCES = [
  'https://huggingface.co/Xenova/wav2vec2-base-960h/resolve/main/onnx/model_quantized.onnx',
  'https://huggingface.co/onnx-community/wav2vec2-base-960h-ONNX/resolve/main/onnx/model_quantized.onnx',
  'https://huggingface.co/Xenova/wav2vec2-base-960h/resolve/main/onnx/model.onnx',
  'https://huggingface.co/facebook/wav2vec2-base-960h/resolve/main/onnx/model.onnx'
]

export const DEFAULT_MODEL_URL = MODEL_SOURCES[0]

const CACHE_NAME = 'lb-w2v2-model'

/** 先查缓存，没有再下载并存起来。带进度回调。 */
async function fetchModel(url: string, onProgress?: (msg: string, ratio?: number) => void): Promise<ArrayBuffer> {
  try {
    const cache = await caches.open(CACHE_NAME)
    const hit = await cache.match(url)
    if (hit) {
      onProgress?.('读取已下载的模型…')
      return await hit.arrayBuffer()
    }

    onProgress?.('下载模型…')
    const res = await fetch(url)
    if (!res.ok) throw new Error(`下载失败 ${res.status}`)

    // 有 content-length 就报百分比
    const total = Number(res.headers.get('content-length') || 0)
    if (total && res.body) {
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let got = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        got += value.length
        onProgress?.(`下载模型 ${Math.round((got / total) * 100)}%`)
      }
      const buf = new Uint8Array(got)
      let off = 0
      for (const c of chunks) { buf.set(c, off); off += c.length }
      await cache.put(url, new Response(buf.slice(0), { headers: { 'content-type': 'application/octet-stream' } }))
      return buf.buffer
    }

    const buf = await res.arrayBuffer()
    await cache.put(url, new Response(buf.slice(0)))
    return buf
  } catch (e) {
    throw new Error('模型下载失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

export function isModelReady(): boolean {
  return !!session
}

/** 模型是不是已经下过了（不看有没有初始化） */
export async function isModelCached(): Promise<boolean> {
  try {
    const cache = await caches.open(CACHE_NAME)
    for (const u of MODEL_SOURCES) {
      if (await cache.match(u)) return true
    }
    return false
  } catch {
    return false
  }
}

/** 删掉已下载的模型（换源或者想省空间时用） */
export async function clearModelCache(): Promise<void> {
  try {
    await caches.delete(CACHE_NAME)
  } catch {
    /* 删不掉不影响使用 */
  }
  session = null
  loading = null
}

export async function loadAligner(src: ModelSource, onProgress?: (msg: string, ratio?: number) => void) {
  if (session) return session
  if (loading) return loading
  loading = (async () => {
    onProgress?.('加载运行时…')
    // @vite-ignore + 变量路径：onnxruntime-web 没装时，构建不会因为这行失败，
    // 只在真正点「强制对齐」的时候才报错。
    const ort = await loadOrt()
    const urls = src.url ? [src.url] : MODEL_SOURCES
    let bytes: ArrayBuffer | null = null
    const errs: string[] = []
    for (const u of urls) {
      try {
        bytes = await fetchModel(u, onProgress)
        break
      } catch (e) {
        errs.push(`${u.split('/').slice(3, 5).join('/')}: ${e instanceof Error ? e.message : e}`)
      }
    }
    if (!bytes) {
      throw new Error(
        '所有模型源都下不动：\n' + errs.join('\n') +
        '\n如果是网络到 huggingface.co 不通，可以自己下好 onnx 文件放到 public/models/，' +
        '再执行 localStorage.setItem("lb-w2v2-model-url", "/models/文件名.onnx")'
      )
    }
    onProgress?.('初始化模型…')
    session = await ort.InferenceSession.create(bytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    })
    onProgress?.('模型就绪')
    return session
  })().catch(err => {
    loading = null
    throw err
  })
  return loading
}

/** 文本 → 教程要求的格式：大写、单词间用 | 分隔、去掉模型认不得的字符 */
export function toTranscript(text: string): string {
  const words = (text.toUpperCase().match(/[A-Z']+/g) || [])
  return words.join('|')
}

/**
 * 贪心 CTC 解码：逐帧取概率最大的标签，合并重复、去掉 blank。
 *
 * wav2vec2-base-960h 本身就是语音识别模型（CTC 头），所以「语音识别」和
 * 「强制对齐」用的是同一份模型、同一份缓存 —— 不需要另外装 whisper，
 * 也不需要后端。区别只是解码方式：识别是贪心取最大，对齐是拿已知文本走 Viterbi。
 */
export function greedyDecode(emission: Float32Array[], labels: string[]): string {
  let out = ''
  let prev = -1
  for (const frame of emission) {
    let best = 0
    for (let c = 1; c < frame.length; c++) if (frame[c] > frame[best]) best = c
    // 合并连续相同 + 跳过 blank（下标 0）
    if (best !== prev && best !== 0) out += labels[best] ?? ''
    prev = best
  }
  return out.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * 在浏览器里转写。返回识别出的文本和带时间的词。
 * 用的是跟强制对齐同一份模型，第一次下过之后走缓存，不会重复下载。
 */
export async function transcribeAudio(
  pcm: Float32Array,
  onProgress?: (msg: string, ratio?: number) => void
): Promise<{ text: string; words: { word: string; start: number; end: number }[] }> {
  const emission = await runModel(pcm, onProgress)
  const text = greedyDecode(emission, W2V2_LABELS)

  // 逐帧找出每个词的起止：非 blank 段连起来，遇到 | 断词
  const words: { word: string; start: number; end: number }[] = []
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
      if (cur) words.push({ word: cur, start: start * W2V2_FRAME_SEC, end: t * W2V2_FRAME_SEC })
      cur = ''
      start = -1
      return
    }
    if (start < 0) start = t
    cur += ch
  })
  if (cur && start >= 0) {
    words.push({ word: cur, start: start * W2V2_FRAME_SEC, end: emission.length * W2V2_FRAME_SEC })
  }
  return { text, words }
}

/**
 * 跑一段音频，拿到词级时间段。
 *
 * @param pcm 16kHz 单声道 Float32（videoAudio.ts 抽出来的正好是这个规格）
 */
/**
 * 跑模型拿 emission。识别和对齐共用这一段。
 *
 * 长音频按 30 秒切段；切点在前后 0.5 秒里找能量最低处，
 * 对应 bournemouth-forced-aligner 的 silence anchoring —— 从句子中间切会把词劈开。
 */
/**
 * 把音频文件解码成 16kHz 单声道 PCM。
 *
 * 之前这段在两个调用方各写了一遍，而且中间不让出事件循环 —— 一小时的音频
 * 解码+重采样要好几秒，这期间页面是死的、进度条也不动，看着就是"卡住了"。
 */
/**
 * WAV 直接解析成 PCM，不用 AudioContext。
 *
 * 我们从视频抽出来的音轨本来就是 16kHz 单声道 16bit WAV（videoAudio.ts 写的），
 * 这种情况下走 decodeAudioData 纯属绕远路 —— 而且那条路有个要命的问题见下。
 * 返回 null 表示不是能直接读的 WAV，交给 AudioContext 那条。
 */
function parseWavTo16k(buf: ArrayBuffer): Float32Array | null {
  const dv = new DataView(buf)
  if (buf.byteLength < 44) return null
  const tag = (o: number) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null

  let off = 12
  let fmt: { channels: number; rate: number; bits: number } | null = null
  let dataOff = -1
  let dataLen = 0
  while (off + 8 <= buf.byteLength) {
    const id = tag(off)
    const size = dv.getUint32(off + 4, true)
    if (id === 'fmt ') {
      const format = dv.getUint16(off + 8, true)
      if (format !== 1) return null   // 只处理未压缩 PCM
      fmt = {
        channels: dv.getUint16(off + 10, true),
        rate: dv.getUint32(off + 12, true),
        bits: dv.getUint16(off + 22, true)
      }
    } else if (id === 'data') {
      dataOff = off + 8
      dataLen = size
    }
    off += 8 + size + (size % 2)
  }
  if (!fmt || dataOff < 0 || fmt.bits !== 16) return null

  const total = Math.floor(Math.min(dataLen, buf.byteLength - dataOff) / 2)
  const frames = Math.floor(total / fmt.channels)
  const mono = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    // 多声道就取平均
    let sum = 0
    for (let c = 0; c < fmt.channels; c++) {
      sum += dv.getInt16(dataOff + (i * fmt.channels + c) * 2, true) / 32768
    }
    mono[i] = sum / fmt.channels
  }
  if (fmt.rate === 16000) return mono

  // 采样率不对就线性重采样，比再开一个 AudioContext 便宜
  const ratio = fmt.rate / 16000
  const outLen = Math.floor(frames / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(frames - 1, i0 + 1)
    const t = pos - i0
    out[i] = mono[i0] * (1 - t) + mono[i1] * t
  }
  return out
}

/**
 * 全局共用一个 AudioContext。
 *
 * 浏览器同时最多允许约 6 个 AudioContext。原来每次解码都 new 一个，
 * 而 close() 没 await —— 上下文根本没关掉，跑到第六次就创建失败，
 * 报 "Unable to decode audio data"。这正是"跑了五个之后就不行"的原因。
 */
let sharedCtx: AudioContext | null = null
function getCtx(): AudioContext {
  if (sharedCtx && sharedCtx.state !== 'closed') return sharedCtx
  const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext
  sharedCtx = new Ctx()
  return sharedCtx
}

export async function decodeTo16k(
  file: Blob,
  onProgress?: (msg: string, ratio?: number) => void
): Promise<Float32Array> {
  onProgress?.('读取音频…', 0.02)
  const buf = await file.arrayBuffer()
  await new Promise(r => setTimeout(r, 0))

  // WAV 直接解析，省掉 AudioContext
  const quick = parseWavTo16k(buf)
  if (quick) {
    onProgress?.('读取完成', 0.1)
    return quick
  }

  onProgress?.('解码音频…', 0.06)
  const ctx = getCtx()
  const decoded = await ctx.decodeAudioData(buf.slice(0))
  await new Promise(r => setTimeout(r, 0))

  onProgress?.('重采样到 16kHz…', 0.1)
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000)
  const src = off.createBufferSource()
  src.buffer = decoded
  src.connect(off.destination)
  src.start()
  const rendered = await off.startRendering()
  await new Promise(r => setTimeout(r, 0))
  return rendered.getChannelData(0)
}

/** 让出一帧，让浏览器有机会重绘进度 —— 否则整段计算跑完前页面是死的 */
function yieldToUI(): Promise<void> {
  return new Promise(r => setTimeout(r, 0))
}

async function runModel(
  pcm: Float32Array,
  onProgress?: (msg: string, ratio?: number) => void
): Promise<Float32Array[]> {
  if (!session) throw new Error('模型还没加载')
  const ort = await loadOrt()

  const CHUNK_SEC = 30
  const RATE = 16000
  const chunkLen = CHUNK_SEC * RATE
  const emission: Float32Array[] = []

  const totalChunks = Math.ceil(pcm.length / chunkLen)
  let chunkNo = 0

  for (let off = 0; off < pcm.length; off += chunkLen) {
    chunkNo++
    onProgress?.(`识别第 ${chunkNo}/${totalChunks} 段`, off / pcm.length)
    // 每段开始前让出一次，进度条才会动
    await yieldToUI()
    let end = Math.min(pcm.length, off + chunkLen)
    if (end < pcm.length) {
      const win = RATE / 2
      let best = end
      let bestE = Infinity
      for (let p = Math.max(off + 1, end - win); p < Math.min(pcm.length, end + win); p += 160) {
        let e = 0
        for (let k = p; k < Math.min(pcm.length, p + 160); k++) e += pcm[k] * pcm[k]
        if (e < bestE) { bestE = e; best = p }
      }
      end = best
    }

    const slice = pcm.subarray(off, end)
    const input = new ort.Tensor('float32', slice, [1, slice.length])
    const out = await session.run({ input_values: input })
    const logits = out[Object.keys(out)[0]]
    const [, frames, labels] = logits.dims as number[]
    const data = logits.data as Float32Array

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
      // 帧数很多（半小时音频约九万帧），中间也要让出，不然这一段内部还是会卡住
      if ((t & 2047) === 2047) await yieldToUI()
    }
  }
  return emission
}

/**
 * 分段强制对齐。
 *
 * 不能整篇一次性做 —— trellis 是「帧数 × token 数」的完整矩阵，
 * 半小时音频（9 万帧）配 309 句正文（约 1.8 万字符）是 16 亿个格子、6.2GB，
 * 浏览器直接冻死，鼠标变成禁止符号。torchaudio 教程里的例子只有几秒音频、
 * 几十个字符，差了六个数量级。
 *
 * 做法：先用贪心解码得到「模型听到的词」，跟正文做一次词级 DTW 找出锚点，
 * 再在相邻锚点之间做小规模 CTC 对齐。每段的矩阵只有几百帧 × 几百字符。
 */
export async function alignAudio(
  pcm: Float32Array,
  text: string,
  onProgress?: (msg: string, ratio?: number) => void
): Promise<Segment[]> {
  const emission = await runModel(pcm, onProgress)
  if (!emission.length) return []

  onProgress?.('对齐…', 0.85)
  await yieldToUI()

  // 每段最多这么多帧，超了就切。600 帧 = 12 秒，矩阵规模可控。
  const MAX_FRAMES = 600
  const words = (text.toUpperCase().match(/[A-Z']+/g) || [])
  if (!words.length) return []

  // 贪心解码出每个词的粗略帧位置，作为切段锚点
  const heard: { word: string; frame: number }[] = []
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
      if (cur) heard.push({ word: cur, frame: start })
      cur = ''
      start = -1
      return
    }
    if (start < 0) start = t
    cur += ch
  })
  if (cur && start >= 0) heard.push({ word: cur, frame: start })

  const { alignWordSequences } = await import('./forcedAlign')
  const map = alignWordSequences(words, heard.map(h => h.word))

  // 按锚点把整篇切成若干段，每段控制在 MAX_FRAMES 以内
  const cuts: { wFrom: number; wTo: number; fFrom: number; fTo: number }[] = []
  let wFrom = 0
  let fFrom = 0
  for (let i = 0; i < words.length; i++) {
    const j2 = map[i]
    const f = j2 >= 0 ? heard[j2].frame : -1
    if (f < 0) continue
    if (f - fFrom >= MAX_FRAMES && i > wFrom) {
      cuts.push({ wFrom, wTo: i, fFrom, fTo: f })
      wFrom = i
      fFrom = f
    }
  }
  cuts.push({ wFrom, wTo: words.length, fFrom, fTo: emission.length })

  const out: Segment[] = []
  for (let c = 0; c < cuts.length; c++) {
    const seg = cuts[c]
    onProgress?.(`对齐 ${c + 1}/${cuts.length} 段`, 0.85 + (c / cuts.length) * 0.15)
    await yieldToUI()

    const segWords = words.slice(seg.wFrom, seg.wTo)
    if (!segWords.length) continue
    const segEmission = emission.slice(seg.fFrom, seg.fTo)
    if (!segEmission.length) continue

    const res = alignWithEmission(segEmission, segWords.join('|'), W2V2_LABELS, W2V2_FRAME_SEC)
    // 段内时间是相对的，加回段起点
    const base = seg.fFrom * W2V2_FRAME_SEC
    for (const w of res) out.push({ ...w, start: w.start + base, end: w.end + base })
  }

  return out
}

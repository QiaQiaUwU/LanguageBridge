/**
 * 对轴任务池。
 *
 * 原来是单任务：一个全局 worker、一份全局状态，第二篇想跑就被挡回去。
 * 现在按文章 id 分开管理，可以同时跑几篇。
 *
 * 但**不是想跑多少就跑多少**：识别是 CPU 密集的 WASM 计算，
 * 同时跑太多只会互相抢核心和内存，总时间反而更长，而且每个 worker
 * 都要装一份模型。所以设并发上限，超出的排队，前面跑完自动接上。
 */
import { reactive } from 'vue'
import { startTask, updateTask, endTask, finishTask, failTask, tickTask } from './taskCenter'

export interface AlignJobState {
  articleId: string
  title: string
  running: boolean
  msg: string
  ratio: number
  error: string
  /** 完成后的结果，页面取走一次就清掉 */
  result: { word: string; start: number; end: number }[] | null
}

/** 所有对轴任务，按文章 id 索引 */
export const alignJobs = reactive<Record<string, AlignJobState>>({})

/**
 * 同时最多跑几个。
 * 2 是折中：只跑一个的话长音频排队太久；三个以上在普通笔记本上会明显卡顿，
 * 内存也吃不消。
 */
/**
 * 同时最多跑几个 —— 可以自己调。
 *
 * 每个 worker 都要加载一份 wav2vec2 模型并跑 WASM 推理，很吃内存和 CPU。
 * 默认 1 是保守值（之前设 2 有人直接卡到重启），但机器好的话完全可以调高：
 * 设置页有个滑块，也可以在控制台跑
 *   localStorage.setItem('lb-align-concurrency', '3')
 * 改完刷新生效。
 *
 * 判断依据：如果跑起来之后整个界面明显卡顿、风扇狂转，就调回小一点。
 */
function maxConcurrent(): number {
  const v = Number(localStorage.getItem('lb-align-concurrency'))
  if (Number.isFinite(v) && v >= 1 && v <= 4) return Math.floor(v)
  return 1
}

const workers = new Map<string, Worker>()
const queue: { articleId: string; title: string; pcm: Float32Array }[] = []

const MODEL_SOURCES = [
  'https://huggingface.co/Xenova/wav2vec2-base-960h/resolve/main/onnx/model_quantized.onnx',
  'https://huggingface.co/onnx-community/wav2vec2-base-960h-ONNX/resolve/main/onnx/model_quantized.onnx',
  'https://huggingface.co/Xenova/wav2vec2-base-960h/resolve/main/onnx/model.onnx'
]

export function runningCount(): number {
  return workers.size
}

export function queuedCount(): number {
  return queue.length
}

export function cancelAlignJob(articleId: string) {
  const w = workers.get(articleId)
  if (w) {
    w.terminate()
    workers.delete(articleId)
  }
  const qi = queue.findIndex(x => x.articleId === articleId)
  if (qi >= 0) queue.splice(qi, 1)

  const job = alignJobs[articleId]
  if (job) {
    job.running = false
    job.msg = ''
  }
  endTask('align:' + articleId)
  pump()
}

export function cancelAllAlignJobs() {
  queue.length = 0
  for (const id of [...workers.keys()]) cancelAlignJob(id)
}

/** 有空位就启动下一个排队的 */
function pump() {
  while (workers.size < maxConcurrent() && queue.length) {
    const next = queue.shift()!
    spawn(next.articleId, next.title, next.pcm)
  }
  // 队列里剩下的，更新一下"前面还有几个"
  queue.forEach((q, i) => {
    updateTask('align:' + q.articleId, { detail: `排队中（前面还有 ${i + 1} 个）` })
  })
}

function spawn(articleId: string, title: string, pcm: Float32Array) {
  const job = alignJobs[articleId]
  if (!job) return

  job.running = true
  job.msg = '准备…'

  const custom = localStorage.getItem('lb-w2v2-model-url')
  const modelUrls = custom ? [custom] : MODEL_SOURCES

  const w = new Worker('/align-worker.js')
  workers.set(articleId, w)

  startTask({
    id: 'align:' + articleId,
    kind: '对轴',
    subject: title || articleId,
    detail: '准备…',
    cancel: () => cancelAlignJob(articleId)
  })

  /** 只负责收摊，不动任务条 —— 成功/失败各自写自己的结果 */
  const cleanup = () => {
    w.terminate()
    workers.delete(articleId)
    pump()
  }

  w.onmessage = ev => {
    const d = ev.data
    if (d.type === 'progress') {
      job.msg = d.msg
      job.ratio = d.ratio ?? job.ratio
      updateTask('align:' + articleId, { detail: d.msg, ratio: d.ratio })
      // 打个时间戳，超过三分钟没动静任务中心会提示可能卡住了
      tickTask('align:' + articleId)
      return
    }
    if (d.type === 'done') {
      job.result = d.words
      job.running = false
      job.msg = ''
      // 留一条「已完成」等用户点掉，别让后台跑完的东西悄无声息
      finishTask('align:' + articleId, `识别出 ${d.words.length} 个词`)
      cleanup()
      return
    }
    if (d.type === 'error') {
      job.error = d.message
      job.running = false
      job.msg = ''
      failTask('align:' + articleId, d.message)
      cleanup()
    }
  }
  w.onerror = err => {
    const msg = err.message || 'Worker 出错'
    job.error = msg
    job.running = false
    failTask('align:' + articleId, msg)
    cleanup()
  }

  // pcm 用 transfer 交出去，避免复制几十兆
  w.postMessage({ kind: 'align', pcm, modelUrls }, [pcm.buffer])
}

/**
 * 起一个对轴任务。
 * 同一篇已在跑或已在队列里返回 false，其余一律接受（超并发就排队）。
 */
export function startAlignJob(articleId: string, pcm: Float32Array, title = ''): boolean {
  if (workers.has(articleId)) return false
  if (queue.some(x => x.articleId === articleId)) return false

  alignJobs[articleId] = {
    articleId,
    title,
    running: false,
    msg: '排队中…',
    ratio: 0,
    error: '',
    result: null
  }

  if (workers.size < maxConcurrent()) {
    spawn(articleId, title, pcm)
  } else {
    // 排队中也算"这篇有任务在身"，否则界面把它当成没在跑，
    // 停止按钮不出现，用户干等还以为卡死了
    alignJobs[articleId].running = true
    queue.push({ articleId, title, pcm })
    startTask({
      id: 'align:' + articleId,
      kind: '对轴',
      subject: title || articleId,
      detail: `排队中（前面还有 ${queue.length} 个）`,
      cancel: () => cancelAlignJob(articleId)
    })
  }
  return true
}

/**
 * 用 Worker 转写一段录音。
 *
 * 不能在主线程跑 —— 对轴之所以用 Worker 就是因为 wav2vec2 推理会把界面卡死。
 * 上一版我直接在主线程调 transcribeAudio，结果是界面僵住、进度停在
 * 「准备识别」不动（而且主线程的 session 根本没加载过，第一行就抛错）。
 *
 * 这里起一个临时 worker 跑完就关，不占用对轴的并发额度：
 * 录一句话通常只有几秒音频，比整篇对轴轻得多。
 */
/**
 * 用 Whisper 转写录音。
 *
 * 跟对齐用的 wav2vec2 分开：那个模型是为「已知原文、只对时间」选的，
 * 盲听短录音很糙；Whisper 才是为自由听写训练的。
 * 模型只下一次，之后走浏览器缓存。
 */
export function transcribeWithWhisper(
  pcm: Float32Array,
  onProgress?: (msg: string, ratio?: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const modelId = localStorage.getItem('lb-asr-model') || 'Xenova/whisper-tiny.en'
    const w = new Worker('/whisper-worker.js', { type: 'module' })
    const done = (fn: () => void) => { w.terminate(); fn() }

    w.onmessage = ev => {
      const d = ev.data
      if (d.type === 'progress') { onProgress?.(d.msg, d.ratio); return }
      if (d.type === 'done') { done(() => resolve(d.text || '')); return }
      if (d.type === 'error') done(() => reject(new Error(d.message)))
    }
    w.onerror = err => done(() => reject(new Error(err.message || 'Worker 出错')))

    w.postMessage({ pcm, modelId }, [pcm.buffer])
  })
}

/** 旧的 wav2vec2 转写，留着做兜底：Whisper 下不下来时还能用 */
export function transcribeRecording(
  pcm: Float32Array,
  onProgress?: (msg: string, ratio?: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const custom = localStorage.getItem('lb-w2v2-model-url')
    const modelUrls = custom ? [custom] : MODEL_SOURCES
    const w = new Worker('/align-worker.js')

    const done = (fn: () => void) => { w.terminate(); fn() }

    w.onmessage = ev => {
      const d = ev.data
      if (d.type === 'progress') { onProgress?.(d.msg, d.ratio); return }
      if (d.type === 'done') {
        const text = (d.words || []).map((x: any) => x.word).join(' ').trim()
        done(() => resolve(text))
        return
      }
      if (d.type === 'error') done(() => reject(new Error(d.message)))
    }
    w.onerror = err => done(() => reject(new Error(err.message || 'Worker 出错')))

    w.postMessage({ kind: 'transcribe', pcm, modelUrls }, [pcm.buffer])
  })
}

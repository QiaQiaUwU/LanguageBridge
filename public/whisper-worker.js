/**
 * Whisper 转写 Worker。
 *
 * 为什么单独一个 worker、而且用 transformers.js：
 *
 * 现在跟读用的是 wav2vec2-base + 贪心解码 —— 那个模型是为**强制对齐**选的
 * （已知原文，只对时间轴），错几个音不影响对齐结果。拿它盲听几秒短录音就很糙，
 * "Summer arrives all at once" 会出来 "SAMER ON MOUN'S ALL AT ONCE"。
 *
 * Whisper 是 encoder-decoder，要自回归解码 + KV cache。用裸 ONNX Runtime 手写
 * 那套循环几百行、极易出错，而 transformers.js 已经把它封好了，一个 pipeline 调用搞定。
 * 代价是多下一个库（约 300KB）和模型本身（whisper-tiny.en 约 75MB，只下一次）。
 *
 * 对齐那条路不动，仍然用 wav2vec2：它在已知原文的场景下又快又够用。
 */

const TRANSFORMERS_CDN = [
  'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2',
  'https://unpkg.com/@xenova/transformers@2.17.2',
  'https://esm.sh/@xenova/transformers@2.17.2'
]

let pipe = null
let loading = null

function post(type, payload) {
  self.postMessage({ type, ...payload })
}

async function loadLib() {
  const errs = []
  for (const url of TRANSFORMERS_CDN) {
    try {
      const mod = await import(/* @vite-ignore */ url)
      return mod
    } catch (e) {
      errs.push(`${url}: ${e && e.message ? e.message : e}`)
    }
  }
  throw new Error('transformers.js 加载失败（都试过了）：\n' + errs.join('\n'))
}

async function ensurePipe(modelId) {
  if (pipe) return pipe
  if (loading) return loading

  loading = (async () => {
    post('progress', { msg: '加载识别库…', ratio: 0.05 })
    const { pipeline, env } = await loadLib()

    // 只用远端模型，不去找本地文件（这个项目没有把模型打进包里）
    env.allowLocalModels = false
    env.useBrowserCache = true

    post('progress', { msg: '下载识别模型…', ratio: 0.1 })
    pipe = await pipeline('automatic-speech-recognition', modelId, {
      quantized: true,
      progress_callback: p => {
        if (p && p.status === 'progress' && p.total) {
          const r = 0.1 + (p.loaded / p.total) * 0.7
          post('progress', { msg: `下载识别模型 ${Math.round((p.loaded / p.total) * 100)}%`, ratio: r })
        }
      }
    })
    return pipe
  })()

  try {
    return await loading
  } finally {
    loading = null
  }
}

self.onmessage = async e => {
  const { pcm, modelId } = e.data
  try {
    const p = await ensurePipe(modelId || 'Xenova/whisper-tiny.en')
    post('progress', { msg: '识别中…', ratio: 0.85 })

    // transformers.js 的 ASR pipeline 直接吃 16kHz 单声道 Float32
    const out = await p(pcm, { chunk_length_s: 30, stride_length_s: 5 })
    const text = (out && out.text ? out.text : '').trim()

    post('done', { text })
  } catch (err) {
    post('error', { message: err && err.message ? err.message : String(err) })
  }
}

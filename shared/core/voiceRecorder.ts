/**
 * 逐句录音。
 *
 * 现有的跟读只做语音识别打分，说完就没了 —— 听不到自己刚才读成什么样，
 * 也没法跟原声比。这个模块负责把音频真正录下来、存起来、能回放、能连起来听。
 *
 * 跟识别是两条独立的路：识别用 SpeechRecognition，录音用 MediaRecorder，
 * 两者可以同时跑，互不干扰。
 */
import { wordDB } from './database'

export interface RecordingHandle {
  stop: () => Promise<Blob>
  /** 当前音量 0–1 */
  level: () => number
  /** 一排竖条的高度（各 0–1），用来画声波柱 */
  bands: (n?: number) => number[]
  /** 已经安静多久了（毫秒）。说过话之后才开始计 */
  silentFor: () => number
  cancel: () => void
}

/** 浏览器支不支持录音 */
export function recordingSupported(): boolean {
  return !!(navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined')
}

/**
 * 开始录音。
 *
 * 音量用 AnalyserNode 实时算：取频域数据的均值再归一化。
 * 不用时域峰值是因为峰值抖得太厉害，图标会闪得让人眼晕。
 */
export async function startRecording(): Promise<RecordingHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
  const src = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.7   // 平滑一点，图标不会跳得刺眼
  src.connect(analyser)
  const buf = new Uint8Array(analyser.frequencyBinCount)

  const chunks: BlobPart[] = []
  // 挑一个浏览器真的支持的格式，别硬写 webm
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', '']
    .find(m => !m || MediaRecorder.isTypeSupported(m)) || ''
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
  rec.start(100)

  const cleanup = () => {
    stream.getTracks().forEach(t => t.stop())
    ctx.close().catch(() => {})
  }

  /**
   * 静音判定：以**环境底噪**为基准，不是以峰值反推。
   *
   * 前两版都栽在同一件事上：拿峰值的固定比例当门槛。
   * 实测底噪只要占到峰值的 12% 以上（风扇、空调、房间回声很容易到），
   * 静音门槛就永远够不着，录音一直停不下来。
   *
   * 现在开录后先花 400ms 量一段环境底噪，之后：
   *   「在说话」= 明显高于底噪    「静了」= 回落到底噪附近
   * 门槛都相对底噪，所以底噪多高都成立。
   * 标定期内不做任何判断，免得把开头的环境音当成说话。
   */
  const CALIB_MS = 400
  const startedAt = Date.now()
  let floorSum = 0
  let floorN = 0
  let floorLv = 0
  let spoke = false
  let silentSince = 0

  const readLevel = () => {
    analyser.getByteFrequencyData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i]
    const avg = sum / buf.length / 255
    const lv = Math.min(1, avg * 3.2)

    if (Date.now() - startedAt <= CALIB_MS) {
      floorSum += lv
      floorN++
      floorLv = floorSum / floorN
      return lv
    }

    const speakAt = Math.max(floorLv * 2.2, floorLv + 0.04)
    const quietAt = Math.max(floorLv * 1.4, floorLv + 0.012)

    if (lv >= speakAt) { spoke = true; silentSince = 0 }
    else if (spoke && lv < quietAt) { if (!silentSince) silentSince = Date.now() }
    else if (lv >= quietAt) silentSince = 0

    return lv
  }

  return {
    level: readLevel,

    /**
     * 把频谱分成 n 段，各取一段的均值当竖条高度。
     * 低频段能量天然大得多，按段号做一点补偿，不然只有最左边一根在动。
     */
    bands(n = 16) {
      analyser.getByteFrequencyData(buf)
      // 只取前 60% 的频段：人声主要在这儿，高频段基本是静的
      const usable = Math.floor(buf.length * 0.6)
      const per = Math.max(1, Math.floor(usable / n))
      const out: number[] = []
      for (let i = 0; i < n; i++) {
        let sum = 0
        for (let k = i * per; k < (i + 1) * per && k < usable; k++) sum += buf[k]
        const avg = sum / per / 255
        const boost = 1.4 + (i / n) * 2.6
        out.push(Math.min(1, avg * boost))
      }
      return out
    },

    silentFor() {
      return silentSince ? Date.now() - silentSince : 0
    },
    stop() {
      return new Promise<Blob>(resolve => {
        rec.onstop = () => {
          cleanup()
          resolve(new Blob(chunks, { type: mime || 'audio/webm' }))
        }
        if (rec.state !== 'inactive') rec.stop()
        else { cleanup(); resolve(new Blob(chunks)) }
      })
    },
    cancel() {
      try { if (rec.state !== 'inactive') rec.stop() } catch { /* 已经停了 */ }
      cleanup()
    }
  }
}

/* ---------- 存取 ---------- */

/**
 * 存在 handle 表里。
 *
 * 数据库没有单独的 blob 表，但音频文件本来就是用 saveHandle 存的
 * （见 audioAlign 的 saveArticleAudioBlob），沿用同一套，不另建结构。
 */
const key = (articleId: string, idx: number) => `rec:${articleId}:${idx}`

export async function saveRecording(articleId: string, idx: number, blob: Blob) {
  await wordDB.saveHandle(key(articleId, idx), { __blob: blob, name: `rec-${idx}.webm` } as any)
}

export async function loadRecording(articleId: string, idx: number): Promise<Blob | null> {
  try {
    const h = await wordDB.getHandle(key(articleId, idx))
    return (h as any)?.__blob || null
  } catch {
    return null
  }
}

export async function deleteRecording(articleId: string, idx: number) {
  try { await wordDB.deleteHandle(key(articleId, idx)) } catch { /* 没有就算了 */ }
}

/** 这篇文章哪些句子已经录过 */
export async function recordedIndexes(articleId: string, total: number): Promise<number[]> {
  const out: number[] = []
  for (let i = 0; i < total; i++) {
    const b = await loadRecording(articleId, i)
    if (b) out.push(i)
  }
  return out
}

/**
 * 把逐句录音连成一整条。
 *
 * 逐句录的是一段段独立音频，想整篇听一遍就得拼起来。
 * 用 OfflineAudioContext 依次解码再排进一条时间线，句间留一点间隔，
 * 不然听起来会黏在一起。
 */
export async function concatRecordings(
  articleId: string,
  indexes: number[],
  gapSec = 0.25,
  onProgress?: (done: number, total: number) => void
): Promise<Blob | null> {
  if (!indexes.length) return null

  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
  const buffers: AudioBuffer[] = []
  try {
    for (let k = 0; k < indexes.length; k++) {
      const blob = await loadRecording(articleId, indexes[k])
      if (!blob) continue
      buffers.push(await ctx.decodeAudioData(await blob.arrayBuffer()))
      onProgress?.(k + 1, indexes.length)
    }
  } finally {
    ctx.close().catch(() => {})
  }
  if (!buffers.length) return null

  const rate = buffers[0].sampleRate
  const total = buffers.reduce((n, b) => n + b.duration, 0) + gapSec * (buffers.length - 1)
  const off = new OfflineAudioContext(1, Math.ceil(total * rate), rate)

  let at = 0
  for (const b of buffers) {
    const node = off.createBufferSource()
    node.buffer = b
    node.connect(off.destination)
    node.start(at)
    at += b.duration + gapSec
  }

  const rendered = await off.startRendering()
  return new Blob([encodeWav(rendered)], { type: 'audio/wav' })
}

/** AudioBuffer → WAV（16bit 单声道），浏览器不能直接导出编码格式，只能自己写头 */
function encodeWav(buf: AudioBuffer): ArrayBuffer {
  const data = buf.getChannelData(0)
  const out = new ArrayBuffer(44 + data.length * 2)
  const view = new DataView(out)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)) }
  const bytes = data.length * 2

  w(0, 'RIFF'); view.setUint32(4, 36 + bytes, true); w(8, 'WAVE'); w(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, buf.sampleRate, true); view.setUint32(28, buf.sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  w(36, 'data'); view.setUint32(40, bytes, true)

  let o = 44
  for (let i = 0; i < data.length; i++) {
    const c = Math.max(-1, Math.min(1, data[i]))
    view.setInt16(o, c < 0 ? c * 0x8000 : c * 0x7fff, true)
    o += 2
  }
  return out
}

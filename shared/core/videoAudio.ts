/**
 * 从视频里取音轨 —— 纯浏览器实现，不需要本机装 ffmpeg。
 *
 * 原来这一步是把整个视频 POST 给本地服务、调 ffmpeg 抽音轨。问题是绝大多数人
 * 机器上没有 ffmpeg，一点就是「本机没装 ffmpeg」，功能等于不存在；而且一小时
 * 的课几百兆全都要先传一遍。
 *
 * 浏览器本身就能解码视频里的音频轨：decodeAudioData 拿到 PCM，再编码成 WAV。
 * 代价是 WAV 比 MP3 大，所以这里降到 16kHz 单声道 —— 跟读和语音识别都够用
 * （MFA / whisper 要的正是 16kHz 单声道），体积约为原始 44.1kHz 立体声的 1/5.5。
 */

export interface ExtractResult {
  blob: Blob
  fileName: string
  seconds: number
}

/** AudioBuffer → 16 位单声道 WAV */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample)
  const view = new DataView(buffer)

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  const dataSize = samples.length * bytesPerSample
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)          // fmt chunk 长度
  view.setUint16(20, 1, true)           // PCM
  view.setUint16(22, 1, true)           // 单声道
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true)  // byte rate
  view.setUint16(32, bytesPerSample, true)               // block align
  view.setUint16(34, 16, true)          // 位深
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    // 削顶再转 16 位整数
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += bytesPerSample
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

/**
 * @param onProgress 报进度用，参数是 0–1
 */
export async function extractAudioFromVideo(
  file: File,
  onProgress?: (stage: string, ratio: number) => void
): Promise<ExtractResult> {
  onProgress?.('读取文件', 0)
  const raw = await file.arrayBuffer()

  onProgress?.('解码音轨', 0.3)
  // 先用普通 AudioContext 解码（它认得容器里的音频轨）
  const Ctx: typeof AudioContext =
    (window as any).AudioContext || (window as any).webkitAudioContext
  const tmp = new Ctx()
  let decoded: AudioBuffer
  try {
    decoded = await tmp.decodeAudioData(raw.slice(0))
  } catch {
    throw new Error('这个视频里的音频格式浏览器解不了，换 mp4/webm 试试')
  } finally {
    tmp.close().catch(() => {})
  }

  onProgress?.('重采样', 0.6)
  const TARGET_RATE = 16000
  const frames = Math.ceil(decoded.duration * TARGET_RATE)
  const offline = new OfflineAudioContext(1, frames, TARGET_RATE)
  const src = offline.createBufferSource()
  src.buffer = decoded
  src.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()

  onProgress?.('打包', 0.9)
  const blob = encodeWav(rendered.getChannelData(0), TARGET_RATE)
  onProgress?.('完成', 1)

  return {
    blob,
    fileName: file.name.replace(/\.[^.]+$/, '') + '.wav',
    seconds: decoded.duration
  }
}

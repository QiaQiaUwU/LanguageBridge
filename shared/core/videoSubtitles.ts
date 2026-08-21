/**
 * 从视频里取内嵌字幕轨 —— 纯浏览器，不需要 ffmpeg。
 *
 * 我之前说"浏览器读不了内嵌字幕"是错的。mp4box.js 能解析 MP4 容器并把
 * 文本轨取出来，subtitlekit / cutfast 这类在线工具就是这么做的（文件不上传，
 * 全在本地）。MP4 里的文本轨常见三种：tx3g（QuickTime text）、
 * TTXT（3GPP Timed Text）、WebVTT。
 *
 * 取不到的情况有两种，要跟用户说清楚：
 *  - 字幕是烧进画面的（hardcoded），那只能 OCR，不是解容器能解决的
 *  - 这个文件本来就没有字幕轨
 */
import type { Cue } from './subtitles'

const MP4BOX_CDN = 'https://cdn.jsdelivr.net/npm/mp4box@0.5.2/dist/mp4box.all.min.js'

async function loadMp4Box(): Promise<any> {
  if ((window as any).MP4Box) return (window as any).MP4Box
  await new Promise<void>((resolve, reject) => {
    const el = document.createElement('script')
    el.src = MP4BOX_CDN
    el.onload = () => resolve()
    el.onerror = () => reject(new Error('mp4box 加载失败，检查网络'))
    document.head.appendChild(el)
  })
  const M = (window as any).MP4Box
  if (!M) throw new Error('mp4box 加载了但没挂上')
  return M
}

/** tx3g 的 sample：前两字节是文本长度，后面是 UTF-8 文本 */
function decodeTx3g(data: Uint8Array): string {
  if (data.length < 2) return ''
  const len = (data[0] << 8) | data[1]
  if (len <= 0 || 2 + len > data.length) return ''
  return new TextDecoder('utf-8').decode(data.subarray(2, 2 + len))
}

/** WebVTT sample 里是若干 box，payload 在 'payl' 里 */
function decodeVttPayload(data: Uint8Array): string {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let off = 0
  let out = ''
  while (off + 8 <= data.length) {
    const size = dv.getUint32(off)
    const type = String.fromCharCode(data[off + 4], data[off + 5], data[off + 6], data[off + 7])
    if (size < 8 || off + size > data.length) break
    if (type === 'payl') {
      out += new TextDecoder('utf-8').decode(data.subarray(off + 8, off + size))
    }
    off += size
  }
  return out
}

export interface ExtractedTrack {
  id: number
  language: string
  codec: string
  cues: Cue[]
}

/**
 * 读出视频里所有文本字幕轨。
 * 目前支持 MP4 系容器（mp4 / m4v / mov）。
 */
export async function extractEmbeddedSubtitles(
  file: File,
  onProgress?: (msg: string) => void
): Promise<ExtractedTrack[]> {
  onProgress?.('解析容器…')
  const MP4Box = await loadMp4Box()
  const mp4 = MP4Box.createFile()

  const tracks: ExtractedTrack[] = []
  const byId = new Map<number, ExtractedTrack>()

  return new Promise<ExtractedTrack[]>((resolve, reject) => {
    let readyInfo: any = null

    mp4.onError = (e: any) => reject(new Error('解析失败：' + e))

    mp4.onReady = (info: any) => {
      readyInfo = info
      const subs = (info.tracks || []).filter((t: any) =>
        t.type === 'subtitles' || t.type === 'text' ||
        /tx3g|text|wvtt|stpp/i.test(t.codec || '')
      )
      if (!subs.length) {
        resolve([])
        return
      }
      for (const t of subs) {
        const rec: ExtractedTrack = {
          id: t.id,
          language: t.language || 'und',
          codec: t.codec || '',
          cues: []
        }
        byId.set(t.id, rec)
        tracks.push(rec)
        mp4.setExtractionOptions(t.id, null, { nbSamples: 1000 })
      }
      onProgress?.(`找到 ${subs.length} 条字幕轨，正在取出…`)
      mp4.start()
    }

    mp4.onSamples = (id: number, _user: any, samples: any[]) => {
      const rec = byId.get(id)
      if (!rec) return
      const trackInfo = (readyInfo?.tracks || []).find((t: any) => t.id === id)
      const timescale = trackInfo?.timescale || 1000
      for (const s of samples) {
        const bytes = new Uint8Array(s.data)
        const text = /wvtt/i.test(rec.codec) ? decodeVttPayload(bytes) : decodeTx3g(bytes)
        const clean = text.trim()
        if (!clean) continue
        rec.cues.push({
          start: s.cts / timescale,
          end: (s.cts + s.duration) / timescale,
          text: clean
        })
      }
    }

    // mp4box 是流式的，喂完整个文件再 flush
    file.arrayBuffer().then(buf => {
      const ab = buf as ArrayBuffer & { fileStart?: number }
      ab.fileStart = 0
      mp4.appendBuffer(ab)
      mp4.flush()
      // onReady 里没有字幕轨时已经 resolve 过了，这里是有字幕轨的情况
      setTimeout(() => resolve(tracks.filter(t => t.cues.length)), 0)
    }).catch(reject)
  })
}

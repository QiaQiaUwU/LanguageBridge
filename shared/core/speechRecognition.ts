
type SpeechCtor = new () => any

function getCtor(): SpeechCtor | null {
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null
}

export const speechRecognitionSupported = !!getCtor()

export interface Recognizer {
  start(): void
  stop(): void
}

export function createRecognizer(
  onResult: (text: string, isFinal: boolean) => void,
  onEnd?: () => void,
  lang = 'en-US',
  /** 识别失败时的原因，交给调用方决定怎么提示 */
  onError?: (reason: string) => void
): Recognizer | null {
  const Ctor = getCtor()
  if (!Ctor) return null

  const rec = new Ctor()
  rec.lang = lang
  rec.continuous = true
  rec.interimResults = true

  rec.onresult = (event: any) => {
    let finalText = ''
    let interimText = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i]
      if (r.isFinal) finalText += r[0].transcript
      else interimText += r[0].transcript
    }
    if (finalText) onResult(finalText.trim(), true)
    else if (interimText) onResult(interimText.trim(), false)
  }
  rec.onend = () => onEnd?.()
  /**
   * 错误要往外说，不能吞。
   *
   * 原来是 `onerror = () => onEnd?.()`，把原因整个丢掉；start() 又套了个空
   * catch —— 于是识别失败时界面上什么都没有，只表现为"转文字没反应"。
   * 常见原因是录音和识别同时抢麦克风，部分浏览器会直接报 audio-capture。
   */
  rec.onerror = (e: any) => {
    const code = e?.error || 'unknown'
    // no-speech 是正常的（这一段没人说话），不用惊动用户
    if (code !== 'no-speech' && code !== 'aborted') onError?.(code)
    onEnd?.()
  }

  return {
    start: () => {
      try {
        rec.start()
      } catch (e: any) {
        // InvalidStateError 表示上一次还没停干净，重来一次通常就好
        onError?.(e?.name === 'InvalidStateError' ? 'busy' : String(e?.message || e))
      }
    },
    stop: () => {
      try { rec.stop() } catch { /* 已经停了 */ }
    }
  }
}

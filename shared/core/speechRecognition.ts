
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
  lang = 'en-US'
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
  rec.onerror = () => onEnd?.()

  return {
    start: () => {
      try {
        rec.start()
      } catch {
      }
    },
    stop: () => rec.stop()
  }
}

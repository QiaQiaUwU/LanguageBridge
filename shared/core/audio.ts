
let currentAudio: HTMLAudioElement | null = null

export type Accent = 'uk' | 'us'

function currentWordVolume(): number {
  try {
    const raw = localStorage.getItem('lb-study-settings')
    const v = raw ? JSON.parse(raw) : null
    const n = typeof v?.wordSoundVolume === 'number' ? v.wordSoundVolume : 100
    return Math.max(0, Math.min(1, n / 100))
  } catch {
    return 1
  }
}

function currentAccent(): Accent {
  try {
    const raw = localStorage.getItem('lb-study-settings')
    const v = raw ? JSON.parse(raw) : null
    return v?.soundType === 'uk' ? 'uk' : 'us'
  } catch {
    return 'us'
  }
}

function youdaoUrl(text: string, accent: Accent): string {
  const type = accent === 'uk' ? 1 : 2
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=${type}`
}

let preferredVoice = ''
export function setTtsVoice(name: string) { preferredVoice = name || '' }

export function listTtsVoices(onReady?: (v: SpeechSynthesisVoice[]) => void): SpeechSynthesisVoice[] {
  if (!window.speechSynthesis) return []
  const pick = () => window.speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang))
  const now = pick()
  if (!now.length && onReady) {
    window.speechSynthesis.addEventListener('voiceschanged', () => onReady(pick()), { once: true })
  }
  return now
}

function speakTTS(text: string, rate = 0.95, volume = 1): Promise<void> {
  return new Promise(resolve => {
    if (!window.speechSynthesis) return resolve()
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-US'
    u.rate = rate
    u.volume = Math.max(0, Math.min(1, volume))
    if (preferredVoice) {
      const hit = window.speechSynthesis.getVoices().find(v => v.name === preferredVoice)
      if (hit) u.voice = hit
    }
    u.onend = () => resolve()
    u.onerror = () => resolve()
    window.speechSynthesis.speak(u)
  })
}

export function playWord(word: string, accent?: Accent, rate = 0.95, volume?: number): Promise<void> {
  const acc: Accent = accent || currentAccent()
  const vol = volume ?? currentWordVolume()
  stopAll()
  return new Promise(resolve => {
    const audio = new Audio(youdaoUrl(word, acc))
    audio.volume = vol
    currentAudio = audio
    let settled = false
    const done = () => {
      if (!settled) {
        settled = true
        resolve()
      }
    }
    audio.onended = done
    audio.onerror = () => {
      if (!settled) {
        settled = true
        speakTTS(word, rate, vol).then(resolve)
      }
    }
    audio.play().catch(() => {
      if (!settled) {
        settled = true
        speakTTS(word, rate, vol).then(resolve)
      }
    })
  })
}

export function playSentence(sentence: string, rate = 0.92, volume = 1): Promise<void> {
  stopAll()
  return speakTTS(sentence, rate, volume)
}

export function stopAll() {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio = null
  }
  window.speechSynthesis?.cancel()
}

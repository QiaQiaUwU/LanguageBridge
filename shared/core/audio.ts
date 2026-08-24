
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

/**
 * 发音缓存。
 *
 * 原来每次发音都 `new Audio(有道URL)` —— 每一次都是一趟网络请求。
 * 同一个词在一轮练习里要读好几遍（进入时、按提示键、打错时、打完时），
 * 每遍都要等网络，就成了"按下去过一会儿才响"。网络稍慢或者被限流时更明显。
 *
 * 拿到一次就把音频数据留在内存里，之后直接放 blob，零延迟。
 * 上限 300 条，够一轮练习用；超了按插入顺序丢最早的，不会无限涨。
 */
const wordAudioCache = new Map<string, string>()
const WORD_CACHE_MAX = 300

function cacheKey(word: string, acc: Accent) {
  return acc + ':' + word.toLowerCase()
}

async function cachedWordUrl(word: string, acc: Accent): Promise<string> {
  const key = cacheKey(word, acc)
  const hit = wordAudioCache.get(key)
  if (hit) return hit
  const remote = youdaoUrl(word, acc)
  try {
    const res = await fetch(remote)
    if (!res.ok) return remote
    const url = URL.createObjectURL(await res.blob())
    if (wordAudioCache.size >= WORD_CACHE_MAX) {
      const oldest = wordAudioCache.keys().next().value
      if (oldest) {
        const old = wordAudioCache.get(oldest)
        if (old) URL.revokeObjectURL(old)
        wordAudioCache.delete(oldest)
      }
    }
    wordAudioCache.set(key, url)
    return url
  } catch {
    // 取不到就还用远程地址，行为跟以前一样
    return remote
  }
}

/**
 * 预取一个词的发音，不播。
 * 练习页可以在显示下一个词之前先调一下，轮到它时就是本地的了。
 */
export function prefetchWord(word: string, accent?: Accent): void {
  if (!word) return
  void cachedWordUrl(word, accent || currentAccent())
}

export async function playWord(word: string, accent?: Accent, rate = 0.95, volume?: number): Promise<void> {
  const acc: Accent = accent || currentAccent()
  const vol = volume ?? currentWordVolume()
  const src = await cachedWordUrl(word, acc)
  stopAll()
  return new Promise(resolve => {
    const audio = new Audio(src)
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

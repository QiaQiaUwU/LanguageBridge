/**
 * 键盘音。
 *
 * 移植自 typing-word（GPL-3.0）：
 *   packages/core/src/hooks/sound.ts  →  useSound / usePlayKeyboardAudio / getAudioFileUrl
 *   packages/core/src/config/env.ts   →  SoundFileOptions
 *
 * 关键点照抄它的：**同一个音频建多份 Audio 实例轮流播**。只用一个实例的话，
 * 快速打字时上一声还没放完就被 play() 打断，听起来是断续的咔哒；多份轮流用
 * 才能叠着响。单文件音色建 4 份，多文件音色（机械键盘有 4 个采样）各建 1 份。
 *
 * 音频文件不在 typing-word 仓库里，托管在它的资源站上。这里默认外链，
 * 首次成功后把音频存进 localStorage 之外的内存缓存；拉不到就退回本地合成音，
 * 不影响使用。
 */

export const TW_SOUND_BASE = 'https://files.typewords.cc/'

export const SOUND_FILE_OPTIONS = [
  { value: '机械键盘', label: '机械键盘' },
  { value: '机械键盘1', label: '机械键盘1' },
  { value: '机械键盘2', label: '机械键盘2' },
  { value: '老式机械键盘', label: '老式机械键盘' },
  { value: '笔记本键盘', label: '笔记本键盘' }
]

/** 原样移植 getAudioFileUrl */
export function getAudioFileUrl(name: string): string[] {
  if (name === '机械键盘') {
    return [
      '/sound/key-sounds/jixie/机械0.mp3',
      '/sound/key-sounds/jixie/机械1.mp3',
      '/sound/key-sounds/jixie/机械2.mp3',
      '/sound/key-sounds/jixie/机械3.mp3'
    ]
  }
  return [`/sound/key-sounds/${name}.mp3`]
}

let pool: HTMLAudioElement[] = []
let poolLength = 1
let cursor = 0
let loadedName = ''
let loadFailed = false

/**
 * 解码好的按键音，用 WebAudio 播。
 *
 * `<audio>` 元素那条路有个绕不过去的延迟：文件是外链（TW_SOUND_BASE 是个
 * 在线资源站），`a.play()` 在数据还没到齐时会等，快速打字时就成了"声音跟不上手"。
 * 而且 `currentTime = 0` 重置本身在某些浏览器上也要一帧。
 *
 * 改成开头 fetch 一次、decodeAudioData 解成 AudioBuffer 留在内存里，
 * 之后每次按键只是 createBufferSource().start() —— 这是同步调用，没有等待。
 * 拉不到就退回下面的合成音，跟以前一样。
 */
let buffers: AudioBuffer[] = []

/** 对应它的 setAudio：同一音色建多份实例 */
export function setKeySound(name: string): void {
  if (loadedName === name) return
  const known = SOUND_FILE_OPTIONS.some(o => o.value === name)
  const use = known ? name : '机械键盘2'
  const urls = getAudioFileUrl(use)
  poolLength = urls.length === 1 ? 4 : 1
  pool = []
  buffers = []
  for (let i = 0; i < poolLength; i++) {
    for (const src of urls) {
      const a = new Audio(TW_SOUND_BASE.replace(/\/$/, '') + src)
      a.preload = 'auto'
      a.addEventListener('error', () => { loadFailed = true }, { once: true })
      pool.push(a)
    }
  }
  cursor = 0
  loadedName = name
  loadFailed = false
  void decodeAll(urls)
}

/** 把这套音色抓下来解码。失败就算了，playKeySound 会退回 <audio> 或合成音 */
async function decodeAll(urls: string[]): Promise<void> {
  try {
    const ctx = (audioCtx = audioCtx || new AudioContext())
    const decoded: AudioBuffer[] = []
    for (const src of urls) {
      const res = await fetch(TW_SOUND_BASE.replace(/\/$/, '') + src)
      if (!res.ok) return
      decoded.push(await ctx.decodeAudioData(await res.arrayBuffer()))
    }
    buffers = decoded
  } catch {
    /* 解不了就不用它 */
  }
}

/** 拉不到音频时的兜底：合成一声键帽响 */
let audioCtx: AudioContext | null = null
function synthClick(gain: number) {
  try {
    audioCtx = audioCtx || new AudioContext()
    const ctx = audioCtx
    const dur = 0.035
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < ch.length; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 6)
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1900 + (Math.random() - 0.5) * 500
    bp.Q.value = 1.1
    const g = ctx.createGain()
    g.gain.value = Math.max(0, Math.min(1, gain))
    src.connect(bp).connect(g).connect(ctx.destination)
    src.start()
  } catch {
    /* 没有音频设备时静默 */
  }
}

/** 对应它的 play：按下标轮流取一个实例播 */
export function playKeySound(volume = 100): void {
  const vol = Math.max(0, Math.min(1, volume / 100))

  // 解码好了就走这条：同步起播，没有网络也没有 currentTime 重置的开销
  if (buffers.length && audioCtx) {
    try {
      cursor++
      const buf = buffers[cursor % buffers.length]
      const src = audioCtx.createBufferSource()
      src.buffer = buf
      const g = audioCtx.createGain()
      g.gain.value = vol
      src.connect(g).connect(audioCtx.destination)
      src.start()
      return
    } catch {
      /* 掉到下面两条兜底 */
    }
  }

  if (loadFailed || !pool.length) {
    synthClick(0.22 * vol)
    return
  }
  cursor++
  const a = pool[cursor % pool.length]
  if (!a) return
  try {
    a.volume = Math.max(0, Math.min(1, volume / 100))
    a.currentTime = 0
    const p = a.play()
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // 浏览器还没拿到用户手势、或者文件 404，都退回合成音
        loadFailed = true
        synthClick(0.22 * Math.max(0, Math.min(1, volume / 100)))
      })
    }
  } catch {
    loadFailed = true
  }
}

/** 当前是不是在用合成音（界面上提示用） */
export function isUsingSynthSound(): boolean {
  return loadFailed || !pool.length
}

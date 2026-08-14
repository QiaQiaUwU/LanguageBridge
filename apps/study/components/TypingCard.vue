<template>
  <div class="typing-card">
    <div class="meta-line top">
      <span v-if="word.phonetic" class="phonetic">/ {{ word.phonetic.replace(/^\/|\/$/g, '') }} /</span>
    </div>

    <p v-if="sentenceIdx >= 0" class="sentence-tip">
      跟打例句 {{ sentenceIdx + 1 }} / {{ sentences.length }}
    </p>
    <div class="word-line" :class="{ 'is-wrong': !!wrong, 'is-sentence': sentenceIdx >= 0, 'all-right': isRight }" :style="{ fontSize: (sentenceIdx >= 0 ? Math.round(settings.fontSize.wordForeign * 0.55) : settings.fontSize.wordForeign) + 'px' }">
      <template v-for="(seg, i) in letterRuns" :key="i">
        <span v-if="seg.type === 'complete'">{{ seg.val }}</span>
        <span v-else-if="seg.type === 'right'" class="input-right">{{ seg.val }}</span>
        <span v-else-if="seg.type === 'wrong'" class="input-wrong">{{ seg.val }}</span>
        <span v-else class="word-end" :class="{ hide: !revealRest }">{{ revealRest ? seg.val : '_'.repeat(seg.val.length) }}</span>
      </template>
    </div>

    <div class="icon-row">
      <button class="speak-btn" title="播放发音（Ctrl+P）" @click="speak">
        <svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>
      </button>
    </div>

    <div class="meaning" :style="{ fontSize: settings.fontSize.wordTranslate + 'px', opacity: showMeaning ? 1 : 0 }">
      <div v-for="(g, i) in posGroups" :key="i" class="pos-row">
        <span class="pos">{{ g.pos }}</span>
        <span class="pos-text">{{ g.text }}</span>
      </div>
      <div v-if="!posGroups.length" class="pos-row"><span class="pos-text">（暂无释义）</span></div>
    </div>

    <div v-if="choiceOn" class="choice-grid">
      <button
        v-for="(c, i) in choices"
        :key="i"
        class="choice-btn"
        :class="{ picked: choicePicked === i, right: choicePicked !== null && c.right, wrong: choicePicked === i && !c.right }"
        @click="pickChoice(i)"
      ><kbd>{{ i + 1 }}</kbd> {{ c.text }}</button>
    </div>
    <div v-else-if="type === 'identify'" class="identify-row">
      <button class="idt-btn know" @click="onIdentify('know')">认识 <kbd>1</kbd></button>
      <button class="idt-btn unknown" @click="onIdentify('unknown')">不认识 <kbd>2</kbd></button>
      <button class="idt-btn mastered" @click="onIdentify('mastered')">已掌握 <kbd>3</kbd></button>
    </div>

    <ul v-if="sentences.length && type !== 'identify' && revealRest" class="sent-list">
      <li v-for="(se, i) in sentences.slice(0, 3)" :key="i" class="sent-item" @click="speakSentence(i)">
        <kbd>{{ i + 1 }}</kbd><span class="sent-text">{{ se }}</span>
      </li>
    </ul>

    <div v-if="settings.showEtymologyAndRelWords && revealRest" class="ety-row">
      <span v-if="morphemeText" class="ety-item">{{ morphemeText }}</span>
      <span v-if="relWords.length" class="ety-item">相关：{{ relWords.join('、') }}</span>
    </div>

    <div v-if="settings.showNearWord && showNear && prevWord" class="prev-corner">
      <span class="pc-arrow">←</span>
      <span class="pc-word">{{ prevWord }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import type { WordItem } from '@/shared/types/WordItem'
import type { PracticeType } from '@/shared/core/studySettings'
import { getStudySettings } from '@/shared/core/studySettings'
import { playWord, playSentence } from '@/shared/core/audio'
import { isSpellingCorrect } from '@/shared/core/spellJudge'
import { typeStep, clearAfterWrong } from '@/shared/core/typeStep'

const props = defineProps<{
  prevWord?: string
  nextWord?: string
  word: WordItem
  type: PracticeType
  pool?: WordItem[]
  showTranslate?: boolean
  hideWord?: boolean
}>()

const emit = defineEmits<{
  (e: 'complete'): void
  (e: 'wrong'): void
  (e: 'know'): void
  (e: 'mastered'): void
}>()

const settings = getStudySettings()

const input = ref('')      // 已经打对的部分
const wrong = ref('')      // 当前打错的那一个字符（500ms 后自动清）
const revealed = ref(false) // 是否已经把答案亮出来了
let inputLock = false      // 打完之后锁住，防止连击重复触发跳词
let waitClear = false      // 错字清除的等待窗口，期间忽略输入
let jumpTimer: ReturnType<typeof setTimeout> | null = null
function clearJumpTimer() {
  if (!jumpTimer) return
  clearTimeout(jumpTimer)
  jumpTimer = null
}

let clearTimer: ReturnType<typeof setTimeout> | null = null
function cancelWrongClear() {
  if (!clearTimer) return
  clearTimeout(clearTimer)
  clearTimer = null
}
let wordCompletedAt = 0    // 打完的时刻，用来做空格冷却
let repeatDone = 0         // 这个词在本次已经打对几遍（repeatCount 用）

const sentences = computed<string[]>(() =>
  (props.word.example_sentences || []).map(e => String(e.en || '').trim()).filter(Boolean)
)

const showNear = computed(() => props.type !== 'dictation' && props.type !== 'listen')

const sentenceIdx = ref(-1)
const practiceSentenceOn = computed(() =>
  settings.practiceSentence && props.type === 'followWrite' && sentences.value.length > 0
)

const target = computed(() => (
  sentenceIdx.value >= 0
    ? (sentences.value[sentenceIdx.value] || props.word.word)
    : props.word.word
))
const restText = computed(() => target.value.slice(input.value.length + wrong.value.length))

const letterRuns = computed<Array<{ type: 'complete' | 'right' | 'wrong' | 'end'; val: string }>>(() => {
  const word = target.value
  const typed = input.value + wrong.value
  const eq = (a: string, b: string) =>
    settings.ignoreCase ? a?.toLowerCase() === b?.toLowerCase() : a === b

  if (!typed.length) return [{ type: 'end', val: word }]
  if (typed.length === word.length && eq(typed, word)) return [{ type: 'complete', val: typed }]

  const out: Array<{ type: 'complete' | 'right' | 'wrong' | 'end'; val: string }> = []
  typed.split('').forEach((ch, i) => {
    const kind: 'right' | 'wrong' = eq(ch, word[i]) ? 'right' : 'wrong'
    const last = out[out.length - 1]
    if (last && last.type === kind) last.val += ch
    else out.push({ type: kind, val: ch })
  })
  if (typed.length < word.length) out.push({ type: 'end', val: word.slice(typed.length) })
  return out
})

const meaningText = computed(() => props.word.meanings?.[0]?.chinese || '')

/** 按词性分组，一行一个词性 —— 照 TranslationList.vue 的 posList 结构。
 *  我们原来把所有释义拼成一行，词性多的词（cancel 有 v./n.）挤成一坨。 */
const posGroups = computed(() => {
  const out: Array<{ pos: string; text: string }> = []
  for (const m of props.word.meanings || []) {
    if (!m.chinese) continue
    const pos = (m.partOfSpeech || '').trim()
    const hit = out.find(x => x.pos === pos)
    if (hit) hit.text += '；' + m.chinese
    else out.push({ pos, text: m.chinese })
  }
  return out
})

const morphemeText = computed(() => {
  const m = props.word.morphemes
  if (!m) return ''
  const parts: string[] = []
  const push = (label: string, x: any) => {
    if (x?.form) parts.push(`${label} ${x.form}${x.meaning ? '（' + x.meaning + '）' : ''}`)
  }
  push('前缀', m.prefix)
  push('词根', m.root)
  push('后缀', m.suffix)
  return parts.join('  ·  ')
})

const relWords = computed(() => {
  const out: string[] = []
  const seen = new Set([props.word.word.toLowerCase()])
  const push = (x: any) => {
    const v = String(x ?? '').trim()
    if (!v || seen.has(v.toLowerCase())) return
    seen.add(v.toLowerCase())
    out.push(v)
  }
  for (const f of props.word.word_family || []) push(f)
  for (const sy of props.word.synonyms || []) push(sy.word)
  for (const an of props.word.antonyms || []) push(an.word)
  return out.slice(0, 6)
})

const choiceOn = computed(() =>
  props.type === 'identify' && settings.identifyMethod === 'choice' && choices.value.length >= 2
)
const choicePicked = ref<number | null>(null)

const choices = computed<{ text: string; right: boolean }[]>(() => {
  if (props.type !== 'identify' || settings.identifyMethod !== 'choice') return []
  const right = meaningText.value
  if (!right) return []
  const pool = (props.pool || []).filter(w =>
    w.word !== props.word.word && w.meanings?.[0]?.chinese
  )
  let seed = 0
  for (let i = 0; i < props.word.word.length; i++) seed = (seed * 31 + props.word.word.charCodeAt(i)) >>> 0
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const picked: string[] = []
  const used = new Set([right])
  for (let guard = 0; guard < 60 && picked.length < 3 && pool.length; guard++) {
    const cand = pool[Math.floor(rnd() * pool.length)].meanings![0].chinese!
    if (used.has(cand)) continue
    used.add(cand)
    picked.push(cand)
  }
  const all = [{ text: right, right: true }, ...picked.map(t => ({ text: t, right: false }))]
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[all[i], all[j]] = [all[j], all[i]]
  }
  return all
})

function pickChoice(i: number) {
  if (choicePicked.value !== null) return
  choicePicked.value = i
  const ok = choices.value[i]?.right
  if (ok) playCorrect(); else playError()
  setTimeout(() => {
    onIdentify(ok ? 'know' : 'unknown')
    choicePicked.value = null
  }, ok ? 420 : 900)
}

const showMeaning = computed(() => {
  if (props.type === 'identify') return true
  if (props.type === 'dictation' || props.type === 'listen') return props.type === 'dictation'
  return props.showTranslate ?? settings.showTranslate
})

const revealRest = computed(() => {
  if (props.hideWord && !revealed.value) return false
  if (props.type === 'followWrite') return true
  return revealed.value
})

function speakSentence(index: number) {
  const text = sentences.value[index]
  if (!text) return
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-US'
    u.rate = settings.sentenceSoundSpeed
    u.volume = Math.max(0, Math.min(1, settings.sentenceSoundVolume / 100))
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  } catch {
  }
}

function isSubmitKey(e: KeyboardEvent): boolean {
  if (e.key === 'Enter') return true
  if (e.code !== 'Space') return false
  return input.value.length >= target.value.length || !target.value.includes(' ')
}


function speak() {
  playWord(props.word.word, 'us', settings.wordSoundSpeed)
}

let audioCtx: AudioContext | null = null
const KEY_TONES: Record<string, { type: OscillatorType; freq: number; ms: number }> = {
  mechanical: { type: 'square', freq: 1500, ms: 16 },
  membrane: { type: 'sine', freq: 700, ms: 26 },
  typewriter: { type: 'triangle', freq: 320, ms: 34 },
  none: { type: 'sine', freq: 0, ms: 0 }
}

function beep(freq: number, ms: number, gain = 0.06, type: OscillatorType = 'sine') {
  if (!freq || !ms) return
  try {
    audioCtx = audioCtx || new AudioContext()
    const osc = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    osc.type = type
    osc.frequency.value = freq
    g.gain.setValueAtTime(Math.max(0, Math.min(1, gain)), audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000)
    osc.connect(g).connect(audioCtx.destination)
    osc.start()
    osc.stop(audioCtx.currentTime + ms / 1000)
  } catch {
  }
}
const vol = (v: number | undefined) => Math.max(0, Math.min(1, (v ?? 100) / 100))
/**
 * 键盘声。
 *
 * 原来是一个 1500Hz 的方波，尖、单调、像电子表报时。真实键帽声是一段极短的
 * 宽带噪声（撞击）+ 快速衰减，所以这里用一小段白噪声过带通滤波来合成，
 * 每次按键把中心频率随机抖动一点，连打时不会像节拍器。
 *
 * TypeWords 用的是几十个录好的 wav（keyboardSoundFile），从它的 CDN 拉，
 * 仓库里没有这些音频文件，拿不到就只能合成一个接近的。
 */
function keyClick(gain: number) {
  try {
    audioCtx = audioCtx || new AudioContext()
    const ctx = audioCtx
    const dur = 0.035
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < ch.length; i++) {
      // 指数衰减的白噪声：起音脆，尾巴短
      ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 6)
    }
    const src = ctx.createBufferSource()
    src.buffer = buf

    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1900 + (Math.random() - 0.5) * 500
    bp.Q.value = 1.1

    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 5200

    const g = ctx.createGain()
    g.gain.value = Math.max(0, Math.min(1, gain))

    src.connect(bp).connect(lp).connect(g).connect(ctx.destination)
    src.start()
  } catch {
  }
}

const playKey = () => {
  if (!settings.keyboardSound) return
  keyClick(0.22 * vol(settings.keyboardSoundVolume))
}
const playCorrect = () => settings.effectSound && beep(880, 90, 0.06 * vol(settings.effectSoundVolume))
const playError = () => settings.effectSound && beep(220, 140, 0.08 * vol(settings.effectSoundVolume))

function reset() {
  clearJumpTimer()
  cancelWrongClear()
  input.value = ''
  wrong.value = ''
  revealed.value = false
  inputLock = false
  waitClear = false
  wordCompletedAt = 0
  repeatDone = 0
  sentenceIdx.value = -1
  if (settings.wordSound && props.type !== 'dictation') {
    playWord(props.word.word, 'us', settings.wordSoundSpeed)
      .then(() => {
        if (!settings.autoPlayFirstSentence) return
        if (props.type === 'dictation' || props.type === 'listen') return
        const first = sentences.value[0]
        if (first) playSentence(first, settings.sentenceSoundSpeed, vol(settings.sentenceSoundVolume))
      })
      .catch(() => { /* 发音失败不影响练习 */ })
  }
}

watch(() => props.word.id, reset)
watch(() => props.type, reset)

function norm(x: string): string {
  let v = x
  if (settings.ignoreSymbol) v = v.replace(/[^\p{L}\p{N}\s]/gu, '')
  if (settings.ignoreCase) v = v.toLowerCase()
  return v
}

const isRight = computed(() => {
  if (norm(input.value) === norm(target.value)) return true
  if (input.value.length < target.value.length) return false
  return isSpellingCorrect(input.value, target.value, {
    ignoreCase: settings.ignoreCase,
    ignoreSymbol: settings.ignoreSymbol,
    allowVariant: settings.allowSpellVariant
  })
})

function finish(delay: boolean) {
  if (practiceSentenceOn.value) {
    const next = sentenceIdx.value + 1
    if (next < sentences.value.length) {
      sentenceIdx.value = next
      input.value = ''
      wrong.value = ''
      revealed.value = false
      inputLock = false
      return
    }
    sentenceIdx.value = -1
  }
  const wantRepeat = settings.repeatCount === 0 ? settings.repeatCustomCount : settings.repeatCount
  if (props.type === 'followWrite' && wantRepeat > repeatDone + 1) {
    clearJumpTimer()
    jumpTimer = setTimeout(() => {
      jumpTimer = null
      repeatDone++
      input.value = ''
      wrong.value = ''
      revealed.value = false
      inputLock = false
      if (settings.wordSound) playWord(props.word.word, 'us', settings.wordSoundSpeed)
    }, settings.waitTimeForChangeWord)
    return
  }
  clearJumpTimer()
  if (delay) {
    jumpTimer = setTimeout(() => { jumpTimer = null; emit('complete') }, settings.waitTimeForChangeWord)
  } else {
    emit('complete')
  }
}

function onKeydown(e: KeyboardEvent) {
  if (choiceOn.value && /^[1-9]$/.test(e.key)) {
    const i = Number(e.key) - 1
    if (i < choices.value.length) { e.preventDefault(); pickChoice(i); return }
  }
  /**
   * 快捷键匹配必须带修饰键判断。
   *
   * 裸字母做快捷键会把正常输入吃掉：replaySound 曾经是 'KeyR'，于是 easter
   * 的最后一个 r 一按就走了「重播发音」分支 return 掉，永远打不进去。
   * TypeWords 的快捷键全都带 Ctrl/Alt/Shift 或者是 Escape/Tab/` 这类非字母键，
   * 就是为了避开这个。这里照它的规则：没有修饰键的纯字母一律不当快捷键。
   */
  const hitShortcut = (combo: string) => {
    if (!combo) return false
    const parts = combo.split('+')
    const key = parts.pop() as string
    const needCtrl = parts.includes('Ctrl')
    const needAlt = parts.includes('Alt')
    const needShift = parts.includes('Shift')
    if (e.code !== key) return false
    if (needCtrl !== (e.ctrlKey || e.metaKey)) return false
    if (needAlt !== e.altKey) return false
    if (needShift !== e.shiftKey) return false
    // 没有任何修饰键的字母/数字键不认作快捷键，否则会吃掉正常输入
    if (!needCtrl && !needAlt && !needShift && /^(Key[A-Z]|Digit[0-9])$/.test(key)) return false
    return true
  }

  const km = settings.shortcutKeyMap
  if (props.type !== 'identify' && hitShortcut(km.showTip)) {
    e.preventDefault()
    if (!settings.allowWordTip || revealed.value) return
    revealed.value = true
    emit('wrong')
    return
  }
  if (hitShortcut(km.replaySound)) { e.preventDefault(); speak(); return }
  if (hitShortcut(km.skipWord)) {
    e.preventDefault()
    emit('wrong')
    emit('complete')
    return
  }

  // 数字键读例句：只在目标词本身不含这个数字时才抢，否则同样会吃掉输入
  if (props.type !== 'identify' && !e.ctrlKey && !e.altKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
    const idx = Number(e.key) - 1
    if (idx < sentences.value.length && !/\d/.test(target.value)) {
      e.preventDefault()
      speakSentence(idx)
      return
    }
  }
  if ((e.ctrlKey || e.metaKey) && ['KeyC', 'KeyA', 'KeyD', 'KeyV'].includes(e.code)) return

  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyP') {
    e.preventDefault()
    speak()
    return
  }

  if (props.type === 'identify') {
    if (['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
      e.preventDefault()
      onIdentify(e.code === 'Digit1' ? 'know' : e.code === 'Digit2' ? 'unknown' : 'mastered')
    }
    return
  }

  if (e.key === 'Backspace') {
    e.preventDefault()
    del()
    return
  }

  if (waitClear) return


  if (e.key === 'Enter' && props.type !== 'dictation') {
    e.preventDefault()
    return
  }

  const letter = e.key
  if (letter.length !== 1) return
  e.preventDefault()

  if (props.type === 'dictation') {
    if (isSubmitKey(e)) {
      if (!input.value.length) return
      inputLock = true
      revealed.value = true
      if (isRight.value) {
        playCorrect()
        wordCompletedAt = Date.now()
        finish(settings.autoNextWord)
      } else {
        playError()
        emit('wrong')
        if (settings.wordSound) playWord(props.word.word, 'us', settings.wordSoundSpeed)
      }
      return
    }
    input.value += letter
    wrong.value = ''
    playKey()
    return
  }

  const step = typeStep(
    { input: input.value, wrong: wrong.value, inputLock, waitClear },
    { key: e.key, code: e.code, shiftKey: e.shiftKey },
    target.value,
    { ignoreCase: settings.ignoreCase, inputWrongClear: settings.inputWrongClear !== false }
  )
  if (step.kind === 'ignored') return

  input.value = step.state.input
  wrong.value = step.state.wrong
  inputLock = step.state.inputLock

  if (step.kind === 'wrong') {
    playError()
    emit('wrong')
    if (settings.wordSound && props.type !== 'dictation') {
      playWord(props.word.word, 'us', settings.wordSoundSpeed)
    }
    waitClear = true
    cancelWrongClear()
    clearTimer = setTimeout(() => {
      clearTimer = null
      const c = clearAfterWrong(
        { input: input.value, wrong: wrong.value, inputLock, waitClear },
        { ignoreCase: settings.ignoreCase, inputWrongClear: settings.inputWrongClear !== false }
      )
      input.value = c.input
      wrong.value = c.wrong
      inputLock = c.inputLock
      waitClear = false
    }, 500)
    return
  }

  playKey()
  if (step.kind === 'complete') {
    wordCompletedAt = Date.now()
    playCorrect()
    revealed.value = true
    finish(true)
  }

}

function del() {
  inputLock = false
  playKey()
  if (revealed.value) {
    input.value = ''
    revealed.value = false
    if (props.type === 'identify') {
      emit('wrong')
      if (settings.wordSound) playWord(props.word.word, 'us', settings.wordSoundSpeed)
    }
    return
  }
  if (wrong.value) wrong.value = ''
  else input.value = input.value.slice(0, -1)
}

function onIdentify(kind: 'know' | 'unknown' | 'mastered') {
  if (kind === 'mastered') {
    emit('mastered')
    return
  }
  if (kind === 'unknown') {
    if (!revealed.value) {
      revealed.value = true
      emit('wrong')
      if (settings.wordSound) playWord(props.word.word, 'us', settings.wordSoundSpeed)
      return
    }
  }
  if (kind === 'know') emit('know')
  emit('complete')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  nextTick(reset)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  clearJumpTimer()
  cancelWrongClear()
})
</script>

<style scoped lang="scss">
.typing-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 40px 20px;
  text-align: center;
}
.meaning {
  font-size: 17px;
  color: var(--r-ink, #1f2328);
  margin: 0;
  max-width: 660px;
  line-height: 1.7;
  transition: opacity .2s ease;
  text-align: left;
}
.pos-row { display: flex; align-items: flex-start; }
/* 照 TranslationList.vue：词性用强调色、定宽 min-w-12（3rem），
   释义在右边成块换行，不跟着词性缩进走。 */
.pos {
  flex-shrink: 0; min-width: 3rem;
  color: var(--r-accent, #5b7a99);
}
.pos-text { flex: 1; min-width: 0; }
.word-line {
  font-family: 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', system-ui, sans-serif;
  font-weight: 300;
  font-size: 64px;
  letter-spacing: 0.02em;
  line-height: 1.3;
  word-break: break-all;
  max-width: 90vw;
}
.input-right { color: rgb(22, 163, 74); }
.input-wrong { color: rgba(255, 0, 0, 0.6); }
.word-end { color: var(--r-ink2, #999); }
.word-end.hide { letter-spacing: 0.14em; opacity: 0.45; }
.word-line.is-wrong { animation: shake 0.16s ease 2; }
.word-line.is-sentence { white-space: normal; word-break: break-word; line-height: 1.6; letter-spacing: 0; }
.sentence-tip { margin: 0 0 6px; font-size: 12px; opacity: 0.65; }
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  50% { transform: translateX(4px); }
}
.meta-line.top {
  min-height: 22px;
  color: var(--r-ink2, #9aa0a6);
  font-size: 15px;
  letter-spacing: 0.02em;
}
.icon-row {
  display: flex;
  align-items: center;
  gap: 14px;
  color: var(--r-ink2, #b6bcc3);
  min-height: 26px;
}
.speak-btn {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 3px;
  display: inline-flex;
}
.identify-row { display: flex; gap: 10px; margin-top: 6px; }
.ety-row { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 8px; font-size: 12.5px; opacity: 0.75; }
.choice-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
.choice-btn {
  text-align: left; padding: 10px 12px; border-radius: 9px; cursor: pointer;
  border: 1px solid var(--r-border, #ddd); background: var(--r-paper, #fff);
  color: var(--r-ink, #1c1c1c); font-size: 13.5px; line-height: 1.5;
  transition: background-color .15s ease, border-color .15s ease;
}
.choice-btn kbd { opacity: 0.5; margin-right: 6px; }
.choice-btn.right { border-color: #3a8a5c; background: color-mix(in srgb, #3a8a5c 14%, transparent); }
.choice-btn.wrong { border-color: #b5493c; background: color-mix(in srgb, #b5493c 14%, transparent); }
.idt-btn {
  padding: 8px 18px;
  border-radius: 18px;
  border: 1px solid var(--r-border, #ddd);
  background: var(--r-ui, #f6f6f6);
  color: var(--r-ink, #333);
  cursor: pointer;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  &:hover { background: var(--r-paper, #fff); }
}
.idt-btn kbd {
  font-size: 11px;
  opacity: 0.5;
  border: 1px solid currentColor;
  border-radius: 3px;
  padding: 0 4px;
}
.hint { font-size: 12.5px; color: var(--r-ink2, #aaa); margin: 0; }
.sent-list {
  list-style: none; margin: 10px 0 0; padding: 0;
  max-width: 640px; text-align: left;
}
.sent-item {
  display: flex; gap: 8px; align-items: baseline;
  padding: 5px 0; cursor: pointer; color: var(--r-ink2, #8a9099);
  font-size: 14px; line-height: 1.55;
  &:hover { color: var(--r-ink, #1f2328); }
  kbd { flex-shrink: 0; }
}
.sent-row { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 10px; }
.sent-btn {
  display: inline-flex; align-items: center; gap: 5px;
  border: 1px solid var(--r-border, #ddd); background: transparent; color: var(--r-ink2, #888);
  border-radius: 9999px; padding: 3px 10px; font-size: 12px; cursor: pointer;
}
.sent-btn:hover { color: var(--r-accent, #8a4b3a); border-color: var(--r-accent, #8a4b3a); }
.prev-corner {
  position: fixed; left: calc(var(--lb-nav-w, 56px) + 56px); top: 22px;
  display: flex; align-items: center; gap: 8px;
  color: var(--r-ink2, #c3c8ce); font-size: 15px; pointer-events: none;
}
.pc-arrow { font-size: 17px; }
.pc-word { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>

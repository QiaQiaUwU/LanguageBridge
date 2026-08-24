<template>
  <div class="flash-overlay">
    <button class="back-btn" @click="$emit('exit')" title="退出">
      <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20v-2z"/></svg>
    </button>

    <div class="progress-row">
      <span>{{ index }} / {{ list.length }}</span>
      <span>{{ percent }}%</span>
    </div>
    <div class="progress-bar"><div class="progress-fill" :style="{ width: percent + '%' }"></div></div>

    <div v-if="current" class="flash-card" :class="{ flipped }" @click="flip">
      <template v-if="!flipped">
        <button class="speak-btn" @click.stop="speak">
          <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>
        </button>
        <!-- 打字练习开着时，正面不直接给词，要自己敲出来（跟 TypeWords 的判定一模一样：
             逐字符比对、打错标红、打对补上）。关掉就是原来的闪卡。 -->
        <div v-if="typingOn" class="fc-word typing" :class="{ 'is-wrong': !!ts.wrong }" @click.stop>
          <template v-for="(seg, i) in letterRuns" :key="i">
            <span v-if="seg.type === 'done'">{{ seg.val }}</span>
            <span v-else-if="seg.type === 'wrong'" class="lt-wrong">{{ seg.val }}</span>
            <span v-else class="lt-rest">{{ seg.val }}</span>
          </template>
        </div>
        <div v-else class="fc-word">{{ current.word }}</div>

        <div v-if="current.phonetic" class="fc-phonetic">[{{ current.phonetic }}]</div>
        <div v-if="posText" class="fc-pos">{{ posText }}</div>

      </template>
      <template v-else>
        <div class="fc-word small">{{ current.word }}</div>
        <div class="fc-def">{{ defText }}</div>
        <div v-if="exampleEn" class="fc-example">
          <p class="en">{{ exampleEn }}
            <button class="inline-speak" @click.stop="speakExample">
              <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>
            </button>
          </p>
          <p v-if="exampleZh" class="zh">{{ exampleZh }}</p>
        </div>
        <div v-if="current.memory_tips" class="fc-tips">{{ current.memory_tips }}</div>
      </template>

    </div>

    <div v-else class="flash-done">
      <h2>本轮完成</h2>
      <p>认识 {{ stat.known }} · 模糊 {{ stat.fuzzy }} · 不认识 {{ stat.unknown }}</p>
      <div class="done-actions">
        <button v-if="stat.unknown + stat.fuzzy > 0" class="done-btn primary" @click="restartWrong">复习不认识/模糊</button>
        <button class="done-btn" @click="$emit('exit')">返回</button>
      </div>
    </div>

    <div v-if="current" class="mark-circle-row">
      <button class="circle known" @click="markAndNext('known')">认识</button>
      <button class="circle fuzzy" @click="markAndNext('fuzzy')">模糊</button>
      <button class="circle unknown" @click="markAndNext('unknown')">不认识</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import type { WordItem, WordStatus } from '@/shared/types/WordItem'
import { playWord, playSentence, stopAll } from '@/shared/core/audio'
import { typeStep, clearAfterWrong, type TypeState } from '@/shared/core/typeStep'
import { getStudySettings } from '@/shared/core/studySettings'
import { setKeySound, playKeySound } from '@/shared/core/keySound'

const props = defineProps<{ words: WordItem[] }>()
const emit = defineEmits<{
  (e: 'exit'): void
  (e: 'mark', wordId: string, status: WordStatus): void
}>()

const list = ref<WordItem[]>([...props.words])
const index = ref(0)
const flipped = ref(false)
const stat = ref({ known: 0, fuzzy: 0, unknown: 0 })
const marks = ref<Record<string, WordStatus>>({})

const current = computed(() => list.value[index.value] || null)
const percent = computed(() =>
  list.value.length ? Math.round((index.value / list.value.length) * 100) : 0
)

const posText = computed(() => {
  const set = new Set(current.value?.meanings?.map(m => m.partOfSpeech).filter(Boolean))
  return [...set].join(' ').toUpperCase()
})
const defText = computed(() =>
  current.value?.meanings?.map(m => [m.partOfSpeech, m.chinese].filter(Boolean).join(' ')).join('；') || ''
)
const exampleEn = computed(() =>
  current.value?.example_sentences?.[0]?.en ||
  current.value?.meanings?.find(m => m.examples?.length)?.examples?.[0] || ''
)
const exampleZh = computed(() => current.value?.example_sentences?.[0]?.zh || '')

/* ---------- 打字练习 ---------- */

/**
 * 卡片背单词里的打字练习。
 *
 * 判定直接复用 typeStep —— 就是背单词流程用的那一套（逐字符比对、
 * 打错标红并按设置决定清不清、忽略大小写），不另写一份，
 * 免得两处对"什么算打对"给出不同答案。
 *
 * 设置里 flashcardTyping 关掉就完全是原来的闪卡，一行都不变。
 */
const settings = getStudySettings()
const typingOn = ref(settings.flashcardTyping !== false)

const ts = ref<TypeState>({ input: '', wrong: '', inputLock: false, waitClear: false })

let clearTimer: ReturnType<typeof setTimeout> | null = null
function cancelWrongClear() {
  if (clearTimer) { clearTimeout(clearTimer); clearTimer = null }
}

function resetTyping() {
  cancelWrongClear()
  ts.value = { input: '', wrong: '', inputLock: false, waitClear: false }
}

/**
 * 拆成「已打对 / 打错 / 还没打」三段，跟 TypingCard 跟写模式的渲染口径一致。
 *
 * **词是显示出来的**，照着敲。第一版做成了下划线占位、只给中文 ——
 * 那是默写（听写）的玩法，不是跟写。
 */
const letterRuns = computed(() => {
  const word = current.value?.word || ''
  const st = ts.value
  const runs: { type: 'done' | 'wrong' | 'rest'; val: string }[] = []
  if (st.input) runs.push({ type: 'done', val: st.input })
  if (st.wrong) runs.push({ type: 'wrong', val: st.wrong })
  const used = st.input.length + st.wrong.length
  const rest = word.slice(used)
  if (rest) runs.push({ type: 'rest', val: rest })
  return runs
})

function onTypeKey(e: KeyboardEvent): boolean {
  const word = current.value?.word
  if (!typingOn.value || !word || flipped.value) return false
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  if (e.key.length !== 1 && e.key !== 'Backspace') return false

  if (e.key === 'Backspace') {
    e.preventDefault()
    cancelWrongClear()
    const st = ts.value
    // 退格要一并解除错字锁，否则 typeStep 会一直 return ignored，键盘像失灵
    if (st.wrong) ts.value = { ...st, wrong: st.wrong.slice(0, -1), inputLock: false, waitClear: false }
    else if (st.input) ts.value = { ...st, input: st.input.slice(0, -1), inputLock: false, waitClear: false }
    return true
  }

  const r = typeStep(
    ts.value,
    { key: e.key, code: e.code, shiftKey: e.shiftKey },
    word,
    { ignoreCase: settings.ignoreCase !== false, inputWrongClear: !!settings.inputWrongClear }
  )
  if (r.kind === 'ignored') return false
  e.preventDefault()
  ts.value = r.state
  if (settings.keyboardSound) {
    setKeySound(settings.keyboardSoundFile)
    playKeySound(settings.keyboardSoundVolume)
  }

  /**
   * 打错之后 typeStep 会把状态锁住（inputLock + waitClear），期间所有输入被忽略 ——
   * 这是故意的，给人看清哪儿错了。**必须有人来解锁**，
   * 由 clearAfterWrong 在半秒后按设置决定是清掉整个输入还是只清错的那几个字母。
   * 忘了这一步的话，打错一次键盘就再也没反应了。
   */
  if (r.kind === 'wrong') {
    cancelWrongClear()
    clearTimer = setTimeout(() => {
      clearTimer = null
      ts.value = clearAfterWrong(ts.value, {
        ignoreCase: settings.ignoreCase !== false,
        inputWrongClear: !!settings.inputWrongClear
      })
    }, 500)
    return true
  }

  if (r.kind === 'complete') {
    // 敲完了就翻面看释义，跟点一下卡片是同一个动作
    flipped.value = true
  }
  return true
}

function flip() { flipped.value = !flipped.value }
function speak() { if (current.value) playWord(current.value.word) }
function speakExample() { if (exampleEn.value) playSentence(exampleEn.value) }

function markAndNext(s: WordStatus) {
  if (!current.value) return
  stat.value[s as 'known' | 'fuzzy' | 'unknown']++
  marks.value[current.value.id] = s
  emit('mark', current.value.id, s)
  flipped.value = false
  index.value++
}

function restartWrong() {
  const wrong = list.value.filter(w => {
    const m = marks.value[w.id]
    return m === 'unknown' || m === 'fuzzy'
  })
  list.value = wrong
  index.value = 0
  flipped.value = false
  stat.value = { known: 0, fuzzy: 0, unknown: 0 }
  marks.value = {}
}

watch(current, w => {
  resetTyping()
  if (w) playWord(w.word)
})

function onKey(e: KeyboardEvent) {
  if (!current.value) return
  // 打字优先：字母键交给判定，方向键仍然是评价，Esc 仍然是退出
  if (onTypeKey(e)) return
  if (e.key === 'ArrowLeft') markAndNext('known')
  else if (e.key === 'ArrowUp') markAndNext('fuzzy')
  else if (e.key === 'ArrowRight') markAndNext('unknown')
  else if (e.key === 'ArrowDown') flip()
  else if (e.key === 'Escape') emit('exit')
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  if (settings.keyboardSound) setKeySound(settings.keyboardSoundFile)
  if (current.value) playWord(current.value.word)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  cancelWrongClear()
  stopAll()
})
</script>

<style lang="scss" scoped>
.flash-overlay {
  position: fixed;
  inset: 0;
  background: #f7f2ec;
  z-index: 150;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px;
  overflow-y: auto;
}

.back-btn {
  position: absolute;
  top: 20px;
  left: 20px;
  border: none;
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff));
  border-radius: 10px;
  padding: 10px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  line-height: 0;
  &:hover { background: #f0eae2; }
}

.progress-row {
  display: flex;
  justify-content: space-between;
  width: min(520px, 90vw);
  color: #7a7268;
  font-size: 15px;
  margin: 40px 0 8px;
}

.progress-bar {
  width: min(520px, 90vw);
  height: 8px;
  background: #e7e0d6;
  border-radius: 4px;
  overflow: hidden;
  .progress-fill { height: 100%; background: #d99b6c; transition: width 0.2s; }
}

.flash-card {
  width: min(480px, 90vw);
  min-height: 500px;
  margin-top: 36px;
  background: #fff;
  border-radius: 18px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 32px 48px;
  cursor: pointer;
  position: relative;
  text-align: center;
}

.speak-btn {
  border: none;
  background: none;
  cursor: pointer;
  color: #333;
  margin-bottom: 10px;
  line-height: 0;
  &:hover { color: #000; }
}

.fc-word {
  font-size: 42px;
  font-weight: 700;
  color: #1a1a1a;
  &.small { font-size: 28px; margin-bottom: 16px; }
  /* 打字状态：等宽 + 字距，免得每敲一个字整行都在跳 */
  &.typing {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    letter-spacing: 0.06em;
    cursor: default;
  }
  &.typing.is-wrong { animation: fc-shake .18s; }
}
.lt-wrong { color: #c0392b; }
.lt-rest { color: #c9ccd1; }   /* 还没敲到的部分：浅色，看得见但一眼能分辨 */
@keyframes fc-shake {
  0%, 100% { transform: translateX(0); }
  30% { transform: translateX(-4px); }
  70% { transform: translateX(4px); }
}

.fc-phonetic { color: #9a938a; font-size: 18px; margin-top: 14px; }

.fc-pos {
  margin-top: 18px;
  background: #f0f0f0;
  color: #555;
  padding: 3px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
}


.fc-def { font-size: 19px; color: #333; line-height: 1.7; }

.fc-example {
  margin-top: 24px;
  font-size: 15px;
  .en { color: #1a1a1a; }
  .zh { color: #777; margin-top: 6px; }
  .inline-speak {
    border: none; background: none; cursor: pointer; color: #555; line-height: 0; vertical-align: middle;
    &:hover { color: #000; }
  }
}

.fc-tips {
  margin-top: 22px;
  font-size: 13px;
  color: #8a7f6d;
  background: #faf6ef;
  border-radius: 8px;
  padding: 10px 14px;
  text-align: left;
}

.mark-circle-row {
  display: flex;
  gap: 26px;
  margin: 30px 0 10px;
}

.circle {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  border: none;
  font-size: 15px;
  cursor: pointer;
  color: #4a4438;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.08);
  transition: transform 0.1s;
  &:hover { transform: scale(1.06); }
  &.known { background: #dde5c8; }
  &.fuzzy { background: #f3ddba; }
  &.unknown { background: #dfb7ae; }
}

.flash-done {
  margin-top: 80px;
  text-align: center;
  h2 { font-size: 28px; color: #1a1a1a; margin-bottom: 14px; }
  p { color: #7a7268; font-size: 16px; }
}

.done-actions { margin-top: 28px; display: flex; gap: 14px; justify-content: center; }

.done-btn {
  padding: 12px 26px;
  border-radius: 10px;
  border: 1px solid #333;
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff));
  font-size: 15px;
  cursor: pointer;
  &:hover { background: #f4efe8; }
  &.primary { background: #e0805e; border-color: #e0805e; color: #fff; &:hover { background: #d06f4d; } }
}
</style>

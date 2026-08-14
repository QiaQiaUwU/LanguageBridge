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
        <div class="fc-word">{{ current.word }}</div>
        <div v-if="current.phonetic" class="fc-phonetic">[{{ current.phonetic }}]</div>
        <div v-if="posText" class="fc-pos">{{ posText }}</div>
        <div class="fc-hint">点击卡片查看详情</div>
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
      <div class="fc-keys">可用键盘箭头：← 认识 / ↑ 模糊 / → 不认识 / ↓ 翻转</div>
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

watch(current, w => { if (w) playWord(w.word) })

function onKey(e: KeyboardEvent) {
  if (!current.value) return
  if (e.key === 'ArrowLeft') markAndNext('known')
  else if (e.key === 'ArrowUp') markAndNext('fuzzy')
  else if (e.key === 'ArrowRight') markAndNext('unknown')
  else if (e.key === 'ArrowDown') flip()
  else if (e.key === 'Escape') emit('exit')
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  if (current.value) playWord(current.value.word)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
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

.fc-hint { color: #b8b1a6; margin-top: 40px; font-size: 15px; }

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

.fc-keys {
  position: absolute;
  bottom: 12px;
  left: 0;
  right: 0;
  color: #c6bfb4;
  font-size: 12px;
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

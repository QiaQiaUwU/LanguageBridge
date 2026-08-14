<template>
  <div
    class="word-card"
    :class="[`mode-${mode}`, statusClass]"
    @click="$emit('select', word)"
  >
    <div class="line-main">
      <span class="w-text">{{ word.word }}</span>
      <span v-if="word.phonetic" class="w-phonetic">{{ word.phonetic }}</span>
      <button class="icon-btn" title="播放发音" @click.stop="onPlayWord">
        <svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>
      </button>
      <span v-if="posText" class="w-pos">{{ posText }}</span>
    </div>

    <div class="line-def">
      <span class="w-def" :class="{ masked: !revealed }" @click.stop="revealed = true">
        <template v-if="revealed">{{ defText }}</template>
      </span>
    </div>

    <div v-if="exampleEn" class="line-example">
      <span class="ex-label">例句：</span>
      <span class="ex-en">{{ exampleEn }}</span>
      <button class="icon-btn small" title="播放例句" @click.stop="onPlaySentence">
        <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>
      </button>
    </div>

    <div class="line-zh">
      <span class="ex-zh" :class="{ masked: !revealed }" @click.stop="revealed = true">
        <template v-if="revealed">{{ exampleZh || '\u00A0' }}</template>
      </span>
      <button class="icon-btn eye" :title="revealed ? '隐藏释义' : '显示释义'" @click.stop="revealed = !revealed">
        <svg v-if="revealed" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>
        <svg v-else viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M2.4 2.4 1 3.8l4 4C3 9.5 1.6 11.3 1 12.5 2 15 6 19.5 12 19.5c1.9 0 3.6-.5 5.1-1.3l3.9 3.9 1.4-1.4L2.4 2.4zM12 16.5c-2.5 0-4.5-2-4.5-4.5 0-.7.2-1.4.5-2l1.6 1.6a2.5 2.5 0 0 0 2.9 2.9l1.6 1.6c-.6.3-1.3.4-2.1.4zm9.7-4c-.6 1.4-2 3.2-4 4.7l-2.3-2.3c.4-.7.6-1.5.6-2.4A4.5 4.5 0 0 0 9.5 8l-1.8-1.8C8.9 5.7 10.4 5.5 12 5.5c6 0 10 4.5 11 7-.3.7-.8 1.6-1.3 2.5z" transform="scale(.92)"/></svg>
      </button>
    </div>

    <div class="mark-bar" @click.stop>
      <button class="mark-btn known" :class="{ on: word.status === 'known' }" @click="mark('known')">认识</button>
      <button class="mark-btn fuzzy" :class="{ on: word.status === 'fuzzy' }" @click="mark('fuzzy')">模糊</button>
      <button class="mark-btn unknown" :class="{ on: word.status === 'unknown' }" @click="mark('unknown')">不认识</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { WordItem, WordStatus } from '@/shared/types/WordItem'
import { playWord, playSentence } from '@/shared/core/audio'

const props = defineProps<{
  word: WordItem
  mode?: 'study' | 'list'
  globalReveal: boolean
}>()

const emit = defineEmits<{
  (e: 'select', w: WordItem): void
  (e: 'mark', wordId: string, status: WordStatus): void
}>()

const revealed = ref(props.globalReveal)
watch(() => props.globalReveal, v => { revealed.value = v })

const posText = computed(() => {
  const set = new Set(props.word.meanings?.map(m => m.partOfSpeech).filter(Boolean))
  return [...set].join(' ')
})

const defText = computed(() =>
  props.word.meanings?.map(m => m.chinese).filter(Boolean).join('；') || ''
)

const exampleEn = computed(() => {
  if (props.word.example_sentences?.length) return props.word.example_sentences[0].en
  const ex = props.word.meanings?.find(m => m.examples?.length)?.examples?.[0]
  return ex || ''
})

const exampleZh = computed(() =>
  props.word.example_sentences?.[0]?.zh || ''
)

const statusClass = computed(() => props.word.status && props.word.status !== 'unmarked'
  ? `st-${props.word.status}` : '')

function onPlayWord() { playWord(props.word.word) }
function onPlaySentence() { if (exampleEn.value) playSentence(exampleEn.value) }
function mark(s: WordStatus) {
  emit('mark', props.word.id, props.word.status === s ? 'unmarked' : s)
}
</script>

<style lang="scss" scoped>
.word-card {
  position: relative;
  background: #fff;
  border: 1px solid #ececec;
  border-radius: 12px;
  padding: 13px 15px 10px;
  cursor: pointer;
  transition: box-shadow 0.15s, border-color 0.15s;
  display: flex;
  flex-direction: column;
  gap: 8px;

  &:hover {
    box-shadow: 0 3px 12px rgba(0, 0, 0, 0.08);
    border-color: #d8d8d8;
    .mark-bar { opacity: 1; pointer-events: auto; }
  }

  &.st-known { background: #eef2e2; border-color: #dfe6cc; }
  &.st-fuzzy { background: #faf3e3; border-color: #efe3c4; }
  &.st-unknown { background: #f7e9e6; border-color: #ecd4cf; }
}

.line-main {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 8px;
  min-height: 26px;
}

.line-def { min-height: 40px; }

.w-text {
  font-size: 19px;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: 0.2px;
  flex: 0 0 auto;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.25;
}

.w-phonetic {
  font-size: 13px;
  color: #666;
  font-family: 'Segoe UI', Arial, sans-serif;
  flex: 0 1 auto;
  min-width: 0;
  white-space: nowrap;
}

.icon-btn {
  border: none;
  background: none;
  color: #444;
  cursor: pointer;
  padding: 2px;
  line-height: 0;
  align-self: center;
  border-radius: 50%;
  &:hover { color: #000; background: #f0f0f0; }
  &.small { color: #555; }
  &.eye { color: #777; margin-left: auto; }
}

.w-pos {
  background: #f1f1f1;
  color: #555;
  font-size: 12px;
  padding: 1px 7px;
  border-radius: 5px;
  align-self: center;
  margin-left: auto;
  flex-shrink: 0;
  white-space: nowrap;
}

.w-def {
  font-size: 14px;
  color: #333;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.45;

  &.masked {
    display: inline-block;
    border-bottom: 1.5px solid #999;
    min-width: 72px;
    max-width: 140px;
    height: 1em;
    align-self: center;
    cursor: pointer;
  }
}

.ex-en {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.line-example { min-height: 40px; }
.line-zh { min-height: 22px; }
.ex-zh {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.line-example {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  font-size: 14px;

  .ex-label { color: #333; font-weight: 500; white-space: nowrap; }
  .ex-en { color: #1a1a1a; }
}

.line-zh {
  display: flex;
  align-items: center;
  min-height: 20px;

  .ex-zh {
    font-size: 13px;
    color: #555;
    &.masked {
      border-bottom: 1.5px solid #aaa;
      min-width: 96px;
      max-width: 160px;
      height: 1em;
      cursor: pointer;
    }
  }
}

.mark-bar {
  position: absolute;
  left: 50%;
  bottom: -16px;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
  z-index: 5;
}

.mark-btn {
  border: none;
  border-radius: 16px;
  padding: 6px 14px;
  font-size: 12.5px;
  white-space: nowrap;
  cursor: pointer;
  background: #2b2b2b;
  color: #fff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 82%, #000); }
  &.on.known { background: #7d9b4e; }
  &.on.fuzzy { background: #c8973a; }
  &.on.unknown { background: #b05a4a; }
}

.mode-list {
  flex-direction: row;
  align-items: center;
  gap: 14px;
  padding: 10px 16px;
  border-radius: 8px;

  .line-example, .line-zh { display: none; }
  .line-main { flex: 1; }
}
</style>

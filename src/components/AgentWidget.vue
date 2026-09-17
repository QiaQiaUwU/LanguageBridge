<template>
  <div class="lb-widget">
    <!-- 词汇宇宙小窗：默认折叠成一条，点开才加载 3D，
         否则聊天记录里堆几个就把页面拖垮了 -->
    <template v-if="spec.kind === 'universe'">
      <button class="w-head" @click="open = !open">
        <span class="w-icon">◍</span>
        <span class="w-title">{{ spec.title || (spec.center ? `${spec.center} 的词族` : '词汇宇宙') }}</span>
        <span class="w-hint">{{ open ? '收起' : `展开（${graphNodes.length} 词）` }}</span>
      </button>
      <div v-if="open" class="w-graph">
        <WordGraph3D
          v-if="graphNodes.length"
          :nodes="graphNodes"
          :links="graphLinks"
          click-mode="select"
          @select="onPick"
        />
        <p v-else class="w-empty">暂无</p>
      </div>
    </template>

    <!-- 单词卡 -->
    <div v-else-if="spec.kind === 'wordcard'" class="w-cards">
      <div v-for="w in cardWords" :key="w.id" class="w-card">
        <div class="wc-top">
          <span class="wc-word">{{ w.word }}</span>
          <span v-if="w.phonetic" class="wc-ph">{{ w.phonetic }}</span>
          <button class="wc-say" title="发音" @click="say(w.word)">🔊</button>
        </div>
        <div class="wc-mean">{{ meaningOf(w) }}</div>
      </div>
      <p v-if="!cardWords.length" class="w-empty">暂无</p>
    </div>

    <!-- 紧凑词表 -->
    <div v-else-if="spec.kind === 'wordlist'" class="w-list">
      <button v-for="w in (spec.words || [])" :key="w" class="w-chip" @click="say(w)">{{ w }}</button>
    </div>

    <!-- 小测验 -->
    <div v-else-if="spec.kind === 'quiz'" class="w-quiz">
      <div class="q-text">{{ spec.question }}</div>
      <button
        v-for="(o, i) in (spec.options || [])"
        :key="i"
        class="q-opt"
        :class="{ right: picked !== null && i === spec.answer, wrong: picked === i && i !== spec.answer }"
        :disabled="picked !== null"
        @click="picked = i"
      >{{ o }}</button>
      <div v-if="picked !== null" class="q-fb">
        {{ picked === spec.answer ? '答对了' : `正确答案是「${(spec.options || [])[spec.answer ?? 0]}」` }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { WidgetSpec } from '@/shared/core/agentTools'
import type { WordItem } from '@/shared/types/WordItem'
import { useWordStore } from '@/shared/stores/wordStore'
import { playWord } from '@/shared/core/audio'
import WordGraph3D from '@/apps/word-core/components/WordGraph3D.vue'

const props = defineProps<{ spec: WidgetSpec }>()
const wordStore = useWordStore()

const open = ref(false)
const picked = ref<number | null>(null)

function findWord(w: string): WordItem | undefined {
  const k = w.toLowerCase()
  return wordStore.words.find(x => x.word.toLowerCase() === k)
}

const cardWords = computed(() =>
  (props.spec.words || []).slice(0, 6).map(findWord).filter(Boolean) as WordItem[]
)

/**
 * 图里放哪些词。
 * 给了 words 就用 words；只给了 center，就把词形、词根、词缀里含这个串的都捞出来。
 */
/** 图要的是 GraphNode，不是 WordItem —— 组件的 props 叫 nodes */
const graphNodes = computed(() =>
  graphWords.value.map(w => ({
    id: w.id,
    word: w.word,
    definitionZh: w.meanings?.[0]?.chinese || '',
    isCenter: !!props.spec.center && w.word.toLowerCase() === props.spec.center.toLowerCase()
  }))
)

const graphWords = computed<WordItem[]>(() => {
  if (props.spec.words?.length) {
    return props.spec.words.map(findWord).filter(Boolean) as WordItem[]
  }
  const c = (props.spec.center || '').toLowerCase()
  if (!c) return []
  const hit = wordStore.words.filter(w => {
    if (w.word.toLowerCase().includes(c)) return true
    const m = w.morphemes
    if (m) {
      for (const p of [m.prefix, m.root, m.suffix]) {
        if (p?.form && p.form.toLowerCase().includes(c)) return true
      }
    }
    return false
  })
  return hit.slice(0, 60)
})

/** 同根的连一条线，让关系看得见 */
const graphLinks = computed(() => {
  // GraphLink 必须带 type，同根词用 morphology
  const links: { source: string; target: string; type: 'morphology' }[] = []
  const byRoot = new Map<string, string[]>()
  for (const w of graphWords.value) {
    const r = w.morphemes?.root?.form?.toLowerCase()
    if (!r) continue
    const arr = byRoot.get(r) || []
    arr.push(w.id)
    byRoot.set(r, arr)
  }
  for (const ids of byRoot.values()) {
    for (let i = 1; i < ids.length; i++) links.push({ source: ids[0], target: ids[i], type: 'morphology' })
  }
  return links
})

function meaningOf(w: WordItem) {
  return (
    w.meanings
      ?.map(m => [m.partOfSpeech, m.chinese].filter(Boolean).join(' '))
      .filter(Boolean)
      .join('；') || '（暂无释义）'
  )
}

function say(w: string) {
  playWord(w, 'us', 1)
}

function onPick(word: string) {
  say(word)
}
</script>

<style scoped lang="scss">
.lb-widget {
  margin: 8px 0;
  border: 1px solid var(--c-line);
  border-radius: 10px;
  overflow: hidden;
  background: var(--c-surface);
}
.w-head {
  width: 100%;
  display: flex; align-items: center; gap: 8px;
  padding: 9px 11px; border: none; background: none;
  cursor: pointer; font-size: 13px; text-align: left;
  &:hover { background: var(--c-surface-2); }
}
.w-icon { color: var(--c-accent); }
.w-title { flex: 1; min-width: 0; color: var(--c-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.w-hint { flex-shrink: 0; color: var(--c-text-2); font-size: 12px; }
.w-graph { height: 260px; border-top: 1px solid var(--c-line); }
.w-empty { margin: 0; padding: 14px; color: var(--c-text-2); font-size: 12.5px; text-align: center; }

.w-cards { padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.w-card { padding: 8px 10px; border-radius: 8px; background: var(--c-surface-2); }
.wc-top { display: flex; align-items: baseline; gap: 8px; }
.wc-word { font-size: 15px; font-weight: 600; color: var(--c-text); }
.wc-ph { font-size: 12px; color: var(--c-text-2); }
.wc-say { border: none; background: none; cursor: pointer; font-size: 13px; margin-left: auto; }
.wc-mean { margin-top: 3px; font-size: 13px; color: var(--c-text-2); line-height: 1.6; }

.w-list { padding: 9px; display: flex; flex-wrap: wrap; gap: 6px; }
.w-chip {
  padding: 4px 10px; border-radius: 999px;
  border: 1px solid var(--c-line); background: none;
  font-size: 12.5px; color: var(--c-text); cursor: pointer;
  &:hover { border-color: var(--c-accent); color: var(--c-accent); }
}

.w-quiz { padding: 10px; display: flex; flex-direction: column; gap: 6px; }
.q-text { font-size: 13.5px; color: var(--c-text); margin-bottom: 2px; }
.q-opt {
  padding: 7px 11px; border-radius: 8px; text-align: left;
  border: 1px solid var(--c-line); background: none;
  font-size: 13px; color: var(--c-text); cursor: pointer;
  &:hover:not(:disabled) { border-color: var(--c-accent); }
  &.right { border-color: var(--c-success); background: color-mix(in srgb, var(--c-success) 10%, transparent); }
  &.wrong { border-color: var(--c-danger); background: color-mix(in srgb, var(--c-danger) 10%, transparent); }
}
.q-fb { font-size: 12.5px; color: var(--c-text-2); }
</style>

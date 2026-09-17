<template>
  <div class="mastered-page">
    <header class="page-head">
      <BackLink label="主页" to="/home" />
      <h2 class="title">已掌握</h2>
    </header>

    <div class="toolbar">
      <input v-model="keyword" class="search" placeholder="搜索" />
      <span class="count">共 {{ filtered.length }} 个{{ keyword ? '（已筛选）' : '' }}</span>
      <button v-if="selected.size" class="ghost-btn small" @click="removeSelected">
        移出（{{ selected.size }}）
      </button>
    </div>

    <EmptyState v-if="!list.length" />

    <ul v-else class="word-list">
      <li v-for="w in filtered" :key="w.word" class="word-row">
        <label class="pick">
          <input type="checkbox" :checked="selected.has(w.word)" @change="toggleSelect(w.word)" />
        </label>
        <span class="w">{{ w.word }}</span>
        <span class="zh">{{ w.zh }}</span>
        <button class="ghost-btn tiny" @click="removeOne(w.word)">移出</button>
      </li>
    </ul>

    <section class="simple-section">
      <h3>高频虚词</h3>
      <p class="sub">
        {{ ignoreSimpleWord ? '已跳过' : '未跳过' }} · {{ SIMPLE_WORDS.length }}
      </p>
      <div class="chips">
        <span v-for="w in SIMPLE_WORDS" :key="w" class="chip" :class="{ off: !ignoreSimpleWord }">{{ w }}</span>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useWordStore } from '@/shared/stores/wordStore'
import type { WordItem } from '@/shared/types/WordItem'
import { loadMasteredWords, getMasteredSet, removeMastered, SIMPLE_WORDS } from '@/shared/core/masteredWords'
import { getStudySettings } from '@/shared/core/studySettings'

const wordStore = useWordStore()

const list = ref<{ word: string; zh: string }[]>([])
const keyword = ref('')
const selected = ref<Set<string>>(new Set())
const ignoreSimpleWord = computed(() => getStudySettings().ignoreSimpleWord)

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return list.value
  return list.value.filter(w => w.word.includes(k) || w.zh.includes(k))
})

function refresh() {
  const byWord = new Map<string, WordItem>(wordStore.words.map(w => [w.word.toLowerCase(), w]))
  list.value = [...getMasteredSet()]
    .sort()
    .map(w => ({ word: w, zh: byWord.get(w)?.meanings?.[0]?.chinese || '' }))
}

function toggleSelect(word: string) {
  const s = new Set(selected.value)
  s.has(word) ? s.delete(word) : s.add(word)
  selected.value = s
}

async function removeOne(word: string) {
  await removeMastered(word)
  selected.value.delete(word)
  refresh()
}

async function removeSelected() {
  for (const w of [...selected.value]) await removeMastered(w)
  selected.value = new Set()
  refresh()
}

onMounted(async () => {
  await wordStore.loadWords()
  await loadMasteredWords()
  refresh()
})
</script>

<style scoped lang="scss">
.mastered-page { max-width: 860px; margin: 0 auto; padding: 18px 20px 60px; }
.page-head { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
.title { font-size: 19px; margin: 0 0 4px; }
.sub { font-size: 12.5px; color: var(--c-text-2); margin: 0; line-height: 1.6; }
.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.search {
  padding: 6px 10px;
  border: 1px solid var(--c-line);
  border-radius: 8px;
  background: var(--c-surface-2);
  color: inherit;
  font-size: 13.5px;
  min-width: 200px;
}
.count { font-size: 12.5px; color: var(--c-text-2); }
.empty { color: var(--c-text-2); font-size: 13.5px; padding: 40px 0; text-align: center; }
.empty kbd {
  border: 1px solid currentColor;
  border-radius: 3px;
  padding: 0 4px;
  font-size: 11px;
}
.word-list { list-style: none; padding: 0; margin: 0; }
.word-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 4px;
  border-bottom: 1px solid var(--c-line);
  font-size: 14px;
}
.word-row .w { min-width: 150px; font-weight: 500; }
.word-row .zh { flex: 1; color: var(--c-text-2); font-size: 13px; }
.pick { display: flex; align-items: center; }
.ghost-btn.tiny { font-size: 12px; padding: 3px 9px; }
.simple-section { margin-top: 34px; padding-top: 20px; border-top: 1px solid var(--c-line); }
.simple-section h3 { font-size: 14.5px; margin: 0 0 6px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
</style>

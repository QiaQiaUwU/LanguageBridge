<template>
  <div class="mastered-page">
    <header class="page-head">
      <button class="ghost-btn small" @click="$router.push('/home')">← 主页</button>
      <div>
        <h2 class="title">已掌握</h2>
        <p class="sub">这些词已经退出练习，不会出现在任何学习和复习队列里。移出后会重新参与排课。</p>
      </div>
    </header>

    <div class="toolbar">
      <input v-model="keyword" class="search" placeholder="搜索单词" />
      <span class="count">共 {{ filtered.length }} 个{{ keyword ? '（已筛选）' : '' }}</span>
      <button v-if="selected.size" class="ghost-btn small" @click="removeSelected">
        移出已掌握（{{ selected.size }}）
      </button>
    </div>

    <p v-if="!list.length" class="empty">
      还没有已掌握的词。学习时在自测阶段按 <kbd>3</kbd>，或在词条详情里标记，词就会进到这里。
    </p>

    <ul v-else class="word-list">
      <li v-for="w in filtered" :key="w.word" class="word-row">
        <label class="pick">
          <input type="checkbox" :checked="selected.has(w.word)" @change="toggleSelect(w.word)" />
        </label>
        <span class="w">{{ w.word }}</span>
        <span class="zh">{{ w.zh || '—' }}</span>
        <button class="ghost-btn tiny" @click="removeOne(w.word)">移出</button>
      </li>
    </ul>

    <section class="simple-section">
      <h3>高频虚词</h3>
      <p class="sub">
        {{ ignoreSimpleWord ? '当前已跳过' : '当前未跳过' }}这 {{ SIMPLE_WORDS.length }} 个词。
        这是一张固定的表，不能单个增删，只能在学习设置里整体开关。
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
.page-head { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 18px; }
.title { font-size: 19px; margin: 0 0 4px; }
.sub { font-size: 12.5px; color: var(--r-ink2, #888); margin: 0; line-height: 1.6; }
.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.search {
  padding: 6px 10px;
  border: 1px solid var(--r-border, #ddd);
  border-radius: 8px;
  background: var(--r-ui, #fafafa);
  color: inherit;
  font-size: 13.5px;
  min-width: 200px;
}
.count { font-size: 12.5px; color: var(--r-ink2, #999); }
.empty { color: var(--r-ink2, #999); font-size: 13.5px; padding: 40px 0; text-align: center; }
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
  border-bottom: 1px solid var(--r-border, #eee);
  font-size: 14px;
}
.word-row .w { min-width: 150px; font-weight: 500; }
.word-row .zh { flex: 1; color: var(--r-ink2, #777); font-size: 13px; }
.pick { display: flex; align-items: center; }
.ghost-btn.tiny { font-size: 12px; padding: 3px 9px; }
.simple-section { margin-top: 34px; padding-top: 20px; border-top: 1px solid var(--r-border, #eee); }
.simple-section h3 { font-size: 14.5px; margin: 0 0 6px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.chip {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  padding: 2px 9px;
  border-radius: 9999px;
  font-size: 12px;
  background: var(--r-ui, #f2f2f2);
  color: var(--r-ink2, #777);
  &.off { opacity: 0.4; text-decoration: line-through; }
}
</style>

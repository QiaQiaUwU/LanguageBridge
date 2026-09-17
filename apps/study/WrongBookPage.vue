<template>
  <div class="list-page">
    <header class="page-head">
      <BackLink label="主页" to="/home" />
      <h2 class="title">错词本</h2>
    </header>

    <div class="toolbar">
      <div class="chip-row">
        <button class="chip" :class="{ on: sortBy === 'recent' }" @click="sortBy = 'recent'">最近错的</button>
        <button class="chip" :class="{ on: sortBy === 'count' }" @click="sortBy = 'count'">错得最多</button>
      </div>
      <input v-model="keyword" class="search" placeholder="搜索" />
      <button class="dark-btn small" :disabled="!dictateIds.length" @click="dictateThese">
        听写（{{ dictateIds.length }}）
      </button>
      <button class="ghost-btn small" :disabled="!dictateIds.length" @click="studyThese">
        学习
      </button>
      <button v-if="picked.size" class="ghost-btn small" @click="removePicked">
        移出（{{ picked.size }}）
      </button>
    </div>

    <section v-if="calendar.length" class="calendar">
      <div class="cal-head">
        <span class="sec-title">错词日历</span>
      </div>
      <div class="cal-row">
        <button
          v-for="d in calendar"
          :key="d.date"
          class="cal-cell"
          :class="{ on: dateFilter === d.date }"
          @click="dateFilter = dateFilter === d.date ? '' : d.date"
        >
          <span class="cal-day">{{ d.label }}</span>
          <span class="cal-count">{{ d.count }}</span>
        </button>
      </div>
    </section>

    <EmptyState v-if="!filtered.length" />

    <ul v-else class="rows">
      <li v-for="r in filtered" :key="r.wordId" class="row">
        <label class="pick"><input type="checkbox" :checked="picked.has(r.wordId)" @change="togglePick(r.wordId)" /></label>
        <span class="w">{{ r.word }}</span>
        <span v-if="r.lastWrongInput" class="wrong-input" :title="`最近一次打成了「${r.lastWrongInput}」`">
          {{ r.lastWrongInput }}
        </span>
        <span v-else class="wrong-input none">（未记录输入）</span>
        <span class="zh">{{ meaningOf(r.wordId) }}</span>
        <span class="times" :class="{ hot: r.wrongCount >= 3 }">错 {{ r.wrongCount }} 次</span>
        <span class="date">{{ r.lastWrongDate }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { commitScope } from '@/shared/core/studyScope'
import { useWordStore } from '@/shared/stores/wordStore'

interface WrongRow {
  wordId: string
  word: string
  lastWrongInput: string
  wrongCount: number
  firstWrongDate: string
  lastWrongDate: string
}

const router = useRouter()
const wordStore = useWordStore()

const rows = ref<WrongRow[]>([])
const sortBy = ref<'recent' | 'count'>('recent')
const keyword = ref('')
const dateFilter = ref('')
const picked = ref<Set<string>>(new Set())

function meaningOf(wordId: string): string {
  const w = wordStore.words.find(x => x.id === wordId)
  return w?.meanings?.[0]?.chinese || '—'
}

const calendar = computed(() => {
  const byDate = new Map<string, number>()
  for (const r of rows.value) {
    if (r.lastWrongDate) byDate.set(r.lastWrongDate, (byDate.get(r.lastWrongDate) || 0) + 1)
  }
  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 14)
    .map(([date, count]) => ({ date, count, label: date.slice(5) }))
})

const filtered = computed(() => {
  let list = [...rows.value]
  if (dateFilter.value) list = list.filter(r => r.lastWrongDate === dateFilter.value)
  const k = keyword.value.trim().toLowerCase()
  if (k) list = list.filter(r => r.word.toLowerCase().includes(k))
  if (sortBy.value === 'count') list.sort((a, b) => b.wrongCount - a.wrongCount)
  return list
})

function togglePick(id: string) {
  const s = new Set(picked.value)
  s.has(id) ? s.delete(id) : s.add(id)
  picked.value = s
}

async function removePicked() {
  for (const id of [...picked.value]) await wordStore.removeFromWrongBook(id)
  picked.value = new Set()
  await refresh()
}

const dictateIds = computed(() => {
  const base = picked.value.size
    ? filtered.value.filter(r => picked.value.has(r.wordId))
    : filtered.value
  return base.map(r => r.wordId).filter(id => wordStore.words.some(w => w.id === id))
})

function dictateThese() {
  if (!dictateIds.value.length) return
  const list = wordStore.words.filter(w => dictateIds.value.includes(w.id))
  wordStore.setStudyList(list)
  router.push('/dictation')
}

function studyThese() {
  const ids = filtered.value.map(r => r.wordId).filter(id => wordStore.words.some(w => w.id === id))
  if (!ids.length) return
  router.push(commitScope({ kind: 'adhoc', ids, label: `错词本 · ${ids.length} 词` }))
}

async function refresh() {
  rows.value = await wordStore.listWrongBook()
}

onMounted(async () => {
  await wordStore.loadWords()
  await refresh()
})
</script>

<style scoped lang="scss">
.list-page { max-width: 960px; margin: 0 auto; padding: 18px 20px 60px; }
.page-head { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
.title { font-size: 19px; margin: 0 0 4px; }
.sub { font-size: 12.5px; color: var(--c-text-2); margin: 0; line-height: 1.6; }
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.chip-row { display: flex; gap: 6px; }
.search {
  padding: 6px 10px; border: 1px solid var(--c-line); border-radius: 8px;
  background: var(--c-surface-2); color: inherit; font-size: 13.5px; min-width: 160px; flex: 1;
}
.calendar { margin-bottom: 16px; }
.cal-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.sec-title { font-size: 13.5px; font-weight: 600; color: var(--c-text-2); }
.cal-hint { font-size: 12px; color: var(--c-text-2); }
.cal-row { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
.cal-cell {
  flex-shrink: 0; min-width: 56px; padding: 7px 6px; border-radius: 9px;
  border: 1px solid var(--c-line); background: var(--c-surface-2);
  cursor: pointer; display: flex; flex-direction: column; gap: 2px; color: inherit;
  &.on { border-color: var(--c-accent); background: var(--c-surface); }
}
.cal-day { font-size: 11.5px; color: var(--c-text-2); }
.cal-count { font-size: 15px; font-weight: 600; }
.empty { color: var(--c-text-2); font-size: 13.5px; padding: 46px 0; text-align: center; line-height: 1.7; }
.rows { list-style: none; padding: 0; margin: 0; }
.row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 4px; border-bottom: 1px solid var(--c-line); font-size: 14px;
}
.pick { display: flex; align-items: center; }
.row .w { min-width: 130px; font-weight: 500; }
.wrong-input {
  min-width: 110px; font-size: 13px; color: #c0413c;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  text-decoration: line-through; text-decoration-color: rgba(192, 65, 60, 0.5);
  &.none { color: var(--c-text-2); text-decoration: none; font-style: italic; font-size: 12px; }
}
.row .zh { flex: 1; font-size: 13px; color: var(--c-text-2); }
.times {
  font-size: 11.5px; padding: 2px 8px; border-radius: 9999px;
  background: var(--c-surface-2); color: var(--c-text-2);
  &.hot { background: rgba(217, 83, 79, 0.12); color: #c0413c; }
}
.date { font-size: 12px; color: var(--c-text-2); min-width: 76px; text-align: right; }
</style>

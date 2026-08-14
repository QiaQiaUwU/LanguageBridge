<template>
  <div class="list-page">
    <header class="page-head">
      <button class="ghost-btn small" @click="$router.push('/home')">← 主页</button>
      <div>
        <h2 class="title">错词本</h2>
        <p class="sub">听写和默写里打错过的词，按次数累计。答对一次会自动移出。</p>
      </div>
    </header>

    <div class="toolbar">
      <div class="chip-row">
        <button class="chip" :class="{ on: sortBy === 'recent' }" @click="sortBy = 'recent'">最近错的</button>
        <button class="chip" :class="{ on: sortBy === 'count' }" @click="sortBy = 'count'">错得最多</button>
      </div>
      <input v-model="keyword" class="search" placeholder="搜索单词" />
      <button class="dark-btn small" :disabled="!dictateIds.length" @click="dictateThese">
        听写这些错词（{{ dictateIds.length }}）
      </button>
      <button class="ghost-btn small" :disabled="!dictateIds.length" @click="studyThese">
        进学习流程
      </button>
      <button v-if="picked.size" class="ghost-btn small" @click="removePicked">
        移出（{{ picked.size }}）
      </button>
    </div>

    <section v-if="calendar.length" class="calendar">
      <div class="cal-head">
        <span class="sec-title">错词日历</span>
        <span class="cal-hint">点某一天只看那天错的</span>
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

    <p v-if="!filtered.length" class="empty">
      {{ rows.length ? '当前筛选下没有错词。' : '还没有错词。听写或默写打错的词会自动进到这里。' }}
    </p>

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
.page-head { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 16px; }
.title { font-size: 19px; margin: 0 0 4px; }
.sub { font-size: 12.5px; color: var(--r-ink2, #888); margin: 0; line-height: 1.6; }
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.chip-row { display: flex; gap: 6px; }
.chip {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  padding: 5px 12px; border-radius: 9999px; font-size: 13px; cursor: pointer;
  border: 1px solid var(--r-border, #ddd); background: transparent; color: inherit;
  &.on { background: var(--r-accent, #8a4b3a); color: var(--r-paper, #fff); border-color: transparent; }
}
.search {
  padding: 6px 10px; border: 1px solid var(--r-border, #ddd); border-radius: 8px;
  background: var(--r-ui, #fafafa); color: inherit; font-size: 13.5px; min-width: 160px; flex: 1;
}
.calendar { margin-bottom: 16px; }
.cal-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.sec-title { font-size: 13.5px; font-weight: 600; color: var(--r-ink2, #666); }
.cal-hint { font-size: 12px; color: var(--r-ink2, #aaa); }
.cal-row { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
.cal-cell {
  flex-shrink: 0; min-width: 56px; padding: 7px 6px; border-radius: 9px;
  border: 1px solid var(--r-border, #eee); background: var(--r-ui, #f7f7f7);
  cursor: pointer; display: flex; flex-direction: column; gap: 2px; color: inherit;
  &.on { border-color: var(--r-accent, #8a4b3a); background: var(--r-paper, #fff); }
}
.cal-day { font-size: 11.5px; color: var(--r-ink2, #999); }
.cal-count { font-size: 15px; font-weight: 600; }
.empty { color: var(--r-ink2, #999); font-size: 13.5px; padding: 46px 0; text-align: center; line-height: 1.7; }
.rows { list-style: none; padding: 0; margin: 0; }
.row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 4px; border-bottom: 1px solid var(--r-border, #eee); font-size: 14px;
}
.pick { display: flex; align-items: center; }
.row .w { min-width: 130px; font-weight: 500; }
.wrong-input {
  min-width: 110px; font-size: 13px; color: #c0413c;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  text-decoration: line-through; text-decoration-color: rgba(192, 65, 60, 0.5);
  &.none { color: var(--r-ink2, #bbb); text-decoration: none; font-style: italic; font-size: 12px; }
}
.row .zh { flex: 1; font-size: 13px; color: var(--r-ink2, #777); }
.times {
  font-size: 11.5px; padding: 2px 8px; border-radius: 9999px;
  background: var(--r-ui, #f0f0f0); color: var(--r-ink2, #888);
  &.hot { background: rgba(217, 83, 79, 0.12); color: #c0413c; }
}
.date { font-size: 12px; color: var(--r-ink2, #aaa); min-width: 76px; text-align: right; }
</style>

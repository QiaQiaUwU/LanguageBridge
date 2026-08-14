<template>
  <div class="list-page">
    <header class="page-head">
      <button class="ghost-btn small" @click="$router.push('/home')">← 主页</button>
      <div>
        <h2 class="title">生词本</h2>
        <p class="sub">标为「不认识」和「模糊」的词。跟「已掌握」相反，这些是要重点练的。</p>
      </div>
    </header>

    <div class="toolbar">
      <div class="chip-row">
        <button class="chip" :class="{ on: statusFilter === 'all' }" @click="statusFilter = 'all'">
          全部 <span class="c">{{ counts.all }}</span>
        </button>
        <button class="chip" :class="{ on: statusFilter === 'unknown' }" @click="statusFilter = 'unknown'">
          不认识 <span class="c">{{ counts.unknown }}</span>
        </button>
        <button class="chip" :class="{ on: statusFilter === 'fuzzy' }" @click="statusFilter = 'fuzzy'">
          模糊 <span class="c">{{ counts.fuzzy }}</span>
        </button>
      </div>
      <input v-model="keyword" class="search" placeholder="搜索单词或释义" />
      <button class="dark-btn small" :disabled="!filtered.length" @click="studyThese">
        练这批（{{ filtered.length }}）
      </button>
    </div>

    <section v-if="calendar.length" class="calendar">
      <div class="cal-head">
        <span class="sec-title">生词日历</span>
        <span class="cal-hint">点某一天只看那天标的词</span>
      </div>
      <div class="cal-row">
        <button
          v-for="d in calendar"
          :key="d.date"
          class="cal-cell"
          :class="{ on: dateFilter === d.date }"
          :title="`${d.date} 新增 ${d.count} 个`"
          @click="dateFilter = dateFilter === d.date ? '' : d.date"
        >
          <span class="cal-day">{{ d.label }}</span>
          <span class="cal-count">{{ d.count }}</span>
        </button>
      </div>
    </section>

    <p v-if="!filtered.length" class="empty">
      {{ words.length ? '当前筛选下没有词。' : '还没有生词。在词汇中心把词标成「不认识」或「模糊」，它们会出现在这里。' }}
    </p>

    <ul v-else class="rows">
      <li v-for="w in filtered" :key="w.id" class="row">
        <span class="w">{{ w.word }}</span>
        <span class="ph">{{ w.phonetic }}</span>
        <span class="zh">{{ w.meanings?.[0]?.chinese || '—' }}</span>
        <span class="badge" :class="w.status">{{ w.status === 'unknown' ? '不认识' : '模糊' }}</span>
        <button class="ghost-btn tiny" @click="markKnown(w)">标为认识</button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { commitScope } from '@/shared/core/studyScope'
import { useWordStore } from '@/shared/stores/wordStore'
import type { WordItem } from '@/shared/types/WordItem'

const router = useRouter()
const wordStore = useWordStore()

const statusFilter = ref<'all' | 'unknown' | 'fuzzy'>('all')
const keyword = ref('')
const dateFilter = ref('')

const words = computed(() =>
  wordStore.words.filter(w => w.status === 'unknown' || w.status === 'fuzzy')
)

const counts = computed(() => ({
  all: words.value.length,
  unknown: words.value.filter(w => w.status === 'unknown').length,
  fuzzy: words.value.filter(w => w.status === 'fuzzy').length
}))

const calendar = computed(() => {
  const byDate = new Map<string, number>()
  for (const w of words.value) {
    const d = (w.updatedAt || w.createdAt || '').slice(0, 10)
    if (d) byDate.set(d, (byDate.get(d) || 0) + 1)
  }
  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 14)
    .map(([date, count]) => ({ date, count, label: date.slice(5) }))
})

const filtered = computed(() => {
  let list = words.value
  if (statusFilter.value !== 'all') list = list.filter(w => w.status === statusFilter.value)
  if (dateFilter.value) {
    list = list.filter(w => (w.updatedAt || w.createdAt || '').slice(0, 10) === dateFilter.value)
  }
  const k = keyword.value.trim().toLowerCase()
  if (k) {
    list = list.filter(
      w => w.word.toLowerCase().includes(k) || w.meanings?.some(m => m.chinese?.includes(k))
    )
  }
  return list
})

async function markKnown(w: WordItem) {
  await wordStore.setWordStatus(w.id, 'known')
}

function studyThese() {
  const ids = filtered.value.map(w => w.id)
  if (!ids.length) return
  router.push(commitScope({ kind: 'adhoc', ids, label: `生词本 · ${ids.length} 词` }))
}

onMounted(() => wordStore.loadWords())
</script>

<style scoped lang="scss">
.list-page { max-width: 900px; margin: 0 auto; padding: 18px 20px 60px; }
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
  .c { opacity: 0.6; margin-left: 4px; font-size: 12px; }
}
.search {
  padding: 6px 10px; border: 1px solid var(--r-border, #ddd); border-radius: 8px;
  background: var(--r-ui, #fafafa); color: inherit; font-size: 13.5px; min-width: 180px; flex: 1;
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
.row .w { min-width: 130px; font-weight: 500; }
.row .ph { min-width: 110px; font-size: 12.5px; color: var(--r-ink2, #999); }
.row .zh { flex: 1; font-size: 13px; color: var(--r-ink2, #777); }
.badge {
  font-size: 11.5px; padding: 2px 8px; border-radius: 9999px;
  &.unknown { background: rgba(217, 83, 79, 0.12); color: #c0413c; }
  &.fuzzy { background: rgba(217, 130, 43, 0.12); color: #b8701f; }
}
.ghost-btn.tiny { font-size: 12px; padding: 3px 9px; }
</style>

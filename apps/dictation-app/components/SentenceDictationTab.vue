<template>
  <div class="sdt">
    <SearchBox v-model="q" />

    <div class="sdt-grid">
      <section class="sdt-col">
        <p class="sdt-label">文章</p>
        <EmptyState v-if="!list.length" />
        <button v-for="a in list" :key="a.id" class="sdt-row" @click="open(a.id)">
          <span class="sdt-title">{{ a.title }}</span>
          <span class="sdt-meta">{{ a.count }} 句<i v-if="a.timed" class="ri-volume-up-line" title="原音"></i></span>
          <span v-if="lastOf(a.id)" class="sdt-score">{{ lastOf(a.id) }}</span>
        </button>
      </section>

      <section class="sdt-col">
        <p class="sdt-label">记录</p>
        <EmptyState v-if="!records.length" />
        <button v-for="r in records.slice(0, 30)" :key="r.id" class="sdt-row" @click="$router.push(`/dictation/record/${r.id}`)">
          <span class="sdt-title">{{ r.articleTitle }}</span>
          <span class="sdt-meta">{{ r.date }} · {{ r.items.length }} 句</span>
          <span class="sdt-score">{{ r.accuracy }}</span>
        </button>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useReaderStore } from '@/apps/reading-assistant/stores/readerStore'
import { listStudyRecords, type DictationRecord } from '@/shared/core/studyRecords'

const router = useRouter()
const reader = useReaderStore()
const q = ref('')
const records = ref<DictationRecord[]>([])

/** 有句子的文章和章节；书本身只是目录，不列 */
const list = computed(() => {
  const k = q.value.trim().toLowerCase()
  return reader.articles
    .filter(a => !a.isBook && a.sentences?.some(s => s.en?.trim()))
    .filter(a => !k || a.title.toLowerCase().includes(k))
    .map(a => ({
      id: a.id,
      title: a.title,
      count: a.sentences.filter(s => s.en?.trim()).length,
      timed: !!a.audioUrl && a.sentences.some(s => s.audioStart != null),
      time: a.updatedAt || a.createdAt || ''
    }))
    .sort((x, y) => y.time.localeCompare(x.time))
    .slice(0, 200)
})

const lastScore = computed(() => {
  const m = new Map<string, number>()
  for (const r of records.value) if (!m.has(r.articleId)) m.set(r.articleId, r.accuracy)
  return m
})
function lastOf(id: string) { return lastScore.value.get(id) }

function open(id: string) { router.push(`/dictation/article/${id}`) }

onMounted(async () => {
  if (!reader.articles.length) reader.loadArticles()
  records.value = (await listStudyRecords()).filter((r): r is DictationRecord => r.type === 'dictation')
})
</script>

<style scoped>
.sdt { display: flex; flex-direction: column; gap: var(--space-sm); }
.sdt-grid { display: grid; grid-template-columns: 3fr 2fr; gap: var(--space-md); }
.sdt-col { display: flex; flex-direction: column; gap: 2px; max-height: 60vh; overflow-y: auto; }
.sdt-label { margin: 0 0 var(--space-xs); font-size: var(--text-xs); color: var(--c-text-3); }
.sdt-row {
  display: flex; align-items: center; gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm); border: none; border-radius: var(--radius-md);
  background: transparent; color: var(--c-text); font: inherit; text-align: left; cursor: pointer;
  transition: background var(--dur-base);
}
.sdt-row:hover { background: var(--c-hover); }
.sdt-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-sm); }
.sdt-meta { flex-shrink: 0; color: var(--c-text-3); font-size: var(--text-xs); display: inline-flex; gap: 4px; align-items: center; }
.sdt-score { flex-shrink: 0; min-width: 2.2em; text-align: right; font-weight: 700; color: var(--c-accent); font-size: var(--text-sm); }
@media (max-width: 900px) { .sdt-grid { grid-template-columns: 1fr; } }
</style>

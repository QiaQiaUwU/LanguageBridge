<template>
  <div class="notes-page">
    <header class="page-head">
      <button class="ghost-btn small" @click="$router.push('/home')">← 主页</button>
      <div>
        <h2 class="title">学习笔记</h2>
        <p class="sub">按学习时间倒序。阅读文章时记的笔记、以后场景实战的评价记录，都会汇到这里。</p>
      </div>
    </header>

    <div class="toolbar">
      <select v-model="groupFilter" class="mini-select">
        <option value="">全部分类</option>
        <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
        <option value="__none">未分组</option>
      </select>
      <input v-model="keyword" class="search" placeholder="搜索笔记内容或标题" />
      <span class="count">{{ filtered.length }} 条</span>
    </div>

    <p v-if="!filtered.length" class="empty">
      {{ items.length ? '当前筛选下没有笔记。' : '还没有笔记。在阅读助手里划线记笔记，这里就会出现。' }}
    </p>

    <ul v-else class="timeline">
      <li v-for="it in filtered" :key="it.id" class="entry">
        <div class="entry-meta">
          <span class="date">{{ formatDate(it.time) }}</span>
          <span v-if="it.groupName" class="group-tag">{{ it.groupName }}</span>
        </div>
        <div class="entry-body">
          <button class="entry-title" @click="openSource(it)">{{ it.title }}</button>
          <p class="entry-preview">{{ it.preview }}</p>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useReaderStore } from '@/apps/reading-assistant/stores/readerStore'

interface NoteEntry {
  id: string
  title: string
  time: string
  groupId?: string
  groupName?: string
  preview: string
}

const router = useRouter()
const readerStore = useReaderStore()

const groupFilter = ref('')
const keyword = ref('')

const groups = computed(() => readerStore.groups)

function toPreview(html: string): string {
  if (!html) return ''
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
    return text.length > 140 ? text.slice(0, 140) + '…' : text
  } catch {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140)
  }
}

const items = computed<NoteEntry[]>(() => {
  const groupName = new Map(readerStore.groups.map(g => [g.id, g.name]))
  return readerStore.articles
    .filter(a => a.notes && toPreview(a.notes).length > 0)
    .map(a => ({
      id: a.id,
      title: a.title,
      time: a.updatedAt || a.createdAt || '',
      groupId: a.groupId,
      groupName: a.groupId ? groupName.get(a.groupId) : undefined,
      preview: toPreview(a.notes)
    }))
    .sort((a, b) => b.time.localeCompare(a.time))
})

const filtered = computed(() => {
  let list = items.value
  if (groupFilter.value === '__none') list = list.filter(i => !i.groupId)
  else if (groupFilter.value) list = list.filter(i => i.groupId === groupFilter.value)
  const k = keyword.value.trim().toLowerCase()
  if (k) list = list.filter(i => i.title.toLowerCase().includes(k) || i.preview.toLowerCase().includes(k))
  return list
})

function formatDate(t: string): string {
  if (!t) return '—'
  const d = new Date(t)
  if (isNaN(d.getTime())) return t.slice(0, 10)
  const today = new Date()
  const sameYear = d.getFullYear() === today.getFullYear()
  return sameYear
    ? `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : d.toLocaleDateString('zh-CN')
}

function openSource(it: NoteEntry) {
  readerStore.selectArticle(it.id)
  router.push('/reading')
}

onMounted(() => readerStore.loadArticles())
</script>

<style scoped lang="scss">
.notes-page { max-width: 880px; margin: 0 auto; padding: 18px 20px 60px; }
.page-head { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 16px; }
.title { font-size: 19px; margin: 0 0 4px; }
.sub { font-size: 12.5px; color: var(--r-ink2, #888); margin: 0; line-height: 1.6; }
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; flex-wrap: wrap; }
.mini-select, .search {
  padding: 6px 10px; border: 1px solid var(--r-border, #ddd); border-radius: 8px;
  background: var(--r-ui, #fafafa); color: inherit; font-size: 13.5px;
}
.search { flex: 1; min-width: 160px; }
.count { font-size: 12.5px; color: var(--r-ink2, #999); }
.empty { color: var(--r-ink2, #999); font-size: 13.5px; padding: 46px 0; text-align: center; line-height: 1.7; }

.timeline { list-style: none; padding: 0; margin: 0; }
.entry {
  display: flex; gap: 16px; padding: 14px 0;
  border-bottom: 1px solid var(--r-border, #eee);
}
.entry-meta { width: 132px; flex-shrink: 0; display: flex; flex-direction: column; gap: 5px; }
.date { font-size: 12.5px; color: var(--r-ink2, #999); }
.group-tag {
  font-size: 11.5px; padding: 2px 8px; border-radius: 9999px; align-self: flex-start;
  background: var(--r-ui, #f0f0f0); color: var(--r-ink2, #777);
}
.entry-body { flex: 1; min-width: 0; }
.entry-title {
  border: none; background: none; padding: 0; cursor: pointer;
  font-size: 14.5px; font-weight: 600; color: var(--r-ink, #1c1c1c); text-align: left;
  &:hover { color: var(--r-accent, #8a4b3a); }
}
.entry-preview {
  font-size: 13px; color: var(--r-ink2, #777); line-height: 1.7; margin: 5px 0 0;
}
@media (max-width: 640px) {
  .entry { flex-direction: column; gap: 6px; }
  .entry-meta { width: auto; flex-direction: row; align-items: center; gap: 8px; }
}
</style>

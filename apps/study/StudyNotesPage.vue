<template>
  <div class="notes-page">
    <header class="page-head">
      <BackLink label="主页" to="/home" />
      <h2 class="title">学习记录</h2>
    </header>

    <div class="toolbar">
      <select v-model="groupFilter" class="mini-select">
        <option value="">全部分类</option>
        <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
        <option value="__none">未分组</option>
      </select>
      <select v-model="kindFilter" class="mini-select">
        <option value="">全部类型</option>
        <option value="note">笔记</option>
        <option value="ai">AI 文章</option>
        <option value="dictation">听写</option>
        <option value="familyNote">词族笔记</option>
      </select>
      <input v-model="keyword" class="search" placeholder="搜索" />
      <span class="count">{{ filtered.length }} 条</span>
    </div>

    <EmptyState v-if="!filtered.length" />

    <ul v-else class="timeline">
      <li v-for="it in filtered" :key="it.key" class="entry">
        <div class="entry-meta">
          <span class="date">{{ formatDate(it.time) }}</span>
          <span v-if="it.groupName" class="group-tag">{{ it.groupName }}</span>
          <span v-if="it.aiLabel" class="ai-tag">{{ it.aiLabel }}</span>
          <span v-if="it.score != null" class="score-tag">{{ it.score }}</span>
        </div>

        <div class="entry-body">
          <!-- 改标题 -->
          <!-- 章节笔记的标题是「文章名 · 章名」拼出来的，改不了单独的标题，
               所以只有整篇笔记和文章才给输入框，免得改了没反应 -->
          <input
            v-if="editingKey === it.key && it.kind !== 'chapterNote'"
            v-model="draftTitle"
            class="edit-title"
            placeholder="标题"
          />
          <button v-else class="entry-title" @click="openSource(it)">{{ it.title }}</button>

          <!-- 改正文。笔记是富文本，用 contenteditable 编辑，
               不用 textarea —— 那样存回去会把划线和格式全抹平。 -->
          <div
            v-if="editingKey === it.key && it.kind !== 'article'"
            ref="editorEl"
            class="edit-body"
            contenteditable="true"
            @input="onEditorInput"
          ></div>
          <p v-else class="entry-preview">{{ it.preview }}</p>


          <div class="entry-acts">
            <template v-if="editingKey === it.key">
              <button class="ghost-btn tiny" @click="cancelEdit">取消</button>
              <button class="dark-btn tiny" @click="saveEdit(it)">保存</button>
            </template>
            <template v-else>
              <button v-if="!isRecord(it)" class="ghost-btn tiny" @click="startEdit(it)">编辑</button>
              <button class="ghost-btn tiny danger" @click="askDelete(it)">删除</button>
            </template>
          </div>
        </div>
      </li>
    </ul>

    <div v-if="pendingDelete" class="del-mask" @click.self="pendingDelete = null">
      <div class="del-card">
        <h3>删除这条记录？</h3>
        <div class="del-acts">
          <button class="ghost-btn" @click="pendingDelete = null">取消</button>
          <button class="dark-btn" @click="confirmDelete">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useReaderStore } from '@/apps/reading-assistant/stores/readerStore'
import { listStudyRecords, deleteStudyRecord, type StudyRecord } from '@/shared/core/studyRecords'

interface NoteEntry {
  /** 列表 key。同一篇文章可能有好几条（整篇笔记 + 各章笔记），光用 id 会撞 */
  key: string
  id: string
  title: string
  time: string
  groupId?: string
  groupName?: string
  preview: string
  /** 第几章的笔记；-1 表示这是整篇的笔记 */
  chapterIdx: number
  /**
   * note        整篇笔记（存在 a.notes）
   * chapterNote 某一章的笔记（存在 a.chapterNotes[i]）
   * article     AI 生成的文章本身（正文在 a.sentences，没有笔记）
   */
  kind: 'note' | 'chapterNote' | 'article' | 'dictation' | 'familyNote'
  /** 听写正确率 */
  score?: number
  /** 生成来源的中文标签，没有就不是 AI 生成的 */
  aiLabel?: string
  /** 编辑时要回填的原始 HTML */
  html: string
}

/** source 字段 → 界面上显示的标签。场景学习那几种产物都是调 AI 生成的，值得标出来 */
const AI_SOURCE_LABEL: Record<string, string> = {
  'scenario-podcast': 'AI · 播客文章',
  'scenario-reading': 'AI · 场景阅读',
  'scenario-note': '场景实战'
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

const records = ref<StudyRecord[]>([])
function isRecord(it: NoteEntry) { return it.kind === 'dictation' || it.kind === 'familyNote' }

const items = computed<NoteEntry[]>(() => {
  const groupName = new Map(readerStore.groups.map(g => [g.id, g.name]))
  const out: NoteEntry[] = []

  for (const a of readerStore.articles) {
    /**
     * 笔记有两个存放处，两个都要看。
     *
     * 单篇文章存在 a.notes；多章文章和书存在 a.chapterNotes（一章一条）——
     * 保存时是 `notes: chapterCount > 1 ? 原样 : 新内容`，
     * 也就是多章的情况下 a.notes 永远是空的。
     * 这个页面原来只筛 a.notes，所以书和长文的笔记一条都出不来。
     */
    const aiLabel = a.source ? AI_SOURCE_LABEL[a.source] : undefined

    const single = toPreview(a.notes || '')
    if (single) {
      out.push({
        key: a.id + ':note',
        id: a.id,
        title: a.title,
        time: a.updatedAt || a.createdAt || '',
        groupId: a.groupId,
        groupName: a.groupId ? groupName.get(a.groupId) : undefined,
        preview: single,
        chapterIdx: -1,
        kind: 'note',
        aiLabel,
        html: a.notes || ''
      })
    }

    const chapters = a.chapters || []
    ;(a.chapterNotes || []).forEach((note, i) => {
      const preview = toPreview(note || '')
      if (!preview) return
      out.push({
        key: `${a.id}:ch${i}`,
        id: a.id,
        // 标出是哪一章，不然同一篇的几条笔记看着一模一样
        title: chapters[i]?.title ? `${a.title} · ${chapters[i].title}` : `${a.title} · 第 ${i + 1} 部分`,
        time: a.updatedAt || a.createdAt || '',
        groupId: a.groupId,
        groupName: a.groupId ? groupName.get(a.groupId) : undefined,
        preview,
        chapterIdx: i,
        kind: 'chapterNote',
        aiLabel,
        html: note || ''
      })
    })

    /**
     * AI 生成的文章本身也算一条学习记录。
     *
     * 这些是调接口生成的（花过钱），原来只存进文章列表，
     * 生成完提示一句就没了，在这个页面一条都看不到 ——
     * 因为这里只筛 notes 非空的条目，而它们的 notes 是空的。
     * 只列 AI 生成的，普通导入的文章不进来，不然这页会被文章淹掉。
     */
    if (aiLabel && a.sentences?.length) {
      out.push({
        key: a.id + ':art',
        id: a.id,
        title: a.title,
        time: a.updatedAt || a.createdAt || '',
        groupId: a.groupId,
        groupName: a.groupId ? groupName.get(a.groupId) : undefined,
        preview: a.sentences.slice(0, 3).map(x => x.en).join(' '),
        chapterIdx: -1,
        kind: 'article',
        aiLabel,
        html: ''
      })
    }
  }

  for (const r of records.value) {
    if (r.type === 'dictation') {
      out.push({
        key: r.id, id: r.id, title: `听写 · ${r.articleTitle}`, time: r.createdAt,
        preview: `${r.items.length} 句 · 漏词 ${r.counts.miss} · 拼错 ${r.counts.typo}`,
        chapterIdx: -1, kind: 'dictation', score: r.accuracy, html: ''
      })
    } else {
      out.push({
        key: r.id, id: r.id, title: `词族 · ${r.title}`, time: r.createdAt,
        preview: (r.note.branches.length
          ? r.note.branches.map(b => b.words.map(w => w.word).join(' ')).join(' · ')
          : (r.note.tree?.children || []).map(c => [c.label, ...c.children.map(x => x.label)].join(' ')).join(' · ')
        ).slice(0, 140),
        chapterIdx: -1, kind: 'familyNote', html: ''
      })
    }
  }

  return out.sort((a, b) => b.time.localeCompare(a.time))
})

const kindFilter = ref('')

const filtered = computed(() => {
  let list = items.value
  if (groupFilter.value === '__none') list = list.filter(i => !i.groupId)
  else if (groupFilter.value) list = list.filter(i => i.groupId === groupFilter.value)
  if (kindFilter.value === 'note') list = list.filter(i => i.kind === 'note' || i.kind === 'chapterNote')
  else if (kindFilter.value === 'ai') list = list.filter(i => i.kind === 'article')
  else if (kindFilter.value) list = list.filter(i => i.kind === kindFilter.value)
  const k = keyword.value.trim().toLowerCase()
  if (k) list = list.filter(i => i.title.toLowerCase().includes(k) || i.preview.toLowerCase().includes(k))
  return list
})

/* ---------- 编辑 ---------- */

const editingKey = ref('')
const draftTitle = ref('')
const draftHtml = ref('')
const editorEl = ref<HTMLElement | HTMLElement[] | null>(null)

function currentEditor(): HTMLElement | null {
  // v-for 里的 ref 会收成数组，这里同一时刻只可能有一个在编辑
  const e = editorEl.value
  return Array.isArray(e) ? (e[0] || null) : e
}

function startEdit(it: NoteEntry) {
  editingKey.value = it.key
  draftTitle.value = it.title
  draftHtml.value = it.html
  if (it.kind === 'article') return
  // contenteditable 不能用 v-model，挂载后手动把原文塞进去
  nextTick(() => {
    const el = currentEditor()
    if (el) el.innerHTML = it.html
  })
}

function onEditorInput() {
  const el = currentEditor()
  if (el) draftHtml.value = el.innerHTML
}

function cancelEdit() {
  editingKey.value = ''
  draftTitle.value = ''
  draftHtml.value = ''
}

async function saveEdit(it: NoteEntry) {
  const a = readerStore.articles.find(x => x.id === it.id)
  if (!a) { cancelEdit(); return }
  const now = new Date().toISOString()

  if (it.kind === 'chapterNote') {
    const notes = [...(a.chapterNotes || [])]
    notes[it.chapterIdx] = draftHtml.value
    await readerStore.saveArticle({ ...a, chapterNotes: notes, updatedAt: now })
  } else if (it.kind === 'note') {
    // 章节笔记的标题是拼出来的（文章名 · 章名），只有整篇笔记和文章能改标题
    await readerStore.saveArticle({
      ...a,
      title: draftTitle.value.trim() || a.title,
      notes: draftHtml.value,
      updatedAt: now
    })
  } else {
    await readerStore.saveArticle({ ...a, title: draftTitle.value.trim() || a.title, updatedAt: now })
  }
  cancelEdit()
}

/* ---------- 删除 ---------- */

const pendingDelete = ref<NoteEntry | null>(null)


function askDelete(it: NoteEntry) {
  pendingDelete.value = it
}

async function confirmDelete() {
  const it = pendingDelete.value
  if (!it) return
  pendingDelete.value = null
  if (isRecord(it)) {
    await deleteStudyRecord(it.id)
    records.value = records.value.filter(r => r.id !== it.id)
    return
  }
  const a = readerStore.articles.find(x => x.id === it.id)
  if (!a) return

  if (it.kind === 'article' || !a.sentences?.length) {
    await readerStore.deleteArticle(a.id)
    return
  }
  const now = new Date().toISOString()
  if (it.kind === 'chapterNote') {
    const notes = [...(a.chapterNotes || [])]
    notes[it.chapterIdx] = ''
    await readerStore.saveArticle({ ...a, chapterNotes: notes, updatedAt: now })
  } else {
    await readerStore.saveArticle({ ...a, notes: '', updatedAt: now })
  }
}

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
  if (it.kind === 'dictation') { router.push(`/dictation/record/${it.id}`); return }
  if (it.kind === 'familyNote') { router.push({ path: '/universe', query: { note: it.id } }); return }
  readerStore.selectArticle(it.id)
  // 带上章号，阅读助手打开后直接翻到那一章的笔记页
  if (it.chapterIdx >= 0) sessionStorage.setItem('lb-open-note-page', String(it.chapterIdx))
  router.push('/reading')
}

onMounted(async () => {
  readerStore.loadArticles()
  records.value = await listStudyRecords()
})
</script>

<style scoped lang="scss">
.notes-page { max-width: 880px; margin: 0 auto; padding: 18px 20px 60px; }
.page-head { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 16px; }
.title { font-size: 19px; margin: 0 0 4px; }
.score-tag { font-weight: 700; color: var(--c-accent); font-size: var(--text-xs); }
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; flex-wrap: wrap; }
.mini-select, .search {
  padding: 6px 10px; border: 1px solid var(--c-line); border-radius: 8px;
  background: var(--c-surface-2); color: inherit; font-size: 13.5px;
}
.search { flex: 1; min-width: 160px; }
.count { font-size: 12.5px; color: var(--c-text-2); }
.empty { color: var(--c-text-2); font-size: 13.5px; padding: 46px 0; text-align: center; line-height: 1.7; }

.timeline { list-style: none; padding: 0; margin: 0; }
.entry {
  display: flex; gap: 16px; padding: 14px 0;
  border-bottom: 1px solid var(--c-line);
}
.entry-meta { width: 132px; flex-shrink: 0; display: flex; flex-direction: column; gap: 5px; }
.date { font-size: 12.5px; color: var(--c-text-2); }
.group-tag {
  font-size: 11.5px; padding: 2px 8px; border-radius: 9999px; align-self: flex-start;
  background: var(--c-surface-2); color: var(--c-text-2);
}
.entry-body { flex: 1; min-width: 0; }
.entry-title {
  border: none; background: none; padding: 0; cursor: pointer;
  font-size: 14.5px; font-weight: 600; color: var(--c-text); text-align: left;
  &:hover { color: var(--c-accent); }
}
.entry-preview {
  font-size: 13px; color: var(--c-text-2); line-height: 1.7; margin: 5px 0 0;
}
.ai-tag {
  font-size: 11.5px; padding: 2px 8px; border-radius: 9999px; align-self: flex-start;
  background: color-mix(in srgb, var(--c-accent) 12%, transparent);
  color: var(--c-accent);
}
.entry-acts { display: flex; gap: 8px; margin-top: 8px; }
.tiny { font-size: 12px; padding: 3px 10px; border-radius: 7px; }
.ghost-btn.danger:hover { color: var(--c-danger); }
.edit-title {
  width: 100%; padding: 6px 10px; font-family: inherit; font-size: 14.5px; font-weight: 600;
  border: 1px solid var(--c-line); border-radius: 8px;
  background: transparent; color: var(--c-text);
}
.edit-body {
  margin-top: 8px; padding: 8px 10px; min-height: 76px;
  border: 1px solid var(--c-line); border-radius: 8px;
  font-size: 13.5px; line-height: 1.7; color: var(--c-text);
  outline: none;
  &:focus { border-color: var(--c-accent); }
}
.edit-hint { font-size: 12px; color: var(--c-text-2); margin: 6px 0 0; }

.del-mask {
  position: fixed; inset: 0; z-index: 60;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, .28);
}
.del-card {
  background: var(--c-surface); border-radius: 14px; padding: 22px 24px;
  max-width: 340px; text-align: center;
  box-shadow: 0 14px 40px rgba(0, 0, 0, .18);
}
.del-card h3 { margin: 0 0 8px; font-size: 16px; }
.del-sub { font-size: 13px; color: var(--c-text-2); line-height: 1.7; margin: 0; }
.del-acts { display: flex; gap: 10px; justify-content: center; margin-top: 16px; }

@media (max-width: 640px) {
  .entry { flex-direction: column; gap: 6px; }
  .entry-meta { width: auto; flex-direction: row; align-items: center; gap: 8px; }
}
</style>

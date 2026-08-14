<template>
  <div class="home">
    <section class="top-row">
      <div class="universe-card" @dblclick="go('/universe')">
        <div class="universe-preview">
          <WordGraph3D
            v-if="previewNodes.length"
            :nodes="previewNodes"
            :links="previewLinks"
            click-mode="none"
          />
          <p v-else class="preview-empty">导入词表后，这里会显示词汇之间的语义关系</p>
        </div>
        <div class="universe-foot">
          <span class="universe-name">词汇宇宙</span>
          <span class="universe-sub">
            {{ studyGroup?.name || studyTag || '全部单词' }} · {{ previewNodes.length }} 词 · {{ previewLinks.length }} 关系
            <em class="legend-inline">越亮 = 掌握得越好</em>
          </span>
        </div>
      </div>

      <button class="entry-card tall" @click="go('/words')">
        <span class="entry-name">总词库</span>
        <span class="entry-num">{{ wordStore.words.length }}</span>
        <span class="entry-sub">全部单词，按考试 / 话题 / 词根词族筛选</span>
      </button>
    </section>

    <section class="task-card">
      <div class="task-top">
        <div class="task-left">
          <h2 class="task-book">{{ studyGroup?.name || '全部单词' }}</h2>
          <p class="task-eta">预计完成日期：{{ etaDate }}</p>
          <div class="progress-bar"><div class="progress-fill" :style="{ width: progressPercent + '%' }"></div></div>
          <div class="progress-line">
            <span>当前进度：已学 {{ progressPercent }}%</span>
            <span>{{ overview.learnedIndex }} / {{ overview.total }} 词</span>
          </div>
          <div class="task-tools">
            <button class="ghost-btn small" @click="showPicker = true">选择词表</button>
            <button class="ghost-btn small" @click="showSetting = true">更改进度</button>
            <button class="ghost-btn small" @click="go('/mastered')">学习记录</button>
          </div>
        </div>

        <div class="task-right">
          <div class="task-goal">
            每日目标 <b>{{ overview.perDay }}</b> 个单词
            <button class="ghost-btn tiny" @click="showSetting = true">更改</button>
          </div>
          <div class="task-nums">
            <div class="task-num"><span class="n">{{ overview.newCount }}</span><span class="l">新词</span></div>
            <div class="task-num"><span class="n review">{{ overview.reviewCount }}</span><span class="l">复习</span></div>
          </div>
          <div class="task-btns">
            <button class="start-btn" @click="startStudy">
              {{ overview.learnedIndex > 0 ? '继续学习' : '开始学习' }} →
            </button>
            <button class="free-btn" @click="startReview">复习{{ dueCount ? ` ${dueCount}` : '' }}</button>
          </div>
        </div>
      </div>
    </section>

    <section class="grid-section">
      <h3 class="sec-title">学习</h3>
      <div class="entry-grid">
        <button class="entry-card" @click="go('/new-words')">
          <span class="entry-name">生词本</span>
          <span class="entry-num">{{ newWordCount }}</span>
        </button>
        <button class="entry-card" @click="go('/wrong-book')">
          <span class="entry-name">错词本</span>
          <span class="entry-num">{{ wrongBookCount }}</span>
        </button>
        <button class="entry-card" @click="go('/mastered')">
          <span class="entry-name">已掌握</span>
          <span class="entry-num">{{ masteredCount }}</span>
        </button>
        <button class="entry-card" @click="go('/study-notes')">
          <span class="entry-name">学习笔记</span>
          <span class="entry-num">{{ noteCount }}</span>
        </button>
      </div>
    </section>

    <section class="grid-section">
      <h3 class="sec-title">我的词表</h3>
      <div class="entry-grid">
        <button v-for="g in myWordLists" :key="g.id" class="entry-card small" @click="openBook(g.id)">
          <span class="entry-name">{{ g.name }}</span>
          <span class="entry-num">{{ g.wordIds.length }}</span>
        </button>
        <button class="entry-card small dashed" @click="showImport = true">
          <span class="entry-name">+ 新建 / 导入词表</span>
        </button>
      </div>
      <p v-if="!myWordLists.length" class="sec-hint">
      </p>
    </section>

    <section class="stat-card">
      <div class="stat-left">
        <h3 class="sec-title">统计</h3>
        <div class="stat-row">
          <div class="stat-box"><span class="n">{{ todayMinutes }}<em>分钟</em></span><span class="l">今日学习时长</span></div>
          <div class="stat-box"><span class="n">{{ streak }}<em>天</em></span><span class="l">连续学习天数</span></div>
          <div class="stat-box"><span class="n">{{ totalMinutes }}<em>分钟</em></span><span class="l">累计学习时长</span></div>
        </div>
      </div>
      <div class="stat-right">
        <div class="week-head">
          <span class="sec-title">本周学习记录</span>
          <button class="ghost-btn tiny" @click="showMonth = !showMonth">{{ showMonth ? '周' : '月' }}</button>
        </div>
        <div v-if="!showMonth" class="week-grid">
          <span v-for="w in WEEK_LABELS" :key="w" class="week-label">{{ w }}</span>
          <span
            v-for="d in weekDays"
            :key="d.date"
            class="week-day"
            :class="{ active: d.active, today: d.isToday }"
            :title="d.active ? `${d.date} 学习 ${d.minutes} 分钟` : `${d.date} 未学习`"
          >{{ d.day }}</span>
        </div>
        <StreakHeatmap v-else class="heatmap" />
      </div>
    </section>

    <PracticeSettingDialog
      v-if="showSetting"
      :group="scopeGroup"
      :total="overview.total"
      :per-day-study-number="overview.perDay"
      :last-learn-index="overview.learnedIndex"
      @close="showSetting = false"
      @save="onSaveSetting"
    />

    <div v-if="showPicker" class="mask" @click.self="showPicker = false">
      <div class="picker">
        <h3 class="picker-title">选择学习范围</h3>

        <p class="picker-group-label">词表</p>
        <div class="picker-list">
          <button class="picker-item" :class="{ on: !studyGroupId && !pickTags.length }" @click="pickAll()">
            <span>全部单词</span><span class="cnt">{{ wordStore.words.length }}</span>
          </button>
          <button
            v-for="g in pickerBooks"
            :key="g.id"
            class="picker-item"
            :class="{ on: studyGroupId === g.id }"
            @click="pick(g.id, [])"
          >
            <span>{{ g.name }}</span><span class="cnt">{{ g.wordIds.length }}</span>
          </button>
        </div>

        <template v-if="availableTags.length">
          <p class="picker-group-label">按标签筛（可多选，条件叠加）</p>
          <div class="picker-list wrap">
            <button
              v-for="t in availableTags"
              :key="t.name"
              class="picker-chip"
              :class="{ on: pickTags.includes(t.name) }"
              @click="toggleTag(t.name)"
            >{{ t.name }}<span class="cnt">{{ t.count }}</span></button>
          </div>
        </template>

        <div class="picker-actions">
          <span class="picker-sum">
            已选 <b>{{ pickedCount }}</b> 个词
            <template v-if="pickTags.length"> · {{ pickTags.join(' + ') }}</template>
          </span>
          <button class="ghost-btn" @click="clearPick">重置</button>
          <button class="dark-btn" :disabled="!pickedCount" @click="showPicker = false">用这批词学</button>
        </div>
      </div>
    </div>
  </div>

  <div v-if="showImport" class="import-mask" @click.self="showImport = false">
    <section class="import-panel">
      <button class="import-close" @click="showImport = false">×</button>
      <h3>新建 / 导入词表</h3>
      <p class="import-hint">
        支持 TXT / CSV / JSON / MD / DOCX / PDF，格式如 <code>word;中文</code>。导入后自动补音标、词性、例句。
      </p>
      <input v-model="importName" class="import-name" placeholder="词表名称（留空则用文件名）" />
      <label class="import-drop">
        <input type="file" class="import-file" :accept="SUPPORTED_IMPORT_EXTS" @change="onPickImport" />
        <span>{{ importing ? '导入中…' : '选择文件' }}</span>
      </label>
      <p v-if="importMsg" class="import-msg">{{ importMsg }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, defineAsyncComponent } from 'vue'
import { useRouter } from 'vue-router'
import type { GraphNode, GraphLink } from '@/apps/word-core/components/WordGraph3D.vue'
const WordGraph3D = defineAsyncComponent(
  () => import('@/apps/word-core/components/WordGraph3D.vue')
)
import { RELATION_WEIGHTS, type RelationType } from '@/apps/word-core/components/graphColors'
import { masteryColor } from '@/shared/core/graphColorSettings'
import PracticeSettingDialog from './components/PracticeSettingDialog.vue'
import StreakHeatmap from '@/src/components/StreakHeatmap.vue'
import { useWordStore } from '@/shared/stores/wordStore'
import type { WordItem } from '@/shared/types/WordItem'
import { useReaderStore } from '@/apps/reading-assistant/stores/readerStore'
import { getTodayOverview } from '@/shared/core/scheduler'
import { loadFsrsData, countDue } from '@/shared/core/fsrs'
import { loadMasteredWords, getMasteredSet, getIgnoreSet } from '@/shared/core/masteredWords'
import { getStudySettings, getAccomplishDate } from '@/shared/core/studySettings'
import { SUPPORTED_IMPORT_EXTS } from '@/shared/core/fileExtract'

const showImport = ref(false)
const importName = ref('')
const importing = ref(false)
const importMsg = ref('')
async function onPickImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  importing.value = true
  importMsg.value = '正在解析文件…'
  try {
    const r = await wordStore.importWordsAsGroup(file, importName.value)
    importMsg.value = r.successCount === 0 && r.total === 0
      ? (r.messages[0] || '没能从文件里解析出词条，检查一下格式')
      : `导入完成：成功 ${r.successCount} 条${r.failCount ? `，失败 ${r.failCount} 条` : ''}。音标和例句会在后台自动补。`
    importName.value = ''
  } catch (err) {
    importMsg.value = `导入失败：${err instanceof Error ? err.message : '检查一下文件格式'}`
  } finally {
    importing.value = false
    ;(e.target as HTMLInputElement).value = ''
  }
}
import { commitScope, studyRoute, wordsOfScope, type StudyScope } from '@/shared/core/studyScope'
import { getScopeProgress, saveScopeProgress, scopeKeyOfTag } from '@/shared/core/scopeProgress'
import { getTodayStats, getStreak, getAllActivity, type DayActivity } from '@/shared/core/activityLog'

const router = useRouter()
const wordStore = useWordStore()

const PREVIEW_LIMIT = 120

const studyGroupId = ref<string>(localStorage.getItem('lb-study-group') || '')
const showSetting = ref(false)
const showPicker = ref(false)

const LIBRARY_BOOK_ID = 'book-lib-all'

const allBooks = computed(() => wordStore.groups.filter(g => g.id.startsWith('book-') && !g.parentId))
const myWordLists = computed(() =>
  allBooks.value.filter(g => g.id !== LIBRARY_BOOK_ID && g.wordIds.length < wordStore.words.length)
)
const studyGroup = computed(() => wordStore.groups.find(g => g.id === studyGroupId.value) || null)

const scopeKey = computed(() => {
  if (studyGroup.value) return ''
  return studyTag.value ? scopeKeyOfTag(studyTag.value) : 'all'
})
const progressTick = ref(0)
const scopeGroup = computed(() => {
  if (studyGroup.value) return studyGroup.value
  if (!scopeKey.value) return null
  void progressTick.value
  const p = getScopeProgress(scopeKey.value)
  return { id: '', name: studyTag.value, ...p } as any
})

const pickTags = ref<string[]>(
  (localStorage.getItem('lb-study-tag') || '').split('\u0001').filter(Boolean)
)
const studyTag = computed(() => pickTags.value.join(' + '))
watch(pickTags, v => localStorage.setItem('lb-study-tag', v.join('\u0001')), { deep: true })

const availableTags = computed(() => {
  const count = new Map<string, number>()
  for (const w of wordStore.words) {
    for (const t of w.tags || []) count.set(t, (count.get(t) || 0) + 1)
    for (const t of w.topics || []) count.set(t, (count.get(t) || 0) + 1)
  }
  return [...count.entries()]
    .map(([name, c]) => ({ name, count: c }))
    .sort((a, b) => b.count - a.count)
})

const currentScopeDef = computed<StudyScope>(() => {
  if (studyTag.value) return { kind: 'tag', tag: studyTag.value, label: '' }
  if (studyGroupId.value) return { kind: 'group', groupId: studyGroupId.value, label: studyGroup.value?.name || '' }
  return { kind: 'all', label: '全部单词' }
})

const studyWords = computed(() =>
  wordsOfScope(currentScopeDef.value, wordStore.words, wordStore.groups)
)

const overview = ref({ newCount: 0, reviewCount: 0, learnedIndex: 0, total: 0, perDay: 20 })
const masteredCount = ref(0)
const masteredSet = ref<Set<string>>(new Set())

function refreshOverview() {
  const s = getStudySettings()
  overview.value = getTodayOverview({
    words: studyWords.value,
    group: scopeGroup.value,
    ignoreSet: getIgnoreSet(s.ignoreSimpleWord)
  })
  masteredSet.value = getMasteredSet()
  masteredCount.value = masteredSet.value.size
}

const progressPercent = computed(() => {
  if (!overview.value.total) return 0
  return Math.round((overview.value.learnedIndex / overview.value.total) * 100)
})
const etaDate = computed(() =>
  getAccomplishDate(Math.max(0, overview.value.total - overview.value.learnedIndex), overview.value.perDay)
)

const newWordCount = computed(
  () => wordStore.words.filter(w => w.status === 'unknown' || w.status === 'fuzzy').length
)
const wrongBookCount = ref(0)
const noteCount = ref(0)
const dueCount = ref(0)

const todayMinutes = ref(0)
const totalMinutes = ref(0)
const streak = ref(0)
const showMonth = ref(false)

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const weekDays = ref<{ date: string; day: number; active: boolean; isToday: boolean; minutes: number }[]>([])

const previewNodes = ref<GraphNode[]>([])
const previewLinks = ref<GraphLink[]>([])

function buildPreview() {
  const pool = studyWords.value.length ? studyWords.value : wordStore.words
  const byWord = new Map<string, WordItem>(pool.map(w => [w.word.toLowerCase(), w]))
  const relOf = (w: WordItem) => [
    ...(w.word_family || []).map(String),
    ...(w.synonyms || []).map(x => String(x.word)),
    ...(w.antonyms || []).map(x => String(x.word))
  ]

  const seeds = [...pool]
    .filter(w => relOf(w).some(r => byWord.has(r.toLowerCase())))
    .sort((a, b) => {
      const ma = a.status && a.status !== 'unmarked' ? 1 : 0
      const mb = b.status && b.status !== 'unmarked' ? 1 : 0
      if (ma !== mb) return mb - ma
      return relOf(b).length - relOf(a).length
    })

  const picked = new Map<string, WordItem>()
  for (const seed of seeds) {
    if (picked.size >= PREVIEW_LIMIT) break
    const key = seed.word.toLowerCase()
    if (picked.has(key)) continue
    picked.set(key, seed)
    for (const r of relOf(seed)) {
      if (picked.size >= PREVIEW_LIMIT) break
      const t = byWord.get(r.toLowerCase())
      if (t) picked.set(t.word.toLowerCase(), t)
    }
  }
  if (!picked.size) {
    for (const w of pool.slice(0, PREVIEW_LIMIT)) picked.set(w.word.toLowerCase(), w)
  }

  const items = [...picked.values()]
  previewNodes.value = items.map(w => {
    const key = masteredSet.value.has(w.word.toLowerCase()) ? 'mastered' : (w.status || 'unmarked')
    return {
      id: w.word,
      word: w.word,
      definitionZh: w.meanings?.[0]?.chinese,
      sources: w.tags?.length ? w.tags : w.level ? [w.level] : [],
      forceColor: masteryColor(key)
    }
  })

  const inSet = new Map<string, WordItem>(items.map(w => [w.word.toLowerCase(), w]))
  const links: GraphLink[] = []
  const seenEdge = new Set<string>()
  for (const w of items) {
    const add = (rawTarget: string, type: GraphLink['type'], difference?: string) => {
      const t = String(rawTarget).toLowerCase()
      const hit = inSet.get(t)
      if (!hit || t === w.word.toLowerCase()) return
      const key = [w.word.toLowerCase(), t].sort().join('|') + '|' + type
      if (seenEdge.has(key)) return
      seenEdge.add(key)
      links.push({ source: w.word, target: hit.word, type, difference, weight: RELATION_WEIGHTS[type] })
    }
    for (const f of w.word_family || []) add(f, 'word_family')
    for (const sy of w.synonyms || []) add(sy.word, 'synonym', sy.difference)
    for (const an of w.antonyms || []) add(an.word, 'antonym')
  }
  previewLinks.value = links
}

function onPreviewSelect() {
  router.push('/universe')
}

function go(path: string) { router.push(path) }
function openBook(id: string) { router.push(`/words?book=${encodeURIComponent(id)}`) }

function currentScope(): StudyScope {
  const s = currentScopeDef.value
  if (s.kind === 'tag') return { ...s, label: `${s.tag} · ${studyWords.value.length} 词` }
  return s
}

function startStudy() {
  router.push(commitScope(currentScope()))
}
function startReview() {
  const scope = currentScope()
  commitScope(scope)
  router.push(studyRoute(scope, 'review'))
}

async function onSaveSetting(payload: { lastLearnIndex: number; perDayStudyNumber: number }) {
  showSetting.value = false
  if (studyGroup.value) {
    await wordStore.updateGroup(studyGroup.value.id, payload)
  } else if (scopeKey.value) {
    saveScopeProgress(scopeKey.value, payload)
    progressTick.value++
  }
  refreshOverview()
  buildPreview()
}

function pick(groupId: string, tags: string[]) {
  studyGroupId.value = groupId
  pickTags.value = tags
}
function pickAll() { studyGroupId.value = ''; pickTags.value = [] }
function clearPick() { pickAll() }
function toggleTag(name: string) {
  studyGroupId.value = ''
  const i = pickTags.value.indexOf(name)
  if (i >= 0) pickTags.value.splice(i, 1)
  else pickTags.value.push(name)
}

const pickerBooks = computed(() =>
  allBooks.value.filter(g => g.id !== LIBRARY_BOOK_ID && g.wordIds.length < wordStore.words.length)
)

const pickedCount = computed(() => {
  if (studyGroupId.value) {
    return wordStore.groups.find(g => g.id === studyGroupId.value)?.wordIds.length || 0
  }
  if (!pickTags.value.length) return wordStore.words.length
  return wordStore.words.filter(w =>
    pickTags.value.every(t => w.tags?.includes(t) || w.topics?.includes(t))
  ).length
})

watch(studyGroupId, v => {
  localStorage.setItem('lb-study-group', v)
  refreshOverview()
  buildPreview()
})
watch(studyTag, () => {
  refreshOverview()
  buildPreview()
})

onMounted(async () => {
  await wordStore.loadWords()
  await loadFsrsData()
  await loadMasteredWords()
  refreshOverview()
  buildPreview()
  dueCount.value = countDue()

  try {
    wrongBookCount.value = (await wordStore.listWrongBook()).length
  } catch { /* 错词本读不出来不该让主页崩掉 */ }

  try {
    const rs = useReaderStore()
    await rs.loadArticles()
    noteCount.value = rs.articles.filter(a => a.notes && a.notes.replace(/<[^>]+>/g, '').trim()).length
  } catch { /* 同上，笔记数量取不到就显示 0，不影响主页其它部分 */ }

  const today = await getTodayStats()
  todayMinutes.value = today.minutesActive || 0
  streak.value = await getStreak()
  await buildWeek()
})

async function buildWeek() {
  const all = await getAllActivity()
  const byDate = new Map<string, DayActivity>(all.map(d => [d.date, d]))
  totalMinutes.value = all.reduce((sum, d) => sum + (d.minutesActive || 0), 0)

  const now = new Date()
  const todayStr = fmt(now)
  const offset = (now.getDay() + 6) % 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - offset)

  const out = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const key = fmt(d)
    const rec = byDate.get(key)
    out.push({
      date: key,
      day: d.getDate(),
      active: !!(rec && (rec.minutesActive || rec.newWords || rec.reviewCount)),
      isToday: key === todayStr,
      minutes: rec?.minutesActive || 0
    })
  }
  weekDays.value = out
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
</script>

<style scoped lang="scss">
.home { max-width: 1180px; margin: 0 auto; padding: 18px 20px 70px; }

.top-row { display: flex; gap: 14px; align-items: stretch; margin-bottom: 16px; }
.universe-card {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--r-border, #e4e4e4);
  border-radius: 14px;
  overflow: hidden;
  cursor: pointer;
  background: var(--r-ui, #fafafa);
  display: flex;
  flex-direction: column;
  transition: box-shadow 0.18s ease;
  &:hover { box-shadow: 0 4px 18px rgba(0, 0, 0, 0.1); }
}
.universe-preview { height: 220px; position: relative; }
.preview-empty {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--r-ink2, #aaa); font-size: 13px; margin: 0;
}
.universe-foot {
  padding: 10px 14px;
  display: flex; align-items: baseline; gap: 10px;
  border-top: 1px solid var(--r-border, #eee);
}
.universe-name { font-size: 15px; font-weight: 600; }
.universe-sub { font-size: 12px; color: var(--r-ink2, #999); }
.legend-inline {
  font-style: normal;
  margin-left: 8px;
  padding: 1px 7px;
  border-radius: 9999px;
  font-size: 11px;
  background: linear-gradient(90deg, #2f3a4a, #7fd1ff, #fff4d6);
  color: var(--r-ink, #1c1c1c);
}

.entry-card {
  border: 1px solid var(--r-border, #e4e4e4);
  border-radius: 12px;
  background: var(--r-paper, #fff);
  color: var(--r-ink, #1c1c1c);
  padding: 14px 16px;
  cursor: pointer;
  text-align: left;
  display: flex; flex-direction: column; gap: 4px;
  transition: box-shadow 0.15s ease;
  &:hover { box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08); }
  &.tall { width: 200px; justify-content: center; }
  &.small { padding: 12px 14px; }
  &.dashed { border-style: dashed; color: var(--r-ink2, #888); }
}
.entry-name { font-size: 14.5px; font-weight: 600; }
.entry-num { font-size: 22px; font-weight: 600; color: var(--r-accent, #8a4b3a); }
.entry-sub { font-size: 12px; color: var(--r-ink2, #999); line-height: 1.5; }

.task-card {
  border: 1px solid var(--r-border, #e4e4e4);
  border-radius: 14px;
  padding: 18px 20px;
  margin-bottom: 22px;
  background: var(--r-paper, #fff);
}
.task-top { display: flex; gap: 28px; align-items: stretch; flex-wrap: wrap; }
.task-left { flex: 1; min-width: 260px; }
.task-book { font-size: 19px; margin: 0 0 6px; }
.task-eta { font-size: 12.5px; color: var(--r-ink2, #888); margin: 0 0 10px; }
.progress-bar { height: 7px; border-radius: 4px; background: var(--r-border, #eee); overflow: hidden; }
.progress-fill { height: 100%; background: #72c240; transition: width 0.3s ease; }
.progress-line {
  display: flex; justify-content: space-between;
  font-size: 12.5px; color: var(--r-ink2, #888); margin-top: 6px;
}
.task-tools { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }

.task-right { display: flex; flex-direction: column; gap: 10px; justify-content: center; }
.task-goal { font-size: 13px; color: var(--r-ink2, #777); display: flex; align-items: center; gap: 6px; }
.task-goal b { font-size: 19px; color: var(--r-accent, #8a4b3a); }
.task-nums { display: flex; gap: 12px; }
.task-num {
  min-width: 108px; text-align: center; padding: 12px 8px;
  border-radius: 10px; background: var(--r-ui, #f6f6f6);
  display: flex; flex-direction: column; gap: 2px;
}
.task-num .n { font-size: 30px; font-weight: 600; color: var(--r-ink, #1f2328); line-height: 1.1; }
.task-num .n.review { color: var(--r-ink2, #8a9099); }
.task-num .l { font-size: 12px; color: var(--r-ink2, #888); }
.task-btns { display: flex; gap: 10px; }
.start-btn {
  flex: 1; padding: 11px 24px; border: none; border-radius: 10px;
  background: var(--r-ink, #1f2328); color: #fff; font-size: 15px; font-weight: 600; cursor: pointer;
  &:hover { filter: brightness(1.05); }
}
.free-btn {
  padding: 11px 20px; border: none; border-radius: 10px;
  background: var(--r-ui, #f4f5f7); color: var(--r-ink, #1f2328); font-size: 14px; cursor: pointer;
  &:hover { filter: brightness(1.15); }
}

.grid-section { margin-bottom: 22px; }
.sec-title { font-size: 14px; margin: 0 0 10px; color: var(--r-ink2, #666); font-weight: 600; }
.sec-hint { font-size: 12px; color: var(--r-ink2, #aaa); margin: 8px 0 0; line-height: 1.6; }
.entry-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 10px; }

.stat-card {
  display: flex; gap: 28px; flex-wrap: wrap;
  border: 1px solid var(--r-border, #e4e4e4);
  border-radius: 14px; padding: 16px 20px; margin-bottom: 22px;
  background: var(--r-paper, #fff);
}
.stat-left { flex: 1; min-width: 300px; }
.stat-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.stat-box {
  border-radius: 10px; background: var(--r-ui, #f6f6f6);
  padding: 16px 10px; text-align: center;
  display: flex; flex-direction: column; gap: 4px;
}
.stat-box .n { font-size: 26px; font-weight: 600; color: var(--r-ink, #1f2328); line-height: 1.1; }
.stat-box .n em { font-size: 14px; font-style: normal; margin-left: 2px; }
.stat-box .l { font-size: 12px; color: var(--r-ink2, #888); }
.stat-right { min-width: 240px; }
.week-head { display: flex; justify-content: space-between; align-items: center; }
.week-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; text-align: center; }
.week-label { font-size: 12px; color: var(--r-ink2, #999); padding-bottom: 4px; }
.week-day {
  font-size: 13px; padding: 7px 0; border-radius: 8px;
  color: var(--r-ink2, #999); background: transparent;
  &.active { background: #3b82f6; color: #fff; }
  &.today { outline: 2px solid var(--r-accent, #8a4b3a); outline-offset: -2px; }
}
.heatmap { margin-top: 10px; }

.mask {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.35);
  display: flex; align-items: center; justify-content: center; z-index: 60; padding: 20px;
}
.picker {
  background: var(--r-paper, #fff); color: var(--r-ink, #1c1c1c);
  border-radius: 14px; padding: 20px 22px; width: min(560px, 100%);
  max-height: 84vh; overflow: auto;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22);
}
.picker-title { margin: 0 0 14px; font-size: 16.5px; }
.picker-group-label { font-size: 12.5px; color: var(--r-ink2, #888); margin: 14px 0 8px; }
.picker-list { display: flex; flex-direction: column; gap: 6px; &.wrap { flex-direction: row; flex-wrap: wrap; } }
.picker-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 9px 12px; border: 1px solid var(--r-border, #e4e4e4); border-radius: 9px;
  background: transparent; color: inherit; cursor: pointer; font-size: 14px;
  &:hover { background: var(--r-ui, #f6f6f6); }
  &.on { border-color: var(--r-accent, #8a4b3a); background: var(--r-ui, #f6f6f6); }
}
.picker-chip {
  padding: 5px 11px; border-radius: 9999px; font-size: 12.5px;
  border: 1px solid color-mix(in srgb, var(--r-accent, #8a4b3a) 22%, transparent);
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 4%, var(--r-paper, #fff));
  color: inherit; cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px;
  transition: background-color .15s ease, border-color .15s ease;
  &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 12%, var(--r-paper, #fff)); }
  &.on {
    border-color: transparent;
    background: var(--r-accent, #8a4b3a);
    color: #fff;
    .cnt { color: rgba(255, 255, 255, 0.75); }
  }
}
.cnt { font-size: 12px; color: var(--r-ink2, #999); }
.picker-actions {
  display: flex; align-items: center; gap: 10px; margin-top: 18px;
  padding-top: 14px; border-top: 1px solid var(--r-border, #e4e4e4);
}
.picker-sum { flex: 1; font-size: 13px; color: var(--r-ink2, #777); }
.picker-sum b { color: var(--r-accent, #8a4b3a); font-size: 15px; }
.ghost-btn.tiny { font-size: 12px; padding: 3px 9px; }

@media (max-width: 720px) {
  .top-row { flex-direction: column; }
  .entry-card.tall { width: auto; }
  .stat-row { grid-template-columns: 1fr; }
}
.import-mask {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
.import-panel {
  position: relative; width: min(520px, 100%);
  background: var(--r-paper, #fff); border-radius: 14px; padding: 22px 24px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
}
.import-panel h3 { margin: 0 0 8px; font-size: 16px; }
.import-hint { font-size: 12.5px; color: var(--r-ink2, #999); line-height: 1.7; margin: 0 0 14px; }
.import-hint code { background: var(--r-ui, #f2f2f2); padding: 1px 5px; border-radius: 4px; }
.import-name {
  width: 100%; padding: 8px 12px; margin-bottom: 12px;
  border: 1px solid var(--r-border, #ddd); border-radius: 8px;
  background: var(--r-ui, #fafafa); color: inherit; font-size: 13.5px; outline: none;
}
.import-drop {
  display: flex; align-items: center; justify-content: center;
  padding: 22px; border: 1px dashed var(--r-border, #ccc); border-radius: 10px;
  cursor: pointer; font-size: 13.5px; color: var(--r-ink2, #888);
}
.import-drop:hover { border-color: var(--r-accent, #8a4b3a); color: var(--r-accent, #8a4b3a); }
.import-file { display: none; }
.import-msg { font-size: 12.5px; color: var(--r-ink2, #777); margin: 12px 0 0; line-height: 1.6; }
.import-close {
  position: absolute; right: 14px; top: 10px;
  border: none; background: none; cursor: pointer; font-size: 22px; line-height: 1;
  color: var(--r-ink2, #999);
}
</style>

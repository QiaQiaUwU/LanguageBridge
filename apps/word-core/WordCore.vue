<template>
  <div class="word-core">
    <div class="library-row">
      <button
        class="library-card"
        :class="{ on: currentGroupId === 'all' }"
        @click="currentGroupId = 'all'; currentPage = 1"
      >
        <span class="library-name">全部单词</span>
        <span class="library-count">{{ wordStore.words.length }}</span>
      </button>
      <button
        v-for="g in topLevelBooks"
        :key="g.id"
        class="library-card"
        :class="{ on: currentBookId === g.id }"
        @click="selectBook(g.id)"
      >
        <span class="library-name">{{ g.name }}</span>
        <span class="library-count">{{ g.wordIds.length }}</span>
        <span class="library-edit" title="编辑这本词书" @click.stop="editingBookId = g.id">✎</span>
        <span class="library-del" @click.stop="doDeleteGroup(g)">×</span>
      </button>
      <button class="library-card library-new" @click="showImport = true">
        <span class="library-name">+ 新建 / 导入词库</span>
      </button>
    </div>

    <div class="search-row">
      <div class="search-box">
        <input
          v-model="wordStore.searchQuery"
          class="word-search"
          placeholder="搜索单词或释义"
        />
        <button v-if="wordStore.searchQuery" class="search-clear" @click="wordStore.searchQuery = ''">×</button>
      </div>
      <span v-if="wordStore.searchQuery" class="search-count">找到 {{ filteredWords.length }} 个</span>
    </div>

    <div v-if="currentBookId && currentChapters.length" class="filter-row chapter-row">
      <span class="filter-label">分类：</span>
      <button class="chip small" :class="{ on: currentGroupId === currentBookId }" @click="currentGroupId = currentBookId!; currentPage = 1">全部</button>
      <button
        v-for="c in currentChapters"
        :key="c.id"
        class="chip small"
        :class="{ on: currentGroupId === c.id }"
        @click="currentGroupId = c.id; currentPage = 1"
      >{{ c.name }}<span class="chip-count">{{ c.wordIds.length }}</span></button>
    </div>

    <div v-if="hasAnyDimension" class="dimension-block">
      <div class="dimension-tabs">
        <button
          v-for="d in dimensions"
          :key="d.key"
          class="dim-tab"
          :class="{ on: activeDim === d.key, picked: !!dimSel[d.key] }"
          :disabled="!d.count"
          @click="activeDim = d.key; expandDim = false"
        >{{ d.label }}<span v-if="d.count" class="dim-count">{{ dimSel[d.key] || d.count }}</span></button>
      </div>

      <div class="filter-row value-row" :class="{ managing: dimManage }">
        <button class="chip small" :class="{ on: !activeDimValue }" @click="setDimValue('')">不限</button>
        <template v-for="v in visibleDimValues" :key="v.name">
          <span class="chip-wrap">
            <button
              class="chip small"
              :class="{ on: activeDimValue === v.name, broken: isBroken(v.name) }"
              :title="v.meaning || v.name"
              @click="setDimValue(v.name)"
              @pointerdown="startPress(v.name)"
              @pointerup="cancelPress"
              @pointerleave="cancelPress"
              @contextmenu.prevent="dimManage = true"
            >{{ v.name }}<span class="chip-count">{{ v.count }}</span></button>
            <template v-if="dimManage && activeDimValue === v.name">
              <button class="chip-act" title="改名" :disabled="tidying" @click="renameDimValue(v.name)">
                <i class="ri-pencil-line"></i>
              </button>
              <button class="chip-act danger" title="删除" :disabled="tidying" @click="deleteDimValue(v.name)">
                <i class="ri-delete-bin-line"></i>
              </button>
            </template>
          </span>
        </template>
        <button v-if="currentDimValues.length > DIM_PREVIEW" class="chip small ghost" @click="expandDim = !expandDim">
          {{ expandDim ? '收起' : `… 更多 ${currentDimValues.length - DIM_PREVIEW}` }}
        </button>
        <button
          class="chip-act toggle"
          :class="{ on: dimManage }"
          :title="dimManage ? '完成整理' : '整理分类（也可以长按某个分类）'"
          @click="dimManage = !dimManage"
        ><i :class="dimManage ? 'ri-check-line' : 'ri-pencil-line'"></i></button>
        <button v-if="dimManage" class="chip-act" title="新建分类" :disabled="tidying" @click="addDimValue">
          <i class="ri-add-line"></i>
        </button>
      </div>

      <div v-if="dimManage" class="manage-bar">
        <span class="manage-hint">
          点一个分类，它后面会出现改名和删除。改名全库生效，删除只去掉这个分类、不会删词。
        </span>
        <span v-if="activeDim === 'exam' && canonicalizable" class="manage-fix">
          有 {{ canonicalizable }} 个词的考纲写法不统一（CET-4 / CET4 这种），会被当成两个分类。
          <button class="dark-btn small" :disabled="tidying" @click="unifyExamTags">统一写法</button>
        </span>
        <span v-if="manageMsg" class="manage-msg">{{ manageMsg }}</span>
      </div>

      <div v-if="activeFilters.length" class="active-filters">
        <span class="af-label">已叠加</span>
        <button
          v-for="f in activeFilters"
          :key="f.key"
          class="af-chip"
          :title="'点击取消：' + f.value"
          @click="clearFilter(f.key)"
        >{{ f.label }}：{{ f.value }} ×</button>
        <button class="af-clear" @click="clearAllFilters">全部清除</button>
      </div>

      <div v-if="activeFilters.length" class="dim-action">
        <span class="dim-hint">已筛出 {{ filteredWords.length }} 个词</span>
        <button class="dark-btn small" :disabled="!filteredWords.length" @click="studyFiltered">
          加入学习规划
        </button>
        <button class="ghost-btn small" :disabled="!filteredWords.length" @click="saveFilteredAsBook">
          存为词表
        </button>
      </div>
    </div>

    <div v-if="familyFilter" class="family-bar">
      <span>正在看「{{ familyRootWord }}」的词族，共 {{ filteredWords.length }} 个词</span>
      <button class="ghost-btn small" @click="clearFamilyFilter">退出词族视图</button>
    </div>

    <WordBookEditor v-if="editingBookId" :group-id="editingBookId" @close="editingBookId = null" />

    <div class="status-tabs">
      <button
        v-for="t in statusTabs"
        :key="t.value"
        class="tab"
        :class="{ on: statusFilter === t.value }"
        @click="statusFilter = t.value; currentPage = 1"
      >{{ t.label }}<span class="tab-count">{{ statusCount(t.value) }}</span></button>
    </div>

    <div class="toolbar">
      <div class="seg">
        <button v-for="o in orders" :key="o.value" class="seg-btn" :class="{ on: order === o.value }" @click="setOrder(o.value)">{{ o.label }}</button>
      </div>
      <div class="seg">
        <button class="seg-btn" :class="{ on: viewMode === 'study' }" @click="viewMode = 'study'">学习模式</button>
        <button class="seg-btn" :class="{ on: viewMode === 'list' }" @click="viewMode = 'list'">列表模式</button>
      </div>
      <button class="dark-btn" @click="openScope('dictation')">听写</button>
      <button class="dark-btn" @click="openScope('match')">卡片消消乐</button>
      <button class="dark-btn" @click="openScope('flashcard')">卡片背单词</button>
      <button class="ghost-btn" :title="globalReveal ? '隐藏全部释义' : '显示全部释义'" @click="globalReveal = !globalReveal">
        {{ globalReveal ? '遮住释义' : '显示释义' }}
      </button>
    </div>

    <div v-if="enrichProgress" class="enrich-banner">
      正在自动补全词条（释义库 / 词典API）：{{ enrichProgress.done }} / {{ enrichProgress.total }}
      <span class="enrich-word">{{ enrichProgress.current }}</span>
    </div>

    <div class="select-bar">
      <button class="ghost-btn small" @click="toggleSelectMode">
        {{ selectMode ? '退出选择' : '选择单词' }}
      </button>
      <template v-if="selectMode">
        <button class="ghost-btn small" @click="selectAllOnPage">选中本页（{{ pagedWords.length }}）</button>
        <button class="ghost-btn small" :disabled="!selectedIds.size" @click="clearSelection">清空</button>
        <span class="sel-count">已选 {{ selectedIds.size }} 个</span>
        <button class="dark-btn small" :disabled="!selectedIds.size" @click="studySelected">
          加入学习（{{ selectedIds.size }}）
        </button>
        <button class="ghost-btn small" :disabled="!selectedIds.size" @click="saveSelectionAsBook">
          存为新词表
        </button>
      </template>
    </div>

    <div class="cards" :class="viewMode === 'list' ? 'list-layout' : 'grid-layout'">
      <div
        v-for="w in pagedWords"
        :key="w.id"
        class="card-wrap"
        :class="{ picking: selectMode, picked: selectedIds.has(w.id) }"
        @click="selectMode ? togglePick(w.id) : null"
      >
        <span v-if="selectMode" class="pick-mark">{{ selectedIds.has(w.id) ? '✓' : '' }}</span>
        <WordCard
          :word="w"
          :mode="viewMode"
          :global-reveal="globalReveal"
          @select="selectMode ? togglePick(w.id) : focusWord($event)"
          @mark="onMark"
        />
      </div>
    </div>
    <p v-if="!filteredWords.length" class="empty-hint">当前筛选下没有单词。可点右上角「+ 新建 / 导入词库」导入。</p>

    <div class="pagination" v-if="totalPages > 1 || filteredWords.length">
      <button class="page-btn" :disabled="currentPage === 1" @click="currentPage--">上一页</button>
      <span class="page-info">第 {{ currentPage }} 页 / 共 {{ totalPages }} 页</span>
      <button class="page-btn" :disabled="currentPage >= totalPages" @click="currentPage++">下一页</button>
      <label class="page-size-select">
        每页
        <select v-model.number="pageSize" @change="currentPage = 1">
          <option v-for="n in pageSizeOptions" :key="n" :value="n">{{ n }} 条</option>
        </select>
      </label>
    </div>

    <div v-if="showImport" class="import-mask" @click.self="showImport = false">
    <section class="import-box">
      <button class="import-close" title="关闭" @click="showImport = false">×</button>
      <div class="import-head">
        <h3>导入词书</h3>
        <p>支持 TXT / CSV / JSON / MD / DOCX / PDF，格式如 <code>word;中文</code>。PDF/DOCX 分栏排版可能错乱，建议用 TXT。</p>
      </div>
      <div class="import-form">
        <input v-model="importGroupName" class="group-name-input" placeholder="词书名称（留空则用文件名）" />
        <label
          class="drop-zone"
          :class="{ over: dragOver }"
          @dragover.prevent="dragOver = true"
          @dragleave="dragOver = false"
          @drop.prevent="onDrop"
        >
          {{ importing ? '正在解析文件…' : '选择文件或拖拽到此处' }}
          <input type="file" :accept="SUPPORTED_IMPORT_EXTS" hidden @change="onFilePick" />
        </label>
      </div>
      <p v-if="importMessage" class="import-msg">{{ importMessage }}</p>

      <div class="lib-import-box">
        <div class="lib-row">
          <button class="ghost-btn small" :disabled="dedupingWords" @click="doDedupeWords">
            {{ dedupingWords ? '清理中…' : '清理重复词条' }}
          </button>
        </div>
        <p v-if="dedupeMessage" class="import-msg">{{ dedupeMessage }}</p>
      </div>
    </section>
    </div>

    <div v-if="relatedWordHint" class="related-hint-toast">{{ relatedWordHint }}</div>

    <StudyScopeDialog
      v-if="scopeDialogFor"
      :total="filteredWords.length"
      :page="currentPage"
      :title="scopeDialogTitle"
      @choose="onScopeChosen"
      @cancel="scopeDialogFor = null"
    />

    <FlashcardStudy
      v-if="flashcardWords"
      :words="flashcardWords"
      @exit="flashcardWords = null"
      @mark="onMark"
    />

    <WordDetailModal
      v-if="selectedWord"
      :word="selectedWord"
      @close="selectedWord = null"
      @memorize="onMemorize"
      @search="onSearchRelatedWord"
      @filter-family="onFilterFamily"
    />

    <button v-if="!universeOpen" class="universe-tab" @click="universeOpen = true">
      词汇宇宙
    </button>
    <div v-else class="universe-panel" :class="{ fullscreen: universeFullscreen }">
      <div class="universe-header">
        <span class="universe-title">
          <template v-if="graphCenter">词汇宇宙 · {{ graphCenter.word }} 的关系网</template>
          <template v-else>词汇宇宙 · {{ currentGroupLabel }}（{{ graphNodes.length }} 词）</template>
        </span>
        <div class="universe-actions">
          <button v-if="graphCenter" class="universe-icon-btn" title="回到当前筛选结果" @click="graphCenter = null">← 全部</button>
          <button class="universe-icon-btn" :title="universeFullscreen ? '收起为侧边' : '展开占满整页'" @click="universeFullscreen = !universeFullscreen">
            {{ universeFullscreen ? '⤡ 收起' : '⤢ 展开' }}
          </button>
          <button class="universe-icon-btn" title="关闭" @click="universeOpen = false">×</button>
        </div>
      </div>
      <GraphLegend
        class="universe-legend"
        :sources="graphSources"
        :color-by="graphColorBy"
        :items="graphLegendItems"
      />
      <div class="universe-graph">
        <WordGraph3D :nodes="graphNodes" :links="graphLinks" @select="onSelectGraphWord" />
        <p v-if="!graphNodes.length" class="universe-empty">当前筛选下没有可展示的语义关系</p>
        <div v-if="graphNodes.length" class="universe-stats">
          <span class="stat-badge">{{ graphNodes.length }} 单词</span>
          <span class="stat-badge">{{ graphLinks.length }} 关系</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, defineAsyncComponent } from 'vue'
import { useRouter } from 'vue-router'
import type { GraphNode, GraphLink } from './components/WordGraph3D.vue'
const WordGraph3D = defineAsyncComponent(() => import('./components/WordGraph3D.vue'))
import GraphLegend from './components/GraphLegend.vue'
import { RELATION_WEIGHTS, type RelationType } from './components/graphColors'
import { relationEdges, centerNetwork, sourcesOf, morphemeKeyOf } from '@/shared/core/graphModel'
import { pickConstellations, filterConstellationLinks, detectCommunities } from '@/shared/core/wordClusters'
import { topicColor, morphemeColor, onColorChange } from '@/shared/core/graphColorSettings'
import WordCard from './components/WordCard.vue'
import WordDetailModal from './components/WordDetailModal.vue'
import StudyScopeDialog from './components/StudyScopeDialog.vue'
import { commitScope } from '@/shared/core/studyScope'
import { canonicalExamTag, canonicalExamTags, needsCanonicalize } from '@/shared/core/examTags'
import { familiarityOf } from '@/shared/core/familiarity'
import { loadFsrsData } from '@/shared/core/fsrs'
import { loadMasteredWords, getMasteredSet } from '@/shared/core/masteredWords'
import * as be from '@/shared/core/backendClient'
import { wordDB } from '@/shared/core/database'
import FlashcardStudy from './components/FlashcardStudy.vue'
import WordBookEditor from './components/WordBookEditor.vue'
import { useWordStore } from '@/shared/stores/wordStore'
import { SUPPORTED_IMPORT_EXTS } from '@/shared/core/fileExtract'
import type { WordItem, WordStatus } from '@/shared/types/WordItem'

const router = useRouter()
const wordStore = useWordStore()

const currentGroupId = ref('all')
const statusFilter = ref<'all' | WordStatus>('all')
const order = ref<'default' | 'shuffle1' | 'shuffle2'>('default')
const viewMode = ref<'study' | 'list'>('study')
const globalReveal = ref(true)

const statusTabs = [
  { label: '全部', value: 'all' as const },
  { label: '未练过', value: 'unmarked' as const },
  { label: '认识', value: 'known' as const },
  { label: '不认识', value: 'unknown' as const },
  { label: '模糊', value: 'fuzzy' as const }
]

const masteredSet = ref<Set<string>>(new Set())
const familiarityTick = ref(0)

const familiarityCounts = computed(() => {
  void familiarityTick.value
  const c: Record<string, number> = { all: 0, unmarked: 0, known: 0, unknown: 0, fuzzy: 0 }
  for (const w of groupWords.value) {
    c.all++
    const lv = familiarityOf(w, masteredSet.value).level
    if (lv === 'unseen') c.unmarked++
    else if (lv === 'mastered') c.known++   // 已掌握并进"认识"，它本来就是认识的极端情况
    else c[lv]++
  }
  return c
})
const orders = [
  { label: '默认', value: 'default' as const },
  { label: '乱一', value: 'shuffle1' as const },
  { label: '乱二', value: 'shuffle2' as const }
]

const COLUMNS = 2
const pageSizeOptions = [10, 20, 40, 60] as const
const pageSize = ref<typeof pageSizeOptions[number]>(20)
const currentPage = ref(1)

const LIBRARY_BOOK_ID = 'book-lib-all'
const topLevelBooks = computed(() =>
  wordStore.groups.filter(
    g =>
      g.id.startsWith('book-') &&
      !g.parentId &&
      g.id !== LIBRARY_BOOK_ID &&
      g.wordIds.length < wordStore.words.length
  )
)
const editingBookId = ref<string | null>(null)

const currentBookId = computed<string | null>(() => {
  const cur = wordStore.groups.find(g => g.id === currentGroupId.value)
  if (!cur) return null
  return cur.parentId || cur.id
})

const currentChapters = computed(() => {
  if (!currentBookId.value) return []
  return wordStore.groups.filter(g => g.parentId === currentBookId.value)
})

function selectBook(bookId: string) {
  currentGroupId.value = bookId
  currentPage.value = 1
}

const showImport = ref(false)

async function doDeleteGroup(g: { id: string; name: string }) {
  if (!confirm(`删除词书「${g.name}」？\n只删这个分类，里面的单词还留在词库里，不会被删掉。`)) return
  if (currentGroupId.value === g.id) currentGroupId.value = 'all'
  await wordStore.deleteGroup(g.id)
}

const groupWords = computed<WordItem[]>(() => {
  if (currentGroupId.value === 'all') return wordStore.words
  const g = wordStore.groups.find(gg => gg.id === currentGroupId.value)
  if (!g) return wordStore.words
  const idset = new Set(g.wordIds)
  return wordStore.words.filter(w => idset.has(w.id))
})

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr]
  let s = seed
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280
    const j = Math.floor((s / 233280) * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const familyFilter = ref<Set<string> | null>(null)
const familyRootWord = ref('')

function onFilterFamily(word: string) {
  const item = wordStore.words.find(w => w.word.toLowerCase() === word.toLowerCase())
  if (!item) return
  const set = new Set<string>([item.word.toLowerCase()])
  for (const w of item.word_family || []) set.add(String(w).toLowerCase())
  for (const w of item.synonyms || []) set.add(String((w as any).word ?? w).toLowerCase())
  for (const w of item.antonyms || []) set.add(String(w.word).toLowerCase())
  familyFilter.value = set
  familyRootWord.value = item.word
  selectedWord.value = null   // 关掉详情弹窗，否则筛完了还挡着看不见结果
  graphCenter.value = null
  currentPage.value = 1
}

function clearFamilyFilter() {
  familyFilter.value = null
  familyRootWord.value = ''
  currentPage.value = 1
}

/**
 * 筛选维度。
 *
 * 词根、前缀、后缀原来挤在一个 morpheme 维度里 —— 三类东西混一张表，
 * 几百项排下来根本找不到想要的。拆成三个各管各的。
 * 老数据里存的 'morpheme' 仍然认（当成词根），不然升级后筛选条件会丢。
 */
type DimKey = 'exam' | 'topic' | 'root' | 'prefix' | 'suffix'

const DIM_PREVIEW = 14
const activeDim = ref<DimKey>('exam')
const DIM_SEL_KEY = 'lb-wordcore-dimsel'
function readDimSel(): Record<DimKey, string> {
  const empty: Record<DimKey, string> = { exam: '', topic: '', root: '', prefix: '', suffix: '' }
  try {
    const raw = localStorage.getItem(DIM_SEL_KEY)
    const v = raw ? JSON.parse(raw) : null
    if (!v) return empty
    return {
      exam: v.exam || '',
      topic: v.topic || '',
      // 老数据只有一个 morpheme 槽，分不出是词根还是词缀，一律当词根收下
      root: v.root || v.morpheme || '',
      prefix: v.prefix || '',
      suffix: v.suffix || ''
    }
  } catch {
    return empty
  }
}
const dimSel = ref<Record<DimKey, string>>(readDimSel())
watch(dimSel, v => {
  try { localStorage.setItem(DIM_SEL_KEY, JSON.stringify(v)) } catch { /* 隐私模式忽略 */ }
}, { deep: true })
const activeDimSaved = localStorage.getItem('lb-wordcore-dim')
// 老数据存的是 'morpheme'，拆分之后当词根处理，不让升级后筛选条件丢掉
const DIM_KEYS: DimKey[] = ['exam', 'topic', 'root', 'prefix', 'suffix']
if (activeDimSaved === 'morpheme') activeDim.value = 'root'
else if (DIM_KEYS.includes(activeDimSaved as DimKey)) activeDim.value = activeDimSaved as DimKey
watch(activeDim, v => localStorage.setItem('lb-wordcore-dim', v))
const activeDimValue = computed<string>({
  get: () => dimSel.value[activeDim.value],
  set: v => { dimSel.value[activeDim.value] = v }
})
const expandDim = ref(false)

interface DimValue { name: string; count: number; meaning?: string }

function collectDim(key: DimKey): DimValue[] {
  const count = new Map<string, number>()
  const meaning = new Map<string, string>()
  for (const w of scopedWords.value) {
    if (key === 'exam') {
      for (const t of w.tags || []) count.set(t, (count.get(t) || 0) + 1)
    } else if (key === 'topic') {
      for (const t of w.topics || []) count.set(t, (count.get(t) || 0) + 1)
    } else {
      const m = w.morphemes
      if (!m) continue
      // 只取这个维度对应的那一类词素
      const part = key === 'prefix' ? m.prefix : key === 'suffix' ? m.suffix : m.root
      if (!part?.form) continue
      count.set(part.form, (count.get(part.form) || 0) + 1)
      if (part.meaning && !meaning.has(part.form)) meaning.set(part.form, part.meaning)
    }
  }
  return [...count.entries()]
    // 词素类的维度过滤掉只出现一次的：一个词独有的词根列出来没有意义
    .filter(([, c]) => (key === 'exam' || key === 'topic' ? true : c > 1))
    .map(([name, c]) => ({ name, count: c, meaning: meaning.get(name) }))
    .sort((a, b) => b.count - a.count)
}

const examValues = computed(() => collectDim('exam'))
const topicValues = computed(() => collectDim('topic'))
const rootValues = computed(() => collectDim('root'))
const prefixValues = computed(() => collectDim('prefix'))
const suffixValues = computed(() => collectDim('suffix'))

const dimensions = computed(() => [
  { key: 'exam' as DimKey, label: '考试', count: examValues.value.length },
  { key: 'topic' as DimKey, label: '话题', count: topicValues.value.length },
  { key: 'root' as DimKey, label: '词根', count: rootValues.value.length },
  { key: 'prefix' as DimKey, label: '前缀', count: prefixValues.value.length },
  { key: 'suffix' as DimKey, label: '后缀', count: suffixValues.value.length }
])

const hasAnyDimension = computed(() => dimensions.value.some(d => d.count > 0))

const currentDimValues = computed<DimValue[]>(() => {
  switch (activeDim.value) {
    case 'topic': return topicValues.value
    case 'root': return rootValues.value
    case 'prefix': return prefixValues.value
    case 'suffix': return suffixValues.value
    default: return examValues.value
  }
})

/** 词素类维度不能手动增删改 —— 那是从词库结构里算出来的 */
const isMorphemeDim = computed(() =>
  activeDim.value === 'root' || activeDim.value === 'prefix' || activeDim.value === 'suffix'
)
const visibleDimValues = computed(() =>
  expandDim.value ? currentDimValues.value : currentDimValues.value.slice(0, DIM_PREVIEW)
)

const DIM_LABEL: Record<DimKey, string> = { exam: '考试', topic: '话题', root: '词根', prefix: '前缀', suffix: '后缀' }
const activeFilters = computed(() =>
  (Object.keys(dimSel.value) as DimKey[])
    .filter(k => dimSel.value[k])
    .map(k => ({ key: k, label: DIM_LABEL[k], value: dimSel.value[k] }))
)
function clearFilter(k: DimKey) { dimSel.value[k] = ''; currentPage.value = 1 }
function clearAllFilters() { dimSel.value = { exam: '', topic: '', morpheme: '' }; currentPage.value = 1 }

function setDimValue(v: string) {
  activeDimValue.value = v
  currentPage.value = 1
}

const dimManage = ref(false)
const tidying = ref(false)
const manageMsg = ref('')

let pressTimer: ReturnType<typeof setTimeout> | null = null
function startPress(name: string) {
  cancelPress()
  pressTimer = setTimeout(() => {
    dimManage.value = true
    activeDimValue.value = name
    currentPage.value = 1
  }, 500)
}
function cancelPress() {
  if (pressTimer) { clearTimeout(pressTimer); pressTimer = null }
}

async function addDimValue() {
  if (isMorphemeDim.value) { manageMsg.value = '词根、前缀、后缀是从词库结构里算出来的，不能手动新建。'; return }
  const ids = [...selectedIds.value]
  if (!ids.length) {
    manageMsg.value = '先在下面勾选要归入这个分类的词（点「选择单词」），再回来新建。'
    return
  }
  const name = prompt(`新分类的名称（会打给已选中的 ${ids.length} 个词）`)
  if (!name?.trim()) return
  const next = activeDim.value === 'exam' ? canonicalExamTag(name.trim()) : name.trim()
  tidying.value = true
  try {
    const want = new Set(ids)
    const changed: WordItem[] = []
    for (const w of wordStore.words) {
      if (!want.has(w.id)) continue
      const list = listOf(w) || []
      if (list.includes(next)) continue
      setListOf(w, [...list, next])
      w.updatedAt = new Date().toISOString()
      changed.push(w)
    }
    await persistWords(changed)
    manageMsg.value = `已新建分类「${next}」，打给 ${changed.length} 个词。`
  } finally {
    tidying.value = false
  }
}

const REPLACEMENT_CHAR = '\uFFFD'
function isBroken(name: string): boolean {
  return name.includes(REPLACEMENT_CHAR)
}

const canonicalizable = computed(() =>
  wordStore.words.filter(w => needsCanonicalize(w.tags)).length
)

async function persistWords(changed: WordItem[]) {
  if (!changed.length) return
  await wordDB.saveWordsBulk(JSON.parse(JSON.stringify(changed)))
  await be.beBulkSaveWords(changed)
}

function listOf(w: WordItem): string[] | undefined {
  return activeDim.value === 'exam' ? w.tags : activeDim.value === 'topic' ? w.topics : undefined
}
function setListOf(w: WordItem, next: string[]) {
  if (activeDim.value === 'exam') w.tags = next
  else if (activeDim.value === 'topic') w.topics = next
}

async function renameDimValue(from: string) {
  if (isMorphemeDim.value) { manageMsg.value = '词根、前缀、后缀是从词库结构里算出来的，不在这里改。'; return }
  const to = prompt(`把分类「${from}」改成：`, from.split(REPLACEMENT_CHAR).join(''))
  if (to === null) return
  const next = to.trim()
  if (!next || next === from) return
  tidying.value = true
  try {
    const changed: WordItem[] = []
    for (const w of wordStore.words) {
      const list = listOf(w)
      if (!list?.includes(from)) continue
      setListOf(w, [...new Set(list.map(t => (t === from ? next : t)))])
      w.updatedAt = new Date().toISOString()
      changed.push(w)
    }
    await persistWords(changed)
    manageMsg.value = changed.length
      ? `已把「${from}」改成「${next}」，影响 ${changed.length} 个词条。`
      : '没有词带这个分类。'
  } finally {
    tidying.value = false
  }
}

async function deleteDimValue(name: string) {
  if (isMorphemeDim.value) { manageMsg.value = '词根、前缀、后缀是从词库结构里算出来的，不在这里删。'; return }
  const hit = currentDimValues.value.find(v => v.name === name)
  if (!confirm(`从 ${hit?.count ?? 0} 个词条上去掉分类「${name}」？\n只去掉这个分类，词条本身不会删。`)) return
  tidying.value = true
  try {
    const changed: WordItem[] = []
    for (const w of wordStore.words) {
      const list = listOf(w)
      if (!list?.includes(name)) continue
      setListOf(w, list.filter(t => t !== name))
      w.updatedAt = new Date().toISOString()
      changed.push(w)
    }
    await persistWords(changed)
    if (activeDimValue.value === name) activeDimValue.value = ''
    manageMsg.value = changed.length ? `已从 ${changed.length} 个词条上去掉「${name}」。` : '没有词带这个分类。'
  } finally {
    tidying.value = false
  }
}

async function unifyExamTags() {
  tidying.value = true
  try {
    const changed: WordItem[] = []
    for (const w of wordStore.words) {
      if (!needsCanonicalize(w.tags)) continue
      w.tags = canonicalExamTags(w.tags)
      w.updatedAt = new Date().toISOString()
      changed.push(w)
    }
    await persistWords(changed)
    manageMsg.value = `已统一 ${changed.length} 个词条的考纲写法。`
  } finally {
    tidying.value = false
  }
}

function matchOne(w: WordItem, key: DimKey, v: string): boolean {
  if (!v) return true
  if (key === 'exam') return !!w.tags?.includes(v)
  if (key === 'topic') return !!w.topics?.includes(v)
  // 拆分之后各查各的：选了前缀 re- 就只看前缀，不会因为后缀同名也命中
  const m = w.morphemes
  if (!m) return false
  const part = key === 'prefix' ? m.prefix : key === 'suffix' ? m.suffix : m.root
  return part?.form === v
}

function matchDim(w: WordItem): boolean {
  const s = dimSel.value
  return matchOne(w, 'exam', s.exam)
    && matchOne(w, 'topic', s.topic)
    && matchOne(w, 'root', s.root)
    && matchOne(w, 'prefix', s.prefix)
    && matchOne(w, 'suffix', s.suffix)
}

function studyFiltered() {
  const ids = filteredWords.value.map(w => w.id)
  if (!ids.length) return
  const label = activeFilters.value.map(f => f.value).join(' + ') || '筛选'
  router.push(commitScope({ kind: 'adhoc', ids, label: `${label} · ${ids.length} 词` }))
}

async function saveFilteredAsBook() {
  const ids = filteredWords.value.map(w => w.id)
  if (!ids.length) return
  const dimLabel = dimensions.value.find(d => d.key === activeDim.value)?.label || ''
  const name = prompt('新词表名称', `${dimLabel}·${activeDimValue.value}`)
  if (!name?.trim()) return
  const now = new Date().toISOString()
  await wordStore.createGroup({
    id: `book-filter-${Date.now()}`,
    name: name.trim(),
    description: `按${dimLabel}「${activeDimValue.value}」筛出的 ${ids.length} 个词`,
    wordIds: ids,
    createdAt: now,
    updatedAt: now
  })
}

const scopedWords = computed<WordItem[]>(() => groupWords.value)

const filteredWords = computed<WordItem[]>(() => {
  let list = scopedWords.value
  if (activeFilters.value.length) list = list.filter(matchDim)
  if (familyFilter.value) {
    list = list.filter(w => familyFilter.value!.has(w.word.toLowerCase()))
  }
  if (statusFilter.value !== 'all') {
    void familiarityTick.value
    const want = statusFilter.value
    list = list.filter(w => {
      const f = familiarityOf(w, masteredSet.value)
      if (want === 'unmarked') return f.level === 'unseen'
      return f.level === want
    })
  }
  const q = wordStore.searchQuery.trim().toLowerCase()
  if (q) {
    // 除了词形和释义，也认词根词缀 —— 搜 spect 要能捞出
    // inspect / respect / spectator 这一族
    list = list.filter(w => {
      const lw = w.word.toLowerCase()
      // 单个字母 = 按首字母找；两个字母以上 = 全文包含
      if (q.length === 1 && /[a-z]/.test(q)) {
        if (lw.startsWith(q)) return true
      } else if (lw.includes(q)) {
        return true
      }
      if (w.meanings?.some(m => m.chinese?.includes(q))) return true
      const mo = w.morphemes
      if (mo) {
        for (const part of [mo.prefix, mo.root, mo.suffix]) {
          if (part?.form && part.form.toLowerCase().includes(q)) return true
        }
      }
      return false
    })
  }
  if (order.value === 'shuffle1') list = seededShuffle(list, 12345)
  else if (order.value === 'shuffle2') list = seededShuffle(list, 67890)
  return list
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredWords.value.length / pageSize.value)))
const pagedWords = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredWords.value.slice(start, start + pageSize.value)
})
watch(totalPages, tp => { if (currentPage.value > tp) currentPage.value = tp })

function statusCount(s: string): number {
  return familiarityCounts.value[s] ?? 0
}

function setOrder(o: typeof order.value) {
  order.value = o
  currentPage.value = 1
}

const selectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())

function toggleSelectMode() {
  selectMode.value = !selectMode.value
  if (!selectMode.value) selectedIds.value = new Set()
}
function togglePick(id: string) {
  const s = new Set(selectedIds.value)
  s.has(id) ? s.delete(id) : s.add(id)
  selectedIds.value = s
}
function selectAllOnPage() {
  const s = new Set(selectedIds.value)
  for (const w of pagedWords.value) s.add(w.id)
  selectedIds.value = s
}
function clearSelection() {
  selectedIds.value = new Set()
}

function studySelected() {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  router.push(commitScope({ kind: 'adhoc', ids, label: `自选 · ${ids.length} 词` }))
}

async function saveSelectionAsBook() {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  const name = prompt('新词表名称', `自选词表 ${new Date().toLocaleDateString('zh-CN')}`)
  if (!name?.trim()) return
  const now = new Date().toISOString()
  const group = {
    id: `book-pick-${Date.now()}`,
    name: name.trim(),
    description: `从词库中手动挑选的 ${ids.length} 个词`,
    wordIds: ids,
    createdAt: now,
    updatedAt: now
  }
  await wordStore.createGroup(group)
  selectMode.value = false
  selectedIds.value = new Set()
}

function onMark(wordId: string, status: WordStatus) {
  wordStore.setWordStatus(wordId, status)
}

const selectedWord = ref<WordItem | null>(null)

function focusWord(w: WordItem | null) {
  selectedWord.value = w
  if (w && universeOpen.value) graphCenter.value = w
}
function onMemorize(wordId: string) {
  wordStore.memorizeWord(wordId)
  wordStore.setWordStatus(wordId, 'known')
  selectedWord.value = null
}

const relatedWordHint = ref('')
function onSearchRelatedWord(word: string) {
  const target = wordStore.words.find(w => w.word.toLowerCase() === word.toLowerCase())
  if (target) {
    selectedWord.value = target
    relatedWordHint.value = ''
  } else {
    relatedWordHint.value = `"${word}" 还未收录，可以去 AI 助手用"单词讲解"查一下，或导入完整释义库看看是否收录`
    setTimeout(() => { if (relatedWordHint.value.includes(word)) relatedWordHint.value = '' }, 4000)
  }
}

const universeOpen = ref(false)
const universeFullscreen = ref(false)

const currentGroupLabel = computed(() => {
  if (currentGroupId.value === 'all') return '全部单词'
  const g = wordStore.groups.find(gg => gg.id === currentGroupId.value)
  return g?.name || '全部单词'
})

const GRAPH_NODE_LIMIT = 400

const graphNodes = ref<GraphNode[]>([])
const graphLinks = ref<GraphLink[]>([])

const graphCenter = ref<WordItem | null>(null)

const graphColorBy = ref<'exam' | 'topic' | 'morpheme'>('exam')

const graphTopics = ref<string[]>([])
const graphMorphemes = ref<string[]>([])

const colorTick = ref(0)

function buildGraphFromFilteredWords() {
  const center = graphCenter.value
  const items = center
    ? centerNetwork(wordStore.words, center, 1)
    : filteredWords.value.slice(0, GRAPH_NODE_LIMIT)

  const edges = relationEdges(items)

  let clusterOf = new Map<string, string>()
  let cores = new Set<string>()
  let keep = items
  if (!center && items.length > 1) {
    const forCluster = edges.map(e => ({ a: e.source, b: e.target, w: e.weight }))
    const names = items.map(w => w.word)
    const comm = detectCommunities(names, forCluster)
    const r = pickConstellations({ words: names, edges: forCluster, limit: items.length, communities: comm })
    clusterOf = r.clusterOf
    cores = r.cores
    const order = new Set(r.keep)
    keep = items.filter(w => order.has(w.word))
  }

  const topics = new Set<string>()
  const morphs = new Set<string>()
  for (const w of keep) {
    for (const t of w.topics || []) topics.add(t)
    const k = morphemeKeyOf(w)
    if (k) morphs.add(k)
  }
  graphTopics.value = [...topics].sort()
  graphMorphemes.value = [...morphs].sort()

  const nodes: GraphNode[] = keep.map(w => {
    const owner = clusterOf.get(w.word)
    const node: GraphNode = {
      id: w.word,
      word: w.word,
      definitionZh: w.meanings?.[0]?.chinese,
      sources: sourcesOf(w),
      clusterOf: owner && owner !== w.word ? owner : undefined,
      isCenter: !!center && w.word === center.word
    }
    if (graphColorBy.value === 'topic') {
      const t = w.topics?.[0]
      node.forceColor = t ? topicColor(t, graphTopics.value) : '#4a4a55'
    } else if (graphColorBy.value === 'morpheme') {
      const k = morphemeKeyOf(w)
      node.forceColor = k ? morphemeColor(k, graphMorphemes.value) : '#4a4a55'
    }
    return node
  })

  const inScope = new Set(keep.map(w => w.word))
  let links = edges.filter(e => inScope.has(e.source) && inScope.has(e.target))
  if (clusterOf.size) {
    const { kept, bridges } = filterConstellationLinks(links, clusterOf, cores)
    links = kept.map(l => (bridges.has(l) ? { ...l, bridge: true } : l))
  }

  graphNodes.value = nodes
  graphLinks.value = links as unknown as GraphLink[]
}

const graphLegendItems = computed<{ name: string; color: string }[]>(() => {
  void colorTick.value
  if (graphColorBy.value === 'topic') {
    const out = graphTopics.value.map(t => ({ name: t, color: topicColor(t, graphTopics.value) }))
    if (graphNodes.value.some(n => n.forceColor === '#4a4a55')) out.push({ name: '没有话题', color: '#4a4a55' })
    return out
  }
  if (graphColorBy.value === 'morpheme') {
    const out = graphMorphemes.value.slice(0, 12).map(k => ({ name: k, color: morphemeColor(k, graphMorphemes.value) }))
    if (graphMorphemes.value.length > 12) out.push({ name: `其余 ${graphMorphemes.value.length - 12} 个词根`, color: '#7b7b88' })
    if (graphNodes.value.some(n => n.forceColor === '#4a4a55')) out.push({ name: '没有词根', color: '#4a4a55' })
    return out
  }
  return []
})

watch([filteredWords, universeOpen, graphCenter, graphColorBy], () => {
  if (universeOpen.value) buildGraphFromFilteredWords()
})

let unsubGraphColor: (() => void) | null = null
onMounted(() => {
  unsubGraphColor = onColorChange(() => {
    colorTick.value++
    if (universeOpen.value) buildGraphFromFilteredWords()
  })
})
onUnmounted(() => { unsubGraphColor?.(); unsubGraphColor = null })

const graphSources = computed(() => {
  const set = new Set<string>()
  for (const n of graphNodes.value) for (const s of n.sources || []) set.add(s)
  return [...set]
})

function onSelectGraphWord(word: string) {
  const item = wordStore.words.find(w => w.word.toLowerCase() === word.toLowerCase())
  if (item) focusWord(item)
}

const scopeDialogFor = ref<null | 'dictation' | 'flashcard' | 'match'>(null)
const flashcardWords = ref<WordItem[] | null>(null)

const scopeDialogTitle = computed(() => {
  if (scopeDialogFor.value === 'dictation') return '听写：选择范围'
  if (scopeDialogFor.value === 'flashcard') return '卡片背单词：选择范围'
  if (scopeDialogFor.value === 'match') return '卡片消消乐：选择范围'
  return ''
})

function openScope(kind: 'dictation' | 'flashcard' | 'match') {
  if (!filteredWords.value.length) return
  scopeDialogFor.value = kind
}

function onScopeChosen(scope: 'page' | 'pageAfter' | 'all') {
  let list: WordItem[] = []
  const start = (currentPage.value - 1) * pageSize.value
  if (scope === 'page') list = filteredWords.value.slice(start, start + pageSize.value)
  else if (scope === 'pageAfter') list = filteredWords.value.slice(start)
  else list = [...filteredWords.value]

  const kind = scopeDialogFor.value
  scopeDialogFor.value = null
  if (!list.length) return

  if (kind === 'flashcard') {
    flashcardWords.value = list
  } else {
    wordStore.setStudyList(list)
    router.push(kind === 'match' ? '/match' : '/dictation')
  }
}

const importGroupName = ref('')
const importMessage = ref('')
const dragOver = ref(false)
const importing = ref(false)
const enrichProgress = computed(() => wordStore.enrichProgress)
const dedupingWords = ref(false)
const dedupeMessage = ref('')
async function doDedupeWords() {
  dedupingWords.value = true
  dedupeMessage.value = ''
  try {
    const r = await wordStore.dedupeWords()
    dedupeMessage.value = r.merged
      ? `清理完成：合并了 ${r.merged} 个重复词条，修正了 ${r.groupsFixed} 个词书里的重复引用`
      : '没有发现重复词条'
  } finally {
    dedupingWords.value = false
  }
}

async function doImport(file: File) {
  importing.value = true
  importMessage.value = '正在解析文件...'
  try {
    const result = await wordStore.importWordsAsGroup(file, importGroupName.value)
    if (result.successCount === 0 && result.total === 0) {
      importMessage.value = result.messages[0] || '未能从文件中解析出任何词条，请检查格式'
    } else {
      importMessage.value = `导入完成：成功 ${result.successCount} 条${result.failCount ? `，失败 ${result.failCount} 条` : ''}。词条将在后台自动补全音标与例句。`
      importGroupName.value = ''
      currentPage.value = 1
    }
  } catch (e) {
    importMessage.value = `导入失败：${e instanceof Error ? e.message : '请检查文件格式'}`
  } finally {
    importing.value = false
  }
}

function onFilePick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) doImport(file)
  ;(e.target as HTMLInputElement).value = ''
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) doImport(file)
}

onMounted(async () => {
  await wordStore.loadWords()
  await loadFsrsData()
  await loadMasteredWords()
  masteredSet.value = getMasteredSet()
  familiarityTick.value++
})
</script>

<style lang="scss" scoped>

/* 这几个类之前一直没有样式 —— 全项扫描时才发现 */
.manage-hint { font-size: 12px; color: var(--r-ink2, #9aa0a6); line-height: 1.6; }
.cards { display: block; width: 100%; }
.word-core {
  max-width: 1440px;
  margin: 0 auto;
  padding: 20px 24px 60px;
}

.library-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 18px;
}
.library-card {
  position: relative;
  border: 1px solid #e6e6e6;
  background: #fff;
  border-radius: 12px;
  padding: 12px 18px;
  min-width: 120px;
  cursor: pointer;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 4px;
  &:hover { border-color: #ccc; background: #fafafa; }
  &.on { background: var(--r-accent, #8a4b3a); border-color: transparent; .library-name, .library-count { color: #fff; } }
}
.library-name { font-size: 14.5px; font-weight: 600; color: var(--r-ink, #1c1c1c); }
.library-count { font-size: 12px; color: #999; }
.library-card { padding-right: 18px; }
.library-edit, .library-del {
  position: absolute;
  top: 6px;
  opacity: 0;
  font-size: 12px;
  line-height: 1;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--r-paper, #fff);
  border: 1px solid var(--r-border, #e0e0e0);
  transition: opacity 0.12s;
}
.library-card:hover .library-edit,
.library-card:hover .library-del { opacity: 0.85; }
.library-edit:hover, .library-del:hover { opacity: 1 !important; }
.library-del:hover { color: #c0492b; border-color: #e0b4aa; }
.library-edit { right: 26px; }
.library-del { right: 4px; }
.library-new {
  border-style: dashed;
  color: #888;
  justify-content: center;
  align-items: center;
  .library-name { color: #888; font-weight: 500; }
  &:hover { border-color: transparent; .library-name { color: var(--r-ink, #1c1c1c); } }
}

.filter-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}
.filter-label { font-weight: 600; color: #333; }
.chip {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  border: none;
  background: var(--r-ui, #f2f2f2);
  border-radius: 18px;
  padding: 7px 16px;
  font-size: 14px;
  cursor: pointer;
  color: #333;
  &:hover { background: #e6e6e6; }
  &.on { background: var(--r-accent, #8a4b3a); color: #fff; }
  &.small { padding: 5px 12px; font-size: 12.5px; }
  .chip-count { margin-left: 5px; font-size: 12px; opacity: 0.65; }
  .chip-del { margin-left: 6px; opacity: 0.4; padding: 0 2px; &:hover { opacity: 1; color: #b05a4a; } }
  .chip-edit { margin-left: 6px; opacity: 0.4; padding: 0 2px; &:hover { opacity: 1; } }
}
.chapter-row { margin-top: -4px; margin-bottom: 10px; padding-left: 4px; }
.dimension-block {
  margin: 4px 0 16px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--r-ui, #f7f7f7);
}
.dimension-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
.dim-tab {
  border: none;
  background: transparent;
  color: var(--r-ink2, #888);
  font-size: 13px;
  padding: 4px 12px;
  border-radius: 7px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  &:hover:not(:disabled) { color: var(--r-ink, #333); }
  &.on { background: var(--r-paper, #fff); color: var(--r-ink, #1c1c1c); font-weight: 600; }
  &:disabled { opacity: 0.35; cursor: default; }
}
.dim-count { font-size: 11px; opacity: 0.6; }
.value-row { flex-wrap: wrap; row-gap: 6px; margin: 0; }
.dim-action {
  display: flex; align-items: center; gap: 8px;
  margin-top: 10px; padding-top: 10px;
  border-top: 1px solid var(--r-border, #e8e8e8);
}
.dim-hint { font-size: 12.5px; color: var(--r-ink2, #888); }
.chip.small.ghost { opacity: 0.75; border-style: dashed; }

.tag-row { margin-top: -2px; margin-bottom: 18px; padding-left: 4px; }
.select-bar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-bottom: 12px;
}
.sel-count { font-size: 12.5px; color: var(--r-ink2, #888); }
.card-wrap { position: relative; }
.card-wrap.picking { cursor: pointer; }
.card-wrap.picking :deep(*) { pointer-events: none; }
.card-wrap.picked::after {
  content: ''; position: absolute; inset: 0; border-radius: 12px;
  border: 2px solid var(--r-accent, #8a4b3a); pointer-events: none;
}
.pick-mark {
  position: absolute; top: 8px; right: 8px; z-index: 3;
  width: 20px; height: 20px; border-radius: 50%;
  border: 1px solid var(--r-border, #ccc); background: var(--r-paper, #fff);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: var(--r-accent, #8a4b3a);
}
.search-row {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  margin: 4px 0 16px;
}
.search-box { position: relative; width: min(460px, 100%); }
.word-search {
  width: 100%;
  padding: 9px 34px 9px 16px;
  border: 1px solid var(--r-border, #ddd);
  border-radius: 9999px;
  background: var(--r-paper, #fff);
  color: inherit;
  font-size: 14px;
  outline: none;
  &:focus { border-color: var(--r-accent, #8a4b3a); }
}
.search-clear {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  border: none; background: none; cursor: pointer;
  font-size: 17px; line-height: 1; color: var(--r-ink2, #999);
  &:hover { color: var(--r-ink, #333); }
}
.search-count { font-size: 12.5px; color: var(--r-ink2, #999); }
.family-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 9px 14px; margin-bottom: 14px; border-radius: 9px;
  background: var(--r-ui, #f2f2f2); font-size: 13px; color: var(--r-ink2, #666);
}
.chip.small.ghost { opacity: 0.7; border-style: dashed; }

.status-tabs {
  display: inline-flex;
  background: var(--r-ui, #f2f2f2);
  border-radius: 10px;
  padding: 4px;
  margin-bottom: 14px;
}
.tab {
  border: none;
  background: none;
  padding: 7px 16px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  color: #444;
  &.on { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff)); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1); font-weight: 600; }
  .tab-count { margin-left: 4px; font-size: 12px; color: #999; }
}

.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 18px;
}
.seg {
  display: inline-flex;
  background: var(--r-ui, #f2f2f2);
  border-radius: 10px;
  padding: 4px;
}
.seg-btn {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  border: none;
  background: none;
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  color: #444;
  &.on { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff)); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1); font-weight: 600; }
}
.dark-btn {
  box-shadow: 0 1px 2px color-mix(in srgb, var(--r-accent, #8a4b3a) 22%, transparent);
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  border: none;
  background: var(--r-accent, #8a4b3a);
  color: #fff;
  border-radius: 9px;
  padding: 9px 20px;
  font-size: 14px;
  cursor: pointer;
  &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 82%, #000); }
}
.ghost-btn {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  border: 1px solid var(--r-border, #ddd);
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff));
  border-radius: 9px;
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
  color: #444;
  &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff)); border-color: color-mix(in srgb, var(--r-accent, #8a4b3a) 42%, transparent); }
}
.enrich-banner {
  background: #fdf6e8;
  border: 1px solid #f0e2bd;
  color: #8a6d2f;
  border-radius: 8px;
  padding: 9px 14px;
  font-size: 13px;
  margin-bottom: 14px;
  .enrich-word { margin-left: 8px; font-weight: 600; }
}

.grid-layout {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  grid-auto-rows: 1fr; /* 每行等高，保证行列齐整 */
  gap: 14px;
}
.list-layout {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
@media (max-width: 560px) {
  .grid-layout { grid-template-columns: 1fr; }
}

.empty-hint { color: #999; text-align: center; padding: 40px 0; }

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin: 26px 0;
}
.page-btn {
  border: 1px solid var(--r-border, #ddd);
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff));
  border-radius: 8px;
  padding: 8px 18px;
  font-size: 14px;
  cursor: pointer;
  &:disabled { opacity: 0.4; cursor: not-allowed; }
  &:not(:disabled):hover { background: #f5f5f5; }
  &.primary { background: var(--r-accent, #8a4b3a); border-color: transparent; color: #fff; &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 82%, #000); } }
}
.page-info { color: #555; font-size: 14px; }
.page-size-select {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #666;
  font-size: 13.5px;
  margin-left: 8px;
  select {
    border: 1px solid var(--r-border, #ddd);
    border-radius: 7px;
    padding: 5px 8px;
    font-size: 13.5px;
    outline: none;
    &:focus { border-color: #999; }
  }
}

.import-box {
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 20px 22px;
}
.import-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
  h3 { font-size: 17px; color: #1a1a1a; }
  p { color: #999; font-size: 12.5px; }
  code { background: #f4f4f4; padding: 1px 5px; border-radius: 4px; }
}
.import-form { display: flex; gap: 12px; flex-wrap: wrap; }
.group-name-input {
  border: 1px solid var(--r-border, #ddd);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 14px;
  width: 220px;
  outline: none;
  &:focus { border-color: #999; }
}
.drop-zone {
  flex: 1;
  min-width: 240px;
  border: 1.5px dashed #ccc;
  border-radius: 8px;
  padding: 22px;
  text-align: center;
  color: #777;
  cursor: pointer;
  transition: all 0.15s;
  &:hover, &.over { border-color: transparent; color: var(--r-ink, #1c1c1c); background: #fafafa; }
}
.import-msg { margin-top: 10px; color: #4a7d3a; font-size: 13px; }
.lib-import-box {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px dashed #eee;
}
.lib-title { font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 10px; }
.lib-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.lib-status { font-size: 13px; color: #4a7d3a; }

.related-hint-toast {
  position: fixed;
  bottom: 90px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--r-accent, #8a4b3a);
  color: #fff;
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 13.5px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  z-index: 400;
  max-width: 80vw;
  text-align: center;
}

.universe-tab {
  position: fixed;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  writing-mode: vertical-rl;
  text-orientation: upright;
  letter-spacing: 4px;
  background: var(--r-accent, #8a4b3a);
  color: #fff;
  border: none;
  border-radius: 10px 0 0 10px;
  padding: 16px 8px;
  font-size: 13px;
  cursor: pointer;
  z-index: 300;
  &:hover { padding-right: 12px; }
}

.universe-panel {
  position: fixed;
  right: 16px;
  top: 100px;
  bottom: 16px;
  width: 380px;
  background: #fff;
  border: 1px solid #e6e6e6;
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  z-index: 300;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: all 0.25s ease;
}
.universe-panel.fullscreen {
  right: 0;
  top: 0;
  bottom: 0;
  left: 0;
  width: auto;
  border-radius: 0;
  border: none;
}
.universe-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid #f0f0f0;
  flex-shrink: 0;
}
.universe-title { font-size: 13.5px; font-weight: 600; color: var(--r-ink, #1c1c1c); }
.universe-actions { display: flex; gap: 6px; }
.universe-icon-btn {
  border: 1px solid #e6e6e6;
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff));
  border-radius: 7px;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
  color: #444;
  &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff)); border-color: color-mix(in srgb, var(--r-accent, #8a4b3a) 42%, transparent); }
}
.universe-legend {
  padding: 8px 16px;
  border-bottom: 1px solid #f5f5f5;
  flex-shrink: 0;
}
.universe-graph { flex: 1; min-height: 0; position: relative; }

.universe-stats {
  position: absolute;
  right: 14px;
  bottom: 14px;
  display: flex;
  gap: 8px;
  pointer-events: none;
  z-index: 5;
}
.stat-badge {
  padding: 3px 10px;
  border-radius: 9999px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--r-ink2, #666);
  background: color-mix(in srgb, var(--r-paper, #fff) 82%, transparent);
  border: 1px solid var(--r-border, #e2e2e2);
  backdrop-filter: blur(6px);
}
.universe-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
  font-size: 13px;
  padding: 0 20px;
  text-align: center;
}
.chip-wrap { display: inline-flex; align-items: center; gap: 3px; }
.chip.broken { border-color: #e0b4aa; background: #fdf5f3; }
.value-row.managing {
  background: var(--r-ui, #faf7f5);
  border-radius: 10px;
  padding: 6px 8px;
}
.chip-act {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; flex-shrink: 0;
  border: 1px solid var(--r-border, #e0e0e0); border-radius: 50%;
  background: var(--r-paper, #fff); color: var(--r-ink2, #888);
  cursor: pointer; font-size: 13px; line-height: 1;
  &:hover { color: var(--r-ink, #222); border-color: var(--r-ink2, #bbb); }
  &.danger:hover { color: #c0492b; border-color: #e0b4aa; }
  &.on { background: var(--r-accent, #8a4b3a); color: var(--r-paper, #fff); border-color: transparent; }
  &:disabled { opacity: 0.4; cursor: default; }
}
.manage-bar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 12px;
  margin-top: 8px; font-size: 12px; color: var(--r-ink2, #999); line-height: 1.6;
}
.manage-fix { display: inline-flex; align-items: center; gap: 8px; color: #c0492b; }
.manage-msg { color: var(--r-ink, #444); }
.import-mask {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
}
.import-mask .import-box {
  position: relative;
  width: min(760px, 100%);
  max-height: 86vh;
  overflow-y: auto;
  background: var(--r-paper, #fff);
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  padding: 22px 24px;
}
.import-close {
  position: absolute; right: 14px; top: 10px;
  border: none; background: none; cursor: pointer;
  font-size: 22px; line-height: 1; color: var(--r-ink2, #999);
}
.import-close:hover { color: var(--r-ink, #333); }
.dim-tab.picked { border-color: var(--r-accent, #8a4b3a); }
.active-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 10px; }
.af-label { font-size: 11.5px; color: var(--r-ink2, #aaa); }
.af-chip {
  border: 1px solid var(--r-accent, #8a4b3a); background: var(--r-ui, #f6f6f6);
  color: var(--r-accent, #8a4b3a); border-radius: 9999px;
  padding: 3px 9px; font-size: 12px; cursor: pointer;
}
.af-clear { border: none; background: none; cursor: pointer; font-size: 12px; color: var(--r-ink2, #999); }
</style>
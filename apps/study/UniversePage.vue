<template>
  <div class="universe-page">
    <header class="uni-head">
      <div class="head-left">
        <button class="ghost-btn small" @click="$router.push('/home')">← 主页</button>
        <h2 class="uni-title">词汇宇宙</h2>
        <span class="uni-count">
          {{ nodes.length }} 词 · {{ links.length }} 关系
          <template v-if="drawn.links !== links.length"> · 实际画出 {{ drawn.links }} 条</template>
        </span>
      </div>

      <div class="head-search" :class="{ focus: searchFocus }">
        <input
          v-model="searchText"
          class="search-input"
          type="text"
          placeholder="搜一个词，看它的关系网"
          @focus="searchFocus = true"
          @blur="onSearchBlur"
          @keydown.enter="commitSearchTop"
        />
        <button v-if="centerWord" class="search-exit" title="回到筛选结果" @click="exitCenter">×</button>
        <div v-if="searchFocus && suggestions.length" class="search-drop">
          <button
            v-if="searchHits.length > suggestions.length"
            class="search-item all"
            @mousedown.prevent="showAllHits"
          >
            把匹配的 {{ searchHits.length }} 个词全画出来
          </button>
          <button
            v-for="s in suggestions"
            :key="s.id"
            class="search-item"
            @mousedown.prevent="focusOn(s)"
          >
            <span class="si-word">{{ s.word }}</span>
            <span class="si-zh">{{ s.meanings?.[0]?.chinese || '' }}</span>
          </button>
        </div>
      </div>

      <div class="head-right"></div>
    </header>

    <div class="uni-body">
      <button
        class="panel-toggle"
        :class="{ folded: panelFolded }"
        :title="panelFolded ? '展开设置面板' : '收起设置面板，把画布铺满'"
        @click="panelFolded = !panelFolded"
      >{{ panelFolded ? '›' : '‹' }}</button>

      <aside v-show="!panelFolded" class="uni-panel">
        <div class="panel-block">
          <p class="panel-label">节点着色</p>
          <div class="mode-row">
            <button class="mode-btn" :class="{ on: colorBy === 'exam' }" @click="colorBy = 'exam'">按考试</button>
            <button class="mode-btn" :class="{ on: colorBy === 'topic' }" @click="colorBy = 'topic'">按话题</button>
            <button class="mode-btn" :class="{ on: colorBy === 'morpheme' }" @click="colorBy = 'morpheme'">按词根</button>
            <button class="mode-btn" :class="{ on: colorBy === 'mastery' }" @click="colorBy = 'mastery'">按掌握</button>
          </div>
        </div>

        <div v-if="centerWord" class="panel-block center-block">
          <p class="panel-label">正在看关系网</p>
          <p class="center-word">{{ centerWord.word }}</p>
          <p class="panel-hint">{{ centerWord.meanings?.[0]?.chinese || '' }}</p>
          <div class="density-row">
            <span class="panel-label" style="margin:0">扩散层数</span>
            <select v-model.number="expandDepth" class="mini-select">
              <option :value="1">1 层（直接相关）</option>
              <option :value="2">2 层（相关词的相关词）</option>
            </select>
          </div>
          <button class="ghost-btn small" @click="exitCenter">回到筛选结果</button>
        </div>

        <template v-else>
          <div class="panel-block">
            <p class="panel-label">词库</p>
            <select v-model="bookId" class="mini-select full">
              <option value="">全部词库（{{ wordStore.words.length }}）</option>
              <option v-for="g in books" :key="g.id" :value="g.id">
                {{ g.name }}（{{ g.wordIds.length }}）
              </option>
            </select>
          </div>

          <div class="panel-block">
            <div class="panel-label-row">
              <span class="panel-label">分类</span>
              <button v-if="sel[dim]" class="link-btn" @click="sel[dim] = ''">清除</button>
            </div>
            <div class="mode-row">
              <button
                v-for="d in dimensions"
                :key="d.key"
                class="mode-btn"
                :class="{ on: dim === d.key, picked: !!sel[d.key] }"
                :disabled="!d.count"
                @click="pickDim(d.key)"
              >{{ d.label }}<span v-if="d.count" class="dim-count">{{ sel[d.key] || d.count }}</span></button>
            </div>
            <div class="val-list">
              <button class="val-chip" :class="{ on: !sel[dim] }" @click="sel[dim] = ''">不限</button>
              <button
                v-for="v in visibleDimValues"
                :key="v.name"
                class="val-chip"
                :class="{ on: sel[dim] === v.name }"
                :title="v.meaning || v.name"
                @click="sel[dim] = sel[dim] === v.name ? '' : v.name"
              >
                <span v-if="dim === 'exam'" class="dot" :style="{ background: dotColor(v.name) }"></span>
                {{ v.name }}<span class="val-count">{{ v.count }}</span>
              </button>
              <button v-if="dimValues.length > DIM_PREVIEW" class="val-chip ghost" @click="expandDim = !expandDim">
                {{ expandDim ? '收起' : '… 更多 ' + (dimValues.length - DIM_PREVIEW) }}
              </button>
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
          </div>

          <div class="panel-block">
            <p class="panel-label">掌握程度</p>
            <div class="mode-row">
              <button
                v-for="st in STATUS_FILTERS"
                :key="st.key"
                class="mode-btn"
                :class="{ on: statusFilter === st.key }"
                @click="statusFilter = st.key"
              >{{ st.label }}</button>
            </div>
          </div>

          <div class="panel-block">
            <p class="panel-label">关系</p>
            <div class="mode-row">
              <button
                v-for="r in REL_OPTIONS"
                :key="r.key"
                class="mode-btn"
                :class="{ on: relTypes.includes(r.key) }"
                @click="toggleRel(r.key)"
              >
                <span class="dot" :style="{ background: relColor(r.key) }"></span>{{ r.label }}
              </button>
            </div>
          </div>

          <div class="panel-block">
            <p class="panel-big">{{ scopedWords.length }}<em>个词在范围内</em></p>
            <label class="panel-label">
              加载数量：{{ limit >= MAX_LIMIT ? '全部' : limit === 0 ? '不画' : limit }}
            </label>
            <input v-model.number="limitIdx" type="range" :min="0" :max="LIMIT_STEPS.length - 1" :step="1" class="slider" />
            <p v-if="buildError" class="warn">构建失败：{{ buildError }}</p>
            <button class="dark-btn small full" :disabled="!dirty" @click="applyLoad">
              {{ dirty ? '加载这一批' : '已是当前视图' }}
            </button>
            <p v-if="applied" class="panel-hint">
              {{ superCount }} 大类 · {{ cloudCount }} 话题 · {{ applied.clusterCount }} 词根团
            </p>
          </div>

          <div class="panel-block">
            <details class="manual-fold">
              <summary class="panel-label">手动输入一批词</summary>
              <textarea
                v-model="manualText"
                class="manual-input"
                rows="6"
                placeholder="一行或用逗号分隔"
              ></textarea>
              <p v-if="manualOverflow" class="warn">超出 {{ MANUAL_MAX }} 个，只取前面的部分</p>
              <button class="ghost-btn small" :disabled="!manualText" @click="manualText = ''">清空</button>
            </details>
          </div>
        </template>

        <div class="panel-block">
          <div class="panel-label-row">
            <span class="panel-label">已加载 {{ nodes.length }} 个</span>
            <button class="link-btn" :disabled="!nodes.length" @click="clearGraph">清空图表</button>
          </div>
          <div class="loaded-chips">
            <span v-for="n in nodes.slice(0, 50)" :key="n.id" class="loaded-chip">{{ n.word }}</span>
            <span v-if="nodes.length > 50" class="loaded-chip more">+{{ nodes.length - 50 }} 更多</span>
          </div>
        </div>
      </aside>

      <div class="uni-graph">
        <WordGraph3D
          v-if="nodes.length"
          ref="graphRef"
          :nodes="nodes"
          :links="links"
          :cluster-info="applied?.info"
          :loading="loadingGraph"
          @select="onSelect"
          @stats="drawn = $event"
        />
        <p v-else class="uni-empty">当前条件下没有可展示的单词</p>
      </div>

      <aside v-if="detailWord" class="uni-detail">
        <WordDetailInline
          :word="detailWord"
          inline
          @close="detailWord = null"
          @search="onSelect"
          @filter-family="focusOn"
        />
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { describePage } from '@/shared/core/agentTools'
import { useAgentChatStore } from '@/shared/stores/agentChatStore'
import WordGraph3D from '@/apps/word-core/components/WordGraph3D.vue'
import type { GraphNode, GraphLink } from '@/apps/word-core/components/WordGraph3D.vue'
import GraphLegend from '@/apps/word-core/components/GraphLegend.vue'
import WordDetailInline from '@/apps/word-core/components/WordDetailModal.vue'
import { RELATION_WEIGHTS, type RelationType } from '@/apps/word-core/components/graphColors'
import {
  detectCommunities, pickConstellations, filterConstellationLinks, membersPerCluster
} from '@/shared/core/wordClusters'
import { sourceColor, masteryColor, topicColor, morphemeColor, relationColor, onColorChange } from '@/shared/core/graphColorSettings'
import { relationEdges, centerNetwork, morphOf, sourcesOf, morphemeKeyOf } from '@/shared/core/graphModel'
import { superTopicOf, refineTopic } from '@/shared/core/topicTaxonomy'
import { loadMasteredWords, getMasteredSet } from '@/shared/core/masteredWords'
import { familiarityOf } from '@/shared/core/familiarity'
import { loadFsrsData } from '@/shared/core/fsrs'
import { useWordStore } from '@/shared/stores/wordStore'
import type { WordItem } from '@/shared/types/WordItem'

const wordStore = useWordStore()
const agentChat = useAgentChatStore()

const LIMIT_STEPS = [0, 60, 120, 200, 300, 500, 800, 1200, 2000, 3000, 5000, 8000, 15000]
const MAX_LIMIT = LIMIT_STEPS[LIMIT_STEPS.length - 1]
const MANUAL_MAX = 500
const DIM_PREVIEW = 12

const limitIdx = ref(LIMIT_STEPS.indexOf(300))
const limit = computed(() => LIMIT_STEPS[limitIdx.value] ?? 300)
const manualText = ref('')
const detailWord = ref<WordItem | null>(null)
/**
 * 左侧设置面板收起没有。
 *
 * 模板里那个折叠按钮一直在用 panelFolded（:class、v-show、@click 五处），
 * 但 script 里从来没声明过 —— Vue 会把它当成 undefined：
 * 面板永远展开、按钮点了没反应，控制台还会报 property not defined。
 * 这是这次全量自查扫出来的，不是这轮改动引起的。
 */
const panelFolded = ref(false)
const colorBy = ref<'exam' | 'topic' | 'morpheme' | 'mastery'>('exam')

const colorTick = ref(0)
let unsubColor: (() => void) | null = null
onMounted(() => { unsubColor = onColorChange(() => colorTick.value++) })
onUnmounted(() => { unsubColor?.(); unsubColor = null })
function dotColor(name: string): string {
  void colorTick.value
  return sourceColor(name)
}

type RelKey = 'synonym' | 'word_family' | 'antonym'
const REL_OPTIONS: { key: RelKey; label: string }[] = [
  { key: 'synonym', label: '近义词' },
  { key: 'word_family', label: '同根词' },
  { key: 'antonym', label: '反义词' }
]
const relTypes = ref<RelKey[]>(['synonym', 'word_family', 'antonym'])
function toggleRel(k: RelKey) {
  const i = relTypes.value.indexOf(k)
  if (i >= 0) { if (relTypes.value.length > 1) relTypes.value.splice(i, 1) }
  else relTypes.value.push(k)
}
function relColor(k: RelKey): string { void colorTick.value; return relationColor(k) }

type DimKey = 'exam' | 'topic' | 'morpheme'
interface DimValue { name: string; count: number; meaning?: string }

const bookId = ref('')
const dim = ref<DimKey>('exam')
const sel = ref<Record<DimKey, string>>({ exam: '', topic: '', morpheme: '' })
const expandDim = ref(false)

const STATUS_FILTERS = [
  { key: 'all', label: '不限' },
  { key: 'unmarked', label: '未标注' },
  { key: 'known', label: '认识' },
  { key: 'fuzzy', label: '模糊' },
  { key: 'unknown', label: '不认识' }
] as const
const statusFilter = ref<'all' | 'unmarked' | 'known' | 'fuzzy' | 'unknown'>('all')

const books = computed(() => wordStore.groups.filter(g => g.id.startsWith('book-') && !g.parentId))

function topicsOf(w: WordItem): string[] {
  const t: any = (w as any).topics
  if (Array.isArray(t)) return t.map(x => String(x).trim()).filter(Boolean)
  if (typeof t === 'string') return t.split(/[,，;；/]/).map(x => x.trim()).filter(Boolean)
  return []
}

function zhOf(w: WordItem): string {
  const c: any = w.meanings?.[0]?.chinese
  if (Array.isArray(c)) return c.map(x => String(x)).join('；')
  return c == null ? '' : String(c)
}

const bookWords = computed<WordItem[]>(() => {
  if (!bookId.value) return wordStore.words
  const g = wordStore.groups.find(x => x.id === bookId.value)
  if (!g) return wordStore.words
  const ids = new Set(g.wordIds)
  return wordStore.words.filter(w => ids.has(w.id))
})

function collectDim(key: DimKey): DimValue[] {
  const count = new Map<string, number>()
  const meaning = new Map<string, string>()
  for (const w of bookWords.value) {
    if (key === 'exam') {
      for (const t of w.tags || []) count.set(t, (count.get(t) || 0) + 1)
    } else if (key === 'topic') {
      for (const t of topicsOf(w)) count.set(t, (count.get(t) || 0) + 1)
    } else {
      const m = w.morphemes
      if (!m) continue
      for (const part of [m.prefix, m.root, m.suffix]) {
        if (!part?.form) continue
        count.set(part.form, (count.get(part.form) || 0) + 1)
        if (part.meaning && !meaning.has(part.form)) meaning.set(part.form, part.meaning)
      }
    }
  }
  return [...count.entries()]
    .filter(([, c]) => (key === 'morpheme' ? c > 1 : true))
    .map(([name, c]) => ({ name, count: c, meaning: meaning.get(name) }))
    .sort((a, b) => b.count - a.count)
}

const examValues = computed(() => collectDim('exam'))
const topicValues = computed(() => collectDim('topic'))
const morphemeValues = computed(() => collectDim('morpheme'))

const dimensions = computed(() => [
  { key: 'exam' as DimKey, label: '考试', count: examValues.value.length },
  { key: 'topic' as DimKey, label: '话题', count: topicValues.value.length },
  { key: 'morpheme' as DimKey, label: '词根词缀', count: morphemeValues.value.length }
])

const dimValues = computed<DimValue[]>(() => {
  if (dim.value === 'topic') return topicValues.value
  if (dim.value === 'morpheme') return morphemeValues.value
  return examValues.value
})
const visibleDimValues = computed(() =>
  expandDim.value ? dimValues.value : dimValues.value.slice(0, DIM_PREVIEW)
)

const DIM_LABEL: Record<DimKey, string> = { exam: '考试', topic: '话题', morpheme: '词根词缀' }

const activeFilters = computed(() =>
  (Object.keys(sel.value) as DimKey[])
    .filter(k => sel.value[k])
    .map(k => ({ key: k, label: DIM_LABEL[k], value: sel.value[k] }))
)
function pickDim(k: DimKey) {
  dim.value = k
  expandDim.value = false
}

function clearFilter(k: DimKey) { sel.value[k] = '' }
function clearAllFilters() { sel.value = { exam: '', topic: '', morpheme: '' } }

function matchOne(w: WordItem, key: DimKey, v: string): boolean {
  if (!v) return true
  if (key === 'exam') return !!w.tags?.includes(v)
  if (key === 'topic') return topicsOf(w).includes(v)
  const m = w.morphemes
  return !!m && [m.prefix?.form, m.root?.form, m.suffix?.form].includes(v)
}

const scopedWords = computed<WordItem[]>(() => {
  const s = sel.value
  const st = statusFilter.value
  return bookWords.value.filter(w => {
    if (!matchOne(w, 'exam', s.exam)) return false
    if (!matchOne(w, 'topic', s.topic)) return false
    if (!matchOne(w, 'morpheme', s.morpheme)) return false
    if (st !== 'all') {
      void familiarityTick.value
      const lv = familiarityOf(w, masteredSet.value).level
      const cur = lv === 'mastered' ? 'known' : lv === 'unseen' ? 'unmarked' : lv
      if (cur !== st) return false
    }
    return true
  })
})

const searchText = ref('')
const searchFocus = ref(false)
const centerWord = ref<WordItem | null>(null)
const expandDepth = ref(1)

/**
 * 匹配一个词。除了词形本身，还认词根词缀和释义 ——
 * 搜 "spect" 应该把 inspect/respect/spectator 都算上，
 * 搜 "un" 应该能捞出所有 un- 开头的。
 */
function matchWord(w: WordItem, q: string): boolean {
  const lw = w.word.toLowerCase()

  // 单个字母 = 找首字母。用 includes 的话搜 a 会把所有含 a 的词都捞出来，
  // 那不是"按字母找词"该有的结果。
  if (q.length === 1 && /[a-z]/.test(q)) {
    if (lw.startsWith(q)) return true
  } else if (lw.includes(q)) {
    return true
  }

  const m = w.morphemes
  if (m) {
    for (const part of [m.prefix, m.root, m.suffix]) {
      if (part?.form && part.form.toLowerCase().includes(q)) return true
    }
  }
  if (w.meanings?.some(x => x.chinese?.includes(q))) return true
  return false
}

/** 所有匹配的词，不只是前 8 个建议 */
const searchHits = computed<WordItem[]>(() => {
  const q = searchText.value.trim().toLowerCase()
  if (!q) return []
  return scopedWords.value.filter(w => matchWord(w, q))
})

const suggestions = computed<WordItem[]>(() => {
  const q = searchText.value.trim().toLowerCase()
  if (!q) return []
  const exact: WordItem[] = []
  const starts: WordItem[] = []
  const others: WordItem[] = []
  for (const w of searchHits.value) {
    const lw = w.word.toLowerCase()
    if (lw === q) exact.push(w)
    else if (lw.startsWith(q)) starts.push(w)
    else others.push(w)
    if (exact.length + starts.length >= 8) break
  }
  return [...exact, ...starts, ...others].slice(0, 8)
})

function commitSearchTop() {
  const first = suggestions.value[0]
  if (first) focusOn(first)
}

/** 把搜索命中的词全部载入图，而不是只看某一个词的关系网 */
function showAllHits() {
  const hits = searchHits.value
  if (!hits.length) return
  centerWord.value = null
  manualWords.value = hits.slice(0, MANUAL_MAX).map(w => w.word.toLowerCase())
  searchFocus.value = false
  paramTick.value++
}

function focusOn(target: WordItem | string) {
  const w = typeof target === 'string'
    ? wordStore.words.find(x => x.word.toLowerCase() === String(target).toLowerCase())
    : target
  if (!w) return
  if (!centerWord.value) drillBeforeSearch = graphRef.value?.captureDrill?.() || null
  centerWord.value = w
  detailWord.value = w
  searchText.value = w.word
  searchFocus.value = false
}

/** 搜词之前停在哪一层，退出后要回到那一层 */
const graphRef = ref<any>(null)
let drillBeforeSearch: any = null

function exitCenter() {
  centerWord.value = null
  searchText.value = ''
  const st = drillBeforeSearch
  drillBeforeSearch = null
  if (!st) return
  // 等新的一批节点进图、坐标从 posCache 摆回来之后再还原视角
  nextTick(() => setTimeout(() => graphRef.value?.restoreDrill?.(st), 120))
}

function onSearchBlur() {
  setTimeout(() => { searchFocus.value = false }, 120)
}

const centerWords = computed<WordItem[]>(() =>
  centerWord.value ? centerNetwork(wordStore.words, centerWord.value, expandDepth.value) : []
)

const morphNodes = computed(() => {
  const root = centerWord.value
  if (!root) return [] as { form: string; label: string }[]
  return morphOf(root)
})

const manualWords = computed(() =>
  manualText.value.split(/[,，\s\n]+/).map(x => x.trim().toLowerCase()).filter(Boolean)
)
const manualOverflow = computed(() => manualWords.value.length > MANUAL_MAX)

interface Applied {
  words: WordItem[]
  clusterOf: Map<string, string>
  cores: Set<string>
  links: GraphLink[]
  clusterCount: number
  hidden: number
  info: Record<string, string>
  cloudOf: Map<string, string>
  superOf: Map<string, string>
}
const applied = ref<Applied | null>(null)
const loadingGraph = ref(false)

const paramTick = ref(0)
const appliedTick = ref(-1)
const dirty = computed(() => paramTick.value !== appliedTick.value)
watch(
  [bookId, sel, statusFilter, limitIdx, relTypes, colorBy],
  () => { paramTick.value++ },
  { deep: true }
)

watch(colorBy, () => { if (applied.value) applyLoad() })

async function applyLoad() {
  loadingGraph.value = true
  await nextTick()
  await new Promise(r => setTimeout(r, 16))
  try {
    buildApplied()
    buildError.value = ''
  } catch (e) {
    buildError.value = e instanceof Error ? e.message : String(e)
    console.error('[词汇宇宙] 构建失败：', e)
    applied.value = null
  } finally {
    loadingGraph.value = false
  }
}
const buildError = ref('')

function buildApplied() {
  appliedTick.value = paramTick.value
  const all = scopedWords.value
  const n = Math.max(0, Math.min(limit.value, all.length))
  if (!n) { applied.value = null; return }

  const edges = relationEdges(all).filter(e => relTypes.value.includes(e.type as RelKey))
  const cohesive = edges.filter(e => e.type !== 'antonym')
  const forCluster = cohesive.map(e => ({ a: e.source, b: e.target, w: e.weight ?? 0.5 }))
  const names = all.map(w => w.word)

  const pinned = new Set<string>()
  for (const w of all) {
    const k = w.word.toLowerCase()
    if ((w.status && w.status !== 'unmarked') || masteredSet.value.has(k)) pinned.add(k)
  }

  const comm = detectCommunities(names, forCluster)
  const r = pickConstellations({ words: names, edges: forCluster, limit: n, pinned, communities: comm })

  const keep = new Set(r.keep)
  const words = all.filter(w => keep.has(w.word))

  const inScope = (l: GraphLink) => keep.has(l.source) && keep.has(l.target)
  const { kept, bridges } = filterConstellationLinks(cohesive.filter(inScope), r.clusterOf, r.cores)
  const links: GraphLink[] = kept.map(l => (bridges.has(l) ? { ...l, bridge: true } : l))

  if (relTypes.value.includes('antonym')) {
    const BRIDGE_TOP = 12
    const BRIDGE_MAX = 24
    const size = new Map<string, number>()
    for (const w of words) {
      const c = r.clusterOf.get(w.word)
      if (c) size.set(c, (size.get(c) || 0) + 1)
    }
    const big = new Set(
      [...size.entries()].sort((a, b) => b[1] - a[1]).slice(0, BRIDGE_TOP).map(([c]) => c)
    )
    const seen = new Set<string>()
    let bridgeCount = 0
    for (const l of edges) {
      if (bridgeCount >= BRIDGE_MAX) break
      if (l.type !== 'antonym' || !inScope(l)) continue
      const ca = r.clusterOf.get(l.source), cb = r.clusterOf.get(l.target)
      if (!ca || !cb || ca === cb) continue
      if (!big.has(ca) || !big.has(cb)) continue
      const key = ca < cb ? `${ca}\u0001${cb}` : `${cb}\u0001${ca}`
      if (seen.has(key)) continue
      seen.add(key)
      links.push({ ...l, bridge: true })
      bridgeCount++
    }
  }

  applied.value = {
    words, clusterOf: r.clusterOf, cores: r.cores, links,
    clusterCount: r.clusterCount, hidden: r.hidden,
    info: describeClusters(words, r.clusterOf),
    ...cloudsOf(words, r.clusterOf)
  }
}

function describeClusters(words: WordItem[], clusterOf: Map<string, string>): Record<string, string> {
  const groups = new Map<string, WordItem[]>()
  for (const w of words) {
    const c = clusterOf.get(w.word)
    if (!c) continue
    const g = groups.get(c)
    if (g) g.push(w); else groups.set(c, [w])
  }
  const out: Record<string, string> = {}
  for (const [core, members] of groups) {
    const head = members.find(w => w.word === core) || members[0]
    const parts: string[] = [`${core}（${members.length} 词）`]

    const roots = new Map<string, number>()
    for (const w of members) { const k = morphemeKeyOf(w); if (k) roots.set(k, (roots.get(k) || 0) + 1) }
    const topRoot = [...roots.entries()].sort((a, b) => b[1] - a[1])[0]
    if (topRoot && topRoot[1] * 2 > members.length) {
      const m = members.find(w => morphemeKeyOf(w) === topRoot[0])?.morphemes
      const mean = m?.root?.meaning || m?.prefix?.meaning || m?.suffix?.meaning
      parts.push(`词根 ${topRoot[0]}${mean ? ' · ' + mean : ''}`)
    }

    const zh = zhOf(head)
    if (zh) parts.push(zh.split(/[；;,，]/)[0].trim())

    const topics = new Map<string, number>()
    for (const w of members) for (const t of topicsOf(w)) topics.set(t, (topics.get(t) || 0) + 1)
    const topTopic = [...topics.entries()].sort((a, b) => b[1] - a[1])[0]
    if (topTopic && topTopic[1] * 2 > members.length) parts.push(topTopic[0])

    const sample = members.filter(w => w.word !== core).slice(0, 5).map(w => w.word)
    const line = parts.join(' · ')
    out[core] = sample.length
      ? `${line}\n${sample.join('、')}${members.length - 1 > sample.length ? ' …' : ''}`
      : line
  }
  return out
}

function cloudsOf(
  words: WordItem[],
  clusterOf: Map<string, string>
): { cloudOf: Map<string, string>; superOf: Map<string, string> } {
  const byWord = new Map(words.map(w => [w.word, w]))
  const members = new Map<string, WordItem[]>()
  for (const w of words) {
    const c = clusterOf.get(w.word) || w.word
    const g = members.get(c)
    if (g) g.push(w); else members.set(c, [w])
  }
  const cloudOut = new Map<string, string>()
  const superOut = new Map<string, string>()
  for (const [core, list] of members) {
    const coreW = byWord.get(core)
    let cloud = coreW ? (topicsOf(coreW)[0] || '') : ''
    if (!cloud) {
      const votes = new Map<string, number>()
      for (const w of list) for (const t of topicsOf(w)) votes.set(t, (votes.get(t) || 0) + 1)
      let best = '', bestN = 0
      for (const [t, n] of votes) if (n > bestN) { bestN = n; best = t }
      cloud = best
    }
    if (!cloud) cloud = '其他'

    const sample = list.slice(0, 12).map(w => `${w.word} ${zhOf(w) || ''}`).join(' ')
    cloud = refineTopic(cloud, sample)
    const sup = superTopicOf(cloud)

    for (const w of list) {
      cloudOut.set(w.word, cloud)
      superOut.set(w.word, sup)
    }
  }
  return { cloudOf: cloudOut, superOf: superOut }
}

/**
 * 只画核心词。
 *
 * 衍生词是跟着核心词分到星云里的，它自己的话题可能完全不同 ——
 * aggressiveness 因为核心词的关系被拖进「积极情感」就是这么来的。
 * 打开这个开关后只保留每个词根团的核心词，团与团之间的关系照画，
 * 分类不再被衍生词污染，节点数也从五千多降到几百，力学模拟顺畅很多。
 */
const picked = computed<WordItem[]>(() => {
  if (centerWord.value) return centerWords.value
  if (manualWords.value.length) {
    const want = new Set(manualWords.value.slice(0, MANUAL_MAX))
    return scopedWords.value.filter(w => want.has(w.word.toLowerCase()))
  }
  const all = applied.value?.words || []
  const cores = applied.value?.cores
  if (!cores || !cores.size) return all
  return all.filter(w => cores.has(w.word))
})

const clusterMap = computed<Map<string, string>>(() => {
  if (centerWord.value || manualWords.value.length) return new Map()
  return applied.value?.clusterOf || new Map()
})

const morphemeList = computed(() => {
  const set = new Set<string>()
  for (const w of picked.value) { const k = morphemeKeyOf(w); if (k) set.add(k) }
  return [...set].sort()
})

const topicList = computed(() => {
  const set = new Set<string>()
  for (const w of picked.value) for (const t of topicsOf(w)) set.add(t)
  return [...set].sort()
})

const cloudOf = computed(() => applied.value?.cloudOf || new Map<string, string>())
const superOf = computed(() => applied.value?.superOf || new Map<string, string>())
const cloudCount = computed(() => new Set(cloudOf.value.values()).size)
const superCount = computed(() => new Set(superOf.value.values()).size)

const nodes = computed<GraphNode[]>(() => {
  const cm = clusterMap.value
  const out: GraphNode[] = picked.value.map(w => {
    const owner = cm.get(w.word)
    const base: GraphNode = {
      id: w.word,
      word: w.word,
      definitionZh: w.meanings?.[0]?.chinese,
      sources: sourcesOf(w),
      clusterOf: owner && owner !== w.word ? owner : undefined,
      cloud: cloudOf.value.get(w.word),
      superCloud: superOf.value.get(w.word),
      isCenter: !!centerWord.value && w.word === centerWord.value.word
    }
    if (colorBy.value === 'mastery') {
      void colorTick.value
      void familiarityTick.value
      const f = familiarityOf(w, masteredSet.value)
      const base0 = masteryColor(f.level === 'unseen' ? 'unmarked' : f.level)
      const span: Record<string, [number, number]> = {
        unseen: [0, 0], unknown: [0, 0.35], fuzzy: [0.35, 0.7], known: [0.7, 1], mastered: [1, 1]
      }
      const [lo, hi] = span[f.level] || [0, 1]
      const t = hi > lo ? Math.max(0, Math.min(1, (f.score - lo) / (hi - lo))) : 1
      base.forceColor = mixHex(base0, mixHex(base0, '#ffffff', 0.5), t * 0.45)
    } else {
      void colorTick.value
      const v = colorBy.value === 'topic' ? (topicsOf(w)[0] || '')
        : colorBy.value === 'morpheme' ? morphemeKeyOf(w)
        : ''
      if (colorBy.value !== 'exam') {
        base.forceColor = v
          ? (colorBy.value === 'topic' ? topicColor(v, topicList.value) : morphemeColor(v, morphemeList.value))
          : '#4a4a55'
      }
    }
    return base
  })
  const have = new Set(out.map(n => n.id.toLowerCase()))
  for (const m of morphNodes.value) {
    if (have.has(m.form.toLowerCase())) continue
    out.push({ id: m.form, word: m.form, definitionZh: m.label, forceColor: '#9a6fd0' })
  }
  return out
})

const links = computed<GraphLink[]>(() => {
  if (centerWord.value || manualWords.value.length) {
    const out = relationEdges(picked.value)
    const root = centerWord.value
    if (root) {
      for (const m of morphNodes.value) {
        if (m.form.toLowerCase() === root.word.toLowerCase()) continue
        out.push({ source: root.word, target: m.form, type: 'morphology', difference: m.label, weight: RELATION_WEIGHTS.morphology })
      }
    }
    return out
  }
  const all = applied.value?.links || []
  // 连线两端都必须还在图上，否则 force-graph 会因为找不到端点报错
  const alive = new Set(picked.value.map(w => w.word))
  return all.filter(l => alive.has(l.source as string) && alive.has(l.target as string))
})

const legendItems = computed<{ name: string; color: string }[]>(() => {
  void colorTick.value
  if (colorBy.value === 'topic') {
    const used = new Set(cloudOf.value.values())
    const out = topicList.value.filter(t => used.has(t)).map(t => ({ name: t, color: topicColor(t, topicList.value) }))
    return out
  }
  if (colorBy.value === 'mastery') {
    return [
      { name: '未练过', color: mixHex(masteryColor('unmarked'), masteryColor('mastered'), 0) },
      { name: '不认识', color: mixHex(masteryColor('unmarked'), masteryColor('mastered'), 0.25) },
      { name: '模糊', color: mixHex(masteryColor('unmarked'), masteryColor('mastered'), 0.5) },
      { name: '认识', color: mixHex(masteryColor('unmarked'), masteryColor('mastered'), 0.8) },
      { name: '已掌握', color: mixHex(masteryColor('unmarked'), masteryColor('mastered'), 1) }
    ]
  }
  return []
})

const graphSources = computed(() => {
  const set = new Set<string>()
  for (const n of nodes.value) for (const s of n.sources || []) set.add(s)
  return [...set]
})

function onSelect(word: string) {
  const hit = wordStore.words.find(w => w.word.toLowerCase() === word.toLowerCase())
  if (!hit) return
  detailWord.value = hit
  focusOn(hit)
}

function clearGraph() {
  if (centerWord.value) exitCenter()
  else if (manualText.value) manualText.value = ''
  else if (activeFilters.value.length) clearAllFilters()
  else { limitIdx.value = 0; applyLoad() }
}

const masteredSet = ref<Set<string>>(new Set())
const familiarityTick = ref(0)

function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const [ar, ag, ab] = p(a)
  const [br, bg, bb] = p(b)
  const k = Math.max(0, Math.min(1, t))
  const to = (x: number) => Math.round(x).toString(16).padStart(2, '0')
  return `#${to(ar + (br - ar) * k)}${to(ag + (bg - ag) * k)}${to(ab + (bb - ab) * k)}`
}

const hasBridge = computed(() => links.value.some(l => (l as any).bridge))

const drawn = ref<{ nodes: number; links: number }>({ nodes: 0, links: 0 })

watch(bookId, () => { clearAllFilters(); expandDim.value = false })

watch(() => wordStore.words.length, () => {
  if (!applied.value || !applied.value.words.length) applyLoad()
  else paramTick.value++
})

onMounted(async () => {
  try { await wordStore.loadWords() } catch (e) { console.error('[词汇宇宙] 词库加载失败', e); buildError.value = '词库加载失败：' + (e instanceof Error ? e.message : String(e)) }
  try { await loadMasteredWords(); masteredSet.value = getMasteredSet() } catch (e) { console.error('[词汇宇宙] 已掌握词表加载失败', e) }
  try { await loadFsrsData(); familiarityTick.value++ } catch (e) { console.error('[词汇宇宙] 复习数据加载失败', e) }
  applyLoad()
})

/**
 * 把当前图上有什么报给 Agent，用户问「讲讲屏幕上这几个词的关系」时它才知道指的是谁。
 *
 * 必须放在文件末尾：centerWord / applied 都是后面才声明的 const，
 * 之前把这段写在前面又带了 immediate，setup 阶段立刻执行就撞上暂时性死区，
 * 报 "Cannot access 'g' before initialization"。
 * 这里也不再用 immediate —— 首次的上下文等数据真正就位后由依赖变化触发。
 */
watch(
  () => [centerWord.value?.word, applied.value?.cores.size, colorBy.value] as const,
  () => {
    /**
     * cores 是 Set<string>（存的是词条 id），不是 WordItem[]。
     * 我原来照数组写成 cores.slice(0,40).map(w => w.word)，
     * 一进词汇宇宙就 "o.slice is not a function" 白屏。
     */
    const coreIds = applied.value?.cores
    // 防御：不管它是 Set 还是数组都能遍历，类型再变也不会白屏
    if (!coreIds || typeof (coreIds as any)[Symbol.iterator] !== 'function') return
    const byId = new Map(wordStore.words.map(w => [w.id, w.word]))
    const names: string[] = []
    for (const id of coreIds) {
      const w = byId.get(id)
      if (w) names.push(w)
      if (names.length >= 40) break
    }
    const ctx = describePage({
      path: '/universe',
      centerWord: centerWord.value?.word,
      visibleWords: names
    })
    agentChat.setPageContext(ctx.summary)
  }
)

</script>

<style scoped lang="scss">
.universe-page { height: calc(100vh - var(--lb-main-pad, 24px) * 2); display: flex; flex-direction: column; padding: 8px 10px 10px; }

.uni-head {
  display: grid; grid-template-columns: 1fr auto 1fr;
  align-items: center; gap: 14px; margin-bottom: 6px;
}
.head-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.head-right { min-width: 0; }
.uni-title { font-size: 17px; margin: 0; white-space: nowrap; }
.uni-count { font-size: 12.5px; color: var(--r-ink2, #999); white-space: nowrap; }
.uni-legend { margin-bottom: 10px; }

.head-search {
  position: relative;
  width: min(460px, 38vw);
  display: flex;
  align-items: center;
}
.search-input {
  width: 100%;
  border: 1px solid var(--r-border, #ddd);
  border-radius: 9999px;
  padding: 7px 34px 7px 14px;
  font-size: 13.5px;
  background: var(--r-paper, #fff);
  color: inherit;
  outline: none;
  transition: border-color 0.15s;
}
.head-search.focus .search-input { border-color: var(--r-accent, #8a4b3a); }
.search-exit {
  position: absolute; right: 10px;
  border: none; background: none; cursor: pointer;
  font-size: 17px; line-height: 1; color: var(--r-ink2, #999);
}
.search-exit:hover { color: var(--r-ink, #333); }
.search-drop {
  position: absolute;
  top: calc(100% + 4px);
  left: 0; right: 0;
  z-index: 40;
  background: var(--r-paper, #fff);
  border: 1px solid var(--r-border, #e4e4e4);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}
.search-item {
  display: flex; align-items: baseline; gap: 8px; width: 100%;
  padding: 7px 12px; border: none; background: none; cursor: pointer; text-align: left;
}
.search-item:hover { background: var(--r-ui, #f5f5f5); }
.si-word { font-size: 13.5px; font-weight: 600; color: var(--r-ink, #222); }
.si-zh { font-size: 12px; color: var(--r-ink2, #999); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.uni-body { flex: 1; min-height: 0; display: flex; gap: 12px; position: relative; }
.panel-toggle {
  position: absolute; left: 0; top: 50%; transform: translateY(-50%);
  z-index: 5; width: 14px; height: 54px; padding: 0;
  border: 1px solid var(--r-border, #e5e7eb); border-left: none;
  border-radius: 0 7px 7px 0; background: var(--r-ui, #f4f5f7);
  color: var(--r-ink2, #8a9099); cursor: pointer; font-size: 12px; line-height: 1;
  &:hover { color: var(--r-accent, #e8622a); }
  &.folded { left: 0; }
}
.uni-panel { margin-left: 14px; }
.uni-body > .graph-3d, .uni-body > :last-child { min-width: 0; }
.uni-legend {
  position: absolute; left: 12px; bottom: 12px; z-index: 4;
  padding: 7px 10px; border-radius: 9px;
  background: rgba(16, 18, 24, 0.55); backdrop-filter: blur(6px);
  color: #e8eaf0; pointer-events: none;
}
.uni-panel {
  width: 268px;
  flex-shrink: 0;
  overflow-y: auto;
  border: 1px solid var(--r-border, #e4e4e4);
  border-radius: 12px;
  padding: 14px;
  background: var(--r-paper, #fff);
}
.panel-block { padding-bottom: 14px; margin-bottom: 14px; border-bottom: 1px solid var(--r-border, #f0f0f0); }
.panel-block:last-child { border-bottom: none; margin-bottom: 0; }
.panel-label { font-size: 12.5px; color: var(--r-ink2, #888); margin: 0 0 8px; }
.panel-big { font-size: 26px; font-weight: 600; margin: 0 0 6px; color: var(--r-accent, #8a4b3a); }
.panel-big em { font-size: 13px; font-style: normal; margin-left: 5px; color: var(--r-ink2, #999); }
.panel-hint { font-size: 12px; color: var(--r-ink2, #999); line-height: 1.6; margin: 0 0 12px; }
.mode-row { display: flex; gap: 6px; flex-wrap: wrap; }
.mode-btn {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  padding: 5px 10px; border-radius: 8px; font-size: 12.5px; cursor: pointer;
  border: 1px solid var(--r-border, #ddd); background: transparent; color: inherit;
}
.mode-btn.on { background: var(--r-accent, #8a4b3a); color: var(--r-paper, #fff); border-color: transparent; }
.mode-btn:disabled { opacity: 0.35; cursor: default; }
.dim-count { font-size: 11px; margin-left: 4px; opacity: 0.7; }
.val-list { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; max-height: 220px; overflow-y: auto; }
.val-chip {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 9px; border-radius: 9999px; font-size: 12.5px; cursor: pointer;
  border: 1px solid var(--r-border, #e6e6e6); background: transparent; color: inherit;
}
.val-chip.on { border-color: var(--r-accent, #8a4b3a); background: var(--r-ui, #f6f6f6); }
.val-chip.ghost { color: var(--r-accent, #8a4b3a); border-style: dashed; }
.val-chip .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.val-count { font-size: 11px; color: var(--r-ink2, #aaa); }
.slider { width: 100%; margin-bottom: 10px; }
.dark-btn {
  width: 100%;
  border: none;
  background: var(--r-accent, #8a4b3a);
  color: #fff;
  border-radius: 9px;
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
  transition: background-color .15s ease, box-shadow .15s ease;
  box-shadow: 0 1px 2px color-mix(in srgb, var(--r-accent, #8a4b3a) 22%, transparent);
}
.dark-btn:disabled { background: var(--r-ui, #eee); color: var(--r-ink2, #999); box-shadow: none; cursor: default; }
.panel-label-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.link-btn {
  border: none; background: none; padding: 0; cursor: pointer;
  font-size: 12px; color: var(--r-accent, #8a4b3a);
}
.link-btn:disabled { opacity: 0.4; cursor: default; }
.center-block { background: var(--r-ui, #faf7f5); border-radius: 10px; padding: 12px; }
.center-word { font-size: 22px; font-weight: 600; margin: 0 0 4px; color: var(--r-accent, #8a4b3a); }
.manual-fold summary { cursor: pointer; }
.density-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.mini-select {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  flex: 1; min-width: 0;
  border: 1px solid var(--r-border, #ddd); border-radius: 8px;
  padding: 4px 7px; font-size: 12.5px; background: var(--r-paper, #fff); color: inherit;
}
.mini-select.full { width: 100%; }
.check { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--r-ink2, #777); cursor: pointer; }
.manual-input {
  width: 100%; margin-top: 8px;
  border: 1px solid var(--r-border, #ddd); border-radius: 8px;
  padding: 8px; font-size: 13px; background: var(--r-ui, #fafafa); color: inherit; resize: vertical;
}
.warn { font-size: 12px; color: #d9822b; margin: 6px 0 0; }
.loaded-chips { display: flex; flex-wrap: wrap; gap: 4px; max-height: 150px; overflow-y: auto; }
.loaded-chip { font-size: 11.5px; padding: 2px 7px; border-radius: 9999px; background: var(--r-ui, #f2f2f2); color: var(--r-ink2, #777); }
.loaded-chip.more { opacity: 0.6; }
.uni-detail {
  width: 380px;
  flex-shrink: 0;
  overflow-y: auto;
  position: relative;
  border: 1px solid var(--r-border, #e4e4e4);
  border-radius: 12px;
  background: var(--r-paper, #fff);
}

.uni-graph {
  flex: 1;
  min-width: 0;
  position: relative;
  border: 1px solid var(--r-border, #e4e4e4);
  border-radius: 12px;
  overflow: hidden;
  background: #050510;
}
.uni-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--r-ink2, #aaa);
  font-size: 13px;
  margin: 0;
}

@media (max-width: 1100px) {
  .uni-detail {
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;
    z-index: 60;
    width: min(380px, 92vw);
  }
  .head-search { width: min(320px, 34vw); }
}

@media (max-width: 900px) {
  .uni-body { flex-direction: column; }
  .uni-panel { width: auto; max-height: 260px; }
  .uni-graph { min-height: 340px; }
  .uni-head { flex-wrap: wrap; }
  .head-search { width: 100%; order: 3; }
}
.mode-btn.picked { border-color: var(--r-accent, #8a4b3a); }
.active-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 10px; }
.af-label { font-size: 11.5px; color: var(--r-ink2, #aaa); }
.af-chip {
  border: 1px solid var(--r-accent, #8a4b3a); background: var(--r-ui, #f6f6f6);
  color: var(--r-accent, #8a4b3a); border-radius: 9999px;
  padding: 3px 9px; font-size: 12px; cursor: pointer;
}
.af-clear { border: none; background: none; cursor: pointer; font-size: 12px; color: var(--r-ink2, #999); }
</style>

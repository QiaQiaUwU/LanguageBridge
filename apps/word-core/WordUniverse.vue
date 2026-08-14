<template>
  <div class="universe-page" :style="pageStyle">
    <header class="universe-header">
      <button class="back-link" @click="router.push('/words')">返回词汇中心</button>
      <div class="header-title">
        <h1>词汇宇宙</h1>
        <p>三维语义关系图谱 · 拖拽旋转、滚轮缩放、点击节点查看详情</p>
      </div>
    </header>

    <div class="universe-body">
      <!-- 左侧控制面板：对齐原 ControlPanel.js 的三种加载模式 -->
      <aside class="control-panel">
        <div class="mode-tabs">
          <button
            v-for="m in modeOptions"
            :key="m.value"
            class="mode-tab"
            :class="{ on: mode === m.value }"
            @click="mode = m.value"
          >
            {{ m.label }}
          </button>
        </div>

        <!-- 全部单词模式 -->
        <div v-if="mode === 'all'" class="mode-section">
          <div class="total-row">
            <span>词库总量</span>
            <strong>{{ wordStore.words.length.toLocaleString() }}</strong>
          </div>

          <div class="section-label">按来源筛选（可多选，不选则为全部）</div>
          <div class="source-grid">
            <button
              v-for="lv in levelOptions"
              :key="lv.value"
              class="source-chip"
              :class="{ on: selectedLevels.includes(lv.value) }"
              @click="toggleLevel(lv.value)"
            >
              {{ lv.value }}
              <span class="chip-count">{{ lv.count }}</span>
            </button>
          </div>

          <div class="section-label">按熟悉度筛选</div>
          <div class="source-grid">
            <button
              v-for="s in statusOptions"
              :key="s.value"
              class="source-chip"
              :class="{ on: selectedStatuses.includes(s.value) }"
              @click="toggleStatus(s.value)"
            >
              {{ s.label }}
            </button>
          </div>

          <label class="checkbox-row">
            <input type="checkbox" v-model="onlyWrongInDictation" />
            <span>只看听写错题</span>
          </label>

          <div class="section-label">加载上限：{{ limitLabel }}</div>
          <input type="range" min="100" max="3000" step="100" v-model.number="limit" class="range-slider" />

          <label class="checkbox-row">
            <input type="checkbox" v-model="showRelationships" />
            <span>显示语义关系连线（数据量大时建议关闭以提升流畅度）</span>
          </label>

          <button class="load-btn" @click="loadAll" :disabled="loading">
            {{ loading ? '加载中…' : `加载约 ${estimatedCount.toLocaleString()} 个词到图谱` }}
          </button>
        </div>

        <!-- 中心性排名模式：接论文数据，节点=排名靠前的枢纽词 -->
        <div v-if="mode === 'rank'" class="mode-section">
          <div class="section-label">排序策略</div>
          <div class="source-grid">
            <button
              v-for="s in strategyOptions"
              :key="s.value"
              class="source-chip"
              :class="{ on: rankStrategy === s.value }"
              @click="rankStrategy = s.value"
            >
              {{ s.label }}
            </button>
          </div>
          <p class="hint-text" v-if="currentStrategyData">
            AUC {{ currentStrategyData.auc.toFixed(3) }} ·
            前 50 词覆盖语义网络 {{ ((currentStrategyData.coverage_at['top_50'] || 0) * 100).toFixed(0) }}%
          </p>
          <p class="hint-text">数据来自本人毕设论文 Stage 4 实证结果，排名之外的连线仍取自本地词库已有的关系字段。</p>
          <button class="load-btn" @click="loadByRank" :disabled="loading || !currentStrategyData">
            {{ loading ? '加载中…' : '按此策略加载图谱' }}
          </button>
        </div>

        <!-- 手动输入模式 -->
        <div v-if="mode === 'manual'" class="mode-section">
          <div class="section-label">输入单词，用逗号或空格分隔</div>
          <textarea v-model="manualInput" rows="5" placeholder="apple, banana, orange" class="manual-textarea"></textarea>
          <button class="load-btn" @click="loadManual" :disabled="loading || !manualInput.trim()">
            {{ loading ? '加载中…' : '加载到图谱' }}
          </button>
        </div>

        <GraphLegend :has-rank-data="mode === 'rank'" />
      </aside>

      <!-- 中间图谱 -->
      <main class="graph-main">
        <WordGraph3D
          v-if="graphNodes.length"
          :nodes="graphNodes"
          :links="graphLinks"
          @select="onSelectWord"
        />
        <div v-else class="graph-empty">
          <p>选择左侧的加载方式，开始探索</p>
        </div>
        <div class="graph-stats" v-if="graphNodes.length">
          <span>{{ graphNodes.length.toLocaleString() }} 词</span>
          <span>{{ graphLinks.length.toLocaleString() }} 条关系</span>
        </div>
      </main>
    </div>

    <WordDetailModal
      v-if="selectedWordItem"
      :word="selectedWordItem"
      @close="selectedWordItem = null"
      @memorize="onMemorize"
      @search="onSearchRelatedWord"
    />
    <div v-if="notInLibraryHint" class="not-in-lib-toast">{{ notInLibraryHint }}</div>
  </div>
</template>

<script setup lang="ts">
/**
 * 词汇宇宙：VocabVerse 毕设项目的 3D 词汇关系图谱，合并进 LanguageBridge 后的版本。
 *
 * 三种加载模式对齐原 ControlPanel.js：
 *   - all：全部单词，按来源/熟悉度筛选，跟原版"全部单词"模式一致
 *   - rank：新增模式，接的是论文 Stage 4 的中心性排名数据（原版没有这个）
 *   - manual：手动输入词表
 *
 * 连线数据源：一律走本地词库 WordItem.synonyms / antonyms / word_family 字段
 * （这些字段主要靠 LLM 生成，参照 VocabVerse 的 generator.py 是同一套思路）。
 * 论文那批数据本身没有完整边表，只提供节点排名，这一点在 rank 模式下的提示文案里
 * 如实说明，不混淆两种数据源的可信度。
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useThemeStore } from '@/shared/stores/themeStore'
import { useWordStore } from '@/shared/stores/wordStore'
import WordGraph3D, { type GraphNode, type GraphLink } from './components/WordGraph3D.vue'
import GraphLegend from './components/GraphLegend.vue'
import WordDetailModal from './components/WordDetailModal.vue'
import type { WordItem, LevelType, WordStatus } from '@/shared/types/WordItem'

const router = useRouter()
const themeStore = useThemeStore()
const wordStore = useWordStore()

const pageStyle = computed(() => ({
  '--r-paper': themeStore.current.paper,
  '--r-ink': themeStore.current.ink,
  '--r-ink2': themeStore.current.ink2,
  '--r-accent': themeStore.current.accent,
  '--r-ui': themeStore.current.ui,
  '--r-border': themeStore.current.border
}))

type Mode = 'all' | 'rank' | 'manual'
const mode = ref<Mode>('all')
const modeOptions: { value: Mode; label: string }[] = [
  { value: 'all', label: '全部单词' },
  { value: 'rank', label: '中心性排名' },
  { value: 'manual', label: '手动输入' }
]

const loading = ref(false)
const showRelationships = ref(true)

// ===== 全部单词模式 =====
const levelOptions = computed(() => {
  const counts = new Map<LevelType, number>()
  for (const w of wordStore.words) counts.set(w.level, (counts.get(w.level) || 0) + 1)
  return Array.from(counts.entries()).map(([value, count]) => ({ value, count }))
})
const selectedLevels = ref<LevelType[]>([])
function toggleLevel(lv: LevelType) {
  const i = selectedLevels.value.indexOf(lv)
  if (i >= 0) selectedLevels.value.splice(i, 1)
  else selectedLevels.value.push(lv)
}

const statusOptions: { value: WordStatus; label: string }[] = [
  { value: 'known', label: '熟悉' },
  { value: 'fuzzy', label: '模糊' },
  { value: 'unknown', label: '不熟悉' },
  { value: 'unmarked', label: '未标记' }
]
const selectedStatuses = ref<WordStatus[]>([])
function toggleStatus(s: WordStatus) {
  const i = selectedStatuses.value.indexOf(s)
  if (i >= 0) selectedStatuses.value.splice(i, 1)
  else selectedStatuses.value.push(s)
}

const onlyWrongInDictation = ref(false)
const limit = ref(500)
const limitLabel = computed(() => (limit.value >= 3000 ? '全部' : limit.value.toLocaleString()))

function filteredWords(): WordItem[] {
  let list = wordStore.words
  if (selectedLevels.value.length) list = list.filter(w => selectedLevels.value.includes(w.level))
  if (selectedStatuses.value.length) {
    list = list.filter(w => selectedStatuses.value.includes(w.status || 'unmarked'))
  }
  if (onlyWrongInDictation.value) list = list.filter(w => (w.learningRecord?.totalWrongCount || 0) > 0)
  return list
}
const estimatedCount = computed(() => Math.min(filteredWords().length, limit.value))

// ===== 中心性排名模式 =====
type StrategyKey = 'betweenness' | 'pagerank' | 'closeness' | 'degree' | 'frequency' | 'syllabus'
interface StrategyData { auc: number; coverage_at: Record<string, number>; top_words: string[] }
interface ModelData { strategies: Record<StrategyKey, StrategyData> }
type RankingFile = Record<'bert_exam' | 'bert_general', ModelData>
const rankingData = ref<RankingFile | null>(null)
const rankStrategy = ref<StrategyKey>('betweenness')
const strategyOptions: { value: StrategyKey; label: string }[] = [
  { value: 'betweenness', label: '桥接中心性' },
  { value: 'pagerank', label: 'PageRank' },
  { value: 'closeness', label: '接近中心性' },
  { value: 'degree', label: '度中心性' },
  { value: 'syllabus', label: '教材顺序' },
  { value: 'frequency', label: '词频' }
]
const currentStrategyData = computed(
  () => rankingData.value?.bert_exam.strategies[rankStrategy.value] || null
)

// ===== 手动输入模式 =====
const manualInput = ref('')

// ===== 图谱数据 =====
const graphNodes = ref<GraphNode[]>([])
const graphLinks = ref<GraphLink[]>([])

function buildGraphFromWords(items: WordItem[], rankMap?: Map<string, number>) {
  const byWord = new Map(items.map(w => [w.word.toLowerCase(), w]))
  const nodes: GraphNode[] = items.map(w => ({
    id: w.word,
    word: w.word,
    rank: rankMap?.get(w.word.toLowerCase()) ?? null,
    definitionZh: w.meanings?.[0]?.chinese
  }))
  const links: GraphLink[] = []
  const seen = new Set<string>()
  if (showRelationships.value) {
    for (const w of items) {
      const addLink = (targetWord: string, type: GraphLink['type'], difference?: string) => {
        const targetLower = targetWord.toLowerCase()
        if (!byWord.has(targetLower) || targetLower === w.word.toLowerCase()) return
        const key = [w.word.toLowerCase(), targetLower, type].sort().join('|')
        if (seen.has(key)) return
        seen.add(key)
        links.push({ source: w.word, target: targetWord, type, difference })
      }
      for (const fam of w.word_family || []) addLink(fam, 'word_family')
      for (const syn of w.synonyms || []) addLink(syn.word, 'synonym', syn.difference)
      for (const ant of w.antonyms || []) addLink(ant.word, 'antonym')
    }
  }
  graphNodes.value = nodes
  graphLinks.value = links
}

async function loadAll() {
  loading.value = true
  try {
    const list = filteredWords().slice(0, limit.value)
    buildGraphFromWords(list)
  } finally {
    loading.value = false
  }
}

async function loadByRank() {
  const strat = currentStrategyData.value
  if (!strat) return
  loading.value = true
  try {
    const rankMap = new Map(strat.top_words.map((w, i) => [w.toLowerCase(), i + 1]))
    const byWord = new Map(wordStore.words.map(w => [w.word.toLowerCase(), w]))
    // 图谱只放"排名词表里、且本地词库真的有这个词"的交集——排名数据给排序，
    // 详情/关系数据仍然要靠本地词库才能展示，两边都没有的词展示不出什么内容。
    const matched = strat.top_words
      .map(w => byWord.get(w.toLowerCase()))
      .filter((w): w is WordItem => !!w)
    buildGraphFromWords(matched, rankMap)
  } finally {
    loading.value = false
  }
}

async function loadManual() {
  loading.value = true
  try {
    const wordList = manualInput.value
      .split(/[,\s，]+/)
      .map(w => w.trim().toLowerCase())
      .filter(Boolean)
    const byWord = new Map(wordStore.words.map(w => [w.word.toLowerCase(), w]))
    const matched = wordList.map(w => byWord.get(w)).filter((w): w is WordItem => !!w)
    const notFound = wordList.filter(w => !byWord.has(w))
    buildGraphFromWords(matched)
    if (notFound.length) {
      notInLibraryHint.value = `${notFound.length} 个词不在词库中，已跳过：${notFound.slice(0, 5).join('、')}${notFound.length > 5 ? '…' : ''}`
      if (hintTimer) clearTimeout(hintTimer)
      hintTimer = setTimeout(() => { notInLibraryHint.value = '' }, 3200)
    }
  } finally {
    loading.value = false
  }
}

// ===== 点击节点 → 详情弹窗（复用词汇中心已有组件） =====
const selectedWordItem = ref<WordItem | null>(null)
const notInLibraryHint = ref('')
let hintTimer: ReturnType<typeof setTimeout> | null = null

function onSelectWord(word: string) {
  const item = wordStore.words.find(w => w.word.toLowerCase() === word.toLowerCase())
  selectedWordItem.value = item || null
}
function onMemorize(wordId: string) {
  wordStore.memorizeWord(wordId)
  wordStore.setWordStatus(wordId, 'known')
  selectedWordItem.value = null
}
function onSearchRelatedWord(word: string) {
  const item = wordStore.words.find(w => w.word.toLowerCase() === word.toLowerCase())
  selectedWordItem.value = item || null
}

onMounted(async () => {
  await wordStore.loadWords()
  try {
    const res = await fetch('/data/thesis_ranking.json')
    rankingData.value = await res.json()
  } catch {
    rankingData.value = null
  }
})

watch(showRelationships, () => {
  // 关系连线开关变化时，用当前已加载的节点重新算一遍连线（不重新拉取/筛选节点）
  if (!graphNodes.value.length) return
  const currentWords = graphNodes.value
    .map(n => wordStore.words.find(w => w.word === n.word))
    .filter((w): w is WordItem => !!w)
  const rankMap = new Map(graphNodes.value.filter(n => n.rank).map(n => [n.word.toLowerCase(), n.rank as number]))
  buildGraphFromWords(currentWords, rankMap.size ? rankMap : undefined)
})
</script>

<style scoped lang="scss">
.universe-page {
  position: fixed;
  inset: 0;
  background: var(--r-paper);
  color: var(--r-ink);
  display: flex;
  flex-direction: column;
  z-index: 500;
}
.universe-header {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--r-border);
  flex-shrink: 0;
}
.back-link {
  background: var(--r-ui);
  border: 1px solid var(--r-border);
  color: var(--r-ink);
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 13.5px;
  cursor: pointer;
  &:hover { filter: brightness(0.96); }
}
.header-title {
  h1 { font-size: 18px; font-weight: 700; }
  p { font-size: 12px; color: var(--r-ink2); margin-top: 2px; }
}

.universe-body { flex: 1; display: flex; min-height: 0; }

.control-panel {
  width: 300px;
  flex-shrink: 0;
  overflow-y: auto;
  padding: 18px;
  border-right: 1px solid var(--r-border);
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.mode-tabs { display: flex; gap: 6px; }
.mode-tab {
  flex: 1;
  background: var(--r-ui);
  border: 1px solid transparent;
  color: var(--r-ink2);
  border-radius: 8px;
  padding: 8px 0;
  font-size: 12.5px;
  cursor: pointer;
  &.on { background: var(--r-accent); color: #fff; }
}
.mode-section { display: flex; flex-direction: column; gap: 12px; }
.section-label { font-size: 12.5px; font-weight: 600; color: var(--r-ink2); }
.total-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--r-ink2);
  strong { color: var(--r-ink); }
}
.source-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.source-chip {
  background: var(--r-ui);
  border: 1px solid var(--r-border);
  color: var(--r-ink);
  border-radius: 14px;
  padding: 6px 12px;
  font-size: 12.5px;
  cursor: pointer;
  &.on { background: var(--r-accent); color: #fff; border-color: var(--r-accent); }
}
.chip-count { margin-left: 4px; opacity: 0.65; font-size: 11px; }
.checkbox-row {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  color: var(--r-ink2);
  cursor: pointer;
}
.range-slider { width: 100%; }
.hint-text { font-size: 12px; color: var(--r-ink2); line-height: 1.5; }
.manual-textarea {
  width: 100%;
  border: 1px solid var(--r-border);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  background: var(--r-paper);
  color: var(--r-ink);
  resize: vertical;
}
.load-btn {
  border: none;
  background: var(--r-accent);
  color: #fff;
  border-radius: 8px;
  padding: 10px 0;
  font-size: 13.5px;
  cursor: pointer;
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:not(:disabled):hover { filter: brightness(1.06); }
}

.graph-main { flex: 1; min-width: 0; position: relative; }
.graph-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--r-ink2);
  font-size: 14px;
}
.graph-stats {
  position: absolute;
  bottom: 16px;
  right: 16px;
  display: flex;
  gap: 8px;
  span {
    background: var(--r-ui);
    border: 1px solid var(--r-border);
    border-radius: 20px;
    padding: 4px 12px;
    font-size: 12px;
    color: var(--r-ink2);
  }
}

.not-in-lib-toast {
  position: fixed;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--r-ui);
  border: 1px solid var(--r-border);
  color: var(--r-ink);
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 13px;
  z-index: 600;
  max-width: 500px;
}
</style>

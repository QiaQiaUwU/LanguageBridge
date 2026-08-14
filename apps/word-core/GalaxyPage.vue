<template>
  <div class="galaxy-page">
    <!-- 开屏聚散动画：只在从其它页面刚进来时播一次，本页内切换策略/网络不会重放 -->
    <GalaxyIntro
      v-if="showIntro"
      :nodes="introNodes"
      @done="showIntro = false"
    />

    <!-- 顶部控制条 -->
    <div class="galaxy-topbar">
      <button class="back-btn" @click="router.push('/words')">进入列表学习 →</button>
      <div class="topbar-title">
        <h1>语义星空</h1>
        <p>基于 betweenness / PageRank 图中心性排序 · 数据来自本人毕设实证结果</p>
      </div>
    </div>

    <div class="galaxy-body">
      <!-- 左侧控制面板 -->
      <aside class="galaxy-panel">
        <section class="panel-block">
          <h3>排序策略</h3>
          <p class="panel-hint">不同策略给出不同的"该先学谁"排序，切换看星空如何变化</p>
          <div class="strategy-list">
            <button
              v-for="s in strategyOptions"
              :key="s.value"
              class="strategy-btn"
              :class="{ on: strategy === s.value }"
              @click="strategy = s.value"
            >
              <span class="strategy-name">{{ s.label }}</span>
              <span class="strategy-auc" v-if="currentModelData">
                AUC {{ currentModelData.strategies[s.value]?.auc.toFixed(3) }}
              </span>
            </button>
          </div>
          <p class="strategy-desc">{{ strategyDescriptions[strategy] }}</p>
        </section>

        <section class="panel-block">
          <h3>语义网络</h3>
          <div class="seg-row">
            <button class="seg-btn" :class="{ on: networkKey === 'bert_exam' }" @click="networkKey = 'bert_exam'">考试语境</button>
            <button class="seg-btn" :class="{ on: networkKey === 'bert_general' }" @click="networkKey = 'bert_general'">通用语境</button>
          </div>
          <p class="panel-hint" v-if="currentModelData">
            {{ currentModelData.n_nodes.toLocaleString() }} 词 ·
            {{ currentModelData.n_edges.toLocaleString() }} 条语义边 ·
            平均聚类系数 {{ currentModelData.topology.avg_clustering.toFixed(3) }}
          </p>
        </section>

        <section class="panel-block">
          <h3>覆盖率曲线</h3>
          <p class="panel-hint">学完排名前 N 的词，能覆盖语义网络的多大比例</p>
          <div class="coverage-bars" v-if="currentStrategyData">
            <div v-for="(pct, label) in coverageDisplay" :key="label" class="coverage-row">
              <span class="coverage-label">前 {{ label }} 词</span>
              <div class="coverage-track">
                <div class="coverage-fill" :style="{ width: (pct * 100) + '%' }"></div>
              </div>
              <span class="coverage-pct">{{ (pct * 100).toFixed(0) }}%</span>
            </div>
          </div>
        </section>

        <section class="panel-block">
          <h3>星星含义</h3>
          <ul class="legend-list">
            <li><span class="legend-dot hub"></span>越大越亮 = 语义枢纽，越该优先学</li>
            <li><span class="legend-dot known"></span>蓝色 = 已在你的词库里</li>
            <li><span class="legend-dot unknown"></span>紫色 = 尚未收录</li>
            <li><span class="legend-line"></span>连线 = 同根词/近义词/反义词关系</li>
          </ul>
          <p class="panel-hint small">拖拽平移 · 滚轮缩放 · 点击星星查看详情</p>
        </section>
      </aside>

      <!-- 中间星空图 -->
      <main class="galaxy-main">
        <GalaxyView
          v-if="galaxyNodes.length"
          :nodes="galaxyNodes"
          :edges="galaxyEdges"
          @select="onSelectWord"
        />
        <div v-else class="galaxy-empty">
          <p>正在准备星空数据…</p>
        </div>
      </main>
    </div>

    <!-- 复用词汇中心已有的详情弹窗：词汇关系 tab 本来就有同根词/近义词/反义词展示和点击跳转 -->
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
 * 语义星空页：VocabVerse 那种"酷、探索感"的入口，但布局逻辑换成了真实的论文数据
 * （见 apps/word-core/components/GalaxyView.vue 头部注释）而不是原来的暴力力导向。
 *
 * 数据来源分两层，UI 上明确区分，不混为一谈：
 *   1. 排名/覆盖率/AUC —— 来自 public/data/thesis_ranking.json，是论文 Stage 4 的
 *      真实实证结果（6种中心性策略，两个语义网络，各自 top-50 词表）
 *   2. 具体某个词的"邻居"（同根词/近义词/反义词）—— 复用词库里已有的
 *      WordItem.synonyms / word_family / antonyms 字段，这些字段目前主要靠 AI
 *      补全或手动录入，跟论文那套 BERT 向量算出来的语义网络不是同一套数据源、
 *      精度也不同（论文那边没有导出完整边表，只有 top-50 排名）。
 *      两者互补：排名负责回答"该学谁"，词库字段负责回答"这个词具体连着谁"。
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import GalaxyView, { type GalaxyNode, type GalaxyEdge } from './components/GalaxyView.vue'
import GalaxyIntro from './components/GalaxyIntro.vue'
import WordDetailModal from './components/WordDetailModal.vue'
import { useWordStore } from '@/shared/stores/wordStore'
import type { WordItem } from '@/shared/types/WordItem'

const router = useRouter()
const route = useRoute()
const wordStore = useWordStore()

type StrategyKey = 'betweenness' | 'pagerank' | 'closeness' | 'degree' | 'frequency' | 'syllabus'
interface StrategyData {
  auc: number
  coverage_at: Record<string, number>
  top_words: string[]
}
interface ModelData {
  n_nodes: number
  n_edges: number
  topology: { density: number; avg_degree: number; avg_clustering: number; avg_path_length: number; small_world_sigma: number; giant_ratio: number }
  strategies: Record<StrategyKey, StrategyData>
}
type RankingFile = Record<'bert_exam' | 'bert_general', ModelData>

const rankingData = ref<RankingFile | null>(null)
const networkKey = ref<'bert_exam' | 'bert_general'>('bert_exam')
const strategy = ref<StrategyKey>('betweenness')

const strategyOptions: { value: StrategyKey; label: string }[] = [
  { value: 'betweenness', label: '桥接中心性' },
  { value: 'pagerank', label: 'PageRank' },
  { value: 'closeness', label: '接近中心性' },
  { value: 'degree', label: '度中心性' },
  { value: 'syllabus', label: '教材顺序' },
  { value: 'frequency', label: '词频' }
]
const strategyDescriptions: Record<StrategyKey, string> = {
  betweenness: '优先学"桥接词"——连接不同语义域的枢纽词，学会一个能同时打通多个方向。实证效果最好（AUC 最高）。',
  pagerank: '优先学"被其他重要词围绕"的词——类似网页排名逻辑，越是核心圈子里的词权重越高。',
  closeness: '优先学"离所有词平均距离最短"的词——从这里出发，去哪个语义方向都近。',
  degree: '优先学"直接关联最多"的词——最简单直观，但只看局部，不看全局位置。',
  syllabus: '按教材/考纲原有顺序，不做任何重排，作为对照基线。',
  frequency: '按语料词频从高到低，最常见的传统背单词顺序，作为对照基线。'
}

const currentModelData = computed(() => rankingData.value?.[networkKey.value] || null)
const currentStrategyData = computed(() => currentModelData.value?.strategies[strategy.value] || null)

const coverageDisplay = computed(() => {
  const c = currentStrategyData.value?.coverage_at
  if (!c) return {}
  // 数据里的 key 是 top_10/top_20/top_50/top_100，这里转成更好读的数字标签
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(c)) {
    const n = k.replace('top_', '')
    out[n] = v
  }
  return out
})

// ===== 把排名数据 + 本地词库拼成星空图需要的节点/边 =====
const galaxyNodes = ref<GalaxyNode[]>([])
const galaxyEdges = ref<GalaxyEdge[]>([])

// 开屏聚散动画只在"刚进入这个页面、且数据已就绪"时播一次——本页内切换策略/
// 网络不重放；数据没加载完之前不显示（避免用空粒子放一段没意义的动画）。
const showIntro = ref(false)
const introNodes = computed(() => galaxyNodes.value.map(n => ({ word: n.word, rank: n.rank })))

function rebuildGalaxy() {
  const strat = currentStrategyData.value
  if (!strat) { galaxyNodes.value = []; galaxyEdges.value = []; return }

  const libraryByWord = new Map(wordStore.words.map(w => [w.word.toLowerCase(), w]))
  const nodes: GalaxyNode[] = strat.top_words.map((word, idx) => ({
    id: word,
    word,
    rank: idx + 1,
    known: libraryByWord.has(word.toLowerCase())
  }))

  // 边：只在 top_words 范围内，用词库里已有的同根词/近义词/反义词字段连线——
  // 论文数据本身没有导出完整边表（只有 top-50 排名），所以星空图里的"连线"
  // 走的是词库字段这条数据源，跟节点的"排名/大小"是两套不同来源的数据，
  // 各自负责各自能负责的部分，不互相冒充。
  const nodeIdSet = new Set(nodes.map(n => n.id.toLowerCase()))
  const edges: GalaxyEdge[] = []
  const seen = new Set<string>()
  for (const n of nodes) {
    const item = libraryByWord.get(n.word.toLowerCase())
    if (!item) continue
    const neighbors = [
      ...(item.word_family || []),
      ...(item.synonyms?.map(s => s.word) || []),
      ...(item.antonyms?.map(a => a.word) || [])
    ]
    for (const nb of neighbors) {
      const nbLower = nb.toLowerCase()
      if (!nodeIdSet.has(nbLower) || nbLower === n.word.toLowerCase()) continue
      const key = [n.word.toLowerCase(), nbLower].sort().join('|')
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ source: n.word, target: nb })
    }
  }

  galaxyNodes.value = nodes
  galaxyEdges.value = edges
}

// ===== 点击星星 → 复用现有详情弹窗 =====
const selectedWordItem = ref<WordItem | null>(null)
const notInLibraryHint = ref('')
let hintTimer: ReturnType<typeof setTimeout> | null = null

function onSelectWord(word: string) {
  const item = wordStore.words.find(w => w.word.toLowerCase() === word.toLowerCase())
  if (item) {
    selectedWordItem.value = item
  } else {
    // 这个词只存在于论文排名数据里，还没被收进本地词库——如实告诉用户，
    // 不假装能打开一份不存在的详情
    notInLibraryHint.value = `"${word}" 还没有收进你的词库，暂无详细释义`
    if (hintTimer) clearTimeout(hintTimer)
    hintTimer = setTimeout(() => { notInLibraryHint.value = '' }, 2400)
  }
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
  rebuildGalaxy()
  // 只有从 `/` 首次重定向过来（带 ?intro=1）才播开屏聚散动画；从词汇中心页
  // 点"✦ 语义星空"按钮直接进 /galaxy 的，跳过动画直接看可交互星空图，
  // 不然每次点这个按钮都要多等一遍已经看过的开屏效果。
  if (route.query.intro === '1' && galaxyNodes.value.length) showIntro.value = true
})

// 策略/网络切换时重建
watch([strategy, networkKey, rankingData], rebuildGalaxy)
</script>

<style scoped lang="scss">
.galaxy-page {
  position: fixed;
  inset: 0;
  background: #05070f;
  color: #e8ecff;
  display: flex;
  flex-direction: column;
  z-index: 500;
}
.galaxy-topbar {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 16px 24px;
  border-bottom: 1px solid rgba(140, 160, 255, 0.15);
  flex-shrink: 0;
}
.back-btn {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12);
  color: #cfd6ff;
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 13.5px;
  cursor: pointer;
  &:hover { background: rgba(255,255,255,0.12); }
}
.topbar-title {
  h1 { font-size: 18px; font-weight: 700; letter-spacing: 0.5px; }
  p { font-size: 12px; color: #8a94c9; margin-top: 2px; }
}

.galaxy-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.galaxy-panel {
  width: 300px;
  flex-shrink: 0;
  overflow-y: auto;
  padding: 18px;
  border-right: 1px solid rgba(140, 160, 255, 0.12);
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.panel-block h3 {
  font-size: 13px;
  font-weight: 700;
  color: #aeb8f0;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  margin-bottom: 8px;
}
.panel-hint {
  font-size: 12px;
  color: #7d87b8;
  line-height: 1.5;
  margin-bottom: 10px;
  &.small { margin-top: 10px; margin-bottom: 0; }
}
.strategy-list { display: flex; flex-direction: column; gap: 6px; }
.strategy-btn {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(255,255,255,0.04);
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 8px 12px;
  color: #cfd6ff;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  &:hover { background: rgba(255,255,255,0.08); }
  &.on { background: rgba(110, 130, 255, 0.18); border-color: rgba(140, 160, 255, 0.5); }
}
.strategy-name { font-weight: 600; }
.strategy-auc { font-size: 11px; color: #8a94c9; }
.strategy-desc {
  margin-top: 10px;
  font-size: 12px;
  color: #9aa4d6;
  line-height: 1.6;
  background: rgba(255,255,255,0.03);
  border-radius: 8px;
  padding: 10px 12px;
}

.seg-row { display: flex; gap: 6px; margin-bottom: 8px; }
.seg-btn {
  flex: 1;
  background: rgba(255,255,255,0.05);
  border: 1px solid transparent;
  color: #cfd6ff;
  border-radius: 7px;
  padding: 7px 0;
  font-size: 12.5px;
  cursor: pointer;
  &.on { background: rgba(110, 130, 255, 0.2); border-color: rgba(140, 160, 255, 0.5); }
}

.coverage-bars { display: flex; flex-direction: column; gap: 8px; }
.coverage-row { display: flex; align-items: center; gap: 8px; }
.coverage-label { font-size: 11.5px; color: #8a94c9; width: 58px; flex-shrink: 0; }
.coverage-track {
  flex: 1;
  height: 6px;
  background: rgba(255,255,255,0.08);
  border-radius: 3px;
  overflow: hidden;
}
.coverage-fill {
  height: 100%;
  background: linear-gradient(90deg, #6e82ff, #a78bfa);
  border-radius: 3px;
}
.coverage-pct { font-size: 11.5px; color: #cfd6ff; width: 36px; text-align: right; }

.legend-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
  color: #9aa4d6;
}
.legend-list li { display: flex; align-items: center; gap: 8px; }
.legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.legend-dot.hub { background: radial-gradient(circle, #c4cfff, #6e82ff); box-shadow: 0 0 6px #6e82ff; }
.legend-dot.known { background: #4a9eff; }
.legend-dot.unknown { background: #a78bfa; }
.legend-line { width: 14px; height: 1px; background: rgba(140, 160, 255, 0.5); flex-shrink: 0; }

.galaxy-main {
  flex: 1;
  min-width: 0;
  position: relative;
}
.galaxy-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #7d87b8;
  font-size: 14px;
}

.not-in-lib-toast {
  position: fixed;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(20, 24, 44, 0.95);
  border: 1px solid rgba(140, 160, 255, 0.3);
  color: #cfd6ff;
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 13px;
  z-index: 600;
}
</style>

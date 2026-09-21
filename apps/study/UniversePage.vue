<template>
  <div class="universe-page">
    <header class="uni-head">
      <div class="head-left">
        <BackLink label="主页" to="/home" />
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
          placeholder="搜索"
          @focus="searchFocus = true"
          @blur="onSearchBlur"
          @keydown.enter="commitSearchTop"
        />
        <CloseButton v-if="centerWord" class="search-exit" title="回到筛选结果" @click="exitCenter" small />
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
      <aside v-show="!panelFolded" class="uni-panel" :style="{ width: panelWidth + 'px' }">
        <div class="panel-resizer" title="拖动改宽度" @pointerdown="startPanelResize"></div>
        <div class="panel-head">
          <span class="panel-title">筛选</span>
          <FoldToggle v-model:folded="panelFolded" :icons="['ri-filter-3-line', 'ri-arrow-left-double-line']" title="筛选面板" />
        </div>

        <div class="panel-block">
          <p class="panel-label">着色</p>
          <div class="seg fill">
            <button :class="{ on: colorBy === 'exam' }" @click="colorBy = 'exam'">考试</button>
            <button :class="{ on: colorBy === 'topic' }" @click="colorBy = 'topic'">话题</button>
            <button :class="{ on: colorBy === 'morpheme' }" @click="colorBy = 'morpheme'">词根</button>
            <button :class="{ on: colorBy === 'mastery' }" @click="colorBy = 'mastery'">掌握</button>
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
                {{ g.name }}（{{ wordStore.groupSize(g) }}）
              </option>
            </select>
          </div>

          <div class="panel-block">
            <div class="panel-label-row">
              <span class="panel-label">分类</span>
              <button v-if="sel[dim]" class="link-btn" @click="sel[dim] = ''">清除</button>
            </div>
            <div class="seg fill">
              <button
                v-for="d in dimensions"
                :key="d.key"
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
                <!-- 词根：直接看以这个词根为中心的笔记 -->
                <i
                  v-if="dim === 'morpheme'"
                  class="ri-sticky-note-line val-note"
                  title="笔记"
                  @click.stop="openRootNote(v.name)"
                ></i>
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
            <p class="panel-label">掌握</p>
            <div class="seg fill">
              <button
                v-for="st in STATUS_FILTERS"
                :key="st.key"
                :class="{ on: statusFilter === st.key }"
                @click="statusFilter = st.key"
              >{{ st.label }}</button>
            </div>
          </div>

          <div class="panel-block">
            <p class="panel-label">关系</p>
            <div class="seg fill">
              <button
                v-for="r in REL_OPTIONS"
                :key="r.key"
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
              <summary class="panel-label">批量添加</summary>
              <textarea
                v-model="manualText"
                class="manual-input"
                rows="6"
                placeholder="单词"
              ></textarea>
              <p v-if="manualOverflow" class="warn">超出 {{ MANUAL_MAX }} 个</p>
              <button class="ghost-btn small" :disabled="!manualText" @click="manualText = ''">清空</button>
            </details>
          </div>
        </template>

        <div class="panel-block">
          <div class="panel-label-row">
            <span class="panel-label">话题</span>
            <button class="ui-icon-btn sm" title="刷新" :disabled="treeBusy" @click="buildTree"><i class="ri-refresh-line"></i></button>
          </div>
          <span v-if="treeBusy" class="ui-spin"></span>
          <EmptyState v-else-if="!topicNodes.length" />
          <ul v-else class="tt">
            <li
              v-for="n in topicNodes"
              :key="n.id"
              class="tt-row"
              :class="[`lv${Math.min(n.level, 5)}`, { cur: topicScope?.id === n.id }]"
              :style="{ paddingLeft: (n.level - 1) * 10 + 'px' }"
            >
              <span v-if="expanding === n.id" class="tt-pad"><span class="ui-spin"></span></span>
              <button v-else-if="n.children.length || n.pending" class="ui-icon-btn sm" :title="treeOpen.has(n.id) ? '收起' : '展开'" @click="toggleTree(n)">
                <i :class="treeOpen.has(n.id) ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'"></i>
              </button>
              <span v-else class="tt-pad"></span>
              <button class="tt-name" :class="{ stray: n.label === '零散' }" :title="n.words.slice(0, 20).join(' ') + (n.weak?.length ? `\n存疑：${n.weak.join(' ')}` : '')" @click="drillTopic(n)">{{ n.label }}</button>
              <i v-if="n.weak?.length" class="ri-question-line tt-weak" :title="`存疑：${n.weak.join(' ')}`"></i>
              <span class="tt-count">{{ n.words.length }}</span>
              <button v-if="n.level >= 2 && n.words.length >= 2" class="ui-icon-btn sm" title="笔记" @click="openTopicNote(n)"><i class="ri-sticky-note-line"></i></button>
            </li>
          </ul>
        </div>

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
        <FoldToggle
          v-if="panelFolded"
          v-model:folded="panelFolded"
          class="graph-unfold"
          :icons="['ri-filter-3-line', 'ri-arrow-left-double-line']"
          title="筛选面板"
        />
        <WordGraph3D
          v-if="nodes.length"
          ref="graphRef"
          :nodes="nodes"
          :links="links"
          :cluster-info="applied?.info"
          :loading="loadingGraph"
          :root-path="topicScope && !centerWord ? topicPath.map(x => x.label) : []"
          @select="onSelect"
          @recenter="focusOn"
          @stats="drawn = $event"
          @drill="onGraphDrill"
          @crumb="onCrumb"
        />
        <p v-else class="uni-empty">暂无</p>
      </div>

      <aside v-if="detailWord || noteTarget" class="uni-detail" :class="{ wide: detailTab === 'note' }">
        <div class="ud-tabs">
          <BackLink v-if="returnNote" label="笔记" @back="backToNote" />
          <div v-if="detailWord" class="seg">
            <button :class="{ on: detailTab === 'detail' }" @click="detailTab = 'detail'">详情</button>
            <button :class="{ on: detailTab === 'note' }" @click="detailTab = 'note'">笔记</button>
          </div>
          <span v-else class="ud-title">笔记</span>
          <CloseButton @click="closeDetail" />
        </div>
        <WordDetailInline
          v-if="detailTab === 'detail' && detailWord"
          :word="detailWord"
          inline
          @close="closeDetail"
          @search="onSelect"
          @filter-family="focusOn"
          @open-morpheme="openRootNote"
        />
        <FamilyNotePanel
          v-else
          class="ud-note"
          :words="wordStore.words"
          :word="noteTarget ? null : detailWord"
          :members="noteTarget?.members"
          :title="noteTarget?.title"
          :preset="noteTarget?.preset"
          :preset-layout="noteTarget?.layout"
          :groups="noteTarget?.groups"
          :root-query="noteTarget?.rootQuery"
          :depth="expandDepth"
          @pick="pickFromNote"
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
import FamilyNotePanel from './components/FamilyNotePanel.vue'
import { getIndex, topicTree, expandTopic } from '@/shared/core/familyNoteService'
import { getStudyRecord } from '@/shared/core/studyRecords'
import type { FamilyNote, TopicTreeNode } from '@/shared/core/wordFamily'
import { realMorphemes, canonicalMorpheme, rootAliasState } from '@/shared/core/wordFamily'
import { useRoute } from 'vue-router'
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

/** 左侧面板宽度，可拖动，记住上次的值 */
const PANEL_W_KEY = 'lb-universe-panel-w'
const panelWidth = ref(Math.min(460, Math.max(260, Number(localStorage.getItem(PANEL_W_KEY)) || 320)))
function startPanelResize(e: PointerEvent) {
  const startX = e.clientX
  const startW = panelWidth.value
  const move = (ev: PointerEvent) => { panelWidth.value = Math.min(460, Math.max(260, startW + ev.clientX - startX)) }
  const up = () => {
    window.removeEventListener('pointermove', move)
    localStorage.setItem(PANEL_W_KEY, String(panelWidth.value))
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up, { once: true })
}

/* ---------- 词汇笔记 ---------- */
const route = useRoute()
const detailTab = ref<'detail' | 'note'>('detail')
const noteTarget = ref<{ members?: string[]; title?: string; preset?: FamilyNote; layout?: 'list' | 'radial'; groups?: { label: string; words: string[] }[]; rootQuery?: string } | null>(null)
/**
 * 详情和笔记并存：
 *   在星图或搜索里选词 → 看这个词的详情（例句、辨析都在），「笔记」页签是这个词的词族笔记；
 *   在话题笔记里点一个词 → 切到这个词的详情，顶上有「返回笔记」回到刚才的话题笔记。
 */
const returnNote = ref<typeof noteTarget.value>(null)
function closeDetail() {
  detailWord.value = null
  noteTarget.value = null
  returnNote.value = null
  detailTab.value = 'detail'
}
function pickFromNote(word: string) {
  const hit = wordStore.words.find(x => x.word.toLowerCase() === word.toLowerCase())
  if (!hit) return
  if (noteTarget.value) returnNote.value = noteTarget.value
  noteTarget.value = null
  detailTab.value = 'detail'
  focusOn(hit)
}
function backToNote() {
  noteTarget.value = returnNote.value
  returnNote.value = null
  detailWord.value = null
  detailTab.value = 'note'
}

const topicRoots = ref<TopicTreeNode[]>([])
const treeOpen = ref(new Set<string>())
const treeBusy = ref(false)
async function buildTree() {
  treeBusy.value = true
  try {
    const idx = await getIndex(wordStore.words)
    topicRoots.value = topicTree(idx, scopedWords.value)
    // 树重建后旧节点失效，退出话题钻取
    if (topicScope.value) { topicScope.value = null; applyLoad() }
  } finally {
    treeBusy.value = false
  }
}
const expanding = ref('')
async function ensureExpanded(n: TopicTreeNode) {
  if (!n.pending) return
  expanding.value = n.id
  try {
    const idx = await getIndex(wordStore.words)
    await expandTopic(idx, n)
    topicRoots.value = [...topicRoots.value]
  } finally {
    expanding.value = ''
  }
}
async function toggleTree(n: TopicTreeNode) {
  const s = new Set(treeOpen.value)
  if (s.has(n.id)) { s.delete(n.id); treeOpen.value = s; return }
  await ensureExpanded(n)
  s.add(n.id)
  treeOpen.value = s
}

/* ---------- 按话题逐层钻取 ---------- */
/**
 * 话题树里点一层：星图换成这一层的词，下一层的各组显示成星云，再下一层是星云里的小团。
 * 在星图里继续往下钻到第二级时，自动把那一组设成新的一层，所以没有层数限制。
 */
const topicScope = ref<TopicTreeNode | null>(null)
const topicPath = computed<TopicTreeNode[]>(() => {
  const n = topicScope.value
  if (!n) return []
  const walk = (list: TopicTreeNode[], trail: TopicTreeNode[]): TopicTreeNode[] | null => {
    for (const x of list) {
      const t = [...trail, x]
      if (x === n) return t
      const hit = walk(x.children, t)
      if (hit) return hit
    }
    return null
  }
  return walk(topicRoots.value, []) || [n]
})
const realChildren = (n: TopicTreeNode) => n.children.filter(c => !c.id.includes('/@'))

async function drillTopic(n: TopicTreeNode | null) {
  if (centerWord.value) exitCenter()
  if (n) {
    await ensureExpanded(n)
    for (const c of realChildren(n)) await ensureExpanded(c)
    // 展开树，让当前层在左边可见
    const s = new Set(treeOpen.value)
    topicPath.value.forEach(x => s.add(x.id))
    s.add(n.id)
    treeOpen.value = s
  }
  topicScope.value = n
  await applyLoad()
  nextTick(() => graphRef.value?.restoreDrill?.({ level: 0, superCloud: '', cloud: '', cluster: '', clusterLabel: '' }))
}
function onCrumb(i: number) {
  if (i < 0) { drillTopic(null); return }
  const target = topicPath.value[i]
  if (target) drillTopic(target)
}
function onGraphDrill(d: { level: number; superCloud: string; cloud: string }) {
  if (d.level < 2) return
  const base = topicScope.value
  let next: TopicTreeNode | undefined
  if (base) {
    const child = realChildren(base).find(c => c.label === d.superCloud)
    next = child && realChildren(child).find(c => c.label === d.cloud)
    if (next && !realChildren(next).length && !next.pending) next = undefined
  } else {
    const l1 = topicRoots.value.find(x => x.label === d.superCloud)
    next = l1?.children.find(x => x.label === d.cloud)
  }
  if (next) drillTopic(next)
}
/** 当前层下，词 → 所属下一层 / 再下一层的组名 */
function scopeClouds(scope: TopicTreeNode, words: WordItem[]) {
  const cloudOut = new Map<string, string>()
  const superOut = new Map<string, string>()
  const kids = realChildren(scope)
  const find = (list: TopicTreeNode[], k: string) => list.find(c => c.words.includes(k))
  for (const w of words) {
    const k = w.word.toLowerCase()
    const child = find(kids, k)
    const grand = child ? find(realChildren(child), k) : undefined
    superOut.set(w.word, child?.label || scope.label)
    cloudOut.set(w.word, grand?.label || child?.label || scope.label)
  }
  return { cloudOf: cloudOut, superOf: superOut }
}
/** 展开后的扁平列表：L1 → L2 → L3（L4 词族太细，只在笔记里体现） */
const topicNodes = computed(() => {
  const out: TopicTreeNode[] = []
  const walk = (n: TopicTreeNode) => {
    out.push(n)
    if (treeOpen.value.has(n.id)) n.children.forEach(walk)
  }
  topicRoots.value.forEach(walk)
  return out
})
async function openTopicNote(n: TopicTreeNode) {
  await ensureExpanded(n)
  const path = pathOf(n)
  // 主题下有小组时，笔记按小组分支，和树保持一致
  const sub = n.children.filter(c => !c.id.includes('/@'))
  const groups = sub.length >= 2 ? sub.map(c => ({ label: c.label, words: c.words })) : undefined
  noteTarget.value = { members: n.words, title: path.slice(1).join(' · ') || n.label, groups }
  detailWord.value = null
  detailTab.value = 'note'
}
/**
 * 以词根为中心的笔记。
 *
 * `buildRootNote` 一直在 wordFamily 里，但界面上没有任何入口调用它，
 * 所以这种笔记实际上看不到了。词根维度的每一项挂一个入口。
 */
/** 从别的页面带 ?morpheme=xxx 进来：直接打开这个词素的笔记 */
onMounted(() => {
  const q = String(route.query.morpheme || '').trim()
  if (q) {
    dim.value = 'morpheme'
    openRootNote(q)
  }
})

function openRootNote(form: string) {
  noteTarget.value = { rootQuery: form, title: form }
  detailWord.value = null
  detailTab.value = 'note'
  /**
   * 中间的星系跟着一起换成这批词。
   * 只开笔记不动图，右边在讲这个词根，中间还停在上一批词上，对不上。
   */
  const members = wordStore.words
    .filter(w => matchOne(w, 'morpheme', form))
    .slice(0, MANUAL_MAX)
    .map(w => w.word.toLowerCase())
  if (members.length) {
    centerWord.value = null
    manualText.value = members.join(' ')
  }
}

/** 从 L1 到这个节点的标签路径 */
function pathOf(n: TopicTreeNode): string[] {
  const walk = (list: TopicTreeNode[], trail: string[]): string[] | null => {
    for (const x of list) {
      const t = [...trail, x.label]
      if (x === n) return t
      const hit = walk(x.children, t)
      if (hit) return hit
    }
    return null
  }
  return walk(topicRoots.value, []) || [n.label]
}

async function openSavedNote(id: string) {
  const r = await getStudyRecord(id)
  if (r && r.type === 'familyNote') {
    noteTarget.value = { preset: r.note, layout: r.layout, title: r.title }
    detailTab.value = 'note'
  }
}
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
  { key: 'unmarked', label: '未标' },
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
      for (const { key: k, meaning: mean } of morphParts(w)) {
        count.set(k, (count.get(k) || 0) + 1)
        if (mean && !meaning.has(k)) meaning.set(k, mean)
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
  { key: 'morpheme' as DimKey, label: '词根', count: morphemeValues.value.length }
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

/**
 * 词的词素，词根按归一键算。
 * 词根梳理合并过的 spec / spect / spic 在列表里是同一项，释义用梳理后统一的那个。
 */
function morphParts(w: WordItem): { key: string; meaning: string }[] {
  const m = realMorphemes(w)
  if (!m) return []
  const out: { key: string; meaning: string }[] = []
  if (m.prefix?.form) out.push({ key: m.prefix.form, meaning: m.prefix.meaning || '' })
  if (m.root?.form) {
    const k = canonicalMorpheme(m.root.form, m.root.meaning, 'root') || m.root.form
    out.push({ key: k, meaning: rootAliasState().meaning.get(k) || m.root.meaning || '' })
  }
  if (m.suffix?.form) out.push({ key: m.suffix.form, meaning: m.suffix.meaning || '' })
  return out
}

function matchOne(w: WordItem, key: DimKey, v: string): boolean {
  if (!v) return true
  if (key === 'exam') return !!w.tags?.includes(v)
  if (key === 'topic') return topicsOf(w).includes(v)
  const keys = morphParts(w).map(p => p.key)
  return keys.includes(v) || keys.includes(canonicalMorpheme(v, '', 'root'))
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

  const m = realMorphemes(w)
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
  // manualWords 是 manualText 的 computed，直接赋值赋不进去（功能等于没生效），要写回源头
  manualText.value = hits.slice(0, MANUAL_MAX).map(w => w.word.toLowerCase()).join(' ')
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
  const scope = topicScope.value
  let all = scopedWords.value
  if (scope) {
    const want = new Set(scope.words)
    all = wordStore.words.filter(w => want.has(w.word.toLowerCase()))
  }
  const n = scope ? Math.min(all.length, MAX_LIMIT) : Math.max(0, Math.min(limit.value, all.length))
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
    ...(scope ? scopeClouds(scope, words) : cloudsOf(words, r.clusterOf))
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
      const m = realMorphemes(members.find(w => morphemeKeyOf(w) === topRoot[0]))
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
      /**
       * 关系网（看某个词的扩散）里这两个字段原来是空的，聚团力就不生效，
       * 所有词自由散开。用「话题 / 词根」兜底：同话题的聚在一块，
       * 话题里再按词根分小团，排布跟左边那两棵树对得上。
       */
      cloud: cloudOf.value.get(w.word) || morphemeKeyOf(w) || w.topics?.[0] || '',
      superCloud: superOf.value.get(w.word) || w.topics?.[0] || '未分类',
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
  // 正在看话题笔记时点星图，切到这个词的详情；正在看单词笔记则保持笔记页签，换成新词的笔记
  if (noteTarget.value) { noteTarget.value = null; detailTab.value = 'detail' }
  returnNote.value = null
  detailWord.value = hit
  focusOn(hit)
}

function clearGraph() {
  if (topicScope.value) { drillTopic(null); return }
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

watch(() => route.query.note, v => { if (v) openSavedNote(String(v)) }, { immediate: true })
watch(() => scopedWords.value.length, n => { if (n) buildTree() }, { immediate: true })

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
.universe-page {
  height: calc(100vh - var(--lb-main-pad, 24px) * 2);
  display: flex; flex-direction: column;
  /* 主区域已经有 24px 内边距，这里不再叠加，左侧面板贴近导航栏 */
  padding: 0 0 var(--space-xs);
  margin-left: calc(var(--space-xs) - var(--lb-main-pad, 24px));
}

.uni-head {
  display: grid; grid-template-columns: 1fr auto 1fr;
  align-items: center; gap: 14px; margin-bottom: 6px;
}
.head-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.head-right { min-width: 0; }
.uni-title { font-size: 17px; margin: 0; white-space: nowrap; }
.uni-count { font-size: 12.5px; color: var(--c-text-2); white-space: nowrap; }
.uni-legend { margin-bottom: 10px; }

.head-search {
  position: relative;
  width: min(460px, 38vw);
  display: flex;
  align-items: center;
}
.search-input {
  width: 100%;
  border: 1px solid var(--c-line);
  border-radius: 9999px;
  padding: 7px 34px 7px 14px;
  font-size: 13.5px;
  background: var(--c-surface);
  color: inherit;
  outline: none;
  transition: border-color 0.15s;
}
.head-search.focus .search-input { border-color: var(--c-accent); }
.search-exit {
  position: absolute; right: 10px;
  border: none; background: none; cursor: pointer;
  font-size: 17px; line-height: 1; color: var(--c-text-2);
}
.search-exit:hover { color: var(--c-text); }
.search-drop {
  position: absolute;
  top: calc(100% + 4px);
  left: 0; right: 0;
  z-index: 40;
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}
.search-item {
  display: flex; align-items: baseline; gap: 8px; width: 100%;
  padding: 7px 12px; border: none; background: none; cursor: pointer; text-align: left;
}
.search-item:hover { background: var(--c-surface-2); }
.si-word { font-size: 13.5px; font-weight: 600; color: var(--c-text); }
.si-zh { font-size: 12px; color: var(--c-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.uni-body { flex: 1; min-height: 0; display: flex; gap: 12px; position: relative; }
.graph-unfold {
  position: absolute; left: var(--space-sm); top: var(--space-sm); z-index: 5;
  background: rgba(16, 18, 24, .55); color: rgba(232, 234, 240, .9);
  &:hover { color: var(--c-text-on-accent); background: rgba(16, 18, 24, .8); }
}
.uni-body > .graph-3d, .uni-body > :last-child { min-width: 0; }
.uni-legend {
  position: absolute; left: 12px; bottom: 12px; z-index: 4;
  padding: 7px 10px; border-radius: 9px;
  background: rgba(16, 18, 24, 0.55); backdrop-filter: blur(6px);
  color: #e8eaf0; pointer-events: none;
}
.uni-panel {
  position: relative;
  flex-shrink: 0;
  overflow-y: auto;
  border: 1px solid var(--c-line);
  border-radius: var(--radius-xl);
  padding: var(--space-sm);
  background: var(--c-surface);
}
.panel-resizer {
  position: absolute; top: 0; right: -4px; bottom: 0; width: 8px; cursor: col-resize; z-index: 2;
}
.panel-resizer:hover { background: linear-gradient(90deg, transparent 3px, var(--c-accent-soft) 3px, var(--c-accent-soft) 5px, transparent 5px); }
.panel-head {
  display: flex; align-items: center; justify-content: space-between;
  margin: calc(-1 * var(--space-2xs)) 0 var(--space-xs);
}
.panel-title { font-size: var(--text-sm); font-weight: 600; color: var(--c-text); }
.panel-block { padding-bottom: var(--space-sm); margin-bottom: var(--space-sm); border-bottom: 1px solid var(--c-line-soft); }
.panel-block:last-child { border-bottom: none; margin-bottom: 0; }
.panel-label { font-size: var(--text-xs); color: var(--c-text-3); margin: 0 0 var(--space-xs); }
.uni-panel .seg.fill > button { font-size: var(--text-xs); }
.panel-big { font-size: var(--text-xl); font-weight: 600; margin: 0 0 var(--space-2xs); color: var(--c-accent); }
.panel-big em { font-size: 13px; font-style: normal; margin-left: 5px; color: var(--c-text-2); }
.panel-hint { font-size: 12px; color: var(--c-text-2); line-height: 1.6; margin: 0 0 12px; }
.mode-row { display: flex; gap: 6px; flex-wrap: wrap; }
.dim-count { font-size: 11px; margin-left: 4px; opacity: 0.7; }
.val-list { display: flex; flex-wrap: wrap; gap: 4px; margin-top: var(--space-xs); max-height: 168px; overflow-y: auto; }
.val-chip {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 8px; border-radius: 9999px; font-size: var(--text-xs); cursor: pointer;
  border: 1px solid var(--c-line); background: transparent; color: inherit;
}
.val-chip.on { border-color: var(--c-accent); background: var(--c-surface-2); }
.val-chip.ghost { color: var(--c-accent); border-style: dashed; }
.val-chip .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.val-note {
  margin-left: 5px; opacity: .55;
  &:hover { opacity: 1; }
}
.val-count { font-size: 11px; color: var(--c-text-2); }
.slider { width: 100%; margin-bottom: 10px; }
.dark-btn {
  width: 100%;
  border: none;
  background: var(--c-accent);
  color: var(--c-text-on-accent);
  border-radius: 9px;
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
  transition: background-color .15s ease, box-shadow .15s ease;
  box-shadow: 0 1px 2px color-mix(in srgb, var(--c-accent) 22%, transparent);
}
.dark-btn:disabled { background: var(--c-surface-2); color: var(--c-text-2); box-shadow: none; cursor: default; }
.panel-label-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.link-btn {
  border: none; background: none; padding: 0; cursor: pointer;
  font-size: 12px; color: var(--c-accent);
}
.link-btn:disabled { opacity: 0.4; cursor: default; }
.center-block { background: var(--c-surface-2); border-radius: 10px; padding: 12px; }
.center-word { font-size: 22px; font-weight: 600; margin: 0 0 4px; color: var(--c-accent); }
.manual-fold summary { cursor: pointer; }
.density-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.mini-select {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  flex: 1; min-width: 0;
  border: 1px solid var(--c-line); border-radius: 8px;
  padding: 4px 7px; font-size: 12.5px; background: var(--c-surface); color: inherit;
}
.mini-select.full { width: 100%; }
.check { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--c-text-2); cursor: pointer; }
.manual-input {
  width: 100%; margin-top: 8px;
  border: 1px solid var(--c-line); border-radius: 8px;
  padding: 8px; font-size: 13px; background: var(--c-surface-2); color: inherit; resize: vertical;
}
.warn { font-size: 12px; color: var(--c-warn); margin: 6px 0 0; }
.loaded-chips { display: flex; flex-wrap: wrap; gap: 4px; max-height: 150px; overflow-y: auto; }
.loaded-chip { font-size: 11.5px; padding: 2px 7px; border-radius: 9999px; background: var(--c-surface-2); color: var(--c-text-2); }
.loaded-chip.more { opacity: 0.6; }
.ud-tabs {
  position: sticky; top: 0; z-index: var(--z-content);
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--space-xs) var(--space-sm); background: var(--c-surface); border-bottom: 1px solid var(--c-line-soft);
}
.ud-note { height: calc(100% - 45px); }
.ud-title { flex: 1; font-weight: 600; font-size: var(--text-sm); }
.ud-tabs .seg { margin-right: auto; }
.uni-detail.wide { width: 520px; display: flex; flex-direction: column; overflow: hidden; }
.tt { list-style: none; margin: 0; padding: 0; max-height: 320px; overflow-y: auto; }
.tt-row { display: flex; align-items: center; gap: 2px; }
.tt-pad { width: 26px; flex-shrink: 0; }
.tt-name {
  flex: 1; min-width: 0; border: none; background: none; cursor: pointer; text-align: left;
  padding: 3px 4px; border-radius: var(--radius-sm); font: inherit; font-size: var(--text-sm); color: var(--c-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tt-name:hover { background: var(--c-hover); }
.tt-row.lv1 .tt-name { font-weight: 600; }
.tt-row.lv3 .tt-name { color: var(--c-text); }
.tt-row.cur .tt-name { background: var(--c-accent-soft); color: var(--c-accent); font-weight: 600; }
.tt-pad { display: inline-flex; align-items: center; justify-content: center; height: 26px; }
.tt-row.lv4 .tt-name, .tt-row.lv5 .tt-name { color: var(--c-text-2); font-size: var(--text-xs); }
.tt { max-height: 46vh; }
.tt-count { font-size: var(--text-2xs); color: var(--c-text-3); }
.tt-weak { font-size: var(--icon-sm); color: var(--c-warn); }
.tt-name.stray { font-style: italic; color: var(--c-text-3); }
.tt-row .ui-icon-btn:last-child { opacity: 0; }
.tt-row:hover .ui-icon-btn:last-child { opacity: 1; }
.uni-detail {
  width: 380px;
  flex-shrink: 0;
  overflow-y: auto;
  position: relative;
  border: 1px solid var(--c-line);
  border-radius: 12px;
  background: var(--c-surface);
}

.uni-graph {
  flex: 1;
  min-width: 0;
  position: relative;
  border: 1px solid var(--c-line);
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
  color: var(--c-text-2);
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
  .uni-panel { width: auto !important; max-height: 260px; }
  .panel-resizer { display: none; }
  .uni-graph { min-height: 340px; }
  .uni-head { flex-wrap: wrap; }
  .head-search { width: 100%; order: 3; }
}
.mode-btn.picked { border-color: var(--c-accent); }
.active-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 10px; }
.af-label { font-size: 11.5px; color: var(--c-text-2); }
.af-chip {
  border: 1px solid var(--c-accent); background: var(--c-surface-2);
  color: var(--c-accent); border-radius: 9999px;
  padding: 3px 9px; font-size: 12px; cursor: pointer;
}
.af-clear { border: none; background: none; cursor: pointer; font-size: 12px; color: var(--c-text-2); }
</style>

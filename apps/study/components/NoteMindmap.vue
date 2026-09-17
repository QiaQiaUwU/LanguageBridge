<template>
  <!-- 思维导图：滚轮缩放、拖动平移、点分支名折叠；点单词跳到星图 -->
  <div
    ref="viewEl"
    class="mm-view"
    :class="{ grabbing: dragging }"
    @wheel.prevent="onWheel"
    @pointerdown="onDown"
  >
    <div
      class="mm"
      data-export-root
      :style="{ width: size.w + 'px', height: size.h + 'px', transform: `translate(${tx}px, ${ty}px) scale(${scale})` }"
    >
      <svg :width="size.w" :height="size.h" :viewBox="`0 0 ${size.w} ${size.h}`" class="mm-svg">
        <path v-for="e in edges" :key="e.id" :d="e.d" class="mm-edge" :class="`d${Math.min(e.depth, 4)}`" />
        <g
          v-for="n in placed"
          :key="n.id"
          :transform="`translate(${n.x},${n.y})`"
          class="mm-node"
          :class="[n.kind, `d${Math.min(n.depth, 4)}`, { folded: n.folded }]"
          @click="onNodeClick(n)"
        >
          <rect v-if="n.kind === 'morpheme' || n.depth === 0" :x="-6" :y="-15" :width="n.w + 12" height="24" rx="12" class="mm-box" />
          <text class="mm-label" x="0" y="2">{{ n.label }}</text>
          <text v-if="n.zh" class="mm-zh" :x="n.lw + 6" y="2">{{ n.zh }}</text>
          <text v-if="n.folded" class="mm-more" :x="n.w + 12" y="2">+{{ n.hidden }}</text>
          <line v-if="n.kind === 'word' && n.depth > 0" x1="0" :x2="n.lw" y1="7" y2="7" class="mm-under" />
          <text v-if="n.links" class="mm-link" :x="0" y="20">{{ n.links }}</text>
        </g>
      </svg>
    </div>

    <div class="mm-tools" data-export-hide @pointerdown.stop>
      <button class="ui-icon-btn sm" title="缩小" @click="zoomBy(1 / 1.2)"><i class="ri-subtract-line"></i></button>
      <span class="mm-pct">{{ Math.round(scale * 100) }}%</span>
      <button class="ui-icon-btn sm" title="放大" @click="zoomBy(1.2)"><i class="ri-add-line"></i></button>
      <button class="ui-icon-btn sm" title="适应" @click="fit"><i class="ri-focus-3-line"></i></button>
      <button class="ui-icon-btn sm" :title="allFolded ? '全部展开' : '全部折叠'" @click="toggleAll">
        <i :class="allFolded ? 'ri-node-tree' : 'ri-git-commit-line'"></i>
      </button>
      <button v-if="expandable" class="ui-icon-btn sm" title="全屏" @click="$emit('expand')"><i class="ri-fullscreen-line"></i></button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { FamilyNote, TreeNode } from '@/shared/core/wordFamily'

const props = defineProps<{ note: FamilyNote; showLow?: boolean; expandable?: boolean }>()
const emit = defineEmits<{ (e: 'pick', w: string): void; (e: 'expand'): void }>()

/* ---------- 折叠 ---------- */
const collapsed = ref(new Set<string>())
watch(() => props.note, () => { collapsed.value = new Set(); nextTick(fit) })
function toggleNode(id: string) {
  const s = new Set(collapsed.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  collapsed.value = s
}

/** 非拆解类笔记转成树：中心 → 分支 → 词 → 派生 */
const tree = computed<TreeNode>(() => {
  const n = props.note
  if (n.tree) return n.tree
  let seq = 0
  // 话题笔记的标题是整条路径，导图中心只放最后一段，避免中心框太长
  const hubLabel = n.hub.label.split(' · ').pop() || n.hub.label
  const root: TreeNode = { id: 'root', label: hubLabel, zh: n.kind === 'topic' ? '' : n.hub.sub, kind: 'morpheme', children: [] }
  for (const b of n.branches) {
    const words = b.words.filter(w => props.showLow || w.confidence >= 0.7 || w.added)
    if (!words.length) continue
    const bn: TreeNode = { id: `b${seq++}`, label: b.label, kind: 'morpheme', children: [] }
    for (const w of words) {
      bn.children.push({
        id: `w${seq++}`, label: w.word, zh: w.zh, kind: 'word',
        links: w.links.filter(l => l.kind === 'syn' || l.kind === 'ant'),
        children: w.derivs.map(d => ({ id: `d${seq++}`, label: d.word, zh: d.zh, kind: 'word' as const, children: [] }))
      })
    }
    root.children.push(n.branches.length === 1 ? bn.children as any : bn)
  }
  root.children = root.children.flat()
  for (const s of n.side) {
    root.children.push({
      id: `s${seq++}`, label: s.label, kind: 'morpheme',
      children: s.items.map(i => ({ id: `s${seq++}`, label: i.word, zh: i.zh, kind: 'word' as const, children: [] }))
    })
  }
  return root
})

interface Placed { id: string; label: string; zh?: string; kind: string; x: number; y: number; depth: number; w: number; lw: number; links?: string; folded?: boolean; hidden?: number; canFold?: boolean }

const countAll = (t: TreeNode): number => t.children.reduce((s, c) => s + 1 + countAll(c), 0)
/** 折叠后的可见树 */
const visibleTree = computed<TreeNode>(() => {
  const cut = (t: TreeNode): TreeNode => ({
    ...t,
    children: collapsed.value.has(t.id) ? [] : t.children.map(cut)
  })
  return cut(tree.value)
})
const allFolded = computed(() => tree.value.children.every(c => !c.children.length || collapsed.value.has(c.id)))
function toggleAll() {
  if (allFolded.value) { collapsed.value = new Set(); return }
  collapsed.value = new Set(tree.value.children.filter(c => c.children.length).map(c => c.id))
}
const findNode = (t: TreeNode, id: string): TreeNode | null => {
  if (t.id === id) return t
  for (const c of t.children) { const h = findNode(c, id); if (h) return h }
  return null
}

const ROW = 30
const textW = (s = '', cjk = false) => [...s].reduce((a, c) => a + (/[\u4e00-\u9fff]/.test(c) ? 13 : cjk ? 9 : 7.6), 0)

const layout = computed(() => {
  const placed: Placed[] = []
  const edges: { id: string; d: string; depth: number }[] = []
  const colW: number[] = []
  // 每层宽度取这一层最宽的节点
  const measure = (t: TreeNode, d: number) => {
    const w = textW(t.label) + (t.zh ? 6 + textW(t.zh) : 0)
    colW[d] = Math.max(colW[d] || 0, Math.min(w, 240))
    t.children.forEach(c => measure(c, d + 1))
  }
  measure(visibleTree.value, 0)
  const colX: number[] = [16]
  for (let d = 1; d < colW.length; d++) colX[d] = colX[d - 1] + colW[d - 1] + 56
  let row = 0
  const place = (t: TreeNode, d: number): number => {
    let y: number
    if (!t.children.length) {
      y = 24 + row * ROW + (t.links?.length ? 0 : 0)
      row += t.links?.length ? 1.5 : 1
    } else {
      const ys = t.children.map(c => place(c, d + 1))
      y = (ys[0] + ys[ys.length - 1]) / 2
    }
    const lw = textW(t.label)
    const zh = t.zh && t.zh.length > 14 ? t.zh.slice(0, 14) + '…' : t.zh
    const full = findNode(tree.value, t.id)
    const isFolded = collapsed.value.has(t.id) && !!full?.children.length
    placed.push({
      id: t.id, label: t.label, zh, kind: t.kind, x: colX[d], y, depth: d,
      w: lw + (zh ? 6 + textW(zh) : 0), lw,
      folded: isFolded, hidden: isFolded && full ? countAll(full) : 0, canFold: !!full?.children.length,
      links: t.links?.length ? t.links.map(l => `${l.kind === 'ant' ? '↔' : '≈'} ${l.word}`).join('  ') : undefined
    })
    return y
  }
  place(visibleTree.value, 0)
  const byId = new Map(placed.map(p => [p.id, p]))
  const link = (t: TreeNode) => {
    const a = byId.get(t.id)!
    for (const c of t.children) {
      const b = byId.get(c.id)!
      const x1 = a.x + Math.min(a.w, colW[a.depth]) + 10, y1 = a.y - 3
      const x2 = b.x - 8, y2 = b.y - 3
      const mx = (x1 + x2) / 2
      edges.push({ id: `${a.id}-${b.id}`, d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, depth: b.depth })
      link(c)
    }
  }
  link(visibleTree.value)
  const w = Math.max(...placed.map(p => p.x + p.w + (p.folded ? 40 : 0))) + 24
  const h = Math.max(...placed.map(p => p.y)) + 30
  return { placed, edges, size: { w, h } }
})
const placed = computed(() => layout.value.placed)
const edges = computed(() => layout.value.edges)
const size = computed(() => layout.value.size)

function onNodeClick(n: Placed) {
  if (moved) return
  // 单词：跳到星图；分支和词素：折叠 / 展开
  if (n.kind === 'word' && n.depth > 0 && !(n.canFold && n.folded)) { emit('pick', n.label); return }
  if (n.canFold && n.depth > 0) toggleNode(n.id)
}

/* ---------- 缩放与平移 ---------- */
const viewEl = ref<HTMLElement | null>(null)
const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
const dragging = ref(false)
let moved = false

function clampScale(v: number) { return Math.min(3, Math.max(0.2, v)) }

function zoomAt(factor: number, cx: number, cy: number) {
  const s0 = scale.value
  const s1 = clampScale(s0 * factor)
  // 以鼠标位置为中心缩放
  tx.value = cx - (cx - tx.value) * (s1 / s0)
  ty.value = cy - (cy - ty.value) * (s1 / s0)
  scale.value = s1
}
function zoomBy(f: number) {
  const r = viewEl.value?.getBoundingClientRect()
  zoomAt(f, (r?.width || 0) / 2, (r?.height || 0) / 2)
}
function onWheel(e: WheelEvent) {
  const r = viewEl.value!.getBoundingClientRect()
  zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top)
}
function onDown(e: PointerEvent) {
  if (e.button !== 0) return
  const sx = e.clientX, sy = e.clientY, ox = tx.value, oy = ty.value
  moved = false
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy
    if (!moved && Math.hypot(dx, dy) < 4) return
    moved = true
    dragging.value = true
    tx.value = ox + dx
    ty.value = oy + dy
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    dragging.value = false
    // click 事件在 pointerup 之后触发，稍后再清掉「拖动过」标记
    setTimeout(() => { moved = false }, 0)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up, { once: true })
}
function fit() {
  const v = viewEl.value
  if (!v) return
  const W = v.clientWidth, H = v.clientHeight
  if (!W || !H) return
  const s = clampScale(Math.min(1, (W - 24) / size.value.w, (H - 24) / size.value.h))
  scale.value = s
  tx.value = Math.max(12, (W - size.value.w * s) / 2)
  ty.value = Math.max(12, (H - size.value.h * s) / 2)
}
onMounted(() => nextTick(fit))
defineExpose({ fit })
</script>

<style scoped>
.mm-view {
  position: relative; width: 100%; height: 100%; min-height: 320px;
  overflow: hidden; cursor: grab; touch-action: none; background: var(--c-surface);
}
.mm-view.grabbing { cursor: grabbing; }
.mm { position: absolute; left: 0; top: 0; transform-origin: 0 0; background: var(--c-surface); }
.mm-tools {
  position: absolute; right: var(--space-xs); bottom: var(--space-xs);
  display: flex; align-items: center; gap: 2px; padding: 2px;
  border-radius: var(--radius-lg); background: var(--c-surface); box-shadow: var(--c-shadow-sm);
}
.mm-pct { min-width: 3em; text-align: center; font-size: var(--text-2xs); color: var(--c-text-3); }
.mm-more { font-size: 11px; fill: var(--c-accent); dominant-baseline: middle; }
.mm-node.morpheme, .mm-node.folded { cursor: pointer; }
.mm-svg { display: block; font-family: inherit; }
.mm-edge { fill: none; stroke-width: 1.4; stroke: var(--c-line); }
.mm-edge.d1 { stroke: var(--c-warn); }
.mm-edge.d2 { stroke: var(--c-note-purple); }
.mm-edge.d3 { stroke: var(--c-note-teal); }
.mm-edge.d4 { stroke: var(--c-text-3); }
.mm-node { cursor: default; }
.mm-node.word { cursor: pointer; }
.mm-label { font-size: 13px; fill: var(--c-text); dominant-baseline: middle; }
.mm-node.d0 .mm-label { font-size: 16px; font-weight: 700; }
.mm-node.morpheme .mm-label { font-weight: 700; fill: var(--c-note-orange-ink); }
.mm-node.d2.morpheme .mm-label { fill: var(--c-note-purple-ink); }
.mm-zh { font-size: 12px; fill: var(--c-text-2); dominant-baseline: middle; }
.mm-box { fill: color-mix(in srgb, var(--c-note-orange) 14%, var(--c-surface)); stroke: var(--c-note-orange); stroke-width: 1.2; }
.mm-node.d0 .mm-box { fill: color-mix(in srgb, var(--c-note-red) 12%, var(--c-surface)); stroke: var(--c-note-red); }
.mm-under { stroke: var(--c-accent); stroke-width: 1; opacity: .5; }
.mm-node.word:hover .mm-label { fill: var(--c-accent); }
.mm-link { font-size: 11px; fill: var(--c-info); dominant-baseline: middle; }
</style>

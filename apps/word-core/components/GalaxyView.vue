<template>
  <div class="galaxy-canvas-wrap">
    <canvas
      ref="canvasEl"
      class="galaxy-canvas"
      @mousemove="onMouseMove"
      @mouseleave="hoveredNode = null"
      @click="onClick"
      @wheel.prevent="onWheel"
      @mousedown="onDragStart"
    ></canvas>

    <!-- 悬浮提示：跟着鼠标走的小卡片，不遮挡内容 -->
    <div
      v-if="hoveredNode"
      class="hover-tip"
      :style="{ left: hoverPos.x + 12 + 'px', top: hoverPos.y + 12 + 'px' }"
    >
      <span class="hover-word">{{ hoveredNode.word }}</span>
      <span class="hover-rank" v-if="hoveredNode.rank">语义枢纽 #{{ hoveredNode.rank }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 星空图：把一组词按"语义中心性"渲染成可探索的星空。
 *
 * 视觉上追求截图里 VocabVerse 那种沉浸感（深色背景、发光节点、连线），但布局逻辑
 * 完全不同——原来的 3D 力导向图是纯随机初始化 + 无差别互斥（O(n²)暴力力导向，
 * 参见 backend_src/src/visualization.py 的 calculate_graph_layout），2000 个点全部
 * 同等大小、同等亮度，等于"好看的粒子云"，看不出任何学习意义。
 *
 * 这里的布局逻辑：
 *   1. 节点大小/亮度 = 中心性排名（rank 越靠前，星星越大越亮）——一眼看出"这是个
 *      重要的词"，对应论文里 betweenness/PageRank 排序思想
 *   2. 中心性 top 的词放在视觉中心，向外围递减——形成"由亮到暗、由中心向外围"的
 *      层次感，而不是均匀撒开的噪点
 *   3. 有真实关系数据（同根词/近义词/反义词）的词之间才连线，没有関係数据就不连
 *      （避免像原来那样把所有点无差别连成一团蜘蛛网）
 *
 * 用 Canvas 2D 而不是 Three.js/WebGL：这批数据量（几百到几千点）2D 足够流畅，
 * 不需要引入一整个 3D 渲染库的体积和复杂度，跟这个项目"能不装包就不装包"的
 * 既有风格一致。
 */
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'

export interface GalaxyNode {
  id: string
  word: string
  /** 排名越小越重要（1 = 最中心），没有排名信息的词传 null，会被放在外围、变暗变小 */
  rank: number | null
  /** 是否已经在词库里学习过/标注过（用不同色调区分"已收录"和"尚未收录"） */
  known?: boolean
}
export interface GalaxyEdge {
  source: string
  target: string
}

const props = defineProps<{
  nodes: GalaxyNode[]
  edges: GalaxyEdge[]
}>()
const emit = defineEmits<{ (e: 'select', word: string): void }>()

const canvasEl = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null
let animId = 0

interface SimNode extends GalaxyNode {
  x: number; y: number; vx: number; vy: number
  targetR: number // 目标半径（根据 rank 决定离中心多远，用于初始布局引导，不是硬约束）
  size: number
  brightness: number
}
let simNodes: SimNode[] = []
let simEdges: { a: SimNode; b: SimNode }[] = []

// 视图变换：缩放 + 平移（拖拽/滚轮），中心点始终是画布中心
const scale = ref(1)
const panX = ref(0)
const panY = ref(0)
let dragging = false
let dragStart = { x: 0, y: 0, panX: 0, panY: 0 }

const hoveredNode = ref<SimNode | null>(null)
const hoverPos = ref({ x: 0, y: 0 })

function buildSim() {
  const maxRank = props.nodes.reduce((m, n) => (n.rank ? Math.max(m, n.rank) : m), 1)
  simNodes = props.nodes.map((n, i) => {
    // rank 越小越靠中心；没有 rank 的词随机撒在外围
    const normRank = n.rank ? n.rank / maxRank : 1
    const targetR = 40 + normRank * 320
    const angle = (i / props.nodes.length) * Math.PI * 2 + Math.random() * 0.6
    return {
      ...n,
      x: Math.cos(angle) * targetR,
      y: Math.sin(angle) * targetR,
      vx: 0,
      vy: 0,
      targetR,
      size: n.rank ? Math.max(3, 11 - Math.log2(n.rank + 1)) : 2.5,
      brightness: n.rank ? Math.max(0.35, 1 - Math.log2(n.rank + 1) / 8) : 0.28
    }
  })
  const byId = new Map(simNodes.map(n => [n.id, n]))
  simEdges = props.edges
    .map(e => ({ a: byId.get(e.source), b: byId.get(e.target) }))
    .filter((e): e is { a: SimNode; b: SimNode } => !!e.a && !!e.b)
}

/** 极轻量的一次性力导向迭代：只用来把重叠的点稍微推开，不追求物理精确，
 *  因为初始位置已经按 rank 排好半径了，不需要像原来那样从纯随机开始暴力收敛。 */
function relax(iterations = 60) {
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < simNodes.length; i++) {
      for (let j = i + 1; j < simNodes.length; j++) {
        const a = simNodes[i], b = simNodes[j]
        const dx = b.x - a.x, dy = b.y - a.y
        const distSq = dx * dx + dy * dy
        const minDist = (a.size + b.size) * 3.2
        if (distSq < minDist * minDist && distSq > 0.01) {
          const dist = Math.sqrt(distSq)
          const push = (minDist - dist) / dist * 0.5
          a.x -= dx * push; a.y -= dy * push
          b.x += dx * push; b.y += dy * push
        }
      }
    }
    // 同时把每个点温和地拉回它的目标半径带，避免松弛力把布局完全打乱
    for (const n of simNodes) {
      const dist = Math.hypot(n.x, n.y) || 1
      const pull = (n.targetR - dist) * 0.02
      n.x += (n.x / dist) * pull
      n.y += (n.y / dist) * pull
    }
  }
}

function resize() {
  const c = canvasEl.value
  if (!c) return
  const wrap = c.parentElement!
  c.width = wrap.clientWidth * devicePixelRatio
  c.height = wrap.clientHeight * devicePixelRatio
  c.style.width = wrap.clientWidth + 'px'
  c.style.height = wrap.clientHeight + 'px'
}

function draw() {
  if (!ctx || !canvasEl.value) return
  const c = canvasEl.value
  const w = c.width, h = c.height
  const dpr = devicePixelRatio

  ctx.clearRect(0, 0, w, h)
  // 深色渐变背景，营造"星空"氛围
  const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7)
  grad.addColorStop(0, '#12172b')
  grad.addColorStop(1, '#05070f')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  ctx.save()
  ctx.translate(w / 2 + panX.value * dpr, h / 2 + panY.value * dpr)
  ctx.scale(scale.value * dpr, scale.value * dpr)

  // 连线：只画有真实关系数据的边，淡淡的，不抢节点风头
  ctx.strokeStyle = 'rgba(140, 160, 255, 0.15)'
  ctx.lineWidth = 1 / scale.value
  for (const e of simEdges) {
    ctx.beginPath()
    ctx.moveTo(e.a.x, e.a.y)
    ctx.lineTo(e.b.x, e.b.y)
    ctx.stroke()
  }

  // 节点：中心性越高越大越亮，悬浮的额外加光晕
  for (const n of simNodes) {
    const isHover = hoveredNode.value?.id === n.id
    const r = isHover ? n.size * 1.6 : n.size
    ctx.beginPath()
    const hue = n.known ? 200 : 265 // 已收录用蓝色系，未收录用紫色系区分
    ctx.fillStyle = `hsla(${hue}, 85%, ${55 + n.brightness * 25}%, ${0.55 + n.brightness * 0.45})`
    if (isHover) {
      ctx.shadowColor = `hsla(${hue}, 90%, 70%, 0.9)`
      ctx.shadowBlur = 18
    } else {
      ctx.shadowBlur = 0
    }
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function loop() {
  draw()
  animId = requestAnimationFrame(loop)
}

function screenToWorld(clientX: number, clientY: number) {
  const c = canvasEl.value!
  const rect = c.getBoundingClientRect()
  const dpr = devicePixelRatio
  const cx = (clientX - rect.left) * dpr
  const cy = (clientY - rect.top) * dpr
  const w = c.width, h = c.height
  return {
    x: (cx - w / 2 - panX.value * dpr) / (scale.value * dpr),
    y: (cy - h / 2 - panY.value * dpr) / (scale.value * dpr)
  }
}

function nodeAt(clientX: number, clientY: number): SimNode | null {
  const p = screenToWorld(clientX, clientY)
  let closest: SimNode | null = null
  let closestDist = Infinity
  for (const n of simNodes) {
    const d = Math.hypot(n.x - p.x, n.y - p.y)
    const hitR = Math.max(n.size * 2.5, 8 / scale.value)
    if (d < hitR && d < closestDist) {
      closest = n
      closestDist = d
    }
  }
  return closest
}

function onMouseMove(e: MouseEvent) {
  if (dragging) {
    panX.value = dragStart.panX + (e.clientX - dragStart.x)
    panY.value = dragStart.panY + (e.clientY - dragStart.y)
    return
  }
  const n = nodeAt(e.clientX, e.clientY)
  hoveredNode.value = n
  if (n) {
    const rect = canvasEl.value!.getBoundingClientRect()
    hoverPos.value = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
}
function onClick(e: MouseEvent) {
  const n = nodeAt(e.clientX, e.clientY)
  if (n) emit('select', n.word)
}
function onWheel(e: WheelEvent) {
  const delta = -e.deltaY * 0.001
  scale.value = Math.min(4, Math.max(0.25, scale.value * (1 + delta)))
}
function onDragStart(e: MouseEvent) {
  dragging = true
  dragStart = { x: e.clientX, y: e.clientY, panX: panX.value, panY: panY.value }
  const stop = () => { dragging = false; window.removeEventListener('mouseup', stop) }
  window.addEventListener('mouseup', stop)
}

onMounted(() => {
  ctx = canvasEl.value!.getContext('2d')
  resize()
  buildSim()
  relax()
  loop()
  window.addEventListener('resize', resize)
})
onUnmounted(() => {
  cancelAnimationFrame(animId)
  window.removeEventListener('resize', resize)
})
watch(() => [props.nodes, props.edges], async () => {
  await nextTick()
  buildSim()
  relax()
}, { deep: false })
</script>

<style scoped>
.galaxy-canvas-wrap {
  position: relative;
  width: 100%;
  height: 100%;
}
.galaxy-canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
}
.galaxy-canvas:active { cursor: grabbing; }
.hover-tip {
  position: absolute;
  pointer-events: none;
  background: rgba(10, 14, 28, 0.92);
  border: 1px solid rgba(140, 160, 255, 0.35);
  border-radius: 8px;
  padding: 6px 12px;
  color: #e8ecff;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  backdrop-filter: blur(4px);
  z-index: 10;
}
.hover-word { font-weight: 600; }
.hover-rank { font-size: 11px; color: #9fb0ff; }
</style>

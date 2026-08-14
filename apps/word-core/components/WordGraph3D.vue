<template>
  <div class="graph-shell">
    <div ref="containerEl" class="force-graph-canvas"></div>
    <div v-if="loading" class="graph-loading">
      <span class="spinner"></span>正在算布局…
    </div>
    <div v-if="drillLevel > 0" class="drill-bar">
      <button class="drill-back" @click="drillOut">‹ 返回</button>
      <span class="drill-crumb">
        <button class="crumb-item" @click="drillTo(0)">全部</button>
        <span class="crumb-sep">›</span>
        <button class="crumb-item" :class="{ cur: drillLevel === 1 }" @click="drillTo(1)">{{ drillSuper }}</button>
        <template v-if="drillLevel >= 2">
          <span class="crumb-sep">›</span>
          <button class="crumb-item" :class="{ cur: drillLevel === 2 }" @click="drillTo(2)">{{ drillCloud }}</button>
        </template>
        <template v-if="drillLevel >= 3">
          <span class="crumb-sep">›</span>
          <button class="crumb-item cur">{{ drillClusterLabel }}</button>
        </template>
      </span>
    </div>
    <div v-if="hoverText" class="cluster-tip" :class="{ 'below-crumb': drillLevel > 0 }">{{ hoverText }}</div>
    <div v-if="lastDiag.incoming > 0 && lastDiag.drawn !== lastDiag.incoming" class="graph-diag">
      关系 {{ lastDiag.incoming }} 条 → 筛减后 {{ lastDiag.afterThin }} 条 → 交给引擎 {{ lastDiag.drawn }} 条
      <span v-if="lastDiag.backedOff">（按当前连线密度会筛成 0 条，已退回显示全部）</span>
      <span v-if="lastDiag.cleaned">（引擎拒绝过一次，清洗后重试）</span>
      <span v-if="lastDiag.bad.length" class="diag-bad">｜对不上的：{{ lastDiag.bad[0] }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph'
import * as THREE from 'three'
import { RELATION_COLORS, RELATION_LABELS, type RelationType } from './graphColors'
import { sourceColorsOf, sourceColor, relationColor, onColorChange } from '@/shared/core/graphColorSettings'
import { useThemeStore } from '@/shared/stores/themeStore'

export interface GraphNode {
  id: string
  word: string
  definitionZh?: string
  sources?: string[]
  forceColor?: string
  clusterOf?: string
  isCenter?: boolean
  cloud?: string
  superCloud?: string
}
export interface GraphLink {
  source: string
  target: string
  type: RelationType
  difference?: string
  weight?: number
  bridge?: boolean
}

const props = withDefaults(defineProps<{
  nodes: GraphNode[]
  links: GraphLink[]
  showLinks?: boolean
  background?: string
  clickMode?: 'none' | 'select'
  minLinkWeight?: number
  maxLinksPerNode?: number
  nodeStyle?: 'glass' | 'planet'
  clusterInfo?: Record<string, string>
  loading?: boolean
}>(), {
  showLinks: true,
  clickMode: 'select',
  minLinkWeight: 0,
  maxLinksPerNode: 0,
  nodeStyle: 'glass'
})
const emit = defineEmits<{
  (e: 'select', word: string): void
  (e: 'drill', d: { level: number; superCloud: string; cloud: string }): void
  (e: 'stats', s: { nodes: number; links: number }): void
}>()

const themeStore = useThemeStore()
const containerEl = ref<HTMLDivElement | null>(null)
let graph: ForceGraph3DInstance | null = null

interface PerfSettings {
  nodeRelSize: number
  linkWidth: number
  particleSpeed: number
  warmupTicks: number
  cooldownTicks: number
  enableNodeDrag: boolean
  useCustomNodes: boolean
}

function getPerformanceSettings(nodeCount: number): PerfSettings {
  if (nodeCount > 5000) {
    return { nodeRelSize: 2.5, linkWidth: 0.2, particleSpeed: 0, warmupTicks: 40, cooldownTicks: 40, enableNodeDrag: false, useCustomNodes: false }
  } else if (nodeCount > 1000) {
    return { nodeRelSize: 4, linkWidth: 0.3, particleSpeed: 0, warmupTicks: 90, cooldownTicks: 90, enableNodeDrag: false, useCustomNodes: false }
  } else if (nodeCount > 500) {
    return { nodeRelSize: 5.5, linkWidth: 0.5, particleSpeed: 0.001, warmupTicks: 100, cooldownTicks: 100, enableNodeDrag: false, useCustomNodes: true }
  } else if (nodeCount > 200) {
    return { nodeRelSize: 6.5, linkWidth: 1, particleSpeed: 0.002, warmupTicks: 100, cooldownTicks: 100, enableNodeDrag: true, useCustomNodes: true }
  }
  return { nodeRelSize: 8, linkWidth: 1.5, particleSpeed: 0.003, warmupTicks: 200, cooldownTicks: 200, enableNodeDrag: true, useCustomNodes: true }
}

const starTextureCache = new Map<string, THREE.Texture>()
function getStarTexture(color: string): THREE.Texture {
  const cached = starTextureCache.get(color)
  if (cached) return cached
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const c = size / 2
  const g = ctx.createRadialGradient(c, c, 0, c, c, c)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(0.06, color)
  g.addColorStop(0.3, color + '99')
  g.addColorStop(0.65, color + '2a')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)

  const tex = new THREE.CanvasTexture(canvas)
  starTextureCache.set(color, tex)
  return tex
}

const envMapCache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>()
function getEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture | null {
  const cached = envMapCache.get(renderer)
  if (cached) return cached
  try {
    const w = 256, h = 128
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')!
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, '#dfe8ff')   // 天顶：冷白
    g.addColorStop(0.32, '#8fa4c8')
    g.addColorStop(0.5, '#5d6b8c')
    g.addColorStop(0.72, '#232a42')
    g.addColorStop(1, '#0a0d18')   // 底：接近深空底色
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    const band = ctx.createLinearGradient(0, h * 0.3, 0, h * 0.52)
    band.addColorStop(0, 'rgba(255,255,255,0)')
    band.addColorStop(0.5, 'rgba(255,246,230,0.55)')
    band.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = band
    ctx.fillRect(0, h * 0.3, w, h * 0.22)

    const src = new THREE.CanvasTexture(canvas)
    src.mapping = THREE.EquirectangularReflectionMapping
    src.colorSpace = THREE.SRGBColorSpace
    const pmrem = new THREE.PMREMGenerator(renderer)
    pmrem.compileEquirectangularShader()
    const tex = pmrem.fromEquirectangular(src).texture
    pmrem.dispose()
    src.dispose()
    envMapCache.set(renderer, tex)
    return tex
  } catch (e) {
    console.warn('[词汇宇宙] 环境贴图生成失败，节点退回无反射材质：', e)
    return null
  }
}
let sceneEnv: THREE.Texture | null = null
let sceneEnvKey = 'none'

const planetTextureCache = new Map<string, THREE.Texture>()
function getPlanetTexture(color: string): THREE.Texture {
  const cached = planetTextureCache.get(color)
  if (cached) return cached
  const w = 128, h = 64
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')!
  const base = new THREE.Color(color)
  ctx.fillStyle = `#${base.getHexString()}`
  ctx.fillRect(0, 0, w, h)

  let seed = 0
  for (let i = 0; i < color.length; i++) seed = (seed * 31 + color.charCodeAt(i)) >>> 0
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }

  const dark = base.clone().multiplyScalar(0.72)
  const light = base.clone().lerp(new THREE.Color('#ffffff'), 0.28)

  const bands = 2 + Math.floor(rnd() * 2)
  for (let i = 0; i < bands; i++) {
    const y = rnd() * h
    const bh = 4 + rnd() * 9
    ctx.fillStyle = `#${(rnd() > 0.5 ? light : dark).getHexString()}`
    ctx.globalAlpha = 0.5
    ctx.fillRect(0, y, w, bh)
  }
  ctx.globalAlpha = 0.55
  const spots = 4 + Math.floor(rnd() * 4)
  for (let i = 0; i < spots; i++) {
    ctx.beginPath()
    ctx.arc(rnd() * w, rnd() * h, 3 + rnd() * 8, 0, Math.PI * 2)
    ctx.fillStyle = `#${(rnd() > 0.45 ? dark : light).getHexString()}`
    ctx.fill()
  }
  ctx.globalAlpha = 1

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  planetTextureCache.set(color, tex)
  return tex
}

function starGeometry(r: number): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  const inner = r * 0.42
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : inner
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const x = Math.cos(a) * rad
    const y = Math.sin(a) * rad
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: r * 0.22,
    bevelEnabled: true,
    bevelThickness: r * 0.06,
    bevelSize: r * 0.05,
    bevelSegments: 2,
    curveSegments: 1
  })
  g.center()
  return g
}

function createStarNode(
  color: string,
  size: number,
  style: 'glass' | 'planet' = 'glass',
  env: THREE.Texture | null = null,
  center = false
): THREE.Group {
  const group = new THREE.Group()

  const coreMat = style === 'planet'
    ? new THREE.MeshLambertMaterial({
        map: getPlanetTexture(color),
        emissive: new THREE.Color(color).multiplyScalar(0.35)
      })
    : new THREE.MeshStandardMaterial({
        color,
        roughness: 0.42,
        metalness: 0.0,
        envMap: env || undefined,
        envMapIntensity: env ? 0.55 : 0,
        emissive: new THREE.Color(color).multiplyScalar(0.42),
        transparent: true,
        opacity: 0.96
      })

  const core = new THREE.Mesh(new THREE.SphereGeometry(size * 0.68, 20, 16), coreMat)
  group.add(core)

  if (style === 'glass') {
    const rim = new THREE.Mesh(
      new THREE.SphereGeometry(size * 0.78, 20, 16),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.3),
        transparent: true,
        opacity: 0.18,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    group.add(rim)
  }

  const mat = new THREE.SpriteMaterial({
    map: getStarTexture(color),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: style === 'planet' ? 0.3 : 0.32
  })
  const halo = new THREE.Sprite(mat)
  const s = size * (center ? 4.2 : 2.4)
  halo.scale.set(s, s, 1)
  group.add(halo)

  if (center) {
    const star = new THREE.Mesh(starGeometry(size * 2.1), new THREE.MeshStandardMaterial({
      color: 0xffc94d,
      emissive: new THREE.Color(0xffb320),
      emissiveIntensity: 1.5,
      roughness: 0.28,
      metalness: 0.6
    }))
    star.rotation.z = 0.12
    group.add(star)

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getStarTexture('#ffd76a'),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.75
    }))
    const gs = size * 7
    glow.scale.set(gs, gs, 1)
    group.add(glow)
  }

  return group
}

function createRingedNode(
  colors: string[],
  size = 5,
  style: 'glass' | 'planet' = 'glass',
  env: THREE.Texture | null = null
): THREE.Group {
  if (!colors || colors.length === 0) colors = [sourceColor('default')]
  const group = createStarNode(colors[0], size, style, env)
  for (let i = 1; i < colors.length && i < 4; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(size * (0.95 + i * 0.16), size * 0.075, 8, 40),
      new THREE.MeshLambertMaterial({
        color: colors[i],
        emissive: new THREE.Color(colors[i]).multiplyScalar(0.3),
        transparent: true,
        opacity: 0.85
      })
    )
    ring.rotation.x = Math.PI / 2 + (i - 1) * 0.3
    ring.rotation.y = (i - 1) * 0.5
    group.add(ring)
  }
  return group
}

let thinTrace = { incoming: 0, afterThin: 0, backedOff: false }

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return hex
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function buildGraphData() {
  let links: GraphLink[] = props.showLinks ? props.links.slice() : []

  const LINK_CAP = props.nodes.length > 5000 ? 2500 : props.nodes.length > 2000 ? 8000 : 0
  if (LINK_CAP && links.length > LINK_CAP) {
    links = [...links].sort((a, b) => (b.weight ?? 0.5) - (a.weight ?? 0.5)).slice(0, LINK_CAP)
  }

  const beforeThin = links.length
  const minW = props.minLinkWeight ?? 0
  if (minW > 0) links = links.filter(l => (l.weight ?? 0.5) >= minW)

  const cap = props.maxLinksPerNode ?? 0
  if (cap > 0 && links.length) {
    const sorted = [...links].sort((a, b) => (b.weight ?? 0.5) - (a.weight ?? 0.5))
    const deg = new Map<string, number>()
    const kept: typeof links = []
    for (const l of sorted) {
      const ds = deg.get(l.source) || 0
      const dt = deg.get(l.target) || 0
      if (ds >= cap || dt >= cap) continue
      deg.set(l.source, ds + 1)
      deg.set(l.target, dt + 1)
      kept.push(l)
    }
    links = kept
  }
  let thinBackedOff = false
  if (beforeThin > 0 && links.length === 0) {
    links = props.showLinks ? props.links.slice() : []
    thinBackedOff = links.length > 0
  }
  thinTrace = { incoming: props.links.length, afterThin: links.length, backedOff: thinBackedOff }
  if (links.length !== beforeThin) {
    console.info(`[词汇宇宙] 连线筛减：${beforeThin} → ${links.length}${thinBackedOff ? '（筛没了，已退回不筛）' : ''}`)
  }

  const degree = new Map<string, number>()
  const famDegree = new Map<string, number>()
  for (const l of links) {
    if (l.type === 'synonym' || l.type === 'antonym') {
      degree.set(l.source, (degree.get(l.source) || 0) + 1)
      degree.set(l.target, (degree.get(l.target) || 0) + 1)
    } else {
      famDegree.set(l.source, (famDegree.get(l.source) || 0) + 1)
      famDegree.set(l.target, (famDegree.get(l.target) || 0) + 1)
    }
  }

  return {
    nodes: props.nodes.map(n => {
      const colors = n.forceColor ? [n.forceColor] : sourceColorsOf(n.sources)
      return {
        ...n,
        val: Math.max(1, 1 + (degree.get(n.id) || 0) + (famDegree.get(n.id) || 0) * 0.8),
        color: colors[0],
        sourceColors: colors,
        isMultiSource: colors.length > 1
      }
    }),
    links: links.map(l => ({
      ...l,
      color: relationColor(l.type)
    }))
  }
}

const nodeObjs = new Map<string, THREE.Group>()
const hoverCloud = ref('')
const hoverText = computed(() => {
  const info = (hoverGroup.value && props.clusterInfo?.[hoverGroup.value]) || ''
  if (hoverCloud.value) return info ? `【${hoverCloud.value}】\n${info}` : `【${hoverCloud.value}】`
  return info
})

function makeNodeColor() {
  const hl = hoverGroup.value
  return (n: any) => {
    const base = n.color || sourceColor('default')
    if (!inDrillScope(n)) return withAlpha(base, 0.03)
    if (!hl) return base
    return groupKeyOf(n) === hl ? lighten(base, 0.35) : withAlpha(base, 0.05)
  }
}

function lighten(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  let h = m[1]
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const num = parseInt(h, 16)
  const mix = (c: number) => Math.round(c + (255 - c) * k)
  return `rgb(${mix((num >> 16) & 255)}, ${mix((num >> 8) & 255)}, ${mix(num & 255)})`
}

function makeNodeVal() {
  const hl = hoverGroup.value
  return (n: any) => {
    const base = n.val ?? 1
    if (!inDrillScope(n)) return base * 0.3
    if (!hl) return base
    return groupKeyOf(n) === hl ? base * 3.2 : base * 0.45
  }
}

function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  let h = m[1]
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const num = parseInt(h, 16)
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${a})`
}

function makeLinkColor() {
  const hl = hoverGroup.value
  return (l: any) => {
    const c = l.color || '#cccccc'
    let a = l.bridge ? 0.18
      : l.type === 'word_family' ? 0.85
      : l.type === 'morphology' ? 0.8
      : l.type === 'synonym' ? 0.55
      : 0.3
    if (hl) {
      const sc = typeof l.source === 'object' ? groupKeyOf(l.source) : ''
      const tc = typeof l.target === 'object' ? groupKeyOf(l.target) : ''
      const inCluster = sc === hl && tc === hl
      a = inCluster ? Math.min(1, a * 1.6) : a * 0.15
    }
    return hexToRgba(c, a)
  }
}

const drillLevel = ref(0)
const drillSuper = ref('')
const drillCloud = ref('')
const drillCluster = ref('')
const drillClusterLabel = ref('')

function inDrillScope(n: any): boolean {
  if (drillLevel.value === 0) return true
  if ((n.superCloud || '未分类') !== drillSuper.value) return false
  if (drillLevel.value === 1) return true
  if ((n.cloud || '未分类') !== drillCloud.value) return false
  if (drillLevel.value === 2) return true
  return (n.clusterOf || n.id) === drillCluster.value
}

function groupKeyOf(n: any): string {
  if (drillLevel.value === 0) return n.superCloud || '未分类'
  if (drillLevel.value === 1) return n.cloud || '未分类'
  if (drillLevel.value === 2) return n.clusterOf || n.id
  return n.id
}

const HALO_HUES = [205, 275, 340, 25, 95, 160, 240, 310, 55, 130]

let haloTexture: THREE.Texture | null = null
function getHaloTexture(): THREE.Texture {
  if (haloTexture) return haloTexture
  const size = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0.0, 'rgba(255,255,255,0.95)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.16)')
  g.addColorStop(1.0, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  haloTexture = new THREE.CanvasTexture(cv)
  return haloTexture
}

interface Halo { key: string; sprite: THREE.Sprite; target: number }
let halos: Halo[] = []
let haloGroup: THREE.Group | null = null

function clearHalos() {
  if (haloGroup && graph) graph.scene().remove(haloGroup)
  for (const h of halos) (h.sprite.material as THREE.SpriteMaterial).dispose()
  halos = []
  haloGroup = null
}

function rebuildHalos() {
  if (!graph) return
  clearHalos()
  const data: any = graph.graphData()
  const ns: any[] = (data?.nodes || []).filter((n: any) => Number.isFinite(n.x))
  if (!ns.length) return

  const acc = new Map<string, { x: number; y: number; z: number; n: number; pts: any[] }>()
  for (const n of ns) {
    if (!inDrillScope(n)) continue
    const k = groupKeyOf(n)
    let g = acc.get(k)
    if (!g) { g = { x: 0, y: 0, z: 0, n: 0, pts: [] }; acc.set(k, g) }
    g.x += n.x; g.y += n.y; g.z += n.z || 0; g.n++
    if (g.pts.length < 600) g.pts.push(n)
  }
  if (acc.size > 60) return

  haloGroup = new THREE.Group()
  const keys = [...acc.keys()].sort()
  keys.forEach((key, i) => {
    const g = acc.get(key)!
    const cx = g.x / g.n, cy = g.y / g.n, cz = g.z / g.n
    const ds = g.pts.map(p => Math.hypot(p.x - cx, p.y - cy, (p.z || 0) - cz)).sort((a, b) => a - b)
    const r = (ds[Math.floor(ds.length * 0.85)] || 60) * 2.6

    const mat = new THREE.SpriteMaterial({
      map: getHaloTexture(),
      color: new THREE.Color(`hsl(${HALO_HUES[i % HALO_HUES.length]}, 72%, 60%)`),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false
    })
    const sprite = new THREE.Sprite(mat)
    sprite.position.set(cx, cy, cz)
    sprite.scale.set(r, r, 1)
    sprite.renderOrder = -1
    haloGroup!.add(sprite)
    halos.push({ key, sprite, target: 0 })
  })
  graph.scene().add(haloGroup)
}

let haloRaf = 0
function animateHalos() {
  haloRaf = requestAnimationFrame(animateHalos)
  let moving = false
  for (const h of halos) {
    const mat = h.sprite.material as THREE.SpriteMaterial
    const diff = h.target - mat.opacity
    if (Math.abs(diff) > 0.004) {
      mat.opacity += diff * 0.18
      moving = true
    } else if (mat.opacity !== h.target) {
      mat.opacity = h.target
    }
  }
  if (moving) { /* three renders on its own loop */ }
}

function setHaloTargets(activeKey: string) {
  for (const h of halos) h.target = h.key === activeKey ? 0.55 : (activeKey ? 0.05 : 0.12)
}

/** 节点坐标长期缓存。切到某个词的关系网再退回来时，全景图直接摆回原位。 */
const posCache = new Map<string, { x: number; y: number; z: number }>()

let groupScreen: Array<{ key: string; x: number; y: number; r: number }> = []
let groupScreenDirty = true

function rebuildGroupScreen() {
  groupScreen = []
  groupScreenDirty = false
  if (!graph || !containerEl.value) return
  const data: any = graph.graphData()
  const ns: any[] = data?.nodes || []
  if (!ns.length) return

  const acc = new Map<string, { sx: number; sy: number; n: number; pts: Array<[number, number]> }>()
  for (const n of ns) {
    if (!Number.isFinite(n.x) || !inDrillScope(n)) continue
    const p = graph.graph2ScreenCoords(n.x, n.y, n.z || 0)
    if (!p || !Number.isFinite(p.x)) continue
    const k = groupKeyOf(n)
    let g = acc.get(k)
    if (!g) { g = { sx: 0, sy: 0, n: 0, pts: [] }; acc.set(k, g) }
    g.sx += p.x; g.sy += p.y; g.n++
    if (g.pts.length < 400) g.pts.push([p.x, p.y])
  }
  for (const [key, g] of acc) {
    const x = g.sx / g.n
    const y = g.sy / g.n
    const ds = g.pts.map(([px, py]) => Math.hypot(px - x, py - y)).sort((a, b) => a - b)
    const r = ds[Math.floor(ds.length * 0.8)] || 30
    groupScreen.push({ key, x, y, r: Math.max(r, 24) })
  }
}

function onCanvasClick(e: MouseEvent) {
  if (!hoverGroup.value) return
  const data: any = graph?.graphData()
  const ns: any[] = data?.nodes || []
  const hit = ns.find(n => inDrillScope(n) && groupKeyOf(n) === hoverGroup.value)
  if (!hit) return
  e.stopPropagation()
  // 钻不下去了（这一团只剩一个词）就当成选词
  if (drillInto(hit) === false && props.clickMode !== 'none') emit('select', hit.word)
}

function onCanvasPointerMove(e: PointerEvent) {
  if (!containerEl.value) return
  if (groupScreenDirty) rebuildGroupScreen()
  if (!groupScreen.length) return
  const rect = containerEl.value.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  let best = ''
  let bestD = Infinity
  for (const g of groupScreen) {
    const d = Math.hypot(g.x - mx, g.y - my)
    if (d < g.r * 1.15 && d < bestD) { bestD = d; best = g.key }
  }
  setHoverGroup(best)
  hoverCloud.value = best
}

const hoverGroup = ref('')

function centroidOf(pred: (n: any) => boolean) {
  const data: any = graph?.graphData()
  const ns: any[] = (data?.nodes || []).filter((n: any) => pred(n) && Number.isFinite(n.x))
  if (!ns.length) return null
  let x = 0, y = 0, z = 0, r = 0
  for (const n of ns) { x += n.x / ns.length; y += n.y / ns.length; z += (n.z || 0) / ns.length }
  for (const n of ns) r = Math.max(r, Math.hypot(n.x - x, n.y - y, (n.z || 0) - z))
  return { x, y, z, r: Math.max(r, 40), count: ns.length }
}

function flyTo(c: { x: number; y: number; z: number; r: number }, ms = 900) {
  if (!graph) return
  const cam = graph.camera() as THREE.PerspectiveCamera
  const vFov = ((cam.fov || 50) * Math.PI) / 180
  const dist = (c.r * 1.9) / Math.tan(vFov / 2)
  let dx = cam.position.x - c.x, dy = cam.position.y - c.y, dz = cam.position.z - c.z
  let len = Math.hypot(dx, dy, dz)
  if (!Number.isFinite(len) || len < 1e-6) { dx = 0; dy = 0; dz = 1; len = 1 }
  const k = dist / len
  graph.cameraPosition(
    { x: c.x + dx * k, y: c.y + dy * k, z: c.z + dz * k },
    { x: c.x, y: c.y, z: c.z },
    ms
  )
}

let repaintQueued = false
function repaintHighlight() {
  if (repaintQueued || !graph) return
  repaintQueued = true
  requestAnimationFrame(() => {
    repaintQueued = false
    if (!graph) return
    graph.nodeColor(makeNodeColor())
    graph.nodeVal(makeNodeVal())
    graph.linkColor(makeLinkColor())
  })
}

function markGroupScreenDirty() { groupScreenDirty = true }

function setHoverGroup(key: string) {
  if (hoverGroup.value === key) return
  hoverGroup.value = key
  setHaloTargets(key)
  repaintHighlight()
}

/** 这一级里这一团有几个节点。只剩一个就没必要再往下钻，点它就是选词。 */
function groupSize(n: any): number {
  const data: any = graph?.graphData()
  const key = groupKeyOf(n)
  let c = 0
  for (const x of (data?.nodes || [])) if (inDrillScope(x) && groupKeyOf(x) === key) c++
  return c
}

function drillInto(n: any) {
  if (groupSize(n) <= 1) return false
  if (fitTimer) { clearTimeout(fitTimer); fitTimer = null }
  if (settleTimer) { clearTimeout(settleTimer); settleTimer = null }
  if (drillLevel.value === 0) {
    drillSuper.value = n.superCloud || '未分类'
    drillLevel.value = 1
    const c = centroidOf(x => (x.superCloud || '未分类') === drillSuper.value)
    if (c) flyTo(c)
  } else if (drillLevel.value === 1) {
    drillCloud.value = n.cloud || '未分类'
    drillLevel.value = 2
    const c = centroidOf(x => (x.superCloud || '未分类') === drillSuper.value && (x.cloud || '未分类') === drillCloud.value)
    if (c) flyTo(c)
  } else if (drillLevel.value === 2) {
    drillCluster.value = n.clusterOf || n.id
    const data: any = graph?.graphData()
    const core = (data?.nodes || []).find((x: any) => x.id === drillCluster.value)
    drillClusterLabel.value = core?.word || drillCluster.value
    drillLevel.value = 3
    const c = centroidOf(x => (x.clusterOf || x.id) === drillCluster.value)
    if (c) flyTo(c)
  } else {
    return false
  }
  hoverGroup.value = ''
  hoverCloud.value = ''
  rebuildGroupScreen()
  rebuildHalos()
  setHaloTargets('')
  repaintHighlight()
  emit('drill', { level: drillLevel.value, superCloud: drillSuper.value, cloud: drillCloud.value })
  return true
}

function drillTo(level: number) {
  if (fitTimer) { clearTimeout(fitTimer); fitTimer = null }
  if (settleTimer) { clearTimeout(settleTimer); settleTimer = null }
  if (level >= drillLevel.value) return
  drillLevel.value = level
  if (level < 3) { drillCluster.value = ''; drillClusterLabel.value = '' }
  if (level < 2) drillCloud.value = ''
  if (level < 1) drillSuper.value = ''

  let c: ReturnType<typeof centroidOf> = null
  if (level === 2) c = centroidOf(x => (x.superCloud || '未分类') === drillSuper.value && (x.cloud || '未分类') === drillCloud.value)
  else if (level === 1) c = centroidOf(x => (x.superCloud || '未分类') === drillSuper.value)
  if (level === 0) fitView(900)
  else if (c) flyTo(c)

  hoverGroup.value = ''
  hoverCloud.value = ''
  rebuildGroupScreen()
  rebuildHalos()
  setHaloTargets('')
  repaintHighlight()
  emit('drill', { level: drillLevel.value, superCloud: drillSuper.value, cloud: drillCloud.value })
}

function drillOut() {
  drillTo(Math.max(0, drillLevel.value - 1))
}
/** 把当前钻取位置整个存下来 / 还原回去。
 *  搜一个词会把图换成那一个词的关系网，退出时要能回到搜之前那一层，
 *  而不是被打回全景 —— 全景和那一层之间的路径是用户自己一层层点下来的。 */
function captureDrill() {
  return {
    level: drillLevel.value,
    superCloud: drillSuper.value,
    cloud: drillCloud.value,
    cluster: drillCluster.value,
    clusterLabel: drillClusterLabel.value
  }
}

function restoreDrill(st: ReturnType<typeof captureDrill> | null) {
  if (!st) return
  drillLevel.value = st.level
  drillSuper.value = st.superCloud
  drillCloud.value = st.cloud
  drillCluster.value = st.cluster
  drillClusterLabel.value = st.clusterLabel
  hoverGroup.value = ''
  hoverCloud.value = ''
  nextTick(() => {
    rebuildGroupScreen()
    rebuildHalos()
    setHaloTargets('')
    repaintHighlight()
    if (st.level === 0) { fitView(600); return }
    let c: ReturnType<typeof centroidOf> = null
    if (st.level >= 3) c = centroidOf(x => (x.clusterOf || x.id) === st.cluster)
    else if (st.level === 2) c = centroidOf(x => (x.superCloud || '未分类') === st.superCloud && (x.cloud || '未分类') === st.cloud)
    else c = centroidOf(x => (x.superCloud || '未分类') === st.superCloud)
    if (c) flyTo(c, 600)
    else fitView(600)
  })
}

defineExpose({ drillOut, drillTo, captureDrill, restoreDrill })

function makeCloudForce() {
  let nodes: any[] = []
  const anchors = new Map<string, { x: number; y: number; z: number }>()

  const SEP = '\u0001'
  const GOLDEN = Math.PI * (3 - Math.sqrt(5))

  type Vec = { x: number; y: number; z: number }

  function place(keys: string[], rad: number, base: Vec, key: (k: string) => string): number {
    keys.sort() // stable order so the same data lands in the same place every time
    const m = keys.length
    if (m === 1) {
      anchors.set(key(keys[0]), { x: base.x, y: base.y, z: base.z })
      return rad
    }
    const pts: Vec[] = []
    keys.forEach((k, i) => {
      const y = 1 - (i / (m - 1)) * 2
      const rr = Math.sqrt(Math.max(0, 1 - y * y))
      const th = GOLDEN * i
      const p = {
        x: base.x + Math.cos(th) * rr * rad,
        y: base.y + y * rad,
        z: base.z + Math.sin(th) * rr * rad
      }
      pts.push(p)
      anchors.set(key(k), p)
    })
    let min = Infinity
    for (let a = 0; a < pts.length; a++) {
      for (let b = a + 1; b < pts.length; b++) {
        const d = Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y, pts[a].z - pts[b].z)
        if (d < min) min = d
      }
    }
    return Number.isFinite(min) ? min : rad
  }

  const INNER = 0.30

  function rebuild() {
    anchors.clear()
    if (!nodes.length) return

    const supers: string[] = []
    const seenSuper = new Set<string>()
    const cloudsBySuper = new Map<string, Set<string>>()
    const clustersByCloud = new Map<string, Set<string>>()

    for (const n of nodes) {
      const cloud = n.cloud || ''
      if (!cloud) continue
      const sup = n.superCloud || '未分类'
      if (!seenSuper.has(sup)) { seenSuper.add(sup); supers.push(sup) }

      let cs = cloudsBySuper.get(sup)
      if (!cs) { cs = new Set(); cloudsBySuper.set(sup, cs) }
      cs.add(cloud)

      const ck = sup + SEP + cloud
      let ks = clustersByCloud.get(ck)
      if (!ks) { ks = new Set(); clustersByCloud.set(ck, ks) }
      ks.add(n.clusterOf || n.id)
    }
    if (!supers.length) return

    const R = Math.max(260, Math.cbrt(Math.max(1, nodes.length)) * 145)

    const gap1 = place(supers, R, { x: 0, y: 0, z: 0 }, k => k)

    for (const [sup, cloudSet] of cloudsBySuper) {
      const base = anchors.get(sup)
      if (!base) continue
      const gap2 = place([...cloudSet], gap1 * INNER, base, c => sup + SEP + c)
      for (const cloud of cloudSet) {
        const ck = sup + SEP + cloud
        const keys = clustersByCloud.get(ck)
        const cbase = anchors.get(ck)
        if (!keys || !cbase) continue
        place([...keys], gap2 * INNER, cbase, k => ck + SEP + k)
      }
    }
  }

  const force = (alpha: number) => {
    for (const n of nodes) {
      const cloud = n.cloud
      if (!cloud) continue
      const sup = n.superCloud || '未分类'
      const ck = sup + SEP + cloud
      const a =
        anchors.get(ck + SEP + (n.clusterOf || n.id)) ||
        anchors.get(ck) ||
        anchors.get(sup)
      if (!a) continue
      const k = 0.12 * alpha
      n.vx += (a.x - n.x) * k
      n.vy += (a.y - n.y) * k
      n.vz += (a.z - n.z) * k
    }
  }
  ;(force as any).initialize = (ns: any[]) => { nodes = ns; rebuild() }
  return force
}

function ensureCloudForce() {
  if (!graph) return
  const g: any = graph as any
  if (typeof g.d3Force !== 'function') return
  const anyCloud = props.nodes.some(n => n.cloud)
  if (anyCloud) {
    g.d3Force('cloud', makeCloudForce())
    g.d3Force('center', null)
  } else {
    g.d3Force('cloud', null)
  }
}

function applyConfig() {
  if (!graph) return
  const perf = getPerformanceSettings(props.nodes.length)
  graph
    .backgroundColor(props.background || '#050510')
    .showNavInfo(false)
    .nodeRelSize(perf.nodeRelSize)
    .nodeVal(makeNodeVal())
    .nodeAutoColorBy(null)
    .nodeColor(makeNodeColor())
    .nodeOpacity(0.9)
    .nodeResolution(props.nodes.length > 5000 ? 3 : props.nodes.length > 2000 ? 5 : 8)
    .nodeLabel((n: any) => {
      let label = n.word
      if (n.sources?.length) label += `\n[${n.sources.join(' / ')}]`
      if (n.definitionZh) label += `\n${n.definitionZh}`
      return label
    })
    .linkWidth((l: any) => perf.linkWidth * 1.3 * (l.weight || 0.5))
    .linkOpacity(0.75)
    .linkColor(makeLinkColor())
    .linkCurvature(0)
    .linkLabel((l: any) => {
      const typeLabel = RELATION_LABELS[l.type as RelationType] || ''
      return l.difference ? `${typeLabel}\n${l.difference}` : typeLabel
    })
    .linkDirectionalParticles(perf.particleSpeed > 0 ? 2 : 0)
    .linkDirectionalParticleSpeed(perf.particleSpeed)
    .linkDirectionalParticleWidth(2)
    .enableNodeDrag(perf.enableNodeDrag)
    .enableNavigationControls(true)
    .onNodeClick((node: any) => {
      if (drillInto(node) !== false) return
      if (props.clickMode !== 'none') emit('select', node.word)
      if (graph && node.x !== undefined) {
        const distance = 100
        const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z)
        graph.cameraPosition(
          { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
          { x: node.x, y: node.y, z: node.z },
          1000
        )
      }
    })
    .onNodeHover((node: any) => {
      if (containerEl.value) containerEl.value.style.cursor = node ? 'pointer' : 'default'
    })
    .warmupTicks(perf.warmupTicks)
    .cooldownTicks(perf.cooldownTicks)

  const linkForce: any = (graph as any).d3Force?.('link')
  if (linkForce?.distance) {
    const u = perf.nodeRelSize
    linkForce.distance((l: any) => (
      l.bridge ? u * 40
        : l.type === 'morphology' ? u * 6
        : l.type === 'word_family' ? u * 7
        : l.type === 'synonym' ? u * 7
        : u * 24
    ))
  }
  if (linkForce?.strength) {
    linkForce.strength((l: any) => (l.bridge ? 0.02 : l.type === 'antonym' ? 0.15 : 1))
  }

  const chargeForce: any = (graph as any).d3Force?.('charge')
  if (chargeForce?.strength) chargeForce.strength(-(perf.nodeRelSize * perf.nodeRelSize * 6))

  ensureCloudForce()

  if (perf.useCustomNodes) {
    nodeObjs.clear()
    graph.nodeThreeObject((node: any) => {
      const colors: string[] = node.sourceColors || sourceColorsOf(node.sources)
      const r = perf.nodeRelSize * Math.cbrt(node.val || 1)
      const obj = node.isCenter
        ? createStarNode('#ffc94d', r * 1.1, props.nodeStyle, sceneEnv, true)
        : colors.length > 1
          ? createRingedNode(colors, r, props.nodeStyle, sceneEnv)
          : createStarNode(colors[0], r, props.nodeStyle, sceneEnv)
      nodeObjs.set(node.id, obj)
      return obj
    })
    graph.nodeThreeObjectExtend(false)
  } else {
    graph.nodeThreeObject(null)
  }
}

let starGroup: THREE.Group | null = null
let starRafId: number | null = null
let starLayers: Array<{ obj: THREE.Points; spin: number }> = []
let nebulaMat: THREE.ShaderMaterial | null = null
let skyMesh: THREE.Mesh | null = null
let starMats: THREE.ShaderMaterial[] = []

const NEBULA_FRAG = `
precision highp float;
varying vec3 vDir;
uniform float uTime;

/** HSV → RGB。星云配色在 HSV 里做，是因为要连续地推色相——
 *  在 RGB 里想让颜色平滑地绕色轮走，只能靠一堆 mix 去拼，拼出来就是色块。 */
vec3 hsv2rgb(vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  rgb = rgb * rgb * (3.0 - 2.0 * rgb);
  return c.z * mix(vec3(1.0), rgb, c.y);
}

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i + vec3(0.0,0.0,0.0)), hash(i + vec3(1.0,0.0,0.0)), f.x),
        mix(hash(i + vec3(0.0,1.0,0.0)), hash(i + vec3(1.0,1.0,0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0,0.0,1.0)), hash(i + vec3(1.0,0.0,1.0)), f.x),
        mix(hash(i + vec3(0.0,1.0,1.0)), hash(i + vec3(1.0,1.0,1.0)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  // 八度从 5 降到 3。每一层 vnoise 是八次哈希加三线性插值，
  // 而这个天幕是 depthTest:false 的整屏覆盖，每一帧每个像素都要跑满。
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float t = uTime * 0.008;

  // 两层不同尺度、不同漂移方向的噪声。同向的话只会整体平移，看不出"翻涌"；
  // 反向叠加才会让云絮之间互相挤压变形，这是星云看起来在动的关键。
  float n1 = fbm(d * 2.1 + vec3(t, t * 0.55, -t * 0.35));
  float n2 = fbm(d * 5.3 + vec3(-t * 0.8, t * 0.25, t * 0.6));

  float mixed = n1 * 0.68 + n2 * 0.32;
  // smoothstep 卡出云的边界：低于下限的地方完全是空的深空。
  // 不卡的话整个天幕会糊成一层均匀的紫，比纯黑还难看。
  float cloud = smoothstep(0.40, 0.86, mixed);
  cloud = pow(cloud, 1.35);

  /**
   * 多色星云，但**不分区**。
   * 前两版都没做对，原因分别是：
   */
  float hueField = n1 * 0.7 + n2 * 0.3;
  // 0.56 起手是青蓝（深空的底色），±0.30 的漂移范围能覆盖到品红和暖金。
  // 再宽就会漂到绿色，那是星云照片里几乎不出现的色相，一出现就假。
  float hue = fract(0.56 + (hueField - 0.5) * 0.30 + (1.0 - cloud) * 0.06);
  float sat = mix(0.85, 0.30, smoothstep(0.35, 1.0, cloud));
  float val = mix(0.22, 0.95, cloud);
  vec3 col = hsv2rgb(vec3(hue, sat, val));

  // 云芯提亮：噪声最高的那一小撮给一点暖白。偏暖不是随手选的——
  // 星云的致密核心通常是里面的恒星把气体电离后自己发光，色温比周围高，
  float core = smoothstep(0.72, 0.98, mixed);
  col += vec3(0.62, 0.55, 0.48) * core * 0.42;

  // 底色是极深的蓝黑（不是纯黑）——纯黑会让整个画面显得"关掉了"，
  // 留一点点蓝才有夜空的通透感
  vec3 base = vec3(0.014, 0.016, 0.045);
  gl_FragColor = vec4(base + col * cloud * 0.95, 1.0);
}
`

const NEBULA_VERT = `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const STAR_VERT = `
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;
uniform float uTime;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vTw;
void main() {
  vColor = aColor;
  // 闪烁：两个不同频率的正弦叠加，避免看出规律性的一开一合
  /**
   * 闪烁。两条正弦相乘的老写法是**周期性**的：所有星星按各自的相位规律地一亮一暗，
   * 亮度还被 0.70 兜着底，从来不会真的灭掉。看久了就是一整片同频的呼吸灯，
   */
  float breathe = 0.62 + 0.38 * sin(uTime * 1.7 + aPhase) * (0.6 + 0.4 * sin(uTime * 0.43 + aPhase * 1.7));
  float slow = sin(uTime * (0.11 + fract(aPhase * 0.017) * 0.09) + aPhase * 3.1);
  float blink = smoothstep(0.0, 0.06, abs(slow));
  // 不压到全黑：留 0.12 的底，星星是"暗下去"而不是"消失"，
  // 整颗不见会让人以为是渲染出了问题。
  float tw = breathe * mix(0.12, 1.0, blink);
  vTw = clamp(tw, 0.25, 1.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // 天幕跟着相机走，每颗星到相机的距离基本恒定，所以不做距离衰减，
  // 直接用屏幕像素尺寸——这也正是真实星空的行为（星星不会因为你走两步就变大）
  gl_PointSize = aSize * uPixelRatio * (0.75 + 0.25 * vTw);
}
`

const STAR_FRAG = `
precision highp float;
varying vec3 vColor;
varying float vTw;
void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);
  if (d > 0.5) discard;
  // 中心实、边缘迅速衰减的光点。三次方比线性更接近真实点光源的观感
  float core = smoothstep(0.5, 0.0, d);
  float glow = pow(core, 2.6);
  gl_FragColor = vec4(vColor * (0.55 + 0.75 * glow), glow * vTw);
}
`

function starColor(): [number, number, number] {
  const r = Math.random()
  if (r < 0.12) return [0.62, 0.74, 1.00]   // 蓝白（高温星）
  if (r < 0.30) return [0.78, 0.86, 1.00]   // 冷白
  if (r < 0.72) return [1.00, 0.98, 0.95]   // 白
  if (r < 0.90) return [1.00, 0.92, 0.76]   // 暖黄
  return [1.00, 0.78, 0.62]                 // 橙红（低温星）
}

function randomOnSphere(radius: number): [number, number, number] {
  let x = 0, y = 0, z = 0, len = 0
  do {
    x = Math.random() * 2 - 1
    y = Math.random() * 2 - 1
    z = Math.random() * 2 - 1
    len = Math.hypot(x, y, z)
  } while (len < 0.001 || len > 1)
  return [(x / len) * radius, (y / len) * radius, (z / len) * radius]
}

function makeStarLayer(
  count: number,
  radius: number,
  sizeMin: number,
  sizeMax: number,
  spin: number
): { obj: THREE.Points; spin: number; mat: THREE.ShaderMaterial } {
  const pos = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const colors = new Float32Array(count * 3)
  const phases = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const [x, y, z] = randomOnSphere(radius)
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z
    sizes[i] = sizeMin + (sizeMax - sizeMin) * Math.pow(Math.random(), 3.2)
    const [r, g, b] = starColor()
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b
    phases[i] = Math.random() * Math.PI * 2
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) }
    },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false
  })
  const obj = new THREE.Points(geo, mat)
  obj.renderOrder = -5
  obj.frustumCulled = false
  return { obj, spin, mat }
}

const STARFIELD_MAX_NODES = 3000

function initStarfield() {
  if (!graph || starGroup) return
  if (props.nodes.length > STARFIELD_MAX_NODES) return
  const group = new THREE.Group()
  group.name = 'lb-skybox'
  group.renderOrder = -10

  const SKY_R = 2600
  nebulaMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: NEBULA_VERT,
    fragmentShader: NEBULA_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false
  })
  const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_R, 32, 20), nebulaMat)
  sky.visible = props.nodes.length <= 2000
  skyMesh = sky
  sky.renderOrder = -10
  sky.frustumCulled = false
  sky.onBeforeRender = (_r, _s, cam: any) => {
    if (!starGroup || !cam?.position) return
    starGroup.position.copy(cam.position)
    starGroup.updateMatrixWorld(true)
  }
  group.add(sky)

  starLayers = []
  starMats = []
  const layerCfg: Array<[number, number, number, number, number]> = [
    [2600, 2400, 0.8, 2.2, Math.PI * 2 / 900],   // 远景：密、小、几乎不动
    [1100, 1900, 1.4, 3.6, Math.PI * 2 / 620],   // 中景
    [280, 1400, 2.2, 5.4, Math.PI * 2 / 420]     // 近景：疏、大、转得稍快
  ]
  for (const [count, radius, sMin, sMax, spin] of layerCfg) {
    const layer = makeStarLayer(count, radius, sMin, sMax, spin)
    group.add(layer.obj)
    starLayers.push({ obj: layer.obj, spin: layer.spin })
    starMats.push(layer.mat)
  }

  const flareColors = ['#ffffff', '#cfe0ff', '#ffe9c4', '#dcd0ff']
  for (let i = 0; i < 10; i++) {
    const color = flareColors[i % flareColors.length]
    const mat = new THREE.SpriteMaterial({
      map: getStarTexture(color),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      opacity: 0.55 + Math.random() * 0.35
    })
    const sp = new THREE.Sprite(mat)
    const [x, y, z] = randomOnSphere(1750)
    sp.position.set(x, y, z)
    const s = 26 + Math.random() * 34
    sp.scale.set(s, s, 1)
    sp.renderOrder = -4
    sp.frustumCulled = false
    sp.userData.baseOpacity = mat.opacity
    sp.userData.phase = Math.random() * Math.PI * 2
    group.add(sp)
  }

  graph.scene().add(group)
  starGroup = group

  const start = performance.now()
  const heavyGraph = props.nodes.length > 2000
  const tick = () => {
    const t = (performance.now() - start) / 1000
    if (starGroup && graph) {
      stepOrbit(t)
      if (nebulaMat) nebulaMat.uniforms.uTime.value = t
      for (const m of starMats) m.uniforms.uTime.value = t
      for (const layer of starLayers) {
        layer.obj.rotation.y = t * layer.spin
        layer.obj.rotation.x = t * layer.spin * 0.35
      }
      for (const child of heavyGraph ? [] : starGroup.children) {
        if (child instanceof THREE.Sprite) {
          const base = child.userData.baseOpacity ?? 0.6
          const phase = child.userData.phase ?? 0
          ;(child.material as THREE.SpriteMaterial).opacity =
            base * (0.65 + 0.35 * Math.sin(t * 0.9 + phase))
        }
      }
    }
    starRafId = requestAnimationFrame(tick)
  }
  const needsTick = () => orbitOn || !!nebulaMat || starMats.length > 0
  if (needsTick()) starRafId = requestAnimationFrame(tick)
}

function stopStarfield() {
  if (starRafId != null) cancelAnimationFrame(starRafId)
  starRafId = null
  if (starGroup) {
    starGroup.traverse(obj => {
      const any = obj as any
      any.geometry?.dispose?.()
      const mat = any.material
      if (Array.isArray(mat)) mat.forEach((m: any) => m.dispose?.())
      else mat?.dispose?.()
    })
    if (graph) graph.scene().remove(starGroup)
    skyMesh = null
  }
  starGroup = null
  starLayers = []
  starMats = []
  nebulaMat = null
}

let fitTimer: ReturnType<typeof setTimeout> | null = null
let settleTimer: ReturnType<typeof setTimeout> | null = null

function sanitizeLinks(data: { nodes: any[]; links: any[] }) {
  const ids = new Set(data.nodes.map(n => n.id))
  const loose = new Map<string, any>()
  for (const n of data.nodes) {
    const k = String(n.id ?? '').trim().toLowerCase()
    if (!loose.has(k)) loose.set(k, n.id)
  }
  const pick = (v: any) => (ids.has(v) ? v : loose.get(String(v ?? '').trim().toLowerCase()) ?? null)
  const kept: any[] = []
  const bad: string[] = []
  for (const l of data.links) {
    const s = pick(typeof l.source === 'object' ? l.source?.id : l.source)
    const t = pick(typeof l.target === 'object' ? l.target?.id : l.target)
    if (s === null || t === null) {
      if (bad.length < 5) bad.push(`${JSON.stringify(l.source)} → ${JSON.stringify(l.target)}`)
      continue
    }
    kept.push({ ...l, source: s, target: t })
  }
  lastDiag.value.bad = bad
  return { nodes: data.nodes, links: kept }
}

const lastDiag = ref<{
  incoming: number; afterThin: number; drawn: number; cleaned: boolean; backedOff: boolean; bad: string[]
}>({ incoming: 0, afterThin: 0, drawn: 0, cleaned: false, backedOff: false, bad: [] })

let savedForces: { charge: any; link: any; center: any; cloud: any } | null = null
function rememberForces() {
  if (savedForces || !graph) return
  const g = graph as any
  if (typeof g.d3Force !== 'function') return
  const charge = g.d3Force('charge')
  const link = g.d3Force('link')
  const center = g.d3Force('center')
  const cloud = g.d3Force('cloud')
  if (charge || link || center || cloud) savedForces = { charge, link, center, cloud }
}
function restoreForces() {
  if (!graph || !savedForces) return
  const g = graph as any
  if (typeof g.d3Force !== 'function') return
  if (!g.d3Force('charge') && savedForces.charge) g.d3Force('charge', savedForces.charge)
  if (!g.d3Force('link') && savedForces.link) g.d3Force('link', savedForces.link)
  if (!g.d3Force('center') && savedForces.center) g.d3Force('center', savedForces.center)
  if (!g.d3Force('cloud') && savedForces.cloud) g.d3Force('cloud', savedForces.cloud)
}

function topoKey(): string {
  let h = 2166136261
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
    h ^= 1; h = Math.imul(h, 16777619)
  }
  for (const n of props.nodes) feed(n.id)
  feed('|links|')
  if (props.showLinks) {
    for (const l of props.links) { feed(l.source); feed(l.target); feed(l.type) }
  }
  feed(`|${props.minLinkWeight}|${props.maxLinksPerNode}|`)
  return (h >>> 0).toString(36)
}
let lastTopoKey = ''

function updateData() {
  if (!graph) return
  const key = topoKey()
  const sameTopo = key === lastTopoKey && lastTopoKey !== ''
  const wasOrbiting = orbitOn
  lastTopoKey = key

  orbitOn = false
  if (!(sameTopo && wasOrbiting)) orbiters = []
  const data = buildGraphData()

  const prev = new Map<string, any>()
  try {
    const old: any = graph.graphData()
    for (const n of old?.nodes || []) {
      if (!Number.isFinite(n.x)) continue
      prev.set(n.id, n)
      // 顺手存进长期缓存：搜一个词再退回来时，全景图能直接摆回原位，
      // 不用把力学模拟重跑一遍（那就是"退出搜索要重新加载"的由来）
      posCache.set(n.id, { x: n.x, y: n.y, z: n.z })
    }
  } catch { /* 第一次建图时没有旧数据，正常 */ }

  // 这批节点是不是全都在缓存里？是的话直接摆好，跳过 warmup
  let allCached = data.nodes.length > 0
  for (const n of data.nodes as any[]) if (!prev.has(n.id) && !posCache.has(n.id)) { allCached = false; break }
  for (const n of data.nodes as any[]) {
    const p = prev.get(n.id) || posCache.get(n.id)
    if (!p) continue
    n.x = p.x; n.y = p.y; n.z = p.z
    n.vx = 0; n.vy = 0; n.vz = 0
    if (sameTopo && wasOrbiting) {
      n.fx = p.fx; n.fy = p.fy; n.fz = p.fz
      n.__orb = p.__orb
    }
  }

  if (sameTopo && wasOrbiting) {
    orbitOn = true
  } else {
    restoreForces()
    ensureCloudForce()
    if (props.nodes.length > STARFIELD_MAX_NODES) stopStarfield()
    else if (!starGroup) initStarfield()
    const perf = getPerformanceSettings(props.nodes.length)
    const g = graph as any
    // 位置全部命中缓存时几乎不用再模拟，给一点点 tick 让新连线收一下就行
    if (typeof g.warmupTicks === 'function') g.warmupTicks(allCached ? 0 : perf.warmupTicks)
    if (typeof g.cooldownTicks === 'function') g.cooldownTicks(allCached ? 8 : perf.cooldownTicks)
  }

  if (skyMesh) skyMesh.visible = props.nodes.length <= 2000

  lastDiag.value = {
    incoming: thinTrace.incoming,
    afterThin: thinTrace.afterThin,
    drawn: data.links.length,
    cleaned: false,
    backedOff: thinTrace.backedOff,
    bad: []
  }
  try {
    graph.graphData(data)
    markGroupScreenDirty()
  } catch (e) {
    console.warn('[词汇宇宙] 引擎拒绝了这批图数据，清洗后重试：', e)
    const cleaned = sanitizeLinks(data)
    graph.graphData(cleaned)
    markGroupScreenDirty()
    lastDiag.value = { ...lastDiag.value, drawn: cleaned.links.length, cleaned: true }
  }
  const d = lastDiag.value
  console.info(`[词汇宇宙] 节点 ${data.nodes.length} · 传入边 ${d.incoming} · 交给引擎 ${d.drawn}${d.cleaned ? '（清洗过）' : ''}${sameTopo ? ' · 拓扑未变，沿用布局' : ''}`)
  emit('stats', { nodes: data.nodes.length, links: d.drawn })
  if (!(sameTopo && wasOrbiting)) scheduleFit()
}

function median(arr: number[]): number {
  if (!arr.length) return 0
  const a = [...arr].sort((p, q) => p - q)
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

function fitView(durationMs: number) {
  if (!graph) return
  const data = graph.graphData() as any
  const ns: any[] = (data?.nodes || []).filter((n: any) => Number.isFinite(n.x) && Number.isFinite(n.y))
  if (!ns.length) return

  const cx = median(ns.map(n => n.x))
  const cy = median(ns.map(n => n.y))
  const cz = median(ns.map(n => n.z ?? 0))

  const dists = ns
    .map(n => Math.hypot(n.x - cx, n.y - cy, (n.z ?? 0) - cz))
    .sort((a, b) => a - b)
  const p92 = dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.92))] || 0
  const maxR = dists[dists.length - 1] || 0
  const radius = Math.max(Math.min(maxR, p92 * 1.25), 1) * 1.15

  const cam = graph.camera() as THREE.PerspectiveCamera
  const vFov = ((cam.fov || 50) * Math.PI) / 180
  const aspect = cam.aspect || 1
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
  const dist = Math.max(radius / Math.tan(vFov / 2), radius / Math.tan(hFov / 2))

  let dx = cam.position.x - cx
  let dy = cam.position.y - cy
  let dz = cam.position.z - cz
  let len = Math.hypot(dx, dy, dz)
  if (!Number.isFinite(len) || len < 1e-6) { dx = 0; dy = 0; dz = 1; len = 1 }
  const k = dist / len

  graph.cameraPosition(
    { x: cx + dx * k, y: cy + dy * k, z: cz + dz * k },
    { x: cx, y: cy, z: cz },
    durationMs
  )
}

let orbitOn = false
const ORBIT_MAX_NODES = 400
let orbiters: any[] = []

function startOrbit() {
  if (!graph || orbitOn) return
  try {
    const data: any = graph.graphData()
    const nodes: any[] = data?.nodes || []
    if (!nodes.length || nodes.length > ORBIT_MAX_NODES) return
    if (typeof (graph as any).d3Force === 'function') {
      ;(graph as any).d3Force('charge', null)
      ;(graph as any).d3Force('link', null)
      ;(graph as any).d3Force('center', null)
      ;(graph as any).d3Force('cloud', null)
    }
    const byId = new Map<string, any>(nodes.map(n => [n.id, n]))
    orbiters = []
    for (const n of nodes) {
      n.fx = n.x; n.fy = n.y; n.fz = n.z
      const core = n.clusterOf ? byId.get(n.clusterOf) : null
      if (!core) continue
      const dx = n.x - core.x, dy = n.y - core.y, dz = n.z - core.z
      const r = Math.hypot(dx, dy, dz)
      if (!Number.isFinite(r) || r < 1) continue
      n.__core = core
      n.__orb = {
        r,
        a: Math.atan2(dz, dx),
        b: Math.asin(Math.max(-1, Math.min(1, dy / r))),
        sp: 0.02 + Math.random() * 0.03
      }
      orbiters.push(n)
    }
    if (!orbiters.length) return
    if (typeof (graph as any).cooldownTicks === 'function') (graph as any).cooldownTicks(Infinity)
    if (typeof (graph as any).d3ReheatSimulation === 'function') (graph as any).d3ReheatSimulation()
    orbitOn = true
  } catch (e) {
    console.warn('[词汇宇宙] 公转效果启用失败，保持静态布局：', e)
  }
}

function stepOrbit(t: number) {
  if (!orbitOn || !orbiters.length) return
  for (const n of orbiters) {
    const o = n.__orb, core = n.__core
    if (!o || !core) continue
    const a = o.a + t * o.sp
    const cb = Math.cos(o.b)
    n.fx = core.fx + o.r * cb * Math.cos(a)
    n.fy = core.fy + o.r * Math.sin(o.b)
    n.fz = core.fz + o.r * cb * Math.sin(a)
  }
}

function scheduleFit() {
  if (fitTimer) clearTimeout(fitTimer)
  const n = props.nodes.length
  const delays = n > 5000 ? [500, 1800, 3500] : n > 1000 ? [400, 1400, 2600] : [400, 1200]
  const run = (i: number) => {
    fitTimer = setTimeout(() => {
      fitView(i === delays.length - 1 ? 600 : 300)
      if (i === delays.length - 1) {
        rebuildHalos()
        setHaloTargets('')
        markGroupScreenDirty()
        setTimeout(startOrbit, 700)
      }
      if (i + 1 < delays.length) run(i + 1)
    }, delays[i])
  }
  run(0)
}

function resize() {
  if (!graph || !containerEl.value) return
  const w = containerEl.value.clientWidth
  const h = containerEl.value.clientHeight
  if (w > 0 && h > 0) {
    graph.width(w)
    graph.height(h)
    fitView(0)
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = setTimeout(() => fitView(0), 280)
  }
}

let resizeObserver: ResizeObserver | null = null

function onDrillKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && drillLevel.value > 0) {
    e.stopPropagation()
    drillOut()
  }
}
window.addEventListener('keydown', onDrillKey)
onUnmounted(() => {
  cancelAnimationFrame(haloRaf)
  clearHalos()
  window.removeEventListener('keydown', onDrillKey)
  containerEl.value?.removeEventListener('pointermove', onCanvasPointerMove)
  containerEl.value?.removeEventListener('click', onCanvasClick, true)
  containerEl.value?.removeEventListener('wheel', markGroupScreenDirty)
  containerEl.value?.removeEventListener('pointerdown', markGroupScreenDirty)
})

onMounted(async () => {
  await nextTick()
  if (!containerEl.value) return
  graph = ForceGraph3D()(containerEl.value)
  containerEl.value.addEventListener('pointermove', onCanvasPointerMove)
  containerEl.value.addEventListener('click', onCanvasClick, true)
  animateHalos()
  containerEl.value.addEventListener('wheel', markGroupScreenDirty, { passive: true })
  containerEl.value.addEventListener('pointerdown', markGroupScreenDirty)
  const w0 = containerEl.value.clientWidth
  const h0 = containerEl.value.clientHeight
  if (w0 > 0 && h0 > 0) { graph.width(w0); graph.height(h0) }
  try {
    sceneEnv = getEnvMap(graph.renderer())
    sceneEnvKey = sceneEnv ? 'env' : 'none'
    const scene = graph.scene()
    const fill = new THREE.DirectionalLight(0x88aaff, 0.55)
    fill.position.set(-1, -0.6, -0.8)
    scene.add(fill)
    const rimLight = new THREE.DirectionalLight(0xffd9b0, 0.35)
    rimLight.position.set(0.3, 1, -1)
    scene.add(rimLight)
  } catch (e) {
    console.warn('[词汇宇宙] 补光/环境贴图初始化失败，用默认光照：', e)
  }
  applyConfig()
  rememberForces()
  updateData()
  requestAnimationFrame(() => requestAnimationFrame(() => resize()))
  initStarfield()
  resizeObserver = new ResizeObserver(() => resize())
  resizeObserver.observe(containerEl.value)
})
let unsubColor: (() => void) | null = null
onMounted(() => { unsubColor = onColorChange(() => updateData()) })

onUnmounted(() => {
  unsubColor?.()
  unsubColor = null
  if (fitTimer) clearTimeout(fitTimer)
  if (settleTimer) clearTimeout(settleTimer)
  resizeObserver?.disconnect()
  stopStarfield()
  graph?._destructor?.()
  graph = null
})

watch(
  () => [props.nodes, props.links, props.showLinks, props.minLinkWeight, props.maxLinksPerNode],
  updateData,
  { deep: false }
)
watch(() => themeStore.currentId, applyConfig)
watch(() => props.nodeStyle, () => {
  applyConfig()
  lastTopoKey = ''
  updateData()
})
</script>

<style scoped>
.graph-shell { position: relative; width: 100%; height: 100%; }
.force-graph-canvas {
  width: 100%;
  height: 100%;
}
.graph-diag {
  position: absolute;
  left: 10px;
  bottom: 8px;
  max-width: calc(100% - 20px);
  padding: 4px 9px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.45);
  color: #ffb4a2;
  font-size: 11.5px;
  line-height: 1.5;
  pointer-events: none;
}
.diag-bad { opacity: 0.8; }
.drill-bar {
  position: absolute; left: 14px; top: 12px; z-index: 6;
  display: flex; align-items: center; gap: 10px;
  padding: 5px 10px 5px 6px; border-radius: 8px;
  background: rgba(16, 18, 24, 0.62); backdrop-filter: blur(6px);
  color: #e8eaf0; font-size: 13px;
}
.drill-back {
  border: none; background: rgba(255, 255, 255, 0.1); color: #e8eaf0;
  border-radius: 6px; padding: 3px 9px; font-size: 12.5px; cursor: pointer;
  &:hover { background: rgba(255, 255, 255, 0.2); }
}
.crumb-sep { opacity: 0.45; margin: 0 6px; }
.crumb-item {
  border: none; background: none; padding: 0; cursor: pointer;
  color: #e8eaf0; opacity: 0.6; font-size: 13px;
  &:hover { opacity: 1; text-decoration: underline; }
  &.cur { opacity: 1; cursor: default; text-decoration: none; }
}

.cluster-tip {
  position: absolute;
  left: 12px;
  top: 12px;
  &.below-crumb { top: 56px; }
  max-width: calc(100% - 24px);
  padding: 7px 12px;
  border-radius: 8px;
  background: rgba(8, 10, 22, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #e8eefc;
  font-size: 12.5px;
  line-height: 1.55;
  pointer-events: none;
  white-space: pre-line;
}
.graph-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(5, 5, 16, 0.55);
  color: #cfd8ee;
  font-size: 13px;
  z-index: 5;
}
.spinner {
  width: 15px; height: 15px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.25);
  border-top-color: #cfd8ee;
  animation: lb-spin 0.8s linear infinite;
}
@keyframes lb-spin { to { transform: rotate(360deg); } }
</style>

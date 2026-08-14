<template>
  <div ref="mountEl" class="intro-mount" @click="skip">
    <div class="intro-overlay" :class="{ fadeout: phase === 'exiting' }">
      <h1 class="intro-title">语义星空</h1>
      <p class="intro-sub">{{ subtitleText }}</p>
      <button class="skip-btn" @click.stop="skip">跳过 →</button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 开屏星空聚散动画：GPU 粒子系统（自定义 GLSL shader），初始所有粒子聚拢在中心
 * 一个发光点，用缓动函数在约 2.2 秒内展开到各自的星空目标位置，并带鼠标跟随光效/
 * 涡流交互（参考 haoqi.design 的 shader 驱动交互思路，简化到适合一个学习工具
 * 开屏场景的规模——不做多主题切换和完整后处理管线，只做"聚散 + 鼠标光效"这一件事）。
 *
 * 粒子的目标位置直接复用父组件传入的中心性排名数据：越靠中心性排名前列的词，
 * 展开后离视觉中心越近、粒子越大越亮——开屏动画结束时的画面，就是紧接着的
 * GalaxyView 星空图的一个平滑的"预告/引子"，不是两套互不相关的视觉。
 *
 * 性能：粒子数量、位置更新、发光计算全部在顶点/片元 shader 里完成（GPU），
 * JS 侧每帧只更新一个 uProgress uniform，即使几千个粒子也不会卡顿。
 */
import { ref, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'

export interface IntroNode {
  word: string
  rank: number | null
}

const props = defineProps<{ nodes: IntroNode[] }>()
const emit = defineEmits<{ (e: 'done'): void }>()

const mountEl = ref<HTMLDivElement | null>(null)
const phase = ref<'gathering' | 'expanding' | 'exiting'>('gathering')
const subtitleText = ref('正在聚集词汇宇宙…')

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let points: THREE.Points | null = null
let material: THREE.ShaderMaterial | null = null
let animId = 0
let startTime = 0
let mouseTarget = new THREE.Vector2(0, 0)
let mouseCurrent = new THREE.Vector2(0, 0)
let skipped = false

const VERTEX_SHADER = /* glsl */ `
  uniform float uProgress; // 0 = 全部聚拢在中心, 1 = 完全展开到目标位置
  uniform vec2 uMouse;
  uniform float uTime;
  attribute vec3 aTarget;
  attribute float aSize;
  attribute float aBrightness;
  varying float vBrightness;
  varying float vDist;

  // 简单缓动：先快后慢，制造"从聚拢猛地弹开"的感觉
  float easeOutCubic(float t) {
    float f = t - 1.0;
    return f * f * f + 1.0;
  }

  void main() {
    float eased = easeOutCubic(clamp(uProgress, 0.0, 1.0));
    vec3 pos = mix(vec3(0.0, 0.0, 0.0), aTarget, eased);

    // 展开过程中加一点轻微的螺旋扰动，让散开的轨迹不是直线，更有"星尘飞散"的动感
    float swirl = (1.0 - eased) * 3.0;
    float angle = swirl + uTime * 0.15;
    pos.x += sin(angle + aTarget.y * 0.5) * swirl * 0.6;
    pos.y += cos(angle + aTarget.x * 0.5) * swirl * 0.6;

    // 鼠标涡流：离鼠标近的粒子受到一点轻微扰动位移，营造光效跟随手感。
    // smoothstep 要求 edge0 < edge1，所以用 (mDist, 近距离, 远距离) 算出"离鼠标越近影响越小"
    // 的过渡值，再用 1.0 减出"越近影响越大"，不能直接把大值写在小值前面（未定义行为）。
    vec2 toMouse = pos.xy - uMouse;
    float mDist = length(toMouse);
    float influence = (1.0 - smoothstep(0.0, 2.2, mDist)) * eased;
    pos.xy += normalize(toMouse + 0.0001) * influence * 0.25;

    vBrightness = aBrightness + influence * 0.6;
    vDist = mDist;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * (300.0 / -mvPosition.z) * (0.6 + eased * 0.4);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  varying float vBrightness;
  varying float vDist;
  void main() {
    // 圆形柔光点，边缘用 smoothstep 做羽化，而不是硬边圆点
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    if (d > 0.5) discard;
    float alpha = (1.0 - smoothstep(0.0, 0.5, d)) * clamp(vBrightness, 0.15, 1.4);
    vec3 color = mix(vec3(0.55, 0.6, 1.0), vec3(0.85, 0.82, 1.0), clamp(vBrightness, 0.0, 1.0));
    gl_FragColor = vec4(color, alpha);
  }
`

function buildParticles() {
  const n = props.nodes.length || 800
  const positions = new Float32Array(n * 3) // 起始位置（全部为 0，聚拢在中心）
  const targets = new Float32Array(n * 3)
  const sizes = new Float32Array(n)
  const brightness = new Float32Array(n)

  const maxRank = props.nodes.reduce((m, x) => (x.rank ? Math.max(m, x.rank) : m), 1)
  for (let i = 0; i < n; i++) {
    const node = props.nodes[i]
    const normRank = node?.rank ? node.rank / maxRank : Math.random()
    const r = 1.2 + normRank * 6.5
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    targets[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    targets[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.6 // 稍微压扁，形成盘状而非球状
    targets[i * 3 + 2] = r * Math.cos(phi) * 0.3

    sizes[i] = node?.rank ? Math.max(2, 9 - Math.log2(node.rank + 1)) : 1.5
    brightness[i] = node?.rank ? Math.max(0.3, 1 - Math.log2(node.rank + 1) / 7) : 0.25
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aTarget', new THREE.BufferAttribute(targets, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1))

  material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uProgress: { value: 0 },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uTime: { value: 0 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })

  points = new THREE.Points(geometry, material)
  scene!.add(points)
}

function onPointerMove(e: PointerEvent) {
  const rect = mountEl.value!.getBoundingClientRect()
  const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1
  const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1
  // 映射到跟粒子场景大致同量级的坐标范围
  mouseTarget.set(nx * 5, ny * 3)
}

function animate() {
  animId = requestAnimationFrame(animate)
  if (!material || !renderer || !scene || !camera) return

  const elapsed = (performance.now() - startTime) / 1000
  material.uniforms.uTime.value = elapsed

  // 鼠标位置做一点平滑跟随，避免瞬移感
  mouseCurrent.lerp(mouseTarget, 0.08)
  material.uniforms.uMouse.value.copy(mouseCurrent)

  // 展开动画：0.3s 后开始展开，持续约 1.6s
  const progress = THREE.MathUtils.clamp((elapsed - 0.3) / 1.6, 0, 1)
  material.uniforms.uProgress.value = progress

  if (phase.value === 'gathering' && progress > 0.02) {
    phase.value = 'expanding'
    subtitleText.value = '正在按语义中心性展开…'
  }
  if (phase.value === 'expanding' && progress >= 1 && !skipped) {
    subtitleText.value = '进入词汇宇宙'
    setTimeout(() => finish(), 550)
  }

  points!.rotation.y = elapsed * 0.03 // 整体缓慢自转，增加沉浸感

  renderer.render(scene, camera)
}

function finish() {
  if (phase.value === 'exiting') return
  phase.value = 'exiting'
  setTimeout(() => emit('done'), 480) // 等淡出 CSS 动画播完再真正切换页面
}

function skip() {
  skipped = true
  finish()
}

function handleResize() {
  if (!renderer || !camera || !mountEl.value) return
  const w = mountEl.value.clientWidth
  const h = mountEl.value.clientHeight
  renderer.setSize(w, h)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}

onMounted(() => {
  const el = mountEl.value!
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(55, el.clientWidth / el.clientHeight, 0.1, 100)
  camera.position.z = 9

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(el.clientWidth, el.clientHeight)
  el.appendChild(renderer.domElement)

  buildParticles()
  startTime = performance.now()
  animate()

  window.addEventListener('resize', handleResize)
  el.addEventListener('pointermove', onPointerMove)
})

onUnmounted(() => {
  cancelAnimationFrame(animId)
  window.removeEventListener('resize', handleResize)
  material?.dispose()
  points?.geometry.dispose()
  renderer?.dispose()
  renderer?.domElement.remove()
})
</script>

<style scoped lang="scss">
.intro-mount {
  position: fixed;
  inset: 0;
  background: radial-gradient(circle at 50% 45%, #12172b 0%, #05070f 70%);
  z-index: 900;
  cursor: pointer;
  overflow: hidden;
}
.intro-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  transition: opacity 0.48s ease;
}
.intro-overlay.fadeout { opacity: 0; }
.intro-title {
  color: #e8ecff;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 6px;
  text-shadow: 0 0 24px rgba(140, 160, 255, 0.5);
  margin-bottom: 10px;
}
.intro-sub {
  color: #8a94c9;
  font-size: 13px;
  letter-spacing: 2px;
}
.skip-btn {
  position: absolute;
  bottom: 36px;
  right: 36px;
  pointer-events: auto;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.15);
  color: #cfd6ff;
  border-radius: 20px;
  padding: 8px 18px;
  font-size: 12.5px;
  cursor: pointer;
  &:hover { background: rgba(255,255,255,0.14); }
}
</style>

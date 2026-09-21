<template>
  <div
    v-if="tasks.length"
    ref="rootEl"
    class="task-center"
    :class="{ folded, docked: !!docked, [`dock-${docked}`]: !!docked, dragging }"
    :style="posStyle"
  >
    <!-- 贴边后只留一个小标签，点一下拿回来 -->
    <button v-if="docked" class="tc-tab" :title="headText" @pointerdown="onHeadDown" @click="onTabClick">
      <span v-if="runningNum()" class="tc-spin"></span>
      <span v-else class="tc-check">✓</span>
      <span class="tc-tab-num">{{ runningNum() || tasks.length }}</span>
    </button>

    <template v-else>
    <button class="tc-head" @pointerdown="onHeadDown" @click="onHeadClick">
      <span v-if="runningNum()" class="tc-spin"></span>
      <span v-else class="tc-check">✓</span>
      <span class="tc-title">{{ headText }}</span>
      <i class="tc-fold" :class="folded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'"></i>
    </button>

    <div v-if="!folded" class="tc-list">
      <!-- 结束的任务点一下整条就消失，不用再多两个按钮 -->
      <div
        v-for="t in tasks"
        :key="t.id"
        class="tc-item"
        :class="[t.status, { clickable: t.status !== 'running', leaving: leavingIds.has(t.id) }]"
        @click="t.status !== 'running' && dismiss(t.id)"
      >
        <div class="tc-line">
          <span class="tc-kind" :class="t.status">{{ t.kind }}</span>
          <span class="tc-subject">{{ t.subject }}</span>
          <button v-if="t.status === 'running'" class="tc-btn" title="停止" @click.stop="stop(t)">停止</button>
        </div>

        <div v-if="t.detail" class="tc-detail" :class="t.status">{{ t.detail }}</div>
        <div v-if="t.status === 'running' && isStalled(t)" class="tc-stall">
          可能卡住
        </div>

        <div v-if="t.status === 'running'" class="tc-bar">
          <div
            class="tc-fill"
            :class="{ indeterminate: t.ratio == null }"
            :style="t.ratio != null ? { width: Math.round(t.ratio * 100) + '%' } : undefined"
          ></div>
        </div>
      </div>
    </div>
    </template>

  </div>
</template>

<script setup lang="ts">
import { readJson } from '@/shared/core/safeStorage'
import { computed, ref, onUnmounted } from 'vue'
import { tasks, runningNum, dismissTask, isStalled, type RunningTask } from '@/shared/core/taskCenter'

const folded = ref(false)

/* ---------- 拖动与贴边 ---------- */
const POS_KEY = 'lb-task-center-pos'
/**
 * 贴边判定：要真的把面板推到贴住边缘才收起。
 * 原来离边 24px 就收，稍微往边上挪一点就没了，很烦。
 */
const EDGE = 2
const rootEl = ref<HTMLElement | null>(null)
const pos = ref<{ x: number; y: number } | null>(null)
const docked = ref<'left' | 'right' | null>(null)
const dragging = ref(false)
let moved = false

try {
  const saved = readJson(POS_KEY, null as any)
  if (saved && typeof saved.x === 'number') {
    pos.value = { x: saved.x, y: saved.y }
    docked.value = saved.docked ?? null
  }
} catch { /* 存坏了就当没存过 */ }

function save() {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify({ ...(pos.value || {}), docked: docked.value }))
  } catch { /* 无痕模式等写不了，忽略 */ }
}

// 没拖过就待在右下角那一摞里，拖过之后自己定位
const posStyle = computed(() => {
  if (!pos.value) return undefined
  const base = { position: 'fixed' as const, top: pos.value.y + 'px', bottom: 'auto' }
  // 贴边后只剩一个小标签，宽度变了，坐标算不准，直接交给 left/right: 0
  if (docked.value === 'left') return { ...base, left: '0px', right: 'auto' }
  if (docked.value === 'right') return { ...base, left: 'auto', right: '0px' }
  return { ...base, left: pos.value.x + 'px', right: 'auto' }
})

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)) }

function onHeadDown(e: PointerEvent) {
  if (e.button !== 0) return
  const el = rootEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  let offX = e.clientX - r.left
  const offY = e.clientY - r.top
  moved = false

  const move = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5) return
    if (!moved && docked.value) {
      // 从收起状态往外拖：先展开再跟手，不然拖的是个贴死在边上的药丸
      docked.value = null
      offX = Math.min(offX, 40)
    }
    moved = true
    dragging.value = true
    const w = rootEl.value?.getBoundingClientRect().width || r.width
    pos.value = {
      x: clamp(ev.clientX - offX, -w / 2, window.innerWidth - w / 2),
      y: clamp(ev.clientY - offY, 8, window.innerHeight - 40)
    }
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    dragging.value = false
    if (moved && pos.value) {
      // 贴住边缘才收起。宽度按当前实际的量，拖出来之后面板已经变宽了
      const w = rootEl.value?.getBoundingClientRect().width || r.width
      if (pos.value.x <= EDGE) docked.value = 'left'
      else if (pos.value.x + w >= window.innerWidth - EDGE) docked.value = 'right'
      else docked.value = null
      save()
    }
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

/** 拖完手一松会补一个 click，别让它顺手把面板折起来 */
function onHeadClick() {
  if (moved) { moved = false; return }
  folded.value = !folded.value
}

/** 收起来的小药丸：点一下拿回来；直接往里拖也能拖出来（拖过就别再当点击） */
function onTabClick() {
  if (moved) { moved = false; return }
  undock()
}

function undock() {
  const el = rootEl.value
  const w = el?.getBoundingClientRect().width || 320
  const y = pos.value?.y ?? 80
  pos.value = docked.value === 'left'
    ? { x: EDGE, y }
    : { x: Math.max(EDGE, window.innerWidth - w - EDGE), y }
  docked.value = null
  save()
}

function onResize() {
  if (!pos.value || docked.value) return
  const el = rootEl.value
  const w = el?.getBoundingClientRect().width || 320
  pos.value = {
    x: clamp(pos.value.x, -w / 2, Math.max(0, window.innerWidth - w / 2)),
    y: clamp(pos.value.y, 8, Math.max(8, window.innerHeight - 40))
  }
}
window.addEventListener('resize', onResize)
onUnmounted(() => window.removeEventListener('resize', onResize))

/** 正在做消失动画的任务 —— 绿一下再移除，不然点了没反馈 */
const leavingIds = ref(new Set<string>())

function dismiss(id: string) {
  if (leavingIds.value.has(id)) return
  leavingIds.value = new Set(leavingIds.value).add(id)
  setTimeout(() => {
    dismissTask(id)
    const next = new Set(leavingIds.value)
    next.delete(id)
    leavingIds.value = next
  }, 260)
}

/**
 * 停止。
 * 排队中的任务也要能停 —— 之前只有正在跑的挂了 cancel，
 * 排队的那条点了没反应。
 */
function stop(t: RunningTask) {
  if (t.cancel) t.cancel()
  else dismissTask(t.id)
}

const headText = computed(() => {
  const run = runningNum()
  const err = tasks.filter(t => t.status === 'error').length
  if (run && err) return `正在进行 ${run} 个 · 失败 ${err} 个`
  if (run) return `正在进行 ${run} 个任务`
  if (err) return `${err} 个任务失败`
  return `${tasks.length} 个任务已完成`
})
</script>

<style scoped lang="scss">
.task-center {
  /* 固定定位后 width:100% 会变成整个视口宽，必须给死宽度 */
  width: 320px;
  max-width: calc(100vw - 24px);
  border-radius: 14px;
  overflow: hidden;
  backdrop-filter: blur(10px);
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  box-shadow: 0 8px 26px rgba(0, 0, 0, .16);
  overflow: hidden;
  font-size: 13px;
}
.task-center.dragging { user-select: none; }
/* 贴边后缩成一枚小药丸，半透明待着，鼠标过去才实心 */
.task-center.docked {
  width: auto; min-width: 0;
  opacity: .72;
  box-shadow: 0 4px 14px rgba(0, 0, 0, .12);
  transition: opacity var(--dur-base);
  &:hover { opacity: 1; }
}
.task-center.dock-left { border-left: none; border-radius: 0 999px 999px 0; }
.task-center.dock-right { border-right: none; border-radius: 999px 0 0 999px; }
.tc-tab {
  display: flex; align-items: center; justify-content: center; gap: 5px;
  min-width: 46px; min-height: 44px;   /* 好点、好抓 */
  padding: 8px 12px; border: none; background: none;
  font: inherit; font-size: 12px; color: var(--c-text-2);
  cursor: grab; touch-action: none;
  &:active { cursor: grabbing; }
}
.tc-tab-num { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--c-text); }
.tc-head {
  width: 100%;
  padding: 10px 12px;
  border-radius: 14px 14px 0 0;
  background: linear-gradient(180deg, var(--c-surface-2), transparent);
  cursor: grab;
  touch-action: none;
  &:active { cursor: grabbing; }
  display: flex; align-items: center; gap: 8px;
  padding: 9px 12px; border: none; background: none;
  cursor: pointer; font-size: 13px; font-family: inherit;
  color: var(--c-text);
  &:hover { background: var(--c-surface-2); }
}
.tc-title { flex: 1; text-align: left; }
.tc-fold { color: var(--c-text-2); font-size: var(--icon); }
.tc-spin {
  width: 12px; height: 12px; flex-shrink: 0;
  border: 2px solid var(--c-line);
  border-top-color: var(--c-accent);
  border-radius: 50%;
  animation: tcspin .8s linear infinite;
}
.tc-check { width: 12px; flex-shrink: 0; color: var(--c-success); }
@keyframes tcspin { to { transform: rotate(360deg); } }

.tc-list { max-height: 240px; overflow-y: auto; border-top: 1px solid var(--c-line); }
.tc-item {
  padding: 8px 12px;
  border-bottom: 1px solid var(--c-line);
  transition: background var(--dur-base);
  &:last-child { border-bottom: none; }
  &:hover { background: var(--c-surface-2); }
}
.tc-item:last-child { border-bottom: none; }
.tc-item.error { background: color-mix(in srgb, var(--c-danger) 5%, transparent); }
.tc-item.clickable { cursor: pointer; }
.tc-item.clickable:hover { background: var(--c-surface-2); }
/* 点掉时绿一下再收起，给个明确反馈 */
.tc-item.leaving {
  background: color-mix(in srgb, var(--c-success) 18%, transparent);
  opacity: 0;
  transform: translateX(12px);
  transition: opacity .25s ease, transform .25s ease, background-color .1s ease;
}
.tc-line { display: flex; align-items: center; gap: 6px; }
.tc-kind {
  flex-shrink: 0; padding: 1px 6px; border-radius: 5px; font-size: 11.5px;
  background: color-mix(in srgb, var(--c-accent) 12%, transparent);
  color: var(--c-accent);
  &.done { background: color-mix(in srgb, var(--c-success) 14%, transparent); color: var(--c-success); }
  &.error { background: color-mix(in srgb, var(--c-danger) 14%, transparent); color: var(--c-danger); }
}
.tc-subject {
  flex: 1; min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
  color: var(--c-text);
}
.tc-btn {
  flex-shrink: 0; border: none; background: none; cursor: pointer;
  color: var(--c-text-2); font-size: 12px;
  &:hover { color: var(--c-accent); }
}
.tc-detail {
  margin-top: 3px; color: var(--c-text-2); font-size: 12px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  &.error { color: var(--c-danger); white-space: normal; }
  &.done { color: var(--c-success); }
}
.tc-stall { margin-top: 4px; color: var(--c-warn); font-size: 11.5px; }
.tc-bar {
  margin-top: 7px; height: 4px; border-radius: 999px;
  background: var(--c-line); overflow: hidden;
}
.tc-fill {
  height: 100%; border-radius: 999px;
  background: linear-gradient(90deg, var(--c-accent), color-mix(in srgb, var(--c-accent) 55%, white));
  transition: width var(--dur-slow) var(--ease-std);
}
.tc-fill.indeterminate { width: 40%; animation: tcslide 1.2s ease-in-out infinite; }
@keyframes tcslide {
  0% { margin-left: -40%; }
  100% { margin-left: 100%; }
}
.tc-clear {
  width: 100%; border: none; border-top: 1px solid var(--c-line);
  background: none; cursor: pointer; padding: 7px;
  font-size: 12px; font-family: inherit; color: var(--c-text-2);
  &:hover { background: var(--c-surface-2); color: var(--c-text); }
}
</style>

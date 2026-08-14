<template>
  <button
    class="floating-agent"
    :style="pos ? { left: pos.x + 'px', top: pos.y + 'px', right: 'auto', bottom: 'auto' } : {}"
    :class="{ dragging }"
    @pointerdown="onPointerDown"
    @contextmenu.prevent
    :title="agentSelectionContext ? `AI 助手（已记下：${agentSelectionContext.text.slice(0, 12)}…）` : 'AI 助手'"
  >
    <span v-if="agentSelectionContext" class="context-dot"></span>
    <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
  </button>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { toggleAgentPanel, agentSelectionContext } from '@/shared/core/agentPanelState'

interface Pos { x: number; y: number }
const pos = ref<Pos | null>(null)
const dragging = ref(false)

const STORAGE_KEY = 'lb_floating_agent_pos'
const SIZE = 52
const MARGIN = 4

function clamp(x: number, y: number): Pos {
  return {
    x: Math.max(MARGIN, Math.min(window.innerWidth - SIZE - MARGIN, x)),
    y: Math.max(MARGIN, Math.min(window.innerHeight - SIZE - MARGIN, y))
  }
}

onMounted(() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) pos.value = clamp(JSON.parse(saved).x, JSON.parse(saved).y)
  } catch {
  }
})

let startX = 0
let startY = 0
let originX = 0
let originY = 0
let moved = false

function onPointerDown(e: PointerEvent) {
  const btn = e.currentTarget as HTMLElement
  const rect = btn.getBoundingClientRect()
  startX = e.clientX
  startY = e.clientY
  originX = rect.left
  originY = rect.top
  moved = false
  dragging.value = true
  btn.setPointerCapture(e.pointerId)
  btn.addEventListener('pointermove', onPointerMove)
  btn.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(e: PointerEvent) {
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true
  if (moved) {
    pos.value = clamp(originX + dx, originY + dy)
  }
}

function onPointerUp(e: PointerEvent) {
  const btn = e.currentTarget as HTMLElement
  btn.removeEventListener('pointermove', onPointerMove)
  btn.removeEventListener('pointerup', onPointerUp)
  dragging.value = false
  if (moved && pos.value) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos.value))
  } else {
    const rect = btn.getBoundingClientRect()
    toggleAgentPanel({ x: rect.left, y: rect.top, width: rect.width, height: rect.height })
  }
}
</script>

<style scoped>
.floating-agent {
  position: fixed;
  right: 24px;
  bottom: 24px;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  background: var(--r-accent, #8a4b3a);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  z-index: 500;
  touch-action: none;
  transition: transform 0.15s, box-shadow 0.15s;
}
.floating-agent:hover {
  transform: scale(1.06);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
}
.floating-agent.dragging {
  cursor: grabbing;
  transition: none;
}
.context-dot {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #d9a441;
  border: 2px solid var(--r-ink, #1c1c1c);
}
</style>

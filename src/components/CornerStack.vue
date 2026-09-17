<template>
  <!-- 右下角唯一的浮层区：通知在上，任务面板在下，自动排开 -->
  <div class="corner-stack">
    <TransitionGroup name="cs" tag="div" class="cs-toasts">
      <div v-for="t in toasts" :key="t.id" class="cs-toast" :class="t.kind" @click="dismissToast(t.id)">
        <i :class="t.kind === 'error' ? 'ri-error-warning-line' : t.kind === 'ok' ? 'ri-checkbox-circle-line' : 'ri-information-line'"></i>
        <span>{{ t.text }}</span>
      </div>
    </TransitionGroup>
    <TaskCenter />
  </div>
</template>

<script setup lang="ts">
import TaskCenter from './TaskCenter.vue'
import { toasts, dismissToast } from '@/shared/core/toast'
</script>

<style scoped>
.corner-stack {
  position: fixed; right: var(--space-sm);
  /* 悬浮 Agent 按钮 52px 固定在 right/bottom 24px，堆叠区放在它上方 */
  bottom: calc(52px + 24px + var(--space-sm)); z-index: var(--z-corner);
  display: flex; flex-direction: column; align-items: flex-end; gap: var(--space-xs);
  width: min(320px, calc(100vw - 2 * var(--space-sm)));
  pointer-events: none;
}
.corner-stack > * { pointer-events: auto; }
.cs-toasts { display: flex; flex-direction: column; gap: var(--space-xs); width: 100%; pointer-events: none; }
.cs-toast {
  pointer-events: auto; display: flex; gap: var(--space-xs); align-items: flex-start;
  padding: 10px var(--space-sm); border-radius: var(--radius-lg);
  background: var(--c-text); color: var(--c-bg);
  font-size: var(--text-sm); line-height: 1.5; box-shadow: var(--c-shadow); cursor: pointer;
}
.cs-toast i { font-size: var(--icon-sm); margin-top: 2px; }
.cs-toast.error { background: var(--c-danger); color: var(--c-text-on-accent); }
.cs-enter-active { transition: all var(--dur-enter) var(--ease-enter); }
.cs-leave-active { transition: all var(--dur-exit) var(--ease-exit); }
.cs-enter-from, .cs-leave-to { opacity: 0; transform: translateY(8px); }
</style>

<template>
  <div v-if="tasks.length" class="task-center" :class="{ folded }">
    <button class="tc-head" @click="folded = !folded">
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

  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { tasks, runningNum, dismissTask, isStalled, type RunningTask } from '@/shared/core/taskCenter'

const folded = ref(false)

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
  if (run && err) return `${run} 个在跑 · ${err} 个失败`
  if (run) return `${run} 个任务在跑`
  if (err) return `${err} 个任务失败`
  return `${tasks.length} 个任务已完成`
})
</script>

<style scoped lang="scss">
.task-center {
  width: 100%;
  border-radius: 12px;
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  box-shadow: 0 8px 26px rgba(0, 0, 0, .16);
  overflow: hidden;
  font-size: 13px;
}
.tc-head {
  width: 100%;
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

.tc-list { max-height: 300px; overflow-y: auto; border-top: 1px solid var(--c-line); }
.tc-item { padding: 9px 12px; border-bottom: 1px solid var(--c-line); }
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
  margin-top: 6px; height: 3px; border-radius: 2px;
  background: var(--c-line); overflow: hidden;
}
.tc-fill {
  height: 100%; background: var(--c-accent);
  transition: width .25s ease;
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

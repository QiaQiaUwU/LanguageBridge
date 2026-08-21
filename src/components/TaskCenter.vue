<template>
  <div v-if="tasks.length" class="task-center" :class="{ folded }">
    <button class="tc-head" @click="folded = !folded">
      <span v-if="runningNum()" class="tc-spin"></span>
      <span v-else class="tc-check">✓</span>
      <span class="tc-title">{{ headText }}</span>
      <span class="tc-fold">{{ folded ? '展开' : '收起' }}</span>
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
          已经三分钟没有新进度了，可能卡住了，可以停掉重来
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
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 800;
  width: 280px;
  border-radius: 12px;
  background: var(--r-paper, #fff);
  border: 1px solid var(--r-border, #e5e7eb);
  box-shadow: 0 8px 26px rgba(0, 0, 0, .16);
  overflow: hidden;
  font-size: 13px;
}
.tc-head {
  width: 100%;
  display: flex; align-items: center; gap: 8px;
  padding: 9px 12px; border: none; background: none;
  cursor: pointer; font-size: 13px; font-family: inherit;
  color: var(--r-ink, #1f2328);
  &:hover { background: var(--r-ui, #f5f6f8); }
}
.tc-title { flex: 1; text-align: left; }
.tc-fold { color: var(--r-ink2, #9aa0a6); font-size: 12px; }
.tc-spin {
  width: 12px; height: 12px; flex-shrink: 0;
  border: 2px solid var(--r-border, #dfe3e8);
  border-top-color: var(--r-accent, #8a4b3a);
  border-radius: 50%;
  animation: tcspin .8s linear infinite;
}
.tc-check { width: 12px; flex-shrink: 0; color: #3a8a5c; }
@keyframes tcspin { to { transform: rotate(360deg); } }

.tc-list { max-height: 300px; overflow-y: auto; border-top: 1px solid var(--r-border, #f0f0f0); }
.tc-item { padding: 9px 12px; border-bottom: 1px solid var(--r-border, #f5f5f5); }
.tc-item:last-child { border-bottom: none; }
.tc-item.error { background: color-mix(in srgb, #b5493c 5%, transparent); }
.tc-item.clickable { cursor: pointer; }
.tc-item.clickable:hover { background: var(--r-ui, #f5f6f8); }
/* 点掉时绿一下再收起，给个明确反馈 */
.tc-item.leaving {
  background: color-mix(in srgb, #3a8a5c 18%, transparent);
  opacity: 0;
  transform: translateX(12px);
  transition: opacity .25s ease, transform .25s ease, background-color .1s ease;
}
.tc-line { display: flex; align-items: center; gap: 6px; }
.tc-kind {
  flex-shrink: 0; padding: 1px 6px; border-radius: 5px; font-size: 11.5px;
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 12%, transparent);
  color: var(--r-accent, #8a4b3a);
  &.done { background: color-mix(in srgb, #3a8a5c 14%, transparent); color: #3a8a5c; }
  &.error { background: color-mix(in srgb, #b5493c 14%, transparent); color: #b5493c; }
}
.tc-subject {
  flex: 1; min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
  color: var(--r-ink, #1f2328);
}
.tc-btn {
  flex-shrink: 0; border: none; background: none; cursor: pointer;
  color: var(--r-ink2, #9aa0a6); font-size: 12px;
  &:hover { color: var(--r-accent, #8a4b3a); }
}
.tc-detail {
  margin-top: 3px; color: var(--r-ink2, #9aa0a6); font-size: 12px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  &.error { color: #b5493c; white-space: normal; }
  &.done { color: #3a8a5c; }
}
.tc-stall { margin-top: 4px; color: #b5843c; font-size: 11.5px; }
.tc-bar {
  margin-top: 6px; height: 3px; border-radius: 2px;
  background: var(--r-border, #eef0f2); overflow: hidden;
}
.tc-fill {
  height: 100%; background: var(--r-accent, #8a4b3a);
  transition: width .25s ease;
}
.tc-fill.indeterminate { width: 40%; animation: tcslide 1.2s ease-in-out infinite; }
@keyframes tcslide {
  0% { margin-left: -40%; }
  100% { margin-left: 100%; }
}
.tc-clear {
  width: 100%; border: none; border-top: 1px solid var(--r-border, #f0f0f0);
  background: none; cursor: pointer; padding: 7px;
  font-size: 12px; font-family: inherit; color: var(--r-ink2, #9aa0a6);
  &:hover { background: var(--r-ui, #f5f6f8); color: var(--r-ink, #1f2328); }
}
</style>

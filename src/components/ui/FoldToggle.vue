<template>
  <button
    class="ui-icon-btn ui-fold"
    type="button"
    :title="title || (folded ? '展开' : '收起')"
    :aria-expanded="!folded"
    @click="$emit('update:folded', !folded)"
  >
    <i :class="icon"></i><span v-if="folded && label">{{ label }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'

/**
 * 全项目唯一的折叠按钮。
 * side：面板贴哪边。left 面板收起时箭头朝右，down 用于上下展开的区块。
 */
const props = withDefaults(
  defineProps<{ folded: boolean; side?: 'left' | 'right' | 'down'; label?: string; icons?: [string, string]; title?: string }>(),
  { side: 'left' }
)
defineEmits<{ (e: 'update:folded', v: boolean): void }>()

const icon = computed(() => {
  if (props.icons) return props.folded ? props.icons[0] : props.icons[1]
  if (props.side === 'down') return props.folded ? 'ri-arrow-down-s-line' : 'ri-arrow-up-s-line'
  if (props.side === 'right') return props.folded ? 'ri-side-bar-fill' : 'ri-side-bar-line'
  return props.folded ? 'ri-menu-unfold-line' : 'ri-menu-fold-line'
})
</script>

<template>
  <button class="ui-icon-btn ui-back" type="button" :title="label" @click="go">
    <i class="ri-arrow-left-s-line"></i><span v-if="label">{{ label }}</span>
  </button>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

/** 全项目唯一的返回按钮。给 to 就跳路由，否则抛 back 事件，都没有就 router.back() */
const props = defineProps<{ label?: string; to?: string }>()
const emit = defineEmits<{ (e: 'back'): void }>()
const router = useRouter()

function go() {
  if (props.to) router.push(props.to)
  else emit('back')
}
</script>

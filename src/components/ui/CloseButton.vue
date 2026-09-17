<template>
  <button class="ui-icon-btn ui-close" :class="{ sm: small }" type="button" :title="title || '关闭'" @click.stop="$emit('click')">
    <i class="ri-close-line"></i>
  </button>
</template>

<script setup lang="ts">
defineProps<{ small?: boolean; title?: string }>()
defineEmits<{ (e: 'click'): void }>()
</script>

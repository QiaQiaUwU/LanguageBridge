<template>
  <button
    class="ui-icon-btn ui-star"
    :class="{ on: modelValue, sm: small }"
    type="button"
    :title="title || '收藏'"
    :aria-pressed="modelValue"
    @click.stop="$emit('update:modelValue', !modelValue)"
  >
    <i :class="modelValue ? 'ri-star-fill' : 'ri-star-line'"></i>
  </button>
</template>

<script setup lang="ts">
defineProps<{ modelValue: boolean; small?: boolean; title?: string }>()
defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
</script>

<template>
  <button
    class="ui-icon-btn ui-bookmark"
    :class="{ on: modelValue, sm: small }"
    type="button"
    :title="title || '书签'"
    :aria-pressed="modelValue"
    @click.stop="$emit('update:modelValue', !modelValue)"
  >
    <i :class="modelValue ? 'ri-bookmark-fill' : 'ri-bookmark-line'"></i>
  </button>
</template>

<script setup lang="ts">
defineProps<{ modelValue: boolean; small?: boolean; title?: string }>()
defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
</script>

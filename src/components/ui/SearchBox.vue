<template>
  <label class="ui-search">
    <i class="ri-search-line"></i>
    <input
      :value="modelValue"
      :placeholder="placeholder || '搜索'"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @keydown.enter="$emit('enter')"
      @keydown.esc="$emit('update:modelValue', '')"
    />
    <CloseButton v-if="modelValue" small title="清空" @click="$emit('update:modelValue', '')" />
  </label>
</template>

<script setup lang="ts">
import CloseButton from './CloseButton.vue'
defineProps<{ modelValue: string; placeholder?: string }>()
defineEmits<{ (e: 'update:modelValue', v: string): void; (e: 'enter'): void }>()
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ui-mask" @mousedown.self="$emit('close')">
      <div class="ui-dialog" :style="width ? { '--dialog-w': width } : undefined" role="dialog">
        <div v-if="title || $slots.tools" class="ui-dialog-head">
          <h3 class="ui-dialog-title">{{ title }}</h3>
          <slot name="tools" />
          <CloseButton @click="$emit('close')" />
        </div>
        <slot />
        <div v-if="$slots.foot" class="ui-dialog-foot"><slot name="foot" /></div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import CloseButton from './CloseButton.vue'

const props = defineProps<{ open: boolean; title?: string; width?: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
watch(() => props.open, v => {
  if (v) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
}, { immediate: true })
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

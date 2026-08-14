<template>
  <div class="legend">
    <div class="legend-group">
      <span class="group-label">关系</span>
      <div class="legend-items">
      <div class="legend-item">
        <svg class="line-sample" viewBox="0 0 24 8">
          <path d="M1 4 H23" :stroke="relationColor('synonym')" stroke-width="2" fill="none" />
        </svg>
        近义词
      </div>
      <div class="legend-item">
        <svg class="line-sample" viewBox="0 0 24 8">
          <path d="M1 4 H23" :stroke="relationColor('antonym')" stroke-width="2" fill="none" />
        </svg>
        反义词
      </div>
      <div class="legend-item">
        <svg class="line-sample" viewBox="0 0 24 8">
          <path d="M1 4 H23" :stroke="relationColor('word_family')" stroke-width="2" fill="none" />
        </svg>
        同根词
      </div>
      <div v-if="showMorph" class="legend-item">
        <svg class="line-sample" viewBox="0 0 24 8">
          <path d="M1 4 H23" :stroke="relationColor('morphology')" stroke-width="2" stroke-dasharray="3 2" fill="none" />
        </svg>
        词形变换
      </div>
      </div>
    </div>

    <div v-if="colorItems.length && colorItems.length <= LEGEND_MAX" class="legend-group">
      <span class="group-label">{{ colorGroupLabel }}</span>
      <div class="legend-items">
        <div v-for="s in colorItems" :key="s.name" class="legend-item">
          <span class="dot" :style="{ background: s.color }"></span>{{ s.name }}
        </div>
      </div>
    </div>

    <div class="legend-group">
      <span class="group-label">节点</span>
      <div class="legend-items">

      <div class="legend-item"><span class="dot" :style="{ background: accentColor }"></span>越大 = 关系越多（词族算在内）</div>
      <div v-if="showBridge" class="legend-item">
        <svg class="line-sample" viewBox="0 0 24 8">
          <path d="M1 4 H23" stroke="currentColor" stroke-width="2" stroke-opacity="0.3" fill="none" />
        </svg>
        很淡的长线 = 两个星座的核心词之间
      </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useThemeStore } from '@/shared/stores/themeStore'
import { SOURCE_ORDER } from './graphColors'
import { sourceColor, relationColor, onColorChange } from '@/shared/core/graphColorSettings'

const colorTick = ref(0)
let unsubColor: (() => void) | null = null
onMounted(() => { unsubColor = onColorChange(() => colorTick.value++) })
onUnmounted(() => { unsubColor?.(); unsubColor = null })

const props = withDefaults(defineProps<{
  sources?: string[]
  colorBy?: 'exam' | 'topic' | 'morpheme' | 'mastery'
  items?: { name: string; color: string }[]
  showBridge?: boolean
  showMorph?: boolean
}>(), { colorBy: 'exam' })

const LEGEND_MAX = 8

const colorGroupLabel = computed(() =>
  props.colorBy === 'topic' ? '话题'
    : props.colorBy === 'morpheme' ? '词根词缀'
    : props.colorBy === 'mastery' ? '掌握'
    : '考试'
)

const colorItems = computed(() =>
  props.colorBy === 'exam' ? visibleSources.value : (props.items || [])
)

const themeStore = useThemeStore()
const accentColor = computed(() => themeStore.current.accent)

const visibleSources = computed(() => {
  const set = new Set(props.sources || [])
  const seenColor = new Set<string>()
  const out: { name: string; color: string }[] = []
  for (const name of SOURCE_ORDER) {
    if (!set.has(name)) continue
    void colorTick.value
    const color = sourceColor(name)
    if (!color || seenColor.has(color)) continue
    seenColor.add(color)
    out.push({ name, color })
  }
  return out
})
</script>

<style scoped>
.legend {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 5px 10px;
  align-items: baseline;
  font-size: 12px;
  color: var(--r-ink2, #666);
}
.legend-group { display: contents; }
.legend-items { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 12px; }
.group-label {
  font-size: 11px; opacity: 0.55; letter-spacing: 0.05em;
  text-align: right; white-space: nowrap;
}
.group-label { font-size: 11px; opacity: 0.55; letter-spacing: 0.05em; }
.legend-item { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
.sub { opacity: 0.6; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ring-sample { background: #8b5cf6; box-shadow: 0 0 0 2px #f59e0b; }
.line-sample { width: 24px; height: 8px; flex-shrink: 0; }
</style>

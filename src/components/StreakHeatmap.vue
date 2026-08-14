<template>
  <div class="streak-card">
    <div class="streak-head">
      <div class="streak-badge">
        <span class="streak-num">{{ streak }}</span>
        <span class="streak-label">天连续打卡</span>
      </div>
      <div class="today-stats">
        <div class="ts-item"><b>{{ today.newWords }}</b><span>今日新词</span></div>
        <div class="ts-item"><b>{{ today.minutesActive }}</b><span>学习分钟</span></div>
        <div class="ts-item"><b>{{ today.reviewCount }}</b><span>复习次数</span></div>
        <div class="ts-item"><b>{{ accuracy }}</b><span>正确率</span></div>
      </div>
    </div>

    <div class="heatmap" v-if="weeks.length">
      <div class="heatmap-col" v-for="(week, wi) in weeks" :key="wi">
        <div
          v-for="cell in week"
          :key="cell.date"
          class="heatmap-cell"
          :class="`level-${cell.level}`"
          :title="cell.date"
        ></div>
      </div>
    </div>
    <p v-else-if="loadError" class="load-error">加载打卡数据失败：{{ loadError }}</p>

    <div class="heatmap-legend">
      <span>少</span>
      <span class="legend-cell level-0"></span>
      <span class="legend-cell level-1"></span>
      <span class="legend-cell level-2"></span>
      <span class="legend-cell level-3"></span>
      <span>多</span>
    </div>
    <p v-if="!loadError && streak === 0 && !today.newWords && !today.reviewCount && !today.minutesActive" class="empty-hint">
      还没有学习记录——去词汇中心标记几个单词为"认识"、或做一次听写，这里就会开始有数据了
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { getStreak, getTodayStats, getHeatmap, type DayActivity, type HeatmapCell } from '@/shared/core/activityLog'

const props = withDefaults(defineProps<{ weeksToShow?: number }>(), { weeksToShow: 18 })

const streak = ref(0)
const today = ref<DayActivity>({ date: '', newWords: 0, reviewCount: 0, correctCount: 0, minutesActive: 0 })
const weeks = ref<HeatmapCell[][]>([])

const accuracy = computed(() =>
  today.value.reviewCount ? `${Math.round((today.value.correctCount / today.value.reviewCount) * 100)}%` : '—'
)

const loadError = ref('')

async function load() {
  loadError.value = ''
  try {
    streak.value = await getStreak()
    today.value = await getTodayStats()
    weeks.value = await getHeatmap(props.weeksToShow)
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : '未知错误'
  }
}

defineExpose({ reload: load })

onMounted(load)
</script>

<style scoped>
.streak-card {
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 16px 18px;
}
.streak-head {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.streak-badge {
  display: flex;
  align-items: baseline;
  gap: 6px;
  background: #fdf6e8;
  border: 1px solid #f0e2bd;
  border-radius: 10px;
  padding: 8px 16px;
}
.streak-num { font-size: 24px; font-weight: 700; color: #8a6d2f; }
.streak-label { font-size: 12.5px; color: #8a6d2f; }

.today-stats { display: flex; gap: 20px; flex-wrap: wrap; }
.ts-item { text-align: center; }
.ts-item b { display: block; font-size: 18px; color: #1a1a1a; }
.ts-item span { font-size: 11.5px; color: #999; }

.heatmap { display: flex; gap: 3px; overflow-x: auto; }
.heatmap-col { display: flex; flex-direction: column; gap: 3px; }
.heatmap-cell {
  width: 11px;
  height: 11px;
  border-radius: 2px;
  background: #ebedf0;
}
.heatmap-cell.level-1 { background: #c6e48b; }
.heatmap-cell.level-2 { background: #7bc96f; }
.heatmap-cell.level-3 { background: #339a4a; }

.heatmap-legend {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  color: #999;
  font-size: 11px;
}
.legend-cell { width: 11px; height: 11px; border-radius: 2px; background: #ebedf0; }
.legend-cell.level-1 { background: #c6e48b; }
.legend-cell.level-2 { background: #7bc96f; }
.legend-cell.level-3 { background: #339a4a; }
.empty-hint { margin-top: 12px; color: #999; font-size: 12.5px; }
.load-error { margin-top: 8px; color: #b05a4a; font-size: 12.5px; }
</style>

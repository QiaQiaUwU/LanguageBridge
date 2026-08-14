<template>
  <div class="study-page">
    <button class="quit-corner" title="退出" @click="quit">←</button>

    <main class="study-body">
      <p v-if="isWrongRound" class="wrong-round-tip">错词重练 · 这一轮里打错过的词，全部答对才进下一阶段</p>

      <TypingCard
        v-if="currentWord"
        :key="currentWord.id + '-' + type"
        :word="currentWord"
        :type="type"
        :prev-word="prevWordText"
        :next-word="nextWordText"
        :pool="currentList"
        :show-translate="showTranslate"
        :hide-word="hideWord"
        @complete="onComplete"
        @wrong="onWrong"
        @know="onKnow"
        @mastered="onMastered"
      />

      <div v-if="scenarioPrompt.length" class="scen-mask">
        <div class="scen-card">
          <p class="scen-title">刚学了 {{ scenarioPrompt.length }} 个词</p>
          <p class="scen-sub">用这批词过一段场景对话，比接着往下背记得牢。</p>
          <div class="scen-words">
            <span v-for="w in scenarioPrompt.slice(0, 12)" :key="w.id">{{ w.word }}</span>
            <span v-if="scenarioPrompt.length > 12">…</span>
          </div>
          <div class="scen-acts">
            <button class="dark-btn" @click="goScenario">去场景学习</button>
            <button class="ghost-btn" @click="skipScenario">接着背</button>
          </div>
        </div>
      </div>

      <div v-if="finished" class="settle">
        <h2>本轮完成</h2>
        <div class="settle-grid">
          <div class="settle-card"><span class="num">{{ minutes }}</span><span class="lbl">学习分钟</span></div>
          <div class="settle-card"><span class="num">{{ accuracy }}%</span><span class="lbl">正确率</span></div>
          <div class="settle-card"><span class="num">{{ newCount }}</span><span class="lbl">新学</span></div>
          <div class="settle-card"><span class="num">{{ reviewCount }}</span><span class="lbl">复习</span></div>
        </div>

        <div v-if="wrongSummary.length" class="wrong-summary">
          <h3>错词统计</h3>
          <ul>
            <li v-for="w in wrongSummary" :key="w.word">
              <span class="w">{{ w.word }}</span>
              <span class="t">错 {{ w.times }} 次</span>
            </li>
          </ul>
        </div>

        <div class="settle-actions">
          <button class="dark-btn" @click="goWrongBook">查看错词本</button>
          <button class="ghost-btn" @click="restart">再来一轮</button>
          <button class="ghost-btn" @click="quit">退出</button>
        </div>
      </div>

      <p v-if="!currentWord && !finished && !scenarioPrompt.length" class="empty">没有可学的词，去词汇中心导入词书，或调大每日学习量。</p>
    </main>

    <aside class="wordlist-panel" :class="{ open: showPanel }" @click.self="showPanel = false">
      <div class="wl-body">
        <div class="wl-title">
          <span>{{ scopeLabel || '本轮词表' }}</span>
          <span class="wl-count">{{ index + 1 }} / {{ currentList.length }}</span>
        </div>
        <div class="wl-list">
          <div
            v-for="(w, i) in currentList"
            :key="w.id"
            class="wl-item"
            :class="{ on: i === index, done: i < index }"
            @click="index = i"
          >
            <span class="wl-w">{{ w.word }}</span>
            <span class="wl-t">{{ w.meanings?.[0]?.chinese || '' }}</span>
          </div>
        </div>
      </div>
    </aside>

    <div class="footer-wrap" :class="{ hide: !showToolbar }">
      <button class="fold-arrow" :title="showToolbar ? '收起' : '展开'" @click="showToolbar = !showToolbar">
        {{ showToolbar ? '▾' : '▴' }}
      </button>
      <div class="footer-card">
        <div class="stage-track">
          <div
            v-for="s in stageList"
            :key="s"
            class="stage-seg"
            :class="{ done: stageIndex > stageList.indexOf(s), active: stage === s }"
            :title="STAGE_NAMES[s]"
          >
            <i v-if="stage === s" :style="{ width: stageFillPct }"></i>
          </div>
        </div>

        <div class="footer-row">
          <div class="stat">
            <div class="row">
              <div class="num">{{ index + 1 }} / {{ currentList.length }}</div>
              <div class="line"></div>
              <div class="name">{{ isWrongRound ? '错词重练' : stageName }}</div>
            </div>
            <div class="row">
              <div class="num clickable" :class="{ paused }" @click="togglePause">{{ minutes }}</div>
              <div class="line"></div>
              <div class="name">{{ paused ? '已暂停' : '分钟' }}</div>
            </div>
            <div class="row">
              <div class="num">{{ currentList.length }}</div>
              <div class="line"></div>
              <div class="name">总词数</div>
            </div>
            <div class="row">
              <div class="num">{{ totalWrong }}</div>
              <div class="line"></div>
              <div class="name">错误</div>
            </div>
          </div>

          <div class="tools">
            <button class="ticon" :class="{ on: hideWord }" :title="hideWord ? '显示单词' : '默写模式（遮住单词）'" @click="hideWord = !hideWord">
              <svg v-if="hideWord" viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M12 6a9.8 9.8 0 0 1 9 6 9.8 9.8 0 0 1-2.6 3.5l1.4 1.4 1.4-1.4L3.5 2.8 2.1 4.2l3.1 3.1A9.9 9.9 0 0 0 3 12a9.8 9.8 0 0 0 9 6 9.7 9.7 0 0 0 3.4-.6l2 2 1.4-1.4L6.6 5.2A9.7 9.7 0 0 1 12 6z"/></svg>
              <svg v-else viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M12 6a9.8 9.8 0 0 1 9 6 9.8 9.8 0 0 1-9 6 9.8 9.8 0 0 1-9-6 9.8 9.8 0 0 1 9-6zm0 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/></svg>
            </button>
            <button class="ticon" :class="{ on: !showTranslate }" :title="showTranslate ? '隐藏释义' : '显示释义'" @click="showTranslate = !showTranslate">
              <svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M12.9 15 10 12.1l.1-.1A17 17 0 0 0 13.8 5H17V3h-7V1H8v2H1v2h11.2A15 15 0 0 1 9 10.6 15 15 0 0 1 6.8 7H4.8A17 17 0 0 0 7.6 12L2.7 16.8 4.1 18.2 9 13.3l3 3zM17.5 10h-2L11 22h2l1.1-3h4.7l1.2 3h2zm-2.6 7 1.6-4.3 1.6 4.3z"/></svg>
            </button>
            <button class="ticon" title="发音" @click="speakCurrent">
              <svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>
            </button>
            <button class="ticon" title="设置" @click="router.push('/settings')">
              <svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M19.4 13a7.4 7.4 0 0 0 0-2l2-1.6a.5.5 0 0 0 .1-.6l-1.9-3.3a.5.5 0 0 0-.6-.2l-2.4 1a7.5 7.5 0 0 0-1.7-1l-.4-2.5a.5.5 0 0 0-.5-.4h-3.8a.5.5 0 0 0-.5.4l-.4 2.5c-.6.3-1.2.6-1.7 1l-2.4-1a.5.5 0 0 0-.6.2L2.7 8.8a.5.5 0 0 0 .1.6L4.9 11a7.4 7.4 0 0 0 0 2l-2 1.6a.5.5 0 0 0-.1.6l1.9 3.3c.1.2.4.3.6.2l2.4-1c.5.4 1.1.8 1.7 1l.4 2.5c0 .2.3.4.5.4h3.8c.2 0 .5-.2.5-.4l.4-2.5c.6-.2 1.2-.6 1.7-1l2.4 1c.2.1.5 0 .6-.2l1.9-3.3a.5.5 0 0 0-.1-.6zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>
            </button>
            <button class="ticon" :class="{ on: showPanel }" title="词表" @click="showPanel = !showPanel">
              <svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import TypingCard from './components/TypingCard.vue'
import { useWordStore } from '@/shared/stores/wordStore'
import { playWord } from '@/shared/core/audio'
import type { WordItem } from '@/shared/types/WordItem'
import {
  getStudySettings, saveStudySettings, MODE_STAGES, STAGE_NAMES, typeOfStage, isReviewStage,
  type PracticeStage, type PracticeType
} from '@/shared/core/studySettings'
import { buildTodayTask } from '@/shared/core/scheduler'
import { readScope, wordsOfScope, groupOfScope } from '@/shared/core/studyScope'
import { getScopeProgress, saveScopeProgress, scopeKeyOfTag } from '@/shared/core/scopeProgress'
import { loadFsrsData, applyGrade, getGradeByWrongTimes, flushFsrsData, forgetWord, Rating } from '@/shared/core/fsrs'
import { loadMasteredWords, getIgnoreSet, addMastered, getMasteredSet } from '@/shared/core/masteredWords'
import { recordReview, recordWordsLearned, recordActiveMinute } from '@/shared/core/activityLog'

const router = useRouter()
const route = useRoute()
const wordStore = useWordStore()
const settings = getStudySettings()

const GROUP_SIZE = 7

const groupId = computed(() => (route.query.group as string) || '')
const scopeLabel = ref('')
const modeParam = computed(() => (route.query.mode as string) || settings.practiceMode)

const stageList = computed<PracticeStage[]>(() => MODE_STAGES[modeParam.value as keyof typeof MODE_STAGES] || MODE_STAGES.system)

const stage = ref<PracticeStage>('followWriteNew')
const stageIndex = computed(() => stageList.value.indexOf(stage.value))
const stageName = computed(() => STAGE_NAMES[stage.value] || '')

const type = ref<PracticeType>('followWrite')

const taskNew = ref<WordItem[]>([])
const taskReview = ref<WordItem[]>([])
const currentList = ref<WordItem[]>([])
const index = ref(0)
const showPanel = ref(localStorage.getItem('lb-study-panel') === '1')
watch(showPanel, v => localStorage.setItem('lb-study-panel', v ? '1' : '0'))
const showToolbar = ref(localStorage.getItem('lb-study-toolbar') !== '0')
watch(showToolbar, v => localStorage.setItem('lb-study-toolbar', v ? '1' : '0'))
const showTranslate = ref(getStudySettings().showTranslate)
watch(showTranslate, v => saveStudySettings({ showTranslate: v }))
const hideWord = ref(false)
function speakCurrent() {
  if (currentWord.value) playWord(currentWord.value.word, 'us', getStudySettings().wordSoundSpeed)
}
const stageFillPct = computed(() =>
  currentList.value.length ? `${Math.round((index.value / currentList.value.length) * 100)}%` : '0%'
)
const finished = ref(false)

const wrongTimesMap = ref<Record<string, number>>({})
const ratingMap = ref<Record<string, number>>({})
const wrongWords = ref<WordItem[]>([])
const curWrong = ref(0)
const isWrongRound = ref(false)
const excludeWords = ref<Set<string>>(new Set())

const newCount = ref(0)
const reviewCount = ref(0)
const totalWrong = computed(() => Object.keys(wrongTimesMap.value).length)

const prevWordText = computed(() => currentList.value[index.value - 1]?.word || '')
const nextWordText = computed(() => currentList.value[index.value + 1]?.word || '')

const currentWord = computed<WordItem | null>(() => currentList.value[index.value] || null)

const segments = ref<[number, number][]>([])
const paused = ref(false)
let tickTimer: ReturnType<typeof setInterval> | null = null
let lastKeyAt = Date.now()
const IDLE_LIMIT = 3 * 60 * 1000

const spend = computed(() => segments.value.reduce((sum, [a, b]) => sum + Math.max(0, b - a), 0))
const minutes = computed(() => Math.floor(spend.value / 60000))

function resumeTimer() {
  if (!paused.value && segments.value.length) return
  paused.value = false
  const now = Date.now()
  segments.value.push([now, now])
}
function pauseTimer() {
  if (paused.value) return
  if (segments.value.length) segments.value[segments.value.length - 1][1] = Date.now()
  paused.value = true
}
function togglePause() {
  paused.value ? resumeTimer() : pauseTimer()
}
function tick() {
  if (paused.value) return
  const now = Date.now()
  if (now - lastKeyAt > IDLE_LIMIT) { pauseTimer(); return }
  if (segments.value.length) segments.value[segments.value.length - 1][1] = now
  if (Math.floor(spend.value / 60000) !== Math.floor((spend.value - 1000) / 60000)) recordActiveMinute()
}
function onAnyKey() {
  lastKeyAt = Date.now()
  if (paused.value) resumeTimer()
}
function onVisibility() {
  document.hidden ? pauseTimer() : resumeTimer()
}

const accuracy = computed(() => {
  const total = newCount.value + reviewCount.value
  if (!total) return 100
  return Math.max(0, Math.round(((total - totalWrong.value) / total) * 100))
})

const wrongSummary = computed<{ word: string; times: number }[]>(() =>
  Object.entries(wrongTimesMap.value)
    .map(([word, times]) => ({ word, times: Number(times) }))
    .sort((a, b) => b.times - a.times)
)

async function init() {
  await wordStore.loadWords()
  await loadFsrsData()
  await loadMasteredWords()

  const scope = readScope(route.query as Record<string, any>)
  scopeLabel.value = scope.label
  let group = groupOfScope(scope, wordStore.groups)
  const words = wordsOfScope(scope, wordStore.words, wordStore.groups)

  if (!group) {
    const key = scope.kind === 'tag' && scope.tag ? scopeKeyOfTag(scope.tag) : 'all'
    const p = getScopeProgress(key)
    group = { id: '', name: scope.label || '', ...p } as any
  }

  const task = buildTodayTask({ words, group, ignoreSet: getIgnoreSet(settings.ignoreSimpleWord) })
  taskNew.value = task.newWords
  taskReview.value = task.reviewWords
  newCount.value = task.newWords.length
  reviewCount.value = task.reviewWords.length

  stage.value = stageList.value[0]
  enterStage(stage.value, true)
}

function wordsForStage(s: PracticeStage): WordItem[] {
  const list = isReviewStage(s) ? taskReview.value : taskNew.value
  return list.filter(w => !excludeWords.value.has(w.word.toLowerCase()))
}

function shuffle<T>(a: T[]): T[] {
  const r = [...a]
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

function enterStage(s: PracticeStage, first = false) {
  if (s === 'complete') { complete(); return }
  stage.value = s
  type.value = typeOfStage(s)
  isWrongRound.value = false
  wrongWords.value = []
  index.value = 0
  const list = wordsForStage(s)
  currentList.value = s === 'followWriteNew' || s === 'followWriteReview' ? list : shuffle(list)
  if (!currentList.value.length && !first) {
    nextStage()
  } else if (!currentList.value.length && first) {
    nextStage()
  }
}

function nextStage() {
  const i = stageList.value.indexOf(stage.value)
  const next = stageList.value[i + 1]
  if (!next) { complete(); return }
  enterStage(next)
}

function groupLoop() {
  if (type.value === 'followWrite') {
    index.value++
    if (index.value % GROUP_SIZE === 0) {
      type.value = 'spell'
      index.value -= GROUP_SIZE
    }
  } else {
    index.value++
    if (index.value % GROUP_SIZE === 0) {
      type.value = 'followWrite'
    }
  }
}

function onWrong() {
  curWrong.value++
  const w = currentWord.value
  if (!w) return
  const key = w.word.toLowerCase()
  excludeWords.value.delete(key)
  if (!wrongWords.value.find(x => x.word.toLowerCase() === key)) {
    wrongWords.value.push(w)
  }
  recordReview(false)
}

function onKnow() {
  const w = currentWord.value
  if (!w) return
  ratingMap.value[w.word.toLowerCase()] = Rating.Good as unknown as number
  excludeWords.value.add(w.word.toLowerCase())
  wordStore.setWordStatus(w.id, 'known')
}

function onMastered() {
  const w = currentWord.value
  if (!w) return
  const key = w.word.toLowerCase()
  ratingMap.value[key] = Rating.Easy as unknown as number
  excludeWords.value.add(key)
  addMastered(key)
  forgetWord(key)
  onComplete()
}

function onComplete() {
  const w = currentWord.value
  if (w) {
    const key = w.word.toLowerCase()
    if (type.value === 'spell' && curWrong.value === 0 && wrongTimesMap.value[key]) {
      const i = wrongWords.value.findIndex(x => x.word.toLowerCase() === key)
      if (i >= 0) wrongWords.value.splice(i, 1)
    }
    wrongTimesMap.value[key] = (wrongTimesMap.value[key] || 0) + curWrong.value
    if (!recentWords.value.some(x => x.id === w.id)) recentWords.value.push(w)
    if (curWrong.value === 0) recordReview(true)
  }
  curWrong.value = 0

  if (settings.scenarioEvery > 0 && isNewWordStage.value) {
    learnedSinceScenario.value++
    if (learnedSinceScenario.value >= settings.scenarioEvery) {
      learnedSinceScenario.value = 0
      scenarioPrompt.value = recentWords.value.slice(-settings.scenarioEvery)
      return
    }
  }
  advance()
}

const isNewWordStage = computed(() =>
  stage.value === 'followWriteNew' || stage.value === 'identifyNew' ||
  stage.value === 'listenNew' || stage.value === 'dictationNew'
)
const learnedSinceScenario = ref(0)
const scenarioPrompt = ref<WordItem[]>([])
const recentWords = ref<WordItem[]>([])

function goScenario() {
  const words = scenarioPrompt.value
  scenarioPrompt.value = []
  wordStore.setStudyList(words)
  router.push('/scenario')
}
function skipScenario() {
  scenarioPrompt.value = []
  advance()
}

function advance() {
  const isLast = index.value >= currentList.value.length - 1

  if (!isLast) {
    if (stage.value === 'followWriteNew' || stage.value === 'followWriteReview' || isWrongRound.value) {
      groupLoop()
    } else {
      index.value++
    }
    skipExcluded()
    return
  }

  if ((stage.value === 'followWriteNew' || stage.value === 'followWriteReview') && type.value !== 'spell') {
    type.value = 'spell'
    index.value = Math.floor(index.value / GROUP_SIZE) * GROUP_SIZE
    skipExcluded()
    return
  }

  const remaining = wrongWords.value.filter(w => !excludeWords.value.has(w.word.toLowerCase()))
  if (remaining.length) {
    isWrongRound.value = true
    type.value = 'followWrite'
    currentList.value = shuffle(remaining)
    wrongWords.value = []
    index.value = 0
    skipExcluded()
    return
  }

  isWrongRound.value = false
  nextStage()
}

function skipExcluded() {
  let guard = 0
  while (
    currentWord.value &&
    excludeWords.value.has(currentWord.value.word.toLowerCase()) &&
    guard++ < currentList.value.length + 1
  ) {
    if (index.value >= currentList.value.length - 1) { advance(); return }
    index.value++
  }
}

function skipStage() {
  wrongWords.value = []
  isWrongRound.value = false
  nextStage()
}

let settled = false
async function complete() {
  if (settled) return
  settled = true
  pauseTimer()
  currentList.value = []
  finished.value = true

  for (const [word, times] of Object.entries(wrongTimesMap.value)) {
    const manual = ratingMap.value[word]
    applyGrade(word, (manual !== undefined ? manual : getGradeByWrongTimes(Number(times))) as any)
  }
  await flushFsrsData()

  if (settings.autoMarkStatus) {
    const byWord = new Map(wordStore.words.map(w => [w.word.toLowerCase(), w]))
    const mastered = getMasteredSet()
    for (const [word, times] of Object.entries(wrongTimesMap.value)) {
      const key = word.toLowerCase()
      const hit = byWord.get(key)
      if (!hit || mastered.has(key)) continue
      const n = Number(times)
      await wordStore.setWordStatus(
        hit.id,
        n <= settings.statusKnownLimit ? 'known'
          : n <= settings.statusFuzzyLimit ? 'fuzzy'
            : 'unknown'
      )
    }
  }

  const group = wordStore.groups.find(g => g.id === groupId.value)
  if (group && newCount.value) {
    const ids = new Set(group.wordIds)
    const ordered = wordStore.words.filter(w => ids.has(w.id))
    const total = ordered.length
    const nextIndex = Math.min((group.lastLearnIndex || 0) + newCount.value, total)

    const ignore = getIgnoreSet(settings.ignoreSimpleWord)
    const ignoreCount = ordered.slice(nextIndex).filter(w => ignore.has(w.word.toLowerCase())).length
    const done = nextIndex + ignoreCount >= total

    await wordStore.updateGroup(group.id, {
      lastLearnIndex: done ? total : nextIndex,
      complete: done
    })
  } else if (!group && newCount.value) {
    const scope = readScope(route.query as Record<string, any>)
    if (scope.kind === 'tag' && scope.tag) {
      const key = scopeKeyOfTag(scope.tag)
      const cur = getScopeProgress(key)
      const total = currentList.value.length
      saveScopeProgress(key, {
        lastLearnIndex: Math.min((cur.lastLearnIndex || 0) + newCount.value, total)
      })
    }
  }
  await recordWordsLearned(newCount.value)
}

function restart() {
  settled = false
  finished.value = false
  wrongTimesMap.value = {}
  ratingMap.value = {}
  excludeWords.value = new Set()
  segments.value = []
  init().then(resumeTimer)
}

function goWrongBook() { router.push('/wrong-book') }
function quit() { router.push('/home') }

watch(currentWord, w => { if (w) curWrong.value = 0 })

onMounted(() => {
  init()
  resumeTimer()
  tickTimer = setInterval(tick, 1000)
  window.addEventListener('keydown', onAnyKey)
  document.addEventListener('visibilitychange', onVisibility)
})
onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer)
  window.removeEventListener('keydown', onAnyKey)
  document.removeEventListener('visibilitychange', onVisibility)
  if (!settled && Object.keys(wrongTimesMap.value).length) flushFsrsData()
})
</script>

<style scoped lang="scss">
.study-page { max-width: 900px; margin: 0 auto; padding: 16px 20px 150px; position: relative; }
.quit-corner {
  position: fixed; left: calc(var(--lb-nav-w, 56px) + 14px); top: 14px; z-index: 30;
  width: 30px; height: 30px; border: none; border-radius: 8px;
  background: var(--r-ui, #f4f5f7); color: var(--r-ink2, #8a9099);
  font-size: 15px; cursor: pointer;
  &:hover { color: var(--r-ink, #1f2328); }
}
.study-body { min-height: 320px; }

.footer-wrap {
  position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%);
  width: min(660px, calc(100vw - var(--lb-nav-w, 56px) - 48px));
  z-index: 20; transition: bottom .3s ease;
  &.hide { bottom: -92px; }
}
.fold-arrow {
  position: absolute; left: 50%; top: -22px; transform: translateX(-50%);
  border: none; background: none; color: var(--r-ink2, #b8bec6);
  font-size: 13px; cursor: pointer; padding: 4px 12px;
  &:hover { color: var(--r-ink, #1f2328); }
}
.footer-card {
  border-radius: 14px; background: var(--r-ui, #f4f5f7);
  box-shadow: 0 6px 22px rgba(0, 0, 0, .07);
  padding: 10px 16px 12px;
}
.stage-track { display: flex; gap: 4px; margin-bottom: 10px; }
.stage-seg {
  flex: 1; height: 4px; border-radius: 2px; position: relative; overflow: hidden;
  background: var(--r-border, #e5e7eb);
  &.done { background: var(--r-ink2, #8a9099); }
  i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--r-ink, #1f2328); transition: width .25s ease; }
}
.footer-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; }
.stat { display: flex; gap: 26px; }
.stat .row { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 52px; }
.stat .num { font-size: 15px; color: var(--r-ink, #1f2328); line-height: 1.2; white-space: nowrap; }
.stat .num.clickable { cursor: pointer; }
.stat .num.paused { opacity: .45; }
.stat .line { height: 1px; width: 100%; background: var(--r-border, #e5e7eb); }
.stat .name { font-size: 11.5px; color: var(--r-ink2, #a0a6ad); white-space: nowrap; }
.tools { display: flex; gap: 4px; }
.ticon {
  border: none; background: none; color: var(--r-ink2, #a0a6ad);
  padding: 6px; border-radius: 7px; cursor: pointer; line-height: 0;
  &:hover { color: var(--r-ink, #1f2328); background: var(--r-paper, #fff); }
  &.on { color: var(--r-ink, #1f2328); background: var(--r-paper, #fff); }
}

.wordlist-panel {
  position: fixed; right: 0; top: 0; bottom: 0; width: 300px;
  transform: translateX(100%); transition: transform .28s ease;
  z-index: 25;
  &.open { transform: translateX(0); }
}
.wl-body {
  height: 100%; display: flex; flex-direction: column;
  background: var(--r-paper, #fff);
  border-left: 1px solid var(--r-border, #e5e7eb);
}
.wl-title {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 16px 16px 10px; font-size: 14px; color: var(--r-ink, #1f2328);
}
.wl-count { font-size: 12px; color: var(--r-ink2, #a0a6ad); }
.wl-list { flex: 1; overflow: auto; padding: 0 8px 16px; }
.wl-item {
  padding: 8px 10px; border-radius: 8px; cursor: pointer;
  display: flex; flex-direction: column; gap: 2px;
  &:hover { background: var(--r-ui, #f4f5f7); }
  &.on { background: var(--r-ui, #f4f5f7); }
  &.done .wl-w { color: var(--r-ink2, #b8bec6); }
}
.wl-w { font-size: 14px; color: var(--r-ink, #1f2328); }
.wl-t { font-size: 12px; color: var(--r-ink2, #a0a6ad); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wrong-round-tip {
  text-align: center;
  font-size: 13px;
  color: #d9822b;
  background: rgba(217, 130, 43, 0.08);
  padding: 6px 12px;
  border-radius: 8px;
  margin: 14px auto 0;
  max-width: 460px;
}
.settle { text-align: center; padding: 30px 0; }
.settle h2 { font-size: 20px; margin: 0 0 20px; }
.settle-grid { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
.settle-card {
  min-width: 96px;
  padding: 14px 18px;
  border: 1px solid var(--r-border, #e4e4e4);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.settle-card .num { font-size: 22px; font-weight: 600; }
.settle-card .lbl { font-size: 12px; color: var(--r-ink2, #888); }
.wrong-summary { margin: 26px auto 0; max-width: 420px; text-align: left; }
.wrong-summary h3 { font-size: 14px; margin: 0 0 8px; }
.wrong-summary ul { list-style: none; padding: 0; margin: 0; }
.wrong-summary li {
  display: flex;
  justify-content: space-between;
  padding: 5px 0;
  border-bottom: 1px solid var(--r-border, #eee);
  font-size: 13.5px;
}
.wrong-summary .t { color: #d9534f; }
.settle-actions { display: flex; gap: 10px; justify-content: center; margin-top: 26px; flex-wrap: wrap; }
.empty { text-align: center; color: var(--r-ink2, #999); padding: 60px 0; }
.scope-label {
  font-size: 12px;
  color: var(--r-ink2, #999);
  padding: 2px 8px;
  border-radius: 9999px;
  background: var(--r-ui, #f4f4f4);
  white-space: nowrap;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.scen-mask {
  position: fixed; inset: 0; z-index: 240; display: flex;
  align-items: center; justify-content: center; padding: 24px;
  background: rgba(0, 0, 0, 0.4);
}
.scen-card {
  width: min(460px, 100%); border-radius: 14px; padding: 24px;
  background: var(--r-paper, #fff); color: var(--r-ink, #222);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.22); text-align: center;
}
.scen-title { margin: 0; font-size: 19px; font-weight: 700; }
.scen-sub { margin: 8px 0 16px; font-size: 13px; color: var(--r-ink2, #888); }
.scen-words {
  display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-bottom: 20px;
}
.scen-words span {
  padding: 3px 9px; border-radius: 7px; font-size: 12.5px;
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 9%, transparent);
}
.scen-acts { display: flex; gap: 10px; justify-content: center; }

</style>

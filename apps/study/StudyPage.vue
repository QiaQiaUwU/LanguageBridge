<template>
  <div class="study-page">
    <button class="quit-corner" title="退出" @click="quit">←</button>

    <main class="study-body">
      <p v-if="isWrongRound" class="wrong-round-tip">错词重练 · 这一轮里打错过的词，全部答对才进下一阶段</p>


      <!-- 上次没练完：问一句接着练还是重开 -->
      <div v-if="pendingSnapshot" class="resume-mask">
        <div class="resume-card">
          <h3>上次没练完</h3>
          <p class="resume-sub">
            {{ stageNameOf(pendingSnapshot.stage) }} · 第 {{ pendingSnapshot.index + 1 }} 个
          </p>
          <div class="resume-acts">
            <button class="dark-btn" @click="resumeSnapshot">接着练</button>
            <button class="ghost-btn" @click="discardSnapshot">重新开始</button>
          </div>
        </div>
      </div>

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
        @skip="onSkip"
      />

      <!-- 教材在后台写：一条不挡路的横幅，自己会消失，也能点掉。
           全屏遮罩挡在这儿等于把人钉住什么都干不了。 -->
      <div v-if="syllabusNotice" class="sy-bar">
        <span>教材在后台准备中，进度看右下角。这一轮先按原顺序学，课文写好后会插进来。</span>
        <button class="sy-x" @click="syllabusNotice = false">×</button>
      </div>

      <!-- 教材里的一段。学完这一段的词才放出来，不跳页，读完接着背 -->
      <div v-if="pendingLesson" class="scen-mask">
        <div class="scen-card wide">
          <p class="scen-title">{{ pendingLesson.topic }}</p>
          <p class="scen-sub">
            {{ sectionLoading ? '正在写这一段…' : sectionError ? sectionError : '这一段用的都是你刚学完的词' }}
          </p>

          <div v-if="sectionLines.length" class="sec-body">
            <div v-for="(ln, i) in sectionLines" :key="i" class="sec-line">
              <p class="sec-en">
                <!-- 鼠标停在词上就出释义，跟阅读助手一个做法 -->
                <span
                  v-for="(tk, ti) in ln.tokens"
                  :key="ti"
                  :class="tk.isWord ? 'sec-tk' : ''"
                  @mouseenter="tk.isWord && hoverLookup(tk.text, $event)"
                  @mouseleave="cancelHoverLookup"
                >{{ tk.text }}</span>
              </p>
              <p v-if="ln.zh" class="sec-zh">{{ ln.zh }}</p>
            </div>
          </div>

          <div class="scen-acts">
            <button v-if="sectionError" class="ghost-btn" @click="loadSection">重试</button>
            <button class="dark-btn" :disabled="sectionLoading" @click="finishSection">
              {{ podcastJustDone ? '读完了，看整篇' : '读完了，接着背' }}
            </button>
            <button class="ghost-btn" @click="skipScenario">跳过</button>
          </div>
        </div>
      </div>

      <!-- 一篇稿子的所有段都读完了：拼成整篇给你看一次，可以存进阅读助手 -->
      <div v-if="fullPodcast" class="scen-mask">
        <div class="scen-card wide">
          <p class="scen-title">{{ fullPodcast.title }}</p>
          <p class="scen-sub">这一篇的几段都读完了，这是完整的一篇</p>
          <div class="sec-body tall">
            <div v-for="(ln, i) in fullLines" :key="i" class="sec-line">
              <p class="sec-en">
                <span
                  v-for="(tk, ti) in ln.tokens"
                  :key="ti"
                  :class="tk.isWord ? 'sec-tk' : ''"
                  @mouseenter="tk.isWord && hoverLookup(tk.text, $event)"
                  @mouseleave="cancelHoverLookup"
                >{{ tk.text }}</span>
              </p>
              <p v-if="ln.zh" class="sec-zh">{{ ln.zh }}</p>
            </div>
          </div>
          <div class="scen-acts">
            <button class="dark-btn" :disabled="savingPodcast" @click="savePodcastToReading">
              {{ savingPodcast ? '保存中…' : '存进阅读助手' }}
            </button>
            <button class="ghost-btn" @click="closeFullPodcast">接着背</button>
          </div>
        </div>
      </div>

      <WordLookupPopover />

      <div v-if="finished" class="settle">
        <h2>本轮完成</h2>
        <div class="settle-grid">
          <div class="settle-card"><span class="num">{{ minutes }}</span><span class="lbl">学习分钟</span></div>
          <div class="settle-card"><span class="num">{{ accuracy }}%</span><span class="lbl">正确率</span></div>
          <div class="settle-card"><span class="num">{{ newCount }}</span><span class="lbl">新学</span></div>
          <div class="settle-card"><span class="num">{{ reviewCount }}</span><span class="lbl">复习</span></div>
        </div>

        <div class="settle-cols">
          <div class="week-box">
            <span class="box-title">本周</span>
            <div class="week-row">
              <span
                v-for="(d, i) in weekDays"
                :key="d.date"
                class="week-cell"
                :class="{ on: d.active, today: d.isToday }"
              >{{ WEEK_LABELS[i] }}</span>
            </div>
          </div>

          <div v-if="dictProgress.total" class="prog-box">
            <div class="prog-head">
              <span class="box-title">{{ scopeLabel || '词表进度' }}</span>
              <span class="prog-pct">{{ dictProgress.percent }}%</span>
            </div>
            <div class="prog-bar"><i :style="{ width: dictProgress.percent + '%' }"></i></div>
            <div class="prog-foot">
              <span>已学 {{ dictProgress.learned }}</span>
              <span>共 {{ dictProgress.total }}</span>
            </div>
          </div>
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

      <!-- pendingSnapshot 期间 currentList 还没填，别在续练框后面露出「没有可学的词」 -->
      <p v-if="!currentWord && !finished && !scenarioPrompt.length && !pendingSnapshot" class="empty">没有可学的词，去词汇中心导入词书，或调大每日学习量。</p>
    </main>

    <div class="panel-wrap" :class="{ 'has-panel': showPanel }" @click.self="showPanel = false">
      <aside v-show="showPanel" class="wordlist-panel">
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
    </div>

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
import { playWord, prefetchWord } from '@/shared/core/audio'
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
import { recordReview, recordWordsLearned, getWeekActivity } from '@/shared/core/activityLog'
import { saveSnapshot, readSnapshot, clearSnapshot, snapshotUsable, type PracticeSnapshot } from '@/shared/core/practiceSnapshot'
import { ensureSyllabus } from '@/shared/core/syllabusTask'
import {
  readSyllabus, buildSyllabus, generateAllSections, saveSyllabus, applyOrder, lessonReadyFor,
  generateSection, podcastOfLesson, podcastComplete, podcastSentences,
  type Syllabus, type SyllabusLesson, type SyllabusPodcast
} from '@/shared/core/syllabus'
import { openWordLookup, splitEnglishText } from '@/shared/core/wordLookup'
import WordLookupPopover from '@/apps/word-core/components/WordLookupPopover.vue'
import { startStudyClock, stopStudyClock } from '@/shared/core/studyClock'

const router = useRouter()
const route = useRoute()
const wordStore = useWordStore()
const settings = getStudySettings()

/**
 * 一组几个词。默认 7，跟上游 TypeWords 的 `const groupSize = 7` 一致；
 * 现在从设置里读，可以改。
 */
const GROUP_SIZE = Math.max(2, settings.groupSize || 7)

const groupId = computed(() => (route.query.group as string) || '')
const scopeLabel = ref('')
const modeParam = computed(() => (route.query.mode as string) || settings.practiceMode)

const stageList = computed<PracticeStage[]>(() => MODE_STAGES[modeParam.value as keyof typeof MODE_STAGES] || MODE_STAGES.system)

const stage = ref<PracticeStage>('followWriteNew')
const stageIndex = computed(() => stageList.value.indexOf(stage.value))
const stageName = computed(() => STAGE_NAMES[stage.value] || '')
function stageNameOf(s: string): string {
  return STAGE_NAMES[s as PracticeStage] || s
}

const type = ref<PracticeType>('followWrite')

const taskNew = ref<WordItem[]>([])
const taskReview = ref<WordItem[]>([])
const currentList = ref<WordItem[]>([])
const index = ref(0)
const showPanel = ref(localStorage.getItem('lb-study-panel') !== '0')
watch(showPanel, v => localStorage.setItem('lb-study-panel', v ? '1' : '0'))
const showToolbar = ref(localStorage.getItem('lb-study-toolbar') !== '0')
watch(showToolbar, v => localStorage.setItem('lb-study-toolbar', v ? '1' : '0'))
const showTranslate = ref(getStudySettings().showTranslate)
watch(showTranslate, v => saveStudySettings({ showTranslate: v }))
const hideWord = ref(false)
function speakCurrent() {
  if (currentWord.value) playWord(currentWord.value.word, getStudySettings().soundType || 'us', getStudySettings().wordSoundSpeed)
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
/**
 * 错词数 = 真的错过的词。
 *
 * 原来是 Object.keys(wrongTimesMap).length —— 而 onComplete 每打完一个词
 * 都会写一条 `wrongTimesMap[key] = 0`（那条记录是给结算时 FSRS 评级和
 * 自动标状态用的，必须保留），于是每学一个词错误数就 +1，正确率也跟着掉。
 * 判断改成按值筛，记录照旧写。
 */
const totalWrong = computed(() =>
  Object.values(wrongTimesMap.value).filter(n => Number(n) > 0).length
)

const prevWordText = computed(() => currentList.value[index.value - 1]?.word || '')
const nextWordText = computed(() => currentList.value[index.value + 1]?.word || '')

/**
 * 提前把下一个词的发音抓下来。
 *
 * 发音是网络请求，轮到那个词才去取就要等一下。这里在当前词还在打的时候
 * 就先取好，切过去时是本地的，按下去立刻响。
 */
watch(nextWordText, w => { if (w) prefetchWord(w, getStudySettings().soundType) })

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
  // 记账交给 studyClock，这里的 segments 只用来在界面上显示本轮分钟数
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
    .filter(x => x.times > 0)   // 0 次的那些是「打对了」，不该出现在错词统计里
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

  /**
   * 配套教材。
   *
   * 勾了场景学习（scenarioEvery > 0）才有这一步 —— 它要花额度，没勾就完全不碰。
   * 已经有教材就直接用它的顺序；没有就后台跑一次，**不挡着学习**：
   * 这一轮照原顺序学，教材建好了下一轮生效。
   */
  /**
   * 配套教材。
   *
   * 勾了场景学习（scenarioEvery > 0）才有这一步，没勾完全不碰。
   *
   * **整段不 await。** 之前在这儿等教材写完 —— 结果 buildTodayTask 迟迟不执行，
   * taskNew 是空的，页面上「总词数 0」，就算把提示框关掉底下也没词可学，
   * 看着就是被钉在那个窗口上。教材是给下一段课文和学习顺序用的，
   * 它没好不该拦着人背单词。
   *
   * 已经有教材就同步取出来用（读 localStorage，不耗时），
   * 需要写的部分丢进任务中心慢慢跑，写好的段学到那儿自然会弹。
   */
  if (settings.scenarioEvery > 0) {
    // 教材按 scopeKey 存：不同标签组合是不同的一套，同一组合再来直接命中
    const sy = readSyllabus(scopeKey.value)
    if (sy) {
      syllabus.value = sy
      const missing = sy.lessons.filter(l => !l.sentences?.length).length
      if (missing) {
        syllabusNotice.value = true
        void ensureSyllabus(scopeKey.value, words, scope.label).then(x => { if (x) syllabus.value = x })
      }
    } else if (words.length) {
      syllabusNotice.value = true
      void ensureSyllabus(scopeKey.value, words, scope.label).then(x => { if (x) syllabus.value = x })
    }
  }

  const task = buildTodayTask({ words, group, ignoreSet: getIgnoreSet(settings.ignoreSimpleWord) })
  // 有教材就按它排：同一话题的词挨在一起学，之后才凑得出一篇像样的课文
  if (syllabus.value) task.newWords = applyOrder(task.newWords, syllabus.value.order)
  taskNew.value = task.newWords
  taskReview.value = task.reviewWords
  newCount.value = task.newWords.length
  reviewCount.value = task.reviewWords.length

  /**
   * 断点。快照是今天的、同一批词，才问用户要不要接着练；
   * 隔夜的直接把上次的成绩结算掉再丢弃，不然那批词永远进不了 FSRS。
   */
  const snap = readSnapshot()
  if (snap && snap.scopeKey === scopeKey.value && !snapshotUsable(snap, scopeKey.value)) {
    settleSnapshot(snap)
    clearSnapshot()
  } else if (snapshotUsable(snap, scopeKey.value)) {
    pendingSnapshot.value = snap
    return   // 等用户选「接着练」还是「重新开始」
  }

  stage.value = stageList.value[0]
  enterStage(stage.value, true)
}

/* ---------- 断点续练 ---------- */

/**
 * 这一轮练的是哪一批词。
 *
 * **必须在进页面时就固定下来，不能做成 computed。**
 * computed 读的是 route.query，而存断点是在 onUnmounted 里做的 ——
 * 那时候路由已经切到下一个页面了，query 变成新页面的，
 * 于是断点被存到一个错误的 key 下，下次回来怎么也对不上，
 * 看着就像"根本没保存进度"。
 */
function computeScopeKey(): string {
  const scope = readScope(route.query as Record<string, any>)
  if (scope.kind === 'group' && scope.groupId) return `group:${scope.groupId}`
  if (scope.kind === 'tag' && scope.tag) return scopeKeyOfTag(scope.tag)
  if (scope.kind === 'adhoc') return `adhoc:${scope.label || ''}`
  return 'all'
}
const scopeKey = ref(computeScopeKey())

const pendingSnapshot = ref<PracticeSnapshot | null>(null)

function wordsByNames(names: string[]): WordItem[] {
  const byName = new Map(wordStore.words.map(w => [w.word.toLowerCase(), w]))
  return names.map(n => byName.get(n.toLowerCase())).filter(Boolean) as WordItem[]
}

/** 把一份快照里已经练出来的成绩落进 FSRS 和状态标记（跟 complete 里那段同一个口径） */
function settleSnapshot(snap: PracticeSnapshot) {
  const times = snap.wrongTimesMap || {}
  if (!Object.keys(times).length) return
  for (const [word, n] of Object.entries(times)) {
    const manual = snap.ratingMap?.[word]
    applyGrade(word, (manual !== undefined ? manual : getGradeByWrongTimes(Number(n))) as any)
  }
  flushFsrsData()
}

function resumeSnapshot() {
  const snap = pendingSnapshot.value
  if (!snap) return
  pendingSnapshot.value = null

  taskNew.value = wordsByNames(snap.taskNewWords)
  taskReview.value = wordsByNames(snap.taskReviewWords)
  newCount.value = snap.newCount
  reviewCount.value = snap.reviewCount
  wrongTimesMap.value = { ...snap.wrongTimesMap }
  ratingMap.value = { ...snap.ratingMap }
  excludeWords.value = new Set(snap.excludeWords || [])
  wrongWords.value = wordsByNames(snap.wrongWords || [])
  isWrongRound.value = !!snap.isWrongRound
  segments.value = Array.isArray(snap.segments) ? snap.segments : []

  stage.value = snap.stage as PracticeStage
  type.value = snap.type as PracticeType
  currentList.value = wordsByNames(snap.listWords)
  index.value = Math.min(Math.max(0, snap.index), Math.max(0, currentList.value.length - 1))
  if (!currentList.value.length) {
    // 词被删了之类的极端情况，退回正常开局
    stage.value = stageList.value[0]
    enterStage(stage.value, true)
  }
}

function discardSnapshot() {
  const snap = pendingSnapshot.value
  pendingSnapshot.value = null
  if (snap) settleSnapshot(snap)   // 上次练出来的成绩先落库，再重开
  clearSnapshot()
  stage.value = stageList.value[0]
  enterStage(stage.value, true)
}

/** 把当前进度写成快照。中途退出时调一次就够，不用一直存 */
function snapshotNow() {
  if (settled) return
  if (!currentList.value.length && !Object.keys(wrongTimesMap.value).length) return
  saveSnapshot({
    scopeKey: scopeKey.value,
    stage: stage.value,
    type: type.value,
    index: index.value,
    listWords: currentList.value.map(w => w.word),
    taskNewWords: taskNew.value.map(w => w.word),
    taskReviewWords: taskReview.value.map(w => w.word),
    newCount: newCount.value,
    reviewCount: reviewCount.value,
    wrongTimesMap: { ...wrongTimesMap.value },
    ratingMap: { ...ratingMap.value },
    excludeWords: [...excludeWords.value],
    wrongWords: wrongWords.value.map(w => w.word),
    isWrongRound: isWrongRound.value,
    segments: segments.value.map(x => [...x] as [number, number])
  })
}

function wordsForStage(s: PracticeStage): WordItem[] {
  // 随机复习：新词旧词混在一起（上游 Shuffle 模式就是不分新旧）
  const list = s === 'shuffle'
    ? [...taskNew.value, ...taskReview.value]
    : isReviewStage(s) ? taskReview.value : taskNew.value
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

/**
 * 按错一个键。
 *
 * 这里**只计数**，不记账。
 * 原来每按错一次就立刻 recordReview(false) 并把词推进错词本 ——
 * 敲错一个字母之后又改回来、最终完整敲对了，这个词照样算错，
 * FSRS 也已经吃到一次「失败」。判定该在整个词敲完时下，不是每一次击键。
 */
function onWrong() {
  curWrong.value++
}

function onKnow() {
  const w = currentWord.value
  if (!w) return
  ratingMap.value[w.word.toLowerCase()] = Rating.Good as unknown as number
  excludeWords.value.add(w.word.toLowerCase())
  wordStore.setWordStatus(w.id, 'known')
}

/**
 * 跳过。照上游 skip()：addExcludeWord() + next(false)。
 * **不记错、不进错词本、不动 FSRS**，只是把这个词从这一轮里排除掉。
 */
function onSkip() {
  const w = currentWord.value
  if (!w) return
  excludeWords.value.add(w.word.toLowerCase())
  curWrong.value = 0
  advance()
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

    /**
     * 整个词敲完了才下判定，一个词只记一次账。
     * 中途错过就算错（进错词本、FSRS 记失败），全程没错才算对。
     */
    if (curWrong.value === 0) {
      recordReview(true)
      // 这一轮打对了就从错词本里撤掉（跟听写那边同一个口径）
      wordStore.markWrongBook(w.id, true)
    } else {
      excludeWords.value.delete(key)
      if (!wrongWords.value.find(x => x.word.toLowerCase() === key)) {
        wrongWords.value.push(w)
      }
      recordReview(false)
      /**
       * 打字流程原来只做了「本轮错词重练」和 FSRS 评级，**没有写错词本** ——
       * 所以在这里打错的词，错词本页面永远看不到，只有听写和单词测试能进去。
       * 复习排期仍然走 FSRS（complete 里的 applyGrade），这里只登记错词本。
       */
      wordStore.markWrongBook(w.id, false)
    }
  }
  curWrong.value = 0

  if (settings.scenarioEvery > 0 && isNewWordStage.value) {
    /**
     * 什么时候插场景学习。
     *
     * 原来是"每学满 N 个新词"就抓最近 N 个凑一堆 —— 那批词话题上毫无关系，
     * 硬要写成一篇短文只能写得很勉强。
     * 现在看教材：某一课覆盖的词全学完了才把那一课端出来，
     * 一课的词本来就是按话题归到一起的。
     * 没有教材（没勾或还没建好）就退回原来的按数量触发，不至于什么都不给。
     */
    learnedSinceScenario.value++
    const sy = syllabus.value
    if (sy) {
      const learned = new Set(recentWords.value.map(w => w.word.toLowerCase()))
      const lesson = lessonReadyFor(sy, learned)
      if (lesson) {
        pendingLesson.value = lesson
        scenarioPrompt.value = wordStore.words.filter(w =>
          lesson.words.some(x => x.toLowerCase() === w.word.toLowerCase())
        )
        learnedSinceScenario.value = 0
        void loadSection()
        return
      }
    } else if (learnedSinceScenario.value >= settings.scenarioEvery) {
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
const syllabus = ref<Syllabus | null>(null)

/**
 * 这两个是上一轮删旧函数时被正则误删的声明。
 *
 * 模板里 `v-if="scenarioPrompt.length"` 和 `v-if="pendingLesson"` 还在用，
 * 声明没了就成了 undefined.length —— 整个学习页渲染直接抛 TypeError 白屏。
 * 教训：用正则删代码块时，删完必须把模板引用过一遍，
 * 光看"括号平衡、模板结构通过"是查不出这种的。
 */
/** 这次要弹的是教材里的哪一课；按数量触发时是 null */
const pendingLesson = ref<SyllabusLesson | null>(null)
/** 这一批词是要拿去做场景学习的 */
const scenarioPrompt = ref<WordItem[]>([])
/** 教材开始写时提示一次，让人知道右下角在跑什么 */
const syllabusNotice = ref(false)

/* ---------- 教材段落的呈现 ---------- */

const sectionLoading = ref(false)
const sectionError = ref('')
const savingPodcast = ref(false)
const fullPodcast = ref<SyllabusPodcast | null>(null)
/** 这一段是不是本篇的最后一段：是的话按钮写「看整篇」，让人知道读完还有东西 */
const podcastJustDone = computed(() => {
  const sy = syllabus.value
  const l = pendingLesson.value
  if (!sy || !l) return false
  const pod = podcastOfLesson(sy, l.id)
  if (!pod) return false
  return pod.lessonIds[pod.lessonIds.length - 1] === l.id
})

interface SecTok { text: string; isWord: boolean }
interface SecLine { en: string; zh: string; tokens: SecTok[] }

function toLines(pairs: { en: string; zh: string }[]): SecLine[] {
  return pairs.map(p => ({ ...p, tokens: splitEnglishText(p.en) }))
}

const sectionLines = ref<SecLine[]>([])
const fullLines = ref<SecLine[]>([])

/**
 * 取这一段的正文。已经写过就直接用，没写过才调 AI。
 * 写好立刻存进教材 —— 中途退出、下次再来不用重写一遍，那是花过钱的东西。
 */
async function loadSection() {
  const sy = syllabus.value
  const lesson = pendingLesson.value
  if (!sy || !lesson) return

  if (lesson.sentences?.length) {
    sectionLines.value = toLines(lesson.sentences)
    return
  }

  sectionLoading.value = true
  sectionError.value = ''
  try {
    const pod = podcastOfLesson(sy, lesson.id)
    const idx = pod ? pod.lessonIds.indexOf(lesson.id) : 0
    const prev: { en: string; zh: string }[] = []
    if (pod) {
      for (const id of pod.lessonIds.slice(0, idx)) {
        const l = sy.lessons.find(x => x.id === id)
        if (l?.sentences?.length) prev.push(...l.sentences)
      }
    }
    const pairs = await generateSection(sy, lesson, {
      isFirst: idx === 0,
      isLast: !!pod && idx === pod.lessonIds.length - 1,
      prev
    })
    lesson.sentences = pairs
    saveSyllabus(sy)
    sectionLines.value = toLines(pairs)
  } catch (e) {
    sectionError.value = '这一段没写出来：' + (e instanceof Error ? e.message : String(e))
  } finally {
    sectionLoading.value = false
  }
}

/** 读完这一段。整篇的段都读完了就把完整版端出来 */
function finishSection() {
  const sy = syllabus.value
  const lesson = pendingLesson.value
  if (!sy || !lesson) { skipScenario(); return }

  lesson.read = true
  saveSyllabus(sy)

  const pod = podcastOfLesson(sy, lesson.id)
  pendingLesson.value = null
  sectionLines.value = []
  scenarioPrompt.value = []

  if (pod && podcastComplete(sy, pod)) {
    fullPodcast.value = pod
    fullLines.value = toLines(podcastSentences(sy, pod))
    return          // 看完整篇再 advance
  }
  advance()
}

function closeFullPodcast() {
  fullPodcast.value = null
  fullLines.value = []
  advance()
}

/** 存进阅读助手：从此它就是一篇普通文章，能对轴、能跟读、能划线 */
async function savePodcastToReading() {
  const sy = syllabus.value
  const pod = fullPodcast.value
  if (!sy || !pod) return
  savingPodcast.value = true
  try {
    const { useReaderStore } = await import('@/apps/reading-assistant/stores/readerStore')
    const rs = useReaderStore()
    const now = new Date().toISOString()
    const id = `art-lesson-${Date.now().toString(36)}`
    await rs.saveArticle({
      id,
      title: pod.title || '配套课文',
      sentences: podcastSentences(sy, pod),
      notes: '',
      source: 'scenario-podcast',
      createdAt: now,
      updatedAt: now
    } as any)
    pod.articleId = id
    saveSyllabus(sy)
    closeFullPodcast()
  } catch (e) {
    sectionError.value = '存不进去：' + (e instanceof Error ? e.message : String(e))
  } finally {
    savingPodcast.value = false
  }
}

/* 悬停查词。跟阅读助手同一套 openWordLookup，延迟一点再弹，免得划过去就闪 */
let hoverTimer: ReturnType<typeof setTimeout> | null = null
function hoverLookup(raw: string, e: MouseEvent) {
  cancelHoverLookup()
  const el = e.target as HTMLElement
  hoverTimer = setTimeout(() => {
    hoverTimer = null
    openWordLookup(raw, el, async candidates => {
      for (const c of candidates) {
        const hit = wordStore.words.find(w => w.word.toLowerCase() === c.toLowerCase())
        if (hit) return hit
      }
      return null
    })
  }, 260)
}
function cancelHoverLookup() {
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null }
}

function skipScenario() {
  scenarioPrompt.value = []
  pendingLesson.value = null
  sectionLines.value = []
  sectionError.value = ''
  advance()
}

function advance() {
  const isLast = index.value >= currentList.value.length - 1

  if (!isLast) {
    // 错词重练那一轮不分组：那个列表通常只有几个词，
    // 按 7 个一组去切，index % GROUP_SIZE 基本不会成立，等于白绕一圈
    if (!isWrongRound.value &&
        (stage.value === 'followWriteNew' || stage.value === 'followWriteReview')) {
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
/* ---------- 结算页：本周记录 + 词表进度 ---------- */

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const weekDays = ref<{ date: string; active: boolean; isToday: boolean }[]>([])

/** 这一轮练的是哪个词表、学到第几个 */
const dictProgress = ref({ learned: 0, total: 0, percent: 0 })

async function loadSettleStats() {
  weekDays.value = await getWeekActivity()

  const group = wordStore.groups.find(g => g.id === groupId.value)
  if (group) {
    const ids = new Set(group.wordIds)
    const total = wordStore.words.filter(w => ids.has(w.id)).length
    const learned = Math.min(group.lastLearnIndex || 0, total)
    dictProgress.value = { learned, total, percent: total ? Math.round((learned / total) * 100) : 0 }
    return
  }
  const scope = readScope(route.query as Record<string, any>)
  if (scope.kind === 'tag' && scope.tag) {
    const cur = getScopeProgress(scopeKeyOfTag(scope.tag))
    const total = taskNew.value.length + taskReview.value.length + (cur.lastLearnIndex || 0)
    const learned = Math.min(cur.lastLearnIndex || 0, total)
    dictProgress.value = { learned, total, percent: total ? Math.round((learned / total) * 100) : 0 }
    return
  }
  dictProgress.value = { learned: 0, total: 0, percent: 0 }
}

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
      const st = n <= settings.statusKnownLimit ? 'known'
        : n <= settings.statusFuzzyLimit ? 'fuzzy'
          : 'unknown'
      await wordStore.setWordStatus(hit.id, st)

      /**
       * 判成「认识」的词顺手放进已掌握词表。
       *
       * 这是一道**粗筛**：只说明这一轮没打错，不等于真记牢了。
       * 所以已掌握那一页留着「移出」——进去翻一遍，把其实还不熟的挑出来，
       * 移出之后立刻重新参与排课。
       * 不想要这道粗筛就在设置里关掉 autoMasterKnown。
       */
      if (st === 'known' && settings.autoMasterKnown) addMastered(key)
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
  clearSnapshot()   // 正常练完，断点就没用了
  // 放在最后：上面刚写完 lastLearnIndex 和今天的活动记录，这时读到的才是新的
  await loadSettleStats()
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
  startStudyClock()
  window.addEventListener('beforeunload', snapshotNow)
  tickTimer = setInterval(tick, 1000)
  window.addEventListener('keydown', onAnyKey)
  document.addEventListener('visibilitychange', onVisibility)
})
onUnmounted(() => {
  stopStudyClock()
  if (tickTimer) clearInterval(tickTimer)
  window.removeEventListener('keydown', onAnyKey)
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('beforeunload', snapshotNow)
  /**
   * 中途离开：存断点。
   * 原来这里是 `flushFsrsData()` —— 但这一轮的 applyGrade 全在 complete() 里，
   * 没评过级，flush 只是把旧数据原样写回去，等于什么都没保住。
   */
  snapshotNow()
})
</script>

<style scoped lang="scss">
/* 尺寸取自 TypeWords 的 main.scss：
     --toolbar-width: 50rem   中间练习区
     --panel-width:   24rem   右侧词表
   它的 .practice-wrapper 是 w-full h-full flex justify-center，
   练习区固定 50rem 居中、右侧面板独立浮在旁边。我们原来是
   max-width:900px 一条竖带，内容全挤在中间。 */
/* 面板常驻时把可用宽度减掉面板，练习区在剩余空间里居中；
   收起时练习区回到整幅居中。这就是它 --word-panel-margin-left 那个
   calc 的效果，只是我们用 padding 表达，收放都不会盖住内容。 */
/* 照 PracticeLayout.vue：练习区永远居中不动，面板独立 fixed，
   靠 .has-panel 切显隐。面板上没有关闭按钮，用底栏那个图标切换
   （它是 settingStore.showPanel = !settingStore.showPanel）。 */
/* 练习区在 .app-main 的剩余空间里居中即可。
   之前我用 calc(50vw + nav/2) 自己算中心点，而 --lb-nav-w 展开时是 178px、
   收起才 56px，我到处写的兜底却是 56px —— 侧栏一展开中心点就偏，
   内容看着永远挤在一边。这种居中根本不该自己算。 */
.study-page {
  --toolbar-width: 50rem;
  --panel-width: 24rem;
  --anim-time: .5s;
  width: 100%;
  /* 自己就是滚动容器，sticky 底栏才有参照；
     高度撑满 .app-main 的可视区，多出来的内容在这里滚。 */
  height: calc(100vh - var(--lb-main-pad, 24px) * 2);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0;
  position: relative;
}
.study-body {
  width: var(--toolbar-width);
  max-width: 100%;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  padding-top: 2.5rem;
  /* 给固定底栏留出空间，否则最后一块内容被压在底栏下面滚不出来 */
  padding-bottom: 14rem;
}
.quit-corner {
  position: fixed; left: calc(var(--lb-nav-w, 56px) + 14px); top: 14px; z-index: 30;
  width: 30px; height: 30px; border: none; border-radius: 8px;
  background: var(--r-ui, #f4f5f7); color: var(--r-ink2, #8a9099);
  font-size: 15px; cursor: pointer;
  &:hover { color: var(--r-ink, #1f2328); }
}


/* 底栏跟练习区同宽（它的 Footer 也是 width: var(--toolbar-width)） */
/* 照它的 .footer-wrap：贴底、收起时 bottom: -6rem */
/* 照它的 .footer-wrap：贴底、transition: all、收起 -6rem */
/* sticky 而不是 fixed：水平方向自然跟着 .app-main 的可用宽度走，
   不用去算 50vw + 侧栏宽；竖直方向照样钉在底部不随内容滚。 */
.footer-wrap {
  position: sticky;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 0.6rem);
  margin: auto auto 0;
  width: min(var(--toolbar-width), 100%);
  z-index: 999; transition: all var(--anim-time);
  &.hide { margin-bottom: -6rem; }
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

/* 照 PracticeLayout.vue 的 .panel-wrap：
     position: fixed; top: 0.8rem; height: calc(100vh - 1.8rem)
   left 用它的 --word-panel-margin-left：
     calc(50vw + aside/2 + toolbar/2 + 1rem)
   —— 是常驻的第三栏，不是滑入抽屉。屏幕窄到放不下时才收起来。 */
/* .panel-wrap 对应它的同名容器 */
.panel-wrap {
  position: fixed;
  top: 0.8rem;
  right: 0.8rem;
  z-index: 1;
  height: calc(100vh - 1.8rem);
  width: var(--panel-width);
}
.wordlist-panel { width: 100%; height: 100%; }
/* <1440px 变成全屏蒙版居中弹层，点背景关闭 */
@media (max-width: 1439px) {
  .panel-wrap {
    top: 0; left: 0 !important; right: 0 !important; bottom: 0;
    height: 100vh; z-index: 1000;
    display: flex; align-items: center; justify-content: center;
    padding: 1rem; box-sizing: border-box;
    pointer-events: none;
    &.has-panel { background: rgba(0, 0, 0, 0.5); pointer-events: auto; }
  }
  .wordlist-panel { width: var(--panel-width); max-width: 100%; height: min(80vh, 100%); }
}
/* .wl-body 原来声明了两遍，中间还夹着一个 @media：
   窄屏那条 border-radius: 0 被后面那遍的 12px 又盖回去了，等于没生效。
   合成一份，@media 放到它后面。 */
.wl-body {
  height: 100%; display: flex; flex-direction: column;
  background: var(--r-paper, #fff);
  border: 1px solid var(--r-border, #e5e7eb);
  border-radius: 12px; overflow: hidden;
  box-shadow: 0 6px 24px rgba(0, 0, 0, .07);
}
@media (max-width: 1200px) {
  .study-page.with-panel { padding-right: 0; --panel-gap: 0px; }
  .wordlist-panel { right: 0; top: 0; height: 100vh; width: var(--panel-width); z-index: 25; }
  .wl-body { border-radius: 0; }
}
.wl-title {
  display: flex; justify-content: space-between; align-items: center;
  gap: 10px;
  padding: 14px 14px 10px; font-size: 14px; color: var(--r-ink, #1f2328);
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
.settle-cols {
  display: flex; gap: 14px; justify-content: center; flex-wrap: wrap;
  margin: 20px auto 0; max-width: 560px;
}
.week-box, .prog-box {
  flex: 1; min-width: 220px;
  padding: 14px 16px;
  border: 1px solid var(--r-border, #e4e4e4);
  border-radius: 12px;
  text-align: left;
}
.box-title { font-size: 13px; color: var(--r-ink2, #888); }
.week-row { display: flex; gap: 6px; margin-top: 10px; }
.week-cell {
  flex: 1; text-align: center; padding: 7px 0;
  border-radius: 8px; font-size: 12.5px;
  background: var(--r-ui, #f4f5f7); color: var(--r-ink2, #9aa0a6);
}
.week-cell.on { background: var(--r-accent, #8a4b3a); color: #fff; }
.week-cell.today { outline: 1.5px solid var(--r-accent, #8a4b3a); outline-offset: 1px; }
.prog-head { display: flex; align-items: center; justify-content: space-between; }
.prog-pct { font-size: 18px; font-weight: 600; color: var(--r-accent, #8a4b3a); }
.prog-bar {
  height: 8px; margin: 10px 0 8px;
  background: var(--r-ui, #f4f5f7); border-radius: 999px; overflow: hidden;
}
.prog-bar i { display: block; height: 100%; background: var(--r-accent, #8a4b3a); transition: width .4s; }
.prog-foot { display: flex; justify-content: space-between; font-size: 12px; color: var(--r-ink2, #888); }

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


/* 断点续练的询问框，样式跟场景插入那个提示（.scen-mask）保持一致 */
.resume-mask {
  position: fixed; inset: 0; z-index: 60;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, .28);
}
.resume-card {
  background: var(--r-bg, #fff); border-radius: 16px; padding: 24px 26px;
  max-width: 380px; text-align: center;
  box-shadow: 0 14px 40px rgba(0, 0, 0, .18);
}
.resume-card h3 { margin: 0 0 8px; font-size: 17px; }
.resume-sub { font-size: 13.5px; color: var(--r-ink2, #6b7280); line-height: 1.7; margin: 0; }
.resume-acts { display: flex; gap: 10px; justify-content: center; margin: 16px 0 10px; }

/* 教材段落面板 */
.scen-card.wide { max-width: 660px; width: min(660px, 92vw); text-align: left; }
.sec-body {
  max-height: 46vh; overflow: auto; margin: 14px 0 4px;
  padding-right: 6px;
}
.sec-body.tall { max-height: 56vh; }
.sec-line { margin-bottom: 12px; }
.sec-en { margin: 0; font-size: 15.5px; line-height: 1.75; color: var(--r-ink, #1f2328); }
.sec-zh { margin: 2px 0 0; font-size: 13.5px; line-height: 1.7; color: var(--r-ink2, #8a9099); }
.sec-tk { cursor: help; border-radius: 3px; }
.sec-tk:hover { background: var(--r-ui, #eef1f4); }

/* 教材准备中的横幅：贴在顶部，不挡内容 */
.sy-bar {
  display: flex; align-items: center; gap: 10px;
  margin: 0 auto 10px; padding: 7px 14px;
  max-width: 720px; border-radius: 999px;
  background: var(--r-ui, #f4f5f7); color: var(--r-ink2, #6b7280);
  font-size: 12.5px; line-height: 1.6;
}
.sy-x {
  margin-left: auto; border: none; background: none; cursor: pointer;
  color: var(--r-ink2, #9aa0a6); font-size: 15px; line-height: 1;
}
</style>

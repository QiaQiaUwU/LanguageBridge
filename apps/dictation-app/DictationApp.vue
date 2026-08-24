<template>
  <div class="dictation">
    <div v-if="phase === 'booting'" class="booting"></div>

    <div v-else-if="phase === 'setup'" class="setup-panel">
      <button class="back-btn" @click="router.back()">← 返回</button>
      <h1>听写练习</h1>

      <div v-if="fromWordCore" class="scope-note">
        已从词汇中心带入 <b>{{ sessionSource.length }}</b> 个单词，可直接开始。
      </div>

      <div class="mode-seg">
        <button class="mode-btn" :class="{ on: sessionMode === 'spelling' }" @click="sessionMode = 'spelling'">拼写测试</button>
        <button class="mode-btn" :class="{ on: sessionMode === 'listening' }" @click="sessionMode = 'listening'">朗读复习</button>
        <button class="mode-btn" :class="{ on: sessionMode === 'materials' }" @click="sessionMode = 'materials'">听力材料</button>
      </div>

      <ListeningMaterialsTab v-if="sessionMode === 'materials'" />

      <div v-else-if="!fromWordCore && sessionMode === 'spelling'" class="empty-guide">
        <p>去词汇中心挑好词再来听写 —— 范围、状态、数量都在那边选。</p>
        <button class="start-btn" @click="router.push('/words')">去词汇中心</button>
      </div>

      <div v-else-if="!fromWordCore" class="setup-form">
        <div class="form-row book-multiselect">
          <label>词书（可多选，不选=全部单词）</label>
          <div class="book-chip-row">
            <button
              v-for="g in bookGroups"
              :key="g.id"
              class="book-chip"
              :class="{ on: selGroupIds.has(g.id) }"
              @click="toggleSelGroup(g.id)"
            >{{ g.name }}（{{ g.wordIds.length }}）</button>
            <p v-if="!bookGroups.length" class="empty-hint small">还没有词书</p>
          </div>
        </div>
        <div class="form-row">
          <label>状态</label>
          <select v-model="selStatus">
            <option value="all">全部</option>
            <option value="unknown">仅不认识</option>
            <option value="fuzzy">仅模糊</option>
            <option value="unknown+fuzzy">不认识 + 模糊</option>
            <option value="unmarked">仅未标注</option>
            <option value="due">今日待复习（按听写表现自动排的）</option>
          </select>
        </div>
        <div class="form-row">
          <label>数量</label>
          <select v-model.number="selCount">
            <option :value="10">10 个</option>
            <option :value="20">20 个</option>
            <option :value="50">50 个</option>
            <option :value="0">全部（{{ candidateWords.length }}）</option>
          </select>
        </div>
        <div class="form-row">
          <label>顺序</label>
          <select v-model="orderSel">
            <option value="order">顺序</option>
            <option value="random">乱序</option>
          </select>
        </div>
      </div>

      <template v-if="sessionMode !== 'materials'">
        <p class="candidate-info">
          <template v-if="fromWordCore">这一批 <b>{{ candidateWords.length }}</b> 个词全部听写</template>
          <template v-else>当前范围可听写：<b>{{ candidateWords.length }}</b> 个单词</template>
        </p>
        <button class="start-btn" :disabled="!candidateWords.length" @click="startSession()">开始听写</button>
      </template>
    </div>

    <div v-else-if="phase === 'listening'" class="listen-panel">
      <div class="run-head">
        <span>{{ listenIndex + 1 }} / {{ listenList.length }}</span>
        <button class="quit-btn" title="不结算，已经答过的记录保留" @click="quitSession">退出</button>
      </div>
      <div class="progress-bar"><div class="fill" :style="{ width: listenPercent + '%' }"></div></div>

      <div v-if="listenCurrent" class="listen-card">
        <button class="big-speak" @click="playListenCurrent">
          <svg viewBox="0 0 24 24" width="34" height="34"><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>
        </button>
        <div class="lc-word">{{ listenCurrent.word }}</div>
        <div v-if="listenCurrent.phonetic" class="lc-ph">{{ listenCurrent.phonetic }}</div>
        <div class="lc-cn">{{ hintOf(listenCurrent) }}</div>
      </div>

      <div class="listen-controls">
        <button class="a-btn" @click="listenPrev" :disabled="listenIndex === 0">上一个</button>
        <button class="a-btn" :class="{ on: listenLoop }" @click="listenLoop = !listenLoop">{{ listenLoop ? '循环中' : '循环' }}</button>
        <button class="a-btn" :class="{ on: listenRandom }" @click="toggleListenRandom">{{ listenRandom ? '乱序中' : '乱序' }}</button>
        <button class="a-btn primary" @click="listenNext">下一个</button>
      </div>
    </div>

    <div v-else-if="phase === 'running'" class="run-panel" :class="{ 'is-list': viewMode === 'list' }">
      <div class="run-bar">
        <span class="run-spacer"></span>
        <span class="run-stat">{{ filledCount }}/{{ session.length }}</span>
        <button class="bar-icon" :title="viewMode === 'word' ? '列表模式' : '单词模式'" @click="viewMode = viewMode === 'word' ? 'list' : 'word'">
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>
        </button>
        <button class="bar-icon" title="设置" @click="showDictSetting = true">
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19.4 13a7.4 7.4 0 0 0 0-2l2-1.6a.5.5 0 0 0 .1-.6l-1.9-3.3a.5.5 0 0 0-.6-.2l-2.4 1a7.5 7.5 0 0 0-1.7-1l-.4-2.5a.5.5 0 0 0-.5-.4h-3.8a.5.5 0 0 0-.5.4l-.4 2.5c-.6.3-1.2.6-1.7 1l-2.4-1a.5.5 0 0 0-.6.2L2.7 8.8a.5.5 0 0 0 .1.6L4.9 11a7.4 7.4 0 0 0 0 2l-2 1.6a.5.5 0 0 0-.1.6l1.9 3.3c.1.2.4.3.6.2l2.4-1c.5.4 1.1.8 1.7 1l.4 2.5c0 .2.3.4.5.4h3.8c.2 0 .5-.2.5-.4l.4-2.5c.6-.2 1.2-.6 1.7-1l2.4 1c.2.1.5 0 .6-.2l1.9-3.3a.5.5 0 0 0-.1-.6zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>
        </button>
        <!-- 这个 × 原来在两种模式下都调 finishSession，单词模式下点一下就直接出结算页 ——
             一组没听完就结算没有意义，何况它长在关闭的位置上，谁都会当成"退出"来点。
             列表模式是一屏铺开、填完统一判，那儿的确需要一个"交卷"，
             所以按模式分开：列表 = 交卷（还有空的会先问一句），单词 = 退出不结算。 -->
        <button
          class="bar-icon danger"
          :title="viewMode === 'list' ? '交卷并结算' : '退出（不结算）'"
          @click="viewMode === 'list' ? finishSession() : quitSession()"
        >
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z"/></svg>
        </button>
      </div>

      <template v-if="viewMode === 'word'">
        <div v-if="lastResult" class="prev-result" :class="{ ok: lastResult.ok }">
          <span class="pr-arrow">←</span>
          <span class="pr-word">
            <span v-for="(r, i) in lastResult.runs" :key="i" :class="r.ok ? 'r-ok' : 'r-bad'">{{ r.text }}</span>
          </span>
          <span class="pr-hint">{{ lastResult.hint }}</span>
        </div>

        <div class="wm-area">
          <button class="wm-speak" title="再听一遍" @click="checkIsWrong(); playCurrent()">
            <svg viewBox="0 0 24 24" width="30" height="30"><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>
          </button>

          <div v-if="dictSet.translate" class="wm-cn" :style="{ fontSize: dictSet.fontSize + 'px' }">
            <div v-for="(g, i) in currentPosGroups" :key="i" class="pos-row">
              <span class="pos">{{ g.pos }}</span>
              <span class="pos-text">{{ g.text }}</span>
            </div>
            <div v-if="!currentPosGroups.length" class="pos-row"><span class="pos-text">{{ currentHint }}</span></div>
          </div>
          <div class="wm-input-wrap">
            <input
              ref="inputEl"
              v-model="userInput"
              class="wm-input"
              :class="{ ok: answered && lastCorrect, bad: answered && !lastCorrect }"
              placeholder=""
              autocomplete="off"
              spellcheck="false"
              autocapitalize="off"
              @keyup.enter="answered ? (retypeBlocked ? null : next()) : submit()"
              @input="onTypedInput"
            />
            <button class="wm-ok" @click="answered ? next() : submit()" :disabled="retypeBlocked">
              {{ answered ? (retypeBlocked ? '把正确拼写打一遍' : '下一个 ↵') : '确定 ↵' }}
            </button>
          </div>



          <div class="wm-controls">
            <button class="icon-round" title="上一个" :disabled="currentIndex === 0" @click="prevWord">‹</button>
            <button class="icon-round play" title="发音" @click="checkIsWrong(); playCurrent()">▶</button>
            <button class="icon-round" title="跳过" @click="giveUp">↻</button>
          </div>
        </div>

        <div class="wm-progress">
          <div class="progress-bar"><div class="fill" :style="{ width: runPercent + '%' }"></div></div>
          <span class="wm-count">{{ currentIndex + 1 }} / {{ session.length }}</span>
        </div>
      </template>

      <div v-else class="lm-grid">
        <div
          v-for="(w, i) in session"
          :key="w.id"
          class="lm-card"
          :class="{ ok: results[i] === true, bad: results[i] === false }"
        >
          <div class="lm-head">
            <span class="lm-cn">{{ dictSet.translate ? hintOf(w) : '　' }}</span>
            <button class="icon-btn" title="发音" @click="playWord(w.word)">
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>
            </button>
          </div>
          <input
            v-model="answers[i]"
            class="lm-input"
            :class="{ ok: results[i] === true, bad: results[i] === false }"
            :readonly="results[i] !== undefined"
            autocomplete="off"
            spellcheck="false"
            autocapitalize="off"
            @keyup.enter="focusNextCell(i)"
          />
          <p v-if="results[i] === false" class="lm-answer">{{ w.word }}</p>
        </div>
      </div>
    </div>

    <div v-if="showDictSetting" class="ds-mask" @click.self="showDictSetting = false">
      <div class="ds-panel">
        <div class="ds-head">
          <h3>设置</h3>
          <button class="ds-close" @click="showDictSetting = false">✕</button>
        </div>
        <div class="ds-body">
          <nav class="ds-nav">
            <button
              v-for="t in DS_TABS"
              :key="t.id"
              class="ds-tab"
              :class="{ on: dsTab === t.id }"
              @click="dsTab = t.id"
            >{{ t.label }}</button>
          </nav>

          <div class="ds-content">
            <template v-if="dsTab === 'quiz'">
              <label class="ds-row">
                <span class="ds-name">错词循环<em>错词会循环出现，连续正确两次才通过</em></span>
                <input v-model="dictSet.wrongLoop" type="checkbox" class="sw" />
              </label>
              <label class="ds-row">
                <span class="ds-name">错了显示答案，写对才到下一个</span>
                <input v-model="dictSet.mustRetype" type="checkbox" class="sw" />
              </label>
              <label class="ds-row">
                <span class="ds-name">播放速度</span>
                <select v-model.number="dictSet.rate" class="ds-sel">
                  <option :value="0.5">0.5 x</option>
                  <option :value="0.75">0.75 x</option>
                  <option :value="1">1.0 x</option>
                  <option :value="1.25">1.25 x</option>
                  <option :value="1.5">1.5 x</option>
                </select>
              </label>
              <label class="ds-row">
                <span class="ds-name">播放遍数</span>
                <select v-model.number="dictSet.playTimes" class="ds-sel">
                  <option :value="1">1 遍</option>
                  <option :value="2">2 遍</option>
                  <option :value="3">3 遍</option>
                </select>
              </label>
              <label class="ds-row">
                <span class="ds-name">乱序播放</span>
                <input v-model="dictSet.shuffle" type="checkbox" class="sw" />
              </label>
              <label class="ds-row">
                <span class="ds-name">拼写正确自动提交<em>打对最后一个字母就直接判过，不用按回车</em></span>
                <input v-model="dictSet.autoSubmit" type="checkbox" class="sw" />
              </label>
              <label class="ds-row">
                <span class="ds-name">答对自动移出错词本</span>
                <input v-model="dictSet.autoRemoveWrong" type="checkbox" class="sw" />
              </label>
            </template>

            <template v-else-if="dsTab === 'sound'">
              <div class="ds-row">
                <span class="ds-name">发音类型</span>
                <div class="seg">
                  <button class="seg-b" :class="{ on: dictSet.accent === 'us' }" @click="dictSet.accent = 'us'">美音</button>
                  <button class="seg-b" :class="{ on: dictSet.accent === 'uk' }" @click="dictSet.accent = 'uk'">英音</button>
                </div>
              </div>
              <label class="ds-row">
                <span class="ds-name">音频<em>关掉就只看中文提示写单词</em></span>
                <input v-model="dictSet.audio" type="checkbox" class="sw" />
              </label>
              <label class="ds-row">
                <span class="ds-name">输入按键音效</span>
                <input v-model="dictSet.keySound" type="checkbox" class="sw" />
              </label>
              <label class="ds-row">
                <span class="ds-name">输入正确/错误提示音</span>
                <input v-model="dictSet.effectSound" type="checkbox" class="sw" />
              </label>
              <label class="ds-row">
                <span class="ds-name">练习完成音效</span>
                <input v-model="dictSet.finishSound" type="checkbox" class="sw" />
              </label>
            </template>

            <template v-else>
              <label class="ds-row">
                <span class="ds-name">显示汉语释义</span>
                <input v-model="dictSet.translate" type="checkbox" class="sw" />
              </label>
              <label class="ds-row">
                <span class="ds-name">显示音标<em>答完之后才显示，答题时露出来等于报答案</em></span>
                <input v-model="dictSet.showPhonetic" type="checkbox" class="sw" />
              </label>
              <label class="ds-row">
                <span class="ds-name">显示例句<em>同上，只在答完之后</em></span>
                <input v-model="dictSet.showExample" type="checkbox" class="sw" />
              </label>
              <label class="ds-row">
                <span class="ds-name">单词字号</span>
                <select v-model.number="dictSet.fontSize" class="ds-sel">
                  <option :value="20">小</option>
                  <option :value="26">中</option>
                  <option :value="34">大</option>
                </select>
              </label>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div v-if="phase === 'done'" class="done-panel">
      <div class="done-face">☺</div>
      <h2>你已完成此次听写</h2>

      <div class="streak-card">
        <div>
          <p class="sk-label">本次最佳状态</p>
          <p class="sk-value">{{ bestStreak ? bestStreak + ' 连胜' : '状态预热中' }}</p>
        </div>
        <span class="sk-badge">x{{ bestStreak }}</span>
      </div>

      <div class="done-stats">
        <div><span>已输入</span><b>{{ judgedCount }}</b></div>
        <div class="ok"><span>正确</span><b>{{ correctCount }}</b></div>
        <div class="rate"><span>正确率</span><b>{{ finalScore }}%</b></div>
      </div>

      <div class="done-actions">
        <button class="a-btn wb" @click="goWrongBook">查看错词本</button>
        <button class="a-btn again" @click="startSession(session)">再来一次</button>
        <button class="a-btn cont" :disabled="!hasMoreToDictate" @click="continueNext">继续听写</button>
        <button class="a-btn quit" @click="quitSession">退出</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getStudySettings } from '@/shared/core/studySettings'
import { wordDB } from '@/shared/core/database'
import { isSpellingCorrect } from '@/shared/core/spellJudge'
import { useWordStore } from '@/shared/stores/wordStore'
import { playWord, stopAll } from '@/shared/core/audio'
import { recordReview, getRecentStats } from '@/shared/core/activityLog'
import { addTodo } from '@/shared/core/studyTodos'
import type { WordItem } from '@/shared/types/WordItem'
import ListeningMaterialsTab from './components/ListeningMaterialsTab.vue'
import { startStudyClock, stopStudyClock } from '@/shared/core/studyClock'
import { nextReviewOf } from '@/shared/core/fsrs'
import { loadFsrsData } from '@/shared/core/fsrs'

const wordStore = useWordStore()
const router = useRouter()

type Phase = 'booting' | 'setup' | 'running' | 'listening' | 'done'
const phase = ref<Phase>('booting')
const sessionMode = ref<'spelling' | 'listening' | 'materials'>('spelling')

const selGroupIds = ref<Set<string>>(new Set())
const selStatus = ref('all')
const selCount = ref(20)
const showDictSetting = ref(false)
const DS_TABS = [
  { id: 'quiz' as const, label: '答题' },
  { id: 'sound' as const, label: '声音' },
  { id: 'display' as const, label: '显示' }
]
const dsTab = ref<'quiz' | 'sound' | 'display'>('quiz')

const DICT_DEFAULTS = {
  shuffle: true,
  audio: true,
  translate: true,
  autoRemoveWrong: true,
  wrongLoop: false,
  mustRetype: false,
  rate: 1,
  playTimes: 1,
  autoSubmit: false,
  accent: 'us' as 'us' | 'uk',
  keySound: true,
  effectSound: true,
  finishSound: true,
  showPhonetic: true,
  showExample: false,
  fontSize: 26
}
let audioCtx: AudioContext | null = null
function beep(freq: number, ms: number, gain = 0.05, type: OscillatorType = 'sine') {
  if (!freq || !ms) return
  try {
    audioCtx = audioCtx || new AudioContext()
    const osc = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    osc.type = type
    osc.frequency.value = freq
    g.gain.setValueAtTime(Math.max(0, Math.min(1, gain)), audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000)
    osc.connect(g).connect(audioCtx.destination)
    osc.start()
    osc.stop(audioCtx.currentTime + ms / 1000)
  } catch {
  }
}
function readDictSet(): typeof DICT_DEFAULTS {
  try {
    const v = JSON.parse(localStorage.getItem('lb-dict-set') || '{}')
    return { ...DICT_DEFAULTS, ...v }
  } catch {
    return { ...DICT_DEFAULTS }
  }
}
const dictSet = ref(readDictSet())
/** 释义按词性分组，跟学习页、TypeWords 的 TranslationList 一致 */
const currentPosGroups = computed(() => {
  const out: Array<{ pos: string; text: string }> = []
  for (const m of current.value?.meanings || []) {
    if (!m.chinese) continue
    const pos = (m.partOfSpeech || '').trim()
    const hit = out.find(x => x.pos === pos)
    if (hit) hit.text += '；' + m.chinese
    else out.push({ pos, text: m.chinese })
  }
  return out
})

const playKey = () => dictSet.value.keySound && beep(1500, 16, 0.04, 'square')
const playCorrect = () => dictSet.value.effectSound && beep(880, 90, 0.06)
const playError = () => dictSet.value.effectSound && beep(220, 140, 0.08)

watch(dictSet, v => localStorage.setItem('lb-dict-set', JSON.stringify(v)), { deep: true })

const orderSel = computed<'order' | 'random'>({
  get: () => (dictSet.value.shuffle ? 'random' : 'order'),
  set: v => { dictSet.value.shuffle = v === 'random' }
})

function toggleSelGroup(id: string) {
  const next = new Set(selGroupIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selGroupIds.value = next
}

const bookGroups = computed(() => wordStore.groups.filter(g => g.id.startsWith('book-') && !g.parentId))

const fromWordCore = computed(() => wordStore.studyList.length > 0)
const sessionSource = computed<WordItem[]>(() =>
  fromWordCore.value ? wordStore.studyList : candidateFromFilters.value
)

const candidateFromFilters = computed<WordItem[]>(() => {
  let list: WordItem[] = wordStore.words
  if (selGroupIds.value.size > 0) {
    const idset = new Set<string>()
    for (const gid of selGroupIds.value) {
      const g = wordStore.groups.find(gg => gg.id === gid)
      if (g) for (const wid of g.wordIds) idset.add(wid)
    }
    list = list.filter(w => idset.has(w.id))
  }
  if (selStatus.value === 'due') {
    // 到期与否只认 FSRS（nextReviewOf 内部会回退到老数据），
    // 跟今日复习挑词、单词详情显示的是同一个日期
    const now = new Date().toISOString()
    list = list.filter(w => {
      const due = nextReviewOf(w)
      return due && due <= now
    })
  } else if (selStatus.value !== 'all') {
    const allowed = selStatus.value.split('+')
    list = list.filter(w => allowed.includes(w.status || 'unmarked'))
  }
  return list
})

const candidateWords = computed(() => sessionSource.value)

const session = ref<WordItem[]>([])
const currentIndex = ref(0)
const userInput = ref('')
const answered = ref(false)
const lastCorrect = ref(false)

/**
 * 上一个词的作答结果，显示在左上角（爱听写 / 小语笔记都是这个位置）。
 * 对了整词绿色；错了就在**出错的那个位置**标红，而不是整词一片红。
 */
interface PrevRun { text: string; ok: boolean }
const lastResult = ref<{ word: string; hint: string; runs: PrevRun[]; ok: boolean } | null>(null)

/** 逐字母比对，合并连续同结果的字母成段 */
function diffRuns(typed: string, answer: string): PrevRun[] {
  const st = getStudySettings()
  const eq = (a: string, b: string) =>
    st.ignoreCase ? a?.toLowerCase() === b?.toLowerCase() : a === b
  const out: PrevRun[] = []
  const len = Math.max(typed.length, answer.length)
  for (let i = 0; i < len; i++) {
    const ch = answer[i] ?? ''
    // 少打的字母也算错位；多打的字母不显示（答案里没有）
    const ok = i < typed.length && eq(typed[i], ch)
    if (!ch) continue
    const last = out[out.length - 1]
    if (last && last.ok === ok) last.text += ch
    else out.push({ text: ch, ok })
  }
  return out
}
const correctCount = ref(0)
const wrongList = ref<{ word: WordItem; input: string }[]>([])
const viewMode = ref<'word' | 'list'>((localStorage.getItem('lb-dict-view') as any) || 'word')
watch(viewMode, v => localStorage.setItem('lb-dict-view', v))
const answers = ref<string[]>([])
const results = ref<(boolean | undefined)[]>([])
const streak = ref(0)
const bestStreak = ref(0)
const loopStreak = ref<Record<string, number>>({})
const loopQueued = ref<Set<string>>(new Set())

const judgedCount = computed(() =>
  viewMode.value === 'list'
    ? results.value.filter(r => r !== undefined).length
    : correctCount.value + wrongList.value.length
)
const filledCount = computed(() =>
  viewMode.value === 'list'
    ? answers.value.filter(a => a && a.trim()).length
    : judgedCount.value
)
const liveAccuracy = computed(() =>
  judgedCount.value ? Math.round((correctCount.value / judgedCount.value) * 100) : 0
)
const pool = ref<WordItem[]>([])
const hasMoreToDictate = computed(() => {
  const done = new Set(session.value.map(w => w.id))
  return pool.value.some(w => !done.has(w.id))
})
const recentAccuracy = ref<{ reviewCount: number; correctCount: number; accuracy: number } | null>(null)
const addedToPlan = ref(false)
const elapsed = ref(0)
let timerId: any = null
const inputEl = ref<HTMLInputElement | null>(null)

const current = computed(() => session.value[currentIndex.value] || null)
const runPercent = computed(() =>
  session.value.length ? Math.round((currentIndex.value / session.value.length) * 100) : 0
)
const finalScore = computed(() =>
  judgedCount.value ? Math.round((correctCount.value / judgedCount.value) * 100) : 0
)

function hintOf(w: WordItem): string {
  return w.meanings?.map(m => [m.partOfSpeech, m.chinese].filter(Boolean).join(' ')).join('；') || ''
}
const currentHint = computed(() => (current.value ? hintOf(current.value) : ''))

function startSession(list?: WordItem[]) {
  if (!list) pool.value = [...sessionSource.value]

  let words = list ? [...list] : [...pool.value]
  if (!words.length) return
  if (!list) {
    if (dictSet.value.shuffle) words.sort(() => Math.random() - 0.5)
    if (!fromWordCore.value && selCount.value > 0) words = words.slice(0, selCount.value)
  }

  if (sessionMode.value === 'listening' && !list) {
    startListening(words)
    return
  }

  session.value = words
  currentIndex.value = 0
  correctCount.value = 0
  wrongList.value = []
  userInput.value = ''
  answered.value = false
  streak.value = 0
  bestStreak.value = 0
  loopStreak.value = {}
  loopQueued.value = new Set()
  answers.value = new Array(words.length).fill('')
  results.value = new Array(words.length).fill(undefined)
  elapsed.value = 0
  phase.value = 'running'
  /**
   * 这里原来会 `setStudyList([])`。
   *
   * 那一下会让 fromWordCore 在会话进行中翻成 false —— 于是「这一批 N 个词全部听写」
   * 的文案、continueNext 取剩余词的口径、退出后的去向全都跟着变了意思。
   * 词已经拷进 session 和 pool 了，没必要在这个时候清；改到组件卸载时清。
   */

  startTimer()
  nextTick(() => {
    if (viewMode.value === 'word') {
      inputEl.value?.focus()
      playCurrent()
    }
  })
}

function startTimer() {
  stopTimer()
  const t0 = Date.now()
  timerId = setInterval(() => { elapsed.value = Math.floor((Date.now() - t0) / 1000) }, 1000)
}
function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null } }

/** 未作答就去听发音，算一次错。不这么记的话可以靠反复点喇叭白嫖。 */
function checkIsWrong() {
  if (!current.value || answered.value) return
  if (wrongList.value.some(w => w.word.id === current.value!.id)) return
  wrongList.value.push({ word: current.value, input: userInput.value })
  wordStore.recordDictationResult(current.value.id, false, userInput.value)
}

async function playCurrent() {
  if (!dictSet.value.audio || !current.value) return
  const w = current.value.word
  const times = Math.max(1, dictSet.value.playTimes)
  for (let i = 0; i < times; i++) {
    await playWord(w, dictSet.value.accent, dictSet.value.rate)
    if (i < times - 1) await new Promise(r => setTimeout(r, 400))
  }
}

function judge(input: string, answer: string): boolean {
  const st = getStudySettings()
  return isSpellingCorrect(input, answer, {
    ignoreCase: st.ignoreCase,
    ignoreSymbol: st.ignoreSymbol,
    allowVariant: st.allowSpellVariant
  })
}

function clean(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z' -]/g, '').replace(/\s+/g, ' ')
}

type DiffOp = { type: 'match' | 'missing' | 'extra'; char: string }
function diffSpelling(correctWord: string, typed: string): DiffOp[] {
  const a = correctWord.toLowerCase()
  const b = typed.toLowerCase()
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  const ops: DiffOp[] = []
  let i = n, j = m
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { ops.push({ type: 'match', char: correctWord[i - 1] }); i--; j-- }
    else if (dp[i - 1][j] >= dp[i][j - 1]) { ops.push({ type: 'missing', char: correctWord[i - 1] }); i-- }
    else { ops.push({ type: 'extra', char: typed[j - 1] }); j-- }
  }
  while (i > 0) { ops.push({ type: 'missing', char: correctWord[i - 1] }); i-- }
  while (j > 0) { ops.push({ type: 'extra', char: typed[j - 1] }); j-- }
  return ops.reverse()
}

const retypeBlocked = computed(() =>
  dictSet.value.mustRetype && answered.value && !lastCorrect.value &&
  !judge(retypeInput.value, current.value?.word || '')
)
const retypeInput = ref('')

function onTypedInput() {
  playKey()
  if (answered.value) { retypeInput.value = userInput.value; return }
  if (!dictSet.value.autoSubmit || answered.value || !current.value) return
  if (judge(userInput.value, current.value.word)) submit()
}

let autoNextTimer: ReturnType<typeof setTimeout> | null = null
function submit() {
  if (!current.value || answered.value) return
  // 一个字母都没输就回车不算一次作答。
  // 少了这条：打对之后 next() 清空输入，而同一次回车的事件还在链上
  // （或者手指没抬利索又触发一次），就拿空串去判，必然判错 ——
  // 表现就是「第一个词之后每个词都自动判错」。
  if (!userInput.value.trim()) return
  const ok = judge(userInput.value, current.value.word)
  lastCorrect.value = ok
  answered.value = true
  if (ok) {
    playCorrect()
    correctCount.value++
    streak.value++
    if (streak.value > bestStreak.value) bestStreak.value = streak.value
  } else {
    playError()
    streak.value = 0
    wrongList.value.push({ word: current.value, input: userInput.value })
    if (dictSet.value.mustRetype) { retypeInput.value = ''; nextTick(() => inputEl.value?.focus()) }
  }
  lastResult.value = {
    word: current.value.word,
    hint: currentHint.value,
    runs: ok ? [{ text: current.value.word, ok: true }] : diffRuns(userInput.value, current.value.word),
    ok
  }
  wordStore.recordDictationResult(current.value.id, ok, userInput.value)
  recordReview(ok)
  if (ok && dictSet.value.autoRemoveWrong) removeFromWrongBook(current.value.id)

  // 对错都直接进下一个，不停在检查页。
  // 结果显示在左上角：对了整词绿，错了在错的那几个字母上标红。
  answered.value = false
  next()
}

function giveUp() {
  if (!current.value || answered.value) return
  userInput.value = ''
  lastCorrect.value = false
  answered.value = true
  streak.value = 0
  wrongList.value.push({ word: current.value, input: '' })
  wordStore.recordDictationResult(current.value.id, false, '')
  recordReview(false)
  playCurrent()
}

function focusNextCell(i: number) {
  const inputs = document.querySelectorAll<HTMLInputElement>('.lm-input')
  inputs[i + 1]?.focus()
}

function judgeAll() {
  session.value.forEach((w, i) => {
    if (results.value[i] !== undefined) return
    const val = (answers.value[i] || '').trim()
    const ok = !!val && judge(val, w.word)
    results.value[i] = ok
    if (ok) {
      correctCount.value++
      streak.value++
      if (streak.value > bestStreak.value) bestStreak.value = streak.value
    } else {
      streak.value = 0
      wrongList.value.push({ word: w, input: val })
    }
    wordStore.recordDictationResult(w.id, ok, val)
    recordReview(ok)
    if (ok && dictSet.value.autoRemoveWrong) removeFromWrongBook(w.id)
  })
}

async function removeFromWrongBook(wordId: string) {
  try {
    await wordDB.removeFromWrongBook(wordId)
  } catch {
  }
}

function prevWord() {
  if (currentIndex.value === 0) return
  currentIndex.value--
  answered.value = false
  userInput.value = ''
  nextTick(() => { inputEl.value?.focus(); playCurrent() })
}

function finishSession(force = false) {
  /**
   * 列表模式下还有没填的就别急着结算。
   *
   * 那个页面是一屏铺开、填多少判多少，很容易手一滑就交了 ——
   * 交完看到"已输入 1"还以为是程序算错了。单词模式走到最后一个才会进来，不受影响。
   */
  if (!force && viewMode.value === 'list') {
    const blank = session.value.length - answers.value.filter(a => a.trim()).length
    if (blank > 0 && !confirm(`还有 ${blank} 个没写，确定现在结算？`)) return
  }
  if (autoNextTimer) { clearTimeout(autoNextTimer); autoNextTimer = null }
  if (viewMode.value === 'list') judgeAll()
  if (dictSet.value.finishSound) {
    beep(660, 110, 0.05); setTimeout(() => beep(880, 110, 0.05), 130)
    setTimeout(() => beep(1170, 190, 0.05), 260)
  }
  phase.value = 'done'
  stopTimer()
  stopAll()
  addedToPlan.value = false
  getRecentStats(7).then(s => { recentAccuracy.value = s })
}

/**
 * 中途退出：不结算。
 *
 * 一组词没听完就出结算页没有意义 —— 那个页面是给"这一轮做完了"看的。
 * 但已经答过的那些要留住：错词该进错词本、对的该记复习，
 * 只是不弹结算、不放完成音、不算这一轮的正确率。
 */
function quitSession() {
  if (autoNextTimer) { clearTimeout(autoNextTimer); autoNextTimer = null }
  stopTimer()
  stopAll()
  /**
   * 回上一个页面，不再回那张"词书 / 状态 / 数量 / 顺序"的表单。
   *
   * 词是从词汇中心选好带进来的，退出当然是回词汇中心；
   * 原来退到 setup 页，等于又让人在另一套筛选器里重选一遍，
   * 那张表和词汇中心的范围选择是两套做同一件事的东西。
   */
  wordStore.setStudyList([])
  router.back()
}

function goWrongBook() { router.push('/wrong-book') }

function continueNext() {
  const done = new Set(session.value.map(w => w.id))
  const rest = pool.value.filter(w => !done.has(w.id))
  if (!rest.length) return
  const n = session.value.length || 20
  startSession(rest.slice(0, n))
}

function next() {
  if (autoNextTimer) { clearTimeout(autoNextTimer); autoNextTimer = null }
  if (dictSet.value.wrongLoop && current.value) {
    const w = current.value
    const k = w.word.toLowerCase()
    if (lastCorrect.value) {
      const n = (loopStreak.value[k] || 0) + 1
      loopStreak.value[k] = n
      if (n < 2 && loopQueued.value.has(k)) session.value.push(w)
    } else {
      loopStreak.value[k] = 0
      loopQueued.value.add(k)
      session.value.push(w)
    }
  }
  answered.value = false
  userInput.value = ''
  retypeInput.value = ''
  currentIndex.value++
  if (currentIndex.value >= session.value.length) {
    finishSession(true)   // 单词模式走到底了，直接结算，不用再问
  } else {
    nextTick(() => {
      inputEl.value?.focus()
      playCurrent()
    })
  }
}

const listenList = ref<WordItem[]>([])
const listenIndex = ref(0)
const listenLoop = ref(false)
const listenRandom = ref(false)

const listenCurrent = computed(() => listenList.value[listenIndex.value] || null)
const listenPercent = computed(() =>
  listenList.value.length ? Math.round(((listenIndex.value + 1) / listenList.value.length) * 100) : 0
)

function startListening(words: WordItem[]) {
  listenList.value = listenRandom.value ? [...words].sort(() => Math.random() - 0.5) : words
  listenIndex.value = 0
  phase.value = 'listening'
  wordStore.setStudyList([])
  playListenCurrent()
}

function playListenCurrent() {
  if (listenCurrent.value) playWord(listenCurrent.value.word)
}

function listenPrev() {
  if (listenIndex.value > 0) {
    listenIndex.value--
    playListenCurrent()
  }
}

function listenNext() {
  if (listenIndex.value < listenList.value.length - 1) {
    listenIndex.value++
    playListenCurrent()
  } else if (listenLoop.value) {
    listenIndex.value = 0
    playListenCurrent()
  } else {
    phase.value = 'setup'
  }
}

function toggleListenRandom() {
  listenRandom.value = !listenRandom.value
  if (listenRandom.value) {
    listenList.value = [...listenList.value].sort(() => Math.random() - 0.5)
    listenIndex.value = 0
  }
}

async function addWrongToPlan() {
  if (!wrongList.value.length || addedToPlan.value) return
  const words = wrongList.value.map(w => w.word.word).join('、')
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const due = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
  await addTodo(`复习听写错词（${wrongList.value.length}个）：${words}`, due)
  addedToPlan.value = true
}

function retryWrong() {
  const words = wrongList.value.map(w => w.word)
  startSession(words)
}

function exportWrong() {
  const text = wrongList.value
    .map(w => `${w.word.word};${hintOf(w.word)}`)
    .join('\n')
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `错词-${new Date().toISOString().slice(0, 10)}.txt`
  a.click()
  URL.revokeObjectURL(a.href)
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}

function onKey(e: KeyboardEvent) {
  if (phase.value === 'running' && answered.value && e.key === 'Enter') next()
}

onMounted(async () => {
  await wordStore.loadWords()
  startStudyClock()   // 听写属于真正在练，计入学习时长
  await loadFsrsData()   // 结果要写进 FSRS，先把卡片读进来，别只落到 localStorage 副本上
  window.addEventListener('keydown', onKey)
  if (sessionMode.value === 'spelling' && candidateWords.value.length) {
    startSession()
  } else if (phase.value === 'booting') {
    phase.value = 'setup'
  }
})
onBeforeUnmount(() => {
  stopStudyClock()
  window.removeEventListener('keydown', onKey)
  stopTimer()
  stopAll()
  wordStore.setStudyList([])
})
</script>

<style lang="scss" scoped>
.dictation {
  --toolbar-width: 50rem;
  width: 100%;
  height: calc(100vh - var(--lb-main-pad, 24px) * 2);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 0;
  padding: 0;
}

.back-btn {
  border: none; background: none; color: var(--r-ink2, #8a9099);
  font-size: 14px; cursor: pointer; padding: 0; margin-bottom: 10px;
  &:hover { color: var(--r-ink, #1f2328); }
}
.booting { min-height: 60vh; }
.setup-panel {
  h1 { font-size: 26px; color: #1a1a1a; }
  .sub { color: #888; margin: 6px 0 22px; font-size: 14px; }
}
.scope-note {
  background: #eef4e8;
  border: 1px solid #d8e4c8;
  color: #4a6d33;
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 16px;
  font-size: 14px;
}
.mode-seg {
  display: inline-flex;
  background: var(--r-ui, #f2f2f2);
  border-radius: 10px;
  padding: 4px;
  margin-bottom: 8px;
}
.mode-btn {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  border: none;
  background: none;
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  color: #444;
  &.on { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff)); box-shadow: 0 1px 4px rgba(0,0,0,0.1); font-weight: 600; }
}
.mode-hint { color: #999; font-size: 13px; margin-bottom: 18px; }

.listen-panel { max-width: 480px; margin: 0 auto; }
.listen-card {
  text-align: center;
  background: #fff;
  border: 1px solid #eee;
  border-radius: 14px;
  padding: 40px 24px;
  margin: 30px 0;
}
.big-speak {
  width: 68px; height: 68px; border-radius: 50%; border: none; background: var(--r-ink, #1f2328); color: #fff; cursor: pointer; line-height: 0; margin-bottom: 18px;
  &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 82%, #000); }
}
.lc-word { font-size: 32px; font-weight: 700; color: #1a1a1a; }
.lc-ph { color: #999; font-size: 15px; margin-top: 8px; }
.lc-cn { color: #555; font-size: 15px; margin-top: 16px; }
.listen-controls { display: flex; gap: 10px; justify-content: center; }
.setup-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}
.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  label { font-size: 13px; color: #666; }
  select {
    border: 1px solid var(--r-border, #ddd);
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 14px;
    background: #fff;
    outline: none;
    &:focus { border-color: #999; }
  }
  &.book-multiselect { grid-column: 1 / -1; }
}
.book-chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
.book-chip {
  border: 1px solid var(--r-border, #ddd);
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff));
  border-radius: 16px;
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
  color: #444;
  &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff)); border-color: color-mix(in srgb, var(--r-accent, #8a4b3a) 42%, transparent); }
  &.on { background: var(--r-accent, #8a4b3a); border-color: transparent; color: #fff; }
}
.candidate-info { color: #555; font-size: 14px; margin-bottom: 18px; }
.start-btn {
  border: none;
  background: var(--r-accent, #8a4b3a);
  color: #fff;
  border-radius: 10px;
  padding: 13px 34px;
  font-size: 16px;
  cursor: pointer;
  &:hover:not(:disabled) { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 82%, #000); }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
}

.run-head {
  display: flex;
  align-items: center;
  gap: 18px;
  color: #666;
  font-size: 14px;
  .quit-btn {
    margin-left: auto;
    border: 1px solid var(--r-border, #ddd);
    background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff));
    border-radius: 7px;
    padding: 5px 14px;
    cursor: pointer;
    font-size: 13px;
    &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff)); border-color: color-mix(in srgb, var(--r-accent, #8a4b3a) 42%, transparent); }
  }
}
.progress-bar {
  height: 6px;
  background: #eee;
  border-radius: 3px;
  margin: 12px 0 30px;
  overflow: hidden;
  .fill { height: 100%; background: var(--r-accent, #8a4b3a); transition: width 0.2s; }
}
.play-area {
  text-align: center;
  margin-bottom: 26px;
  .big-speak {
    width: 88px;
    height: 88px;
    border-radius: 50%;
    border: none;
    background: var(--r-accent, #8a4b3a);
    color: #fff;
    cursor: pointer;
    line-height: 0;
    &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 82%, #000); transform: scale(1.04); }
    transition: transform 0.1s;
  }
  .play-hint { color: #888; font-size: 14px; margin-top: 14px; }
  .cn-hint { color: #333; font-weight: 500; }
}
.answer-area { text-align: center; }
.handwrite-hint { color: #999; font-size: 12px; margin-top: 10px; line-height: 1.6; max-width: 460px; margin-left: auto; margin-right: auto; }
.dict-input {
  width: min(440px, 90%);
  border: 2px solid #ddd;
  border-radius: 10px;
  padding: 14px 18px;
  font-size: 20px;
  text-align: center;
  outline: none;
  letter-spacing: 1px;
  &:focus { border-color: transparent; }
}
.answer-btns { margin-top: 18px; display: flex; gap: 12px; justify-content: center; }
.a-btn {
  border: 1px solid var(--r-border, #ddd);
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff));
  border-radius: 9px;
  padding: 10px 22px;
  font-size: 14px;
  cursor: pointer;
  &:hover:not(:disabled) { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff)); }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
  &.on { background: var(--r-accent, #8a4b3a); border-color: transparent; color: #fff; }
  &.primary {
    background: var(--r-accent, #8a4b3a);
    border-color: transparent;
    color: #fff;
    &:hover:not(:disabled) { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 82%, #000); }
  }
}

.feedback {
  text-align: center;
  border-radius: 12px;
  padding: 22px;
  &.ok { background: #eef4e8; }
  &.bad { background: #f9ece9; }
  .fb-line { display: flex; align-items: baseline; justify-content: center; gap: 10px; margin-bottom: 8px; }
  .fb-badge { font-weight: 700; }
  .fb-word { font-size: 26px; font-weight: 700; color: #1a1a1a; }
  .fb-ph { color: #777; }
  .fb-your { color: #a05040; font-size: 14px; margin-bottom: 4px; }
  .fb-diff { font-size: 20px; letter-spacing: 1px; margin-bottom: 6px; font-family: inherit; }
  .fb-diff-legend { font-size: 11.5px; color: #999; margin-bottom: 10px; }
  .fb-cn { color: #555; font-size: 14px; margin-bottom: 16px; }
}
.feedback.ok .fb-badge { color: #4a7d3a; }
.feedback.bad .fb-badge { color: #b05a4a; }

.diff-match { color: #1a1a1a; }
.diff-missing { color: #b05a4a; text-decoration: underline; text-decoration-style: wavy; }
.diff-extra { color: #b05a4a; text-decoration: line-through; }

.done-panel {
  h2 { font-size: 24px; color: #1a1a1a; margin-bottom: 18px; }
}
.recent-stat { color: #777; font-size: 13px; margin: -8px 0 18px; b { color: #4a7d3a; } }
.done-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  text-align: center;
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 18px 0;
  margin-bottom: 22px;
  b { display: block; font-size: 26px; color: #1a1a1a; }
  span { color: #888; font-size: 13px; }
  .ok-c { color: #4a7d3a; }
  .bad-c { color: #b05a4a; }
}
.wrong-box {
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 16px 18px;
  margin-bottom: 22px;
  h3 { font-size: 15px; margin-bottom: 12px; color: #333; }
}
.wrong-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px dashed #f0f0f0;
  font-size: 14px;
  flex-wrap: wrap;
  &:last-child { border-bottom: none; }
  .ww { font-weight: 700; color: #1a1a1a; min-width: 110px; }
  .wp { color: #999; font-size: 12.5px; }
  .wc { color: #555; flex: 1; }
  .wu { color: #b05a4a; font-size: 12.5px; }
  .wu-diff { font-size: 13px; letter-spacing: 0.5px; }
  .icon-btn { border: none; background: none; cursor: pointer; color: #555; line-height: 0; align-self: center; &:hover { color: #000; } }
}
.done-actions { display: flex; gap: 12px; flex-wrap: wrap; }

@media (max-width: 600px) {
  .dictation { padding: 14px 14px 40px; }
}

/* 之前这里没写宽度，它只按内容撑开 —— 内层再怎么设 50rem 也没用，
   看着就是窄窄一条。练习内容整体垂直居中。 */
.run-panel {
  flex: 1; min-height: 0; width: 100%;
  display: flex; flex-direction: column; align-items: center;
  position: relative;
}
.run-bar {
  width: min(var(--toolbar-width), 100%);
  margin: 0 auto 22px;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 14px 0; border-bottom: 1px solid var(--r-border, #e6e6e6);
}
.run-stat {
  font-size: 13px; padding: 4px 10px; border-radius: 7px;
  background: var(--r-ui, #f2f2f2); color: var(--r-ink2, #666);
}
.run-stat.ok { background: color-mix(in srgb, #3a8a5c 14%, transparent); color: #2f6f4a; }
.run-spacer { flex: 1; }
.bar-icon {
  border: none; background: none; cursor: pointer; padding: 6px;
  border-radius: 8px; line-height: 0; color: var(--r-ink2, #8a7f6d);
  transition: background .12s ease, color .12s ease;
  &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 10%, transparent); color: var(--r-accent, #8a4b3a); }
  &.danger:hover { background: #f7e7e3; color: #b05a4a; }
}

/* 上一个词的结果，钉在左上角。爱听写和小语笔记都是这个位置：
   箭头 + 单词 + 释义，对了整词绿，错了只标错的那几个字母。 */
.prev-result {
  position: absolute; left: 1.25rem; top: 1.25rem;
  display: flex; align-items: baseline; gap: 0.6rem;
  font-size: 1.1rem; pointer-events: none; z-index: 5;
}
.pr-arrow { color: var(--r-ink2, #b8bec6); font-size: 1rem; }
.pr-word { letter-spacing: 0.02em; font-weight: 500; }
.r-ok { color: #3a8a5c; }
.r-bad { color: #c0392b; }
.pr-hint {
  color: var(--r-ink2, #9aa0a6); font-size: 0.95rem;
  max-width: 16rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 输入线落在页面竖直中线上：wm-area 占满剩余高度并居中对齐内容 */
.wm-area {
  flex: 1; min-height: 0;
  display: flex; flex-direction: column; justify-content: center; align-items: center;
  width: min(var(--toolbar-width), 100%);
  margin: 0 auto; text-align: center;
  padding-bottom: 4rem;   /* 抵掉底部进度条的高度，让中线真的在正中 */
}
/* 数值同 TypeWord.vue：.translate 1.2rem，.pos min-width 2.5rem(min-w-10) */
.wm-cn {
  font-size: 1.6rem; font-weight: 500; line-height: 1.7; margin: 0 0 3rem;
  color: var(--r-ink, #1f2328); text-align: center;
  width: min(var(--toolbar-width), 100%);
}
/* 释义整体居中：每一行自己是 inline-flex，行内左对齐、整行在容器里居中 */
.wm-cn .pos-row {
  display: inline-flex; align-items: flex-start; gap: 0.5rem;
  text-align: left;
}
.wm-cn .pos { flex-shrink: 0; color: var(--r-accent, #5b7a99); }
.wm-cn .pos-text { flex: 1; min-width: 0; }
/* 输入区照 TypeWords：.dictation { border-bottom: 2px solid gray }，宽 w-120 = 30rem */
.wm-input-wrap {
  display: flex; gap: 1rem; justify-content: center; align-items: flex-end;
  margin-top: 0.5rem;
}
.wm-input {
  width: min(30rem, 70vw); padding: 0.5rem 0.25rem;
  font-size: 2rem; text-align: center; letter-spacing: 0.15rem;
  border: none; border-bottom: 2px solid var(--r-border, #b9bec4);
  background: transparent; color: var(--r-ink, #1f2328); outline: none;
  font-family: 'Segoe UI', 'PingFang SC', system-ui, sans-serif; font-weight: 300;
}
.wm-input:focus { border-bottom-color: var(--r-ink, #1f2328); }
/* 只把下边线变色，不整个框刷红底。答错时正确拼写已经在下面显示了，
   再糊一片红底既晃眼又没多给信息。 */
.wm-input.ok { border-bottom-color: #3a8a5c; }
.wm-input.bad { border-bottom-color: #b5493c; }
.wm-ok {
  border: none; border-radius: 8px; padding: 11px 22px;
  font-size: 14px; cursor: pointer;
  background: var(--r-ink, #1f2328); color: #fff;
  &:hover:not(:disabled) { filter: brightness(1.25); }
  &:disabled { opacity: .4; cursor: default; }
}
.wm-controls { display: flex; gap: 1.5rem; justify-content: center; align-items: center; margin-top: 3rem; }
.icon-round {
  width: 46px; height: 46px; border-radius: 50%; font-size: 19px; cursor: pointer;
  border: 1px solid var(--r-border, #ddd);
  background: var(--r-paper, #fff); color: var(--r-ink, #333);
  transition: background-color .15s ease;
}
.icon-round:hover:not(:disabled) { background: var(--r-ui, #f2f2f2); }
.icon-round:disabled { opacity: 0.35; cursor: default; }
.icon-round.play { background: var(--r-ink, #1f2328); border-color: transparent; color: #fff; }
/* 进度条钉窗口底边，不跟着内容浮在中间 */
.wm-progress {
  position: sticky;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 1rem);
  margin: auto auto 0;
  width: min(var(--toolbar-width), 100%);
  display: flex; align-items: center; gap: 14px;
  z-index: 20;
}
.wm-progress .progress-bar { flex: 1; }
.wm-count { font-size: 13px; color: var(--r-ink2, #888); white-space: nowrap; }

.lm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px 32px; }
.lm-card {
  border: none; border-radius: 0; padding: 12px 4px 6px;
  background: transparent;
}
.lm-card.ok .lm-cn { color: #2f6f4a; }
.lm-card.bad .lm-cn { color: #b5493c; }
.lm-head { display: flex; align-items: flex-start; gap: 8px; min-height: 42px; }
.lm-cn { flex: 1; font-size: 14px; line-height: 1.5; }
.lm-input {
  width: 100%; margin-top: 10px; padding: 6px 2px; font-size: 15px;
  border: none; border-bottom: 1px solid var(--r-border, #ddd);
  background: transparent; color: var(--r-ink, #222); outline: none;
}
.lm-input:focus { border-bottom-color: var(--r-accent, #8a4b3a); }
.lm-input.ok { color: #2f6f4a; }
.lm-input.bad { color: #b5493c; text-decoration: line-through; }
.lm-answer { margin: 4px 0 0; font-size: 13px; color: #2f6f4a; font-weight: 600; }

.done-face { font-size: 74px; line-height: 1; text-align: center; margin-bottom: 6px; }
.done-panel h2 { text-align: center; margin: 0 0 24px; }
.streak-card {
  max-width: 420px; margin: 0 auto 18px; display: flex; align-items: center; gap: 14px;
  padding: 16px 20px; border-radius: 12px;
  background: color-mix(in srgb, #3a8a5c 12%, transparent);
}
.streak-card > div { flex: 1; }
.sk-label { margin: 0; font-size: 12.5px; color: #2f6f4a; opacity: 0.85; }
.sk-value { margin: 4px 0 0; font-size: 21px; font-weight: 700; color: #2f6f4a; }
.sk-badge {
  padding: 9px 15px; border-radius: 9999px; font-weight: 700; font-size: 17px;
  background: var(--r-paper, #fff); color: #2f6f4a;
}
.done-stats { max-width: 420px; margin: 0 auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.done-stats > div {
  padding: 14px 8px; border-radius: 11px; text-align: center;
  border: 1px solid var(--r-border, #e6e6e6);
}
.done-stats span { display: block; font-size: 12.5px; color: var(--r-ink2, #888); }
.done-stats b { display: block; margin-top: 4px; font-size: 25px; }
.done-stats .ok { background: color-mix(in srgb, #3a8a5c 8%, transparent); }
.done-stats .ok b { color: #2f6f4a; }
.done-stats .rate { background: color-mix(in srgb, #d99a2b 10%, transparent); }
.done-stats .rate b { color: #b8801f; }
.done-note { text-align: center; font-size: 13px; color: var(--r-ink2, #888); margin-top: 16px; }
.done-actions { justify-content: center; margin-top: 26px; }
.a-btn.wb { background: #e2583f; border-color: transparent; color: #fff; }
.a-btn.again { background: #8a4b2a; border-color: transparent; color: #fff; }
.a-btn.cont { background: #1b1b1b; border-color: transparent; color: #fff; }
.a-btn.quit { background: #e8463a; border-color: transparent; color: #fff; }
.a-btn.cont:disabled { opacity: 0.4; }

.ds-mask {
  position: fixed; inset: 0; z-index: 300; background: rgba(0, 0, 0, 0.35);
  display: flex; align-items: center; justify-content: center; padding: 24px;
}

.ds-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.ds-close { border: none; background: none; font-size: 16px; cursor: pointer; color: var(--r-ink2, #999); }
.ds-body { display: flex; gap: 18px; min-height: 300px; }
.ds-nav { display: flex; flex-direction: column; gap: 4px; width: 108px; flex-shrink: 0; }
.ds-tab {
  text-align: left; padding: 10px 12px; border-radius: 9px; font-size: 14px; cursor: pointer;
  border: none; background: none; color: var(--r-ink2, #777);
  transition: background-color .15s ease, color .15s ease;
}
.ds-tab:hover { background: var(--r-ui, #f3f3f3); }
.ds-tab.on { background: var(--r-ui, #eee); color: var(--r-ink, #222); font-weight: 600; }
.ds-content { flex: 1; min-width: 0; }
.ds-name { display: flex; flex-direction: column; gap: 3px; font-size: 14.5px; font-weight: 600; }
.ds-name em { font-style: normal; font-size: 12px; font-weight: 400; color: var(--r-ink2, #999); }
.ds-sel {
  padding: 6px 10px; border-radius: 8px; font-size: 13px; min-width: 96px;
  border: 1px solid var(--r-border, #ddd); background: var(--r-paper, #fff); color: inherit;
}
.seg { display: inline-flex; border-radius: 8px; overflow: hidden; border: 1px solid var(--r-border, #ddd); }
.seg-b {
  padding: 6px 16px; font-size: 13px; cursor: pointer; border: none;
  background: var(--r-paper, #fff); color: var(--r-ink2, #777);
}
.seg-b.on { background: var(--r-ui, #f4f5f7); color: var(--r-ink, #1f2328); font-weight: 600; }
.fb-eg { flex-basis: 100%; font-size: 13px; color: var(--r-ink2, #888); margin-top: 4px; }
.ds-panel {
  width: min(620px, 100%); border-radius: 14px; padding: 22px 24px;
  background: var(--r-paper, #fff); color: var(--r-ink, #222);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.22);
}
.ds-panel h3 { margin: 0 0 18px; font-size: 20px; }
.ds-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 0; font-size: 15px; font-weight: 600; cursor: pointer;
}
.ds-actions { display: flex; justify-content: flex-end; margin-top: 14px; }
.sw {
  appearance: none; width: 46px; height: 26px; border-radius: 9999px; cursor: pointer;
  background: var(--r-border, #ccc); position: relative; transition: background-color .18s ease;
}
.sw::after {
  content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px;
  border-radius: 50%; background: #fff; transition: transform .18s ease;
}
.sw:checked { background: var(--r-accent, #8a4b3a); }
.sw:checked::after { transform: translateX(20px); }
.wm-speak {
  width: 56px; height: 56px; border-radius: 50%; cursor: pointer; margin: 0.5rem auto 2rem;
  display: flex; align-items: center; justify-content: center;
  border: none; background: var(--r-accent, #8a4b3a); color: #fff;
}

.empty-guide {
  margin-top: 28px;
  display: flex; flex-direction: column; align-items: flex-start; gap: 14px;
  color: var(--r-ink2, #888); font-size: 14px;
}
.empty-guide p { margin: 0; }
</style>

<template>
  <div class="match-page">
    <header class="mg-head">
      <button class="ghost-btn small" @click="quit">← 返回</button>
      <div class="mg-title">
        <h2>卡片消消乐</h2>
        <p class="mg-sub">点单词，再点它的释义</p>
      </div>
      <span class="mg-scope">{{ scopeLabel }}</span>
    </header>

    <div class="mg-bar">
      <button class="ghost-btn small" :disabled="page === 0" @click="goPage(page - 1)">‹ 上一页</button>
      <span class="mg-progress">
        进度: {{ matched }} / {{ total }}
        <span v-if="pageCount > 1" class="mg-page">第 {{ page + 1 }} / {{ pageCount }} 页 · 全部 {{ doneTotal }} / {{ pairs.length }} 对</span>
      </span>
      <button class="ghost-btn small" :disabled="page >= pageCount - 1" @click="goPage(page + 1)">下一页 ›</button>
    </div>

    <div v-if="!total" class="mg-empty">
      这里没有可以配对的词。需要至少 2 个带释义的单词。
    </div>

    <div v-else class="mg-grid">
      <button
        v-for="c in cards"
        :key="c.key"
        class="mg-card"
        :class="{
          picked: pickedKey === c.key,
          right: flash === 'right' && flashKeys.includes(c.key),
          wrong: flash === 'wrong' && flashKeys.includes(c.key),
          gone: c.done,
          cn: c.side === 'zh'
        }"
        :disabled="c.done"
        @click="tap(c)"
      >
        <span class="mg-dot"></span>
        <span class="mg-text">{{ c.text }}</span>
      </button>
    </div>

    <div v-if="finished" class="mg-settle">
      <h3>{{ page >= pageCount - 1 ? '全部配完' : `第 ${page + 1} 页配完` }}</h3>
      <p>用时 {{ minutes }} 分 {{ seconds }} 秒 · 点错 {{ wrongCount }} 次</p>
      <div class="mg-acts">
        <button v-if="page < pageCount - 1" class="dark-btn" @click="goPage(page + 1)">下一页（{{ pairsOfPage(page + 1).length }} 对）</button>
        <button class="dark-btn" @click="restart">再来一轮</button>
        <button class="ghost-btn" @click="goWrongBook">查看错词本</button>
      </div>
    </div>

    <footer class="mg-foot">
      <label class="mg-opt">
        <input v-model="linkWrongBook" type="checkbox" /> 关联错词本
      </label>
      <label class="mg-opt">
        <input v-model="playOnPick" type="checkbox" /> 选中播放音频
      </label>
      <label class="mg-opt">
        每页
        <select v-model.number="perPage" class="mg-sel">
          <option v-for="n in PER_PAGE_CHOICES" :key="n" :value="n">{{ n }}</option>
        </select>
        对
      </label>
      <label class="mg-opt">
        <input v-model="shuffleOn" type="checkbox" /> 打乱
      </label>
      <span class="spacer"></span>
      <button class="ghost-btn small" @click="goWrongBook">查看错词本</button>
      <button class="ghost-btn small" @click="quit">关闭</button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useWordStore } from '@/shared/stores/wordStore'
import type { WordItem } from '@/shared/types/WordItem'
import { playWord } from '@/shared/core/audio'
import { getStudySettings, saveStudySettings } from '@/shared/core/studySettings'
import { startStudyClock, stopStudyClock } from '@/shared/core/studyClock'
import { readScope, wordsOfScope } from '@/shared/core/studyScope'

interface Card {
  key: string
  wordId: string
  side: 'en' | 'zh'
  text: string
  done: boolean
}

/**
 * 每页多少对，来自练习设置（默认 10）。
 * 范围里的词**全部**参与，按这个数分页，一页配完自动进下一页 ——
 * 原来是从范围里随机抽 10 对就完事，剩下的词根本轮不到。
 */

const router = useRouter()
const route = useRoute()
const wordStore = useWordStore()
const settings = getStudySettings()

const scopeLabel = ref('')
const pool = ref<WordItem[]>([])
/** 分好页的词：pairs[页][这一页的词] */
const pairs = ref<WordItem[]>([])
const page = ref(0)
const doneIds = ref<Set<string>>(new Set())
const cards = ref<Card[]>([])
const pickedKey = ref('')
const flash = ref<'' | 'right' | 'wrong'>('')
const flashKeys = ref<string[]>([])
const wrongCount = ref(0)
const matched = ref(0)
const total = ref(0)
const finished = ref(false)

const PER_PAGE_CHOICES = [10, 20, 30]

/**
 * 每页几对、要不要打乱。
 *
 * 原来只能去练习设置弹窗里改 —— 那个弹窗挂在背单词那边，
 * 玩消消乐的时候根本够不着。改成就放在底栏，改完立刻重排，
 * 同时写回 settings，跟练习设置里那两项是同一个值。
 */
/** 存的值不在选项里（改选项之前存过 12、15 之类）就归到最近的一档，免得下拉显示空白 */
function nearestChoice(n: number): number {
  return PER_PAGE_CHOICES.reduce((best, c) => Math.abs(c - n) < Math.abs(best - n) ? c : best, PER_PAGE_CHOICES[0])
}
const perPage = ref(nearestChoice(settings.matchPairsPerPage || 10))
const shuffleOn = ref(settings.matchShuffle !== false)

watch(perPage, n => {
  saveStudySettings({ matchPairsPerPage: n })
  // 页数变了，当前页号可能越界；回到第一页最省事，也不会让人对不上进度
  page.value = 0
  deal()
})
watch(shuffleOn, v => {
  saveStudySettings({ matchShuffle: v })
  pairs.value = v ? shuffle(pool.value) : [...pool.value]
  page.value = 0
  doneIds.value = new Set()
  deal()
})
const pageCount = computed(() => Math.max(1, Math.ceil(pairs.value.length / perPage.value)))
const doneTotal = computed(() => doneIds.value.size)

const linkWrongBook = ref(localStorage.getItem('lb-match-wrongbook') !== '0')
const playOnPick = ref(localStorage.getItem('lb-match-audio') !== '0')

const startedAt = ref(Date.now())
const elapsed = ref(0)
let tickTimer: ReturnType<typeof setInterval> | null = null
const minutes = computed(() => Math.floor(elapsed.value / 60))
const seconds = computed(() => elapsed.value % 60)

function meaningOf(w: WordItem): string {
  const m = (w.meanings || []).find(x => x.chinese)
  if (!m) return ''
  return (m.partOfSpeech ? m.partOfSpeech + ' ' : '') + m.chinese
}

function shuffle<T>(a: T[]): T[] {
  const r = [...a]
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

function build() {
  // 优先用外面带进来的词（词汇中心「消消乐」按钮走的是 studyList）
  const fromOutside = wordStore.studyList.length ? wordStore.studyList : null
  let list: WordItem[]
  if (fromOutside) {
    list = fromOutside
    scopeLabel.value = `${list.length} 词`
  } else {
    const scope = readScope(route.query as Record<string, any>)
    scopeLabel.value = scope.label || '全部'
    list = wordsOfScope(scope, wordStore.words, wordStore.groups)
  }

  // 释义为空的词配不出对，直接排除；释义重复的也去掉一个，
  // 否则会出现两张一模一样的中文卡，点哪张都对不上另一个词
  const seen = new Set<string>()
  pool.value = list.filter(w => {
    const m = meaningOf(w)
    if (!m || seen.has(m)) return false
    seen.add(m)
    return true
  })

  // 打乱与否由设置决定；不打乱时按词表原顺序分页
  pairs.value = shuffleOn.value ? shuffle(pool.value) : [...pool.value]
  page.value = 0
  doneIds.value = new Set()
  deal()
}

let autoNextTimer: ReturnType<typeof setTimeout> | null = null

/** 第 n 页有哪些词 */
function pairsOfPage(n: number): WordItem[] {
  const start = n * perPage.value
  return pairs.value.slice(start, start + perPage.value)
}

function goPage(n: number) {
  if (n < 0 || n >= pageCount.value) return
  if (autoNextTimer) { clearTimeout(autoNextTimer); autoNextTimer = null }
  page.value = n
  deal()
}

function deal() {
  const picked = pairsOfPage(page.value)
  total.value = picked.length
  matched.value = 0
  finished.value = false
  const cs: Card[] = []
  for (const w of picked) {
    cs.push({ key: w.id + ':en', wordId: w.id, side: 'en', text: w.word, done: false })
    cs.push({ key: w.id + ':zh', wordId: w.id, side: 'zh', text: meaningOf(w), done: false })
  }
  // 页内摆放位置始终是乱的，否则单词和它的释义会挨着
  cards.value = shuffle(cs)
  pickedKey.value = ''
}

function cardOf(key: string): Card | undefined {
  return cards.value.find(c => c.key === key)
}

let flashTimer: ReturnType<typeof setTimeout> | null = null
function showFlash(kind: 'right' | 'wrong', keys: string[], ms: number, after?: () => void) {
  flash.value = kind
  flashKeys.value = keys
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    flash.value = ''
    flashKeys.value = []
    flashTimer = null
    after?.()
  }, ms)
}

function tap(c: Card) {
  if (c.done || flash.value) return

  // 点到单词就读一遍。点中文卡不读 —— 那等于把答案念出来了
  if (playOnPick.value && c.side === 'en') {
    playWord(c.text, settings.soundType || 'us', settings.wordSoundSpeed).catch(() => {})
  }

  if (!pickedKey.value) {
    pickedKey.value = c.key
    return
  }
  if (pickedKey.value === c.key) {
    pickedKey.value = ''
    return
  }

  const first = cardOf(pickedKey.value)
  if (!first) { pickedKey.value = c.key; return }

  // 同一侧的两张（两个单词、或两个释义）不构成一对，当点错处理
  const ok = first.wordId === c.wordId && first.side !== c.side
  const keys = [first.key, c.key]
  pickedKey.value = ''

  if (ok) {
    // 对了：绿一下再消失
    showFlash('right', keys, 320, () => {
      for (const k of keys) {
        const t = cardOf(k)
        if (t) t.done = true
      }
      matched.value++
      doneIds.value.add(first.wordId)
      if (playOnPick.value) {
        const en = first.side === 'en' ? first.text : c.text
        playWord(en, settings.soundType || 'us', settings.wordSoundSpeed).catch(() => {})
      }
      if (linkWrongBook.value) wordStore.markWrongBook(first.wordId, true)
      if (matched.value >= total.value) complete()
    })
  } else {
    // 错了：红一下，卡片留在原地
    wrongCount.value++
    showFlash('wrong', keys, 420)
    if (linkWrongBook.value) {
      // 两张卡分属两个词，错在"把 A 的释义安给了 B"，两个都记
      wordStore.markWrongBook(first.wordId, false, c.text)
      if (c.wordId !== first.wordId) wordStore.markWrongBook(c.wordId, false, first.text)
    }
  }
}

function complete() {
  finished.value = true
  // 还有下一页就等一下自动翻过去，最后一页才停表出结算
  if (page.value < pageCount.value - 1) {
    autoNextTimer = setTimeout(() => {
      autoNextTimer = null
      goPage(page.value + 1)
    }, 1200)
    return
  }
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
}

function restart() {
  wrongCount.value = 0
  page.value = 0
  doneIds.value = new Set()
  if (shuffleOn.value) pairs.value = shuffle(pool.value)
  startedAt.value = Date.now()
  elapsed.value = 0
  if (!tickTimer) tickTimer = setInterval(() => { elapsed.value = Math.floor((Date.now() - startedAt.value) / 1000) }, 1000)
  deal()
}

function goWrongBook() { router.push('/wrong-book') }
function quit() {
  wordStore.setStudyList([])
  router.back()
}

onMounted(async () => {
  await wordStore.loadWords()
  build()
  startStudyClock()
  tickTimer = setInterval(() => { elapsed.value = Math.floor((Date.now() - startedAt.value) / 1000) }, 1000)
})
onUnmounted(() => {
  stopStudyClock()
  if (tickTimer) clearInterval(tickTimer)
  if (flashTimer) clearTimeout(flashTimer)
  if (autoNextTimer) clearTimeout(autoNextTimer)
})

// 两个开关记住上次的选择
watch(linkWrongBook, v => localStorage.setItem('lb-match-wrongbook', v ? '1' : '0'))
watch(playOnPick, v => localStorage.setItem('lb-match-audio', v ? '1' : '0'))
</script>

<style scoped lang="scss">
.match-page {
  min-height: 100%;
  padding: 18px 24px 90px;
  display: flex;
  flex-direction: column;
}
.mg-head { display: flex; align-items: center; gap: 16px; }
.mg-title h2 { font-size: 18px; margin: 0; }
.mg-sub { font-size: 12.5px; color: var(--r-ink2, #9aa0a6); margin: 2px 0 0; }
.mg-scope { margin-left: auto; font-size: 12.5px; color: var(--r-ink2, #9aa0a6); }
.mg-progress { text-align: center; font-size: 17px; font-weight: 600; }
.mg-empty { text-align: center; color: var(--r-ink2, #9aa0a6); margin-top: 40px; }

.mg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 14px;
}
.mg-card {
  position: relative;
  min-height: 92px;
  padding: 16px 14px;
  border: none;
  border-radius: 14px;
  background: var(--r-ui, #f4f5f7);
  color: var(--r-ink, #1f2328);
  font-size: 15px;
  font-family: inherit;
  line-height: 1.45;
  cursor: pointer;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform .12s ease, background .2s ease, opacity .3s ease;

  &:hover:not(:disabled) { transform: translateY(-2px); }
  &.cn { background: var(--r-ui2, #eceff3); }
  &.picked { outline: 2px solid var(--r-accent, #8a4b3a); }
  &.right { background: #cdebd4; }
  &.wrong { background: #f3ccc8; }
  &.gone { opacity: 0; pointer-events: none; }
}
.mg-dot {
  position: absolute; left: 10px; top: 10px;
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--r-accent, #b08968); opacity: .55;
}
.mg-text { max-height: 100%; overflow: hidden; }

.mg-settle {
  margin: 26px auto 0; text-align: center;
}
.mg-settle h3 { margin: 0 0 6px; font-size: 17px; }
.mg-acts { display: flex; gap: 10px; justify-content: center; margin-top: 12px; }

.mg-foot {
  position: fixed; left: var(--lb-nav-w, 56px); right: 0; bottom: 0;
  display: flex; align-items: center; gap: 18px;
  padding: 12px 24px;
  background: var(--r-bg, #fff);
  border-top: 1px solid var(--r-line, #eceff3);
  font-size: 13px;
}
.mg-opt { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.mg-sel {
  border: 1px solid var(--r-line, #e5e7eb); border-radius: 7px;
  background: transparent; color: var(--r-ink, #1f2328);
  font-family: inherit; font-size: 13px; padding: 3px 6px;
}
.mg-bar { display: flex; align-items: center; justify-content: center; gap: 16px; margin: 18px 0 14px; }
.mg-page { display: block; font-size: 12.5px; font-weight: 400; color: var(--r-ink2, #9aa0a6); }
.spacer { flex: 1; }
</style>

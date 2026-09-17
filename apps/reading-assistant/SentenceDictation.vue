<template>
  <div class="sd">
    <!-- 顶栏：返回 · 标题 · 进度 · 设置 -->
    <header class="sd-head">
      <BackLink label="返回" @back="leave" />
      <div class="sd-title">{{ title }}</div>
      <span v-if="phase === 'run'" class="sd-count">{{ cursor + 1 }} / {{ queue.length }}</span>
      <FoldToggle v-if="phase !== 'result'" v-model:folded="setFolded" side="down" class="sd-set-btn" />
    </header>
    <div v-if="phase === 'run'" class="sd-bar"><div class="sd-bar-fill" :style="{ width: progressPct + '%' }"></div></div>

    <section v-if="!setFolded && phase !== 'result'" class="sd-settings">

      <label>自动重复
        <select v-model.number="cfg.repeat">
          <option v-for="r in [1, 2, 3]" :key="r" :value="r">{{ r }} 遍</option>
        </select>
      </label>
      <label>音源
        <select v-model="cfg.source">
          <option value="auto">自动</option>
          <option value="tts">朗读</option>
        </select>
      </label>
      <label>范围
        <input v-model.number="rangeFrom" class="sd-num" type="number" min="1" :max="sentences.length" />
        <span>—</span>
        <input v-model.number="rangeTo" class="sd-num" type="number" min="1" :max="sentences.length" />
        <button class="ghost-btn small" @click="start()">重新开始</button>
      </label>
      <label>模式
        <select v-model="cfg.mode">
          <option value="full">整句</option>
          <option value="cloze">填空</option>
        </select>
      </label>
      <label class="sd-check"><input v-model="cfg.instant" type="checkbox" />逐句对照</label>
      <label class="sd-check"><input v-model="cfg.live" type="checkbox" />边打边校验</label>
      <label class="sd-check"><input v-model="cfg.slots" type="checkbox" />词数提示</label>
      <label class="sd-check"><input v-model="cfg.zh" type="checkbox" />中文提示</label>
      <label class="sd-check"><input v-model="cfg.strict" type="checkbox" />严格模式</label>
    </section>

    <!-- 准备 -->
    <main v-if="phase === 'ready'" class="sd-main sd-ready">
      <span v-if="loading" class="ui-spin"></span>
      <EmptyState v-else />
    </main>

    <!-- 逐句听写 -->
    <main v-else-if="phase === 'run' && current" class="sd-main">
      <button class="sd-play" :class="{ playing }" title="播放 Ctrl" @click="play()">
        <i :class="playing ? 'ri-volume-up-fill' : 'ri-play-fill'"></i>
      </button>
      <div class="sd-replays" title="本句播放次数"><i class="ri-repeat-2-line"></i>{{ currentItem.replays }}</div>

      <p v-if="cfg.zh && current.zh" class="sd-zh">{{ current.zh }}</p>

      <div v-if="cfg.slots || cfg.mode === 'cloze'" class="sd-slots">
        <template v-for="(s, k) in slots" :key="k">
          <span v-if="!s.blank" class="sd-given">{{ s.word }}</span>
          <span
            v-else
            class="sd-slot"
            :class="[s.state, { filled: s.typed }]"
            :style="{ minWidth: Math.max(1.6, s.word.length * 0.62) + 'em' }"
          >{{ s.typed && (cfg.live || judged) ? s.typed : hintLevel > 0 ? s.word.slice(0, hintLevel) : '' }}</span>
        </template>
      </div>

      <textarea
        ref="inputEl"
        v-model="typed"
        class="sd-input"
        :readonly="judged"
        rows="2"
        spellcheck="false"
        autocomplete="off"
        @keydown="onInputKey"
      ></textarea>

      <!-- 本句对照 -->
      <div v-if="judged" class="sd-judge">
        <div class="sd-score" :class="scoreClass(currentItem.accuracy)">{{ currentItem.accuracy }}</div>
        <p class="sd-ops"><OpsLine :ops="currentItem.ops" /></p>
      </div>

      <div class="sd-ctrl">
        <div class="sd-ctrl-left">
          <button class="ui-icon-btn" title="上一句" :disabled="cursor === 0" @click="go(-1)"><i class="ri-arrow-left-s-line"></i></button>
          <select v-model.number="cfg.rate" class="sd-rate" title="语速">
            <option v-for="r in RATES" :key="r" :value="r">{{ r }}x</option>
          </select>
        </div>
        <div class="sd-ctrl-main">
          <button class="ghost-btn" :class="{ on: hintLevel > 0 }" :title="hintLevel >= 3 ? '收起' : '多露一个字母'" @click="hint">
            <i class="ri-lightbulb-line"></i>{{ hintLevel ? `提示 ${hintLevel}` : '提示' }}
          </button>
          <button v-if="hintLevel" class="ui-icon-btn" title="收起提示" @click="hintLevel = 0"><i class="ri-eye-off-line"></i></button>
          <button class="start-btn sd-submit" @click="submit">
            {{ judged ? (cursor + 1 < queue.length ? '下一句' : '结算') : '提交' }}
            <kbd>Enter</kbd>
          </button>
        </div>
        <div class="sd-ctrl-right">
          <span v-if="runningScore != null" class="sd-live-score" title="已完成句子的平均正确率">均 {{ runningScore }}</span>
          <button class="ui-icon-btn" title="下一句" :disabled="cursor + 1 >= queue.length" @click="go(1)"><i class="ri-arrow-right-s-line"></i></button>
        </div>
      </div>
      <p class="sd-keys">Enter 提交 · Ctrl 重播 · Ctrl+Shift 慢放 · Shift+Enter 提示 · Ctrl+← → 换句 · Esc 退出</p>
    </main>

    <!-- 整篇结算 -->
    <main v-else-if="phase === 'result' && record" class="sd-main sd-result">
      <div class="sd-sum">
        <div class="sd-big" :class="scoreClass(record.accuracy)">{{ record.accuracy }}</div>
        <div class="sd-sum-grid">
          <span>{{ record.date }}</span>
          <span>{{ fmtDur(record.durationSec) }}</span>
          <span class="k-ok">正确 {{ record.counts.ok }}</span>
          <span class="k-typo">拼错 {{ record.counts.typo }}</span>
          <span class="k-moved">顺序 {{ record.counts.moved }}</span>
          <span class="k-miss">漏词 {{ record.counts.miss }}</span>
          <span class="k-extra">多词 {{ record.counts.extra }}</span>
        </div>
        <div class="sd-sum-btns">
          <div class="seg">
            <button :class="{ on: resultView === 'all' }" @click="resultView = 'all'">全部</button>
            <button :class="{ on: resultView === 'wrong' }" @click="resultView = 'wrong'">错句</button>
          </div>
          <button v-if="!readonlyRecord && wrongIdx.length" class="ghost-btn small" @click="retryWrong">重练错句</button>
          <button class="ghost-btn small" @click="exportText">导出</button>
        </div>
      </div>

      <div v-if="trickyWords.length" class="sd-tricky">
        <span class="sd-tricky-label">易错词</span>
        <span v-for="t in trickyWords" :key="t.word" class="chip" :title="t.typed.join('、')">{{ t.word }}<small>×{{ t.n }}</small></span>
      </div>

      <ol class="sd-list">
        <li v-for="it in shownItems" :key="it.sentIdx" class="sd-row" :class="{ perfect: it.accuracy === 100 }">
          <span class="sd-no">{{ it.sentIdx + 1 }}</span>
          <div class="sd-row-body">
            <p class="sd-ops"><OpsLine :ops="it.ops" /></p>
            <p class="sd-mine">{{ it.skipped ? '跳过' : it.typed || '—' }}</p>
            <p v-if="it.zh" class="sd-row-zh">{{ it.zh }}</p>
          </div>
          <span v-if="it.hints" class="sd-row-hint" title="提示次数"><i class="ri-lightbulb-line"></i>{{ it.hints }}</span>
          <span class="sd-row-score" :class="scoreClass(it.accuracy)">{{ it.accuracy }}</span>
          <button v-if="!readonlyRecord" class="ui-icon-btn sm" title="播放" @click="playIdx(it.sentIdx)"><i class="ri-volume-up-line"></i></button>
        </li>
      </ol>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type PropType } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useReaderStore } from './stores/readerStore'
import type { ArticleSentence } from '@/shared/types/Article'
import { alignWords, countOps, scoreOps, tokenize } from '@/shared/core/wordAlign'
import {
  saveStudyRecord, getStudyRecord, newRecordId, todayStr,
  type AlignOp, type DictationItem, type DictationRecord
} from '@/shared/core/studyRecords'
import { playSentence, stopAll } from '@/shared/core/audio'
import { recordReview } from '@/shared/core/activityLog'
import { toast } from '@/shared/core/toast'

/** 一行对照：原文词按对齐结果着色，拼错的把输入标在下角 */
const OpsLine = defineComponent({
  props: { ops: { type: Array as PropType<AlignOp[]>, required: true } },
  setup(p) {
    return () => h('span', { class: 'ops' }, p.ops.map((o, k) => {
      if (o.kind === 'ok') return h('span', { key: k, class: 'op ok' }, o.src)
      if (o.kind === 'extra') return h('span', { key: k, class: 'op extra', title: '多写' }, o.typed)
      if (o.kind === 'miss') return h('span', { key: k, class: 'op miss', title: '漏写' }, o.src)
      return h('span', { key: k, class: `op ${o.kind}`, title: o.kind === 'moved' ? '顺序' : '拼错' }, [
        o.src, h('sub', o.typed)
      ])
    }))
  }
})

const route = useRoute()
const router = useRouter()
const reader = useReaderStore()

const readonlyRecord = computed(() => route.name === 'DictationRecord')
const articleId = computed(() => String(route.params.id || ''))
const article = computed(() => reader.articles.find(a => a.id === articleId.value) || null)
const sentences = computed<ArticleSentence[]>(() => (article.value?.sentences || []).filter(s => s.en?.trim()))
const title = computed(() => record.value?.articleTitle || article.value?.title || '听写')
const hasTimedAudio = computed(() =>
  !!article.value?.audioUrl && sentences.value.some(s => s.audioStart != null && s.audioEnd != null)
)

/* ---------- 设置 ---------- */
const CFG_KEY = 'lb-sentence-dictation-cfg'
const cfg = reactive({
  rate: 1, repeat: 1, source: 'auto' as 'auto' | 'tts', instant: true, slots: true, zh: false, strict: false,
  live: false, mode: 'full' as 'full' | 'cloze'
})
try { Object.assign(cfg, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')) } catch { /* 坏配置忽略 */ }
watch(cfg, v => localStorage.setItem(CFG_KEY, JSON.stringify(v)), { deep: true })
const setFolded = ref(true)
const RATES = [0.5, 0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5]
const loading = ref(true)
// 语速改了，正在播的这句按新语速重播
watch(() => cfg.rate, () => { if (playing.value) play() })

/* ---------- 状态 ---------- */
type Phase = 'ready' | 'run' | 'result'
const phase = ref<Phase>('ready')
const queue = ref<number[]>([])          // 要听写的句子下标
const items = ref<DictationItem[]>([])   // 与 queue 对齐
const cursor = ref(0)
const typed = ref('')
const judged = ref(false)
const hintLevel = ref(0)
const startedAt = ref(0)
const record = ref<DictationRecord | null>(null)
const resultView = ref<'all' | 'wrong'>('all')
const rangeFrom = ref(1)
const rangeTo = ref(1)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const playing = ref(false)

const current = computed(() => sentences.value[queue.value[cursor.value]])
const currentItem = computed(() => items.value[cursor.value])
const slotWords = computed(() => tokenize(current.value?.en || ''))

/**
 * 填空模式挖哪些词：四个字母以上的实词，按句子内容固定挑，约三分之一，至少一个。
 * 固定挑选是为了重做同一句时空位不变，结果可以对比。
 */
const STOP = new Set('the and that with this from have were been their there which would could should about into your they them what when where while these those than then also just very more most over only such some other after before because'.split(' '))
function blanksOf(words: string[]): number[] {
  const cand = words.map((w, i) => ({ w: w.toLowerCase(), i })).filter(x => x.w.length >= 4 && !STOP.has(x.w))
  if (!cand.length) return words.length ? [words.length - 1] : []
  const want = Math.max(1, Math.round(cand.length / 3))
  const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
  return cand.sort((a, b) => hash(a.w + a.i) - hash(b.w + b.i)).slice(0, want).map(x => x.i).sort((a, b) => a - b)
}
const blankIdx = computed(() => cfg.mode === 'cloze' ? blanksOf(slotWords.value) : slotWords.value.map((_, i) => i))
/** 这一句要填的原文（整句模式就是整句） */
const targetText = computed(() => blankIdx.value.map(i => slotWords.value[i]).join(' '))

const typedTokens = computed(() => tokenize(typed.value))
const normTok = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, '')
const slots = computed(() => {
  const blanks = new Set(blankIdx.value)
  let t = 0
  return slotWords.value.map((word, i) => {
    if (!blanks.has(i)) return { word, blank: false, typed: '', state: '' }
    const got = typedTokens.value[t++] || ''
    // 正在输入的最后一个词不判错，免得打一半就变红
    const done = t < typedTokens.value.length || /\s$/.test(typed.value)
    const state = !got || !(cfg.live || judged.value) ? '' : normTok(got) === normTok(word) ? 'ok' : done || judged.value ? 'bad' : ''
    return { word, blank: true, typed: got, state }
  })
})

const runningScore = computed(() => {
  const done = items.value.filter(i => i.ops.length)
  return done.length ? Math.round(done.reduce((s, i) => s + i.accuracy, 0) / done.length) : null
})

/** 本篇易错词：漏写或拼错的原词，按次数排 */
const trickyWords = computed(() => {
  const m = new Map<string, { word: string; n: number; typed: string[] }>()
  for (const it of record.value?.items || []) {
    for (const o of it.ops) {
      if ((o.kind !== 'typo' && o.kind !== 'miss') || !o.src) continue
      const k = o.src.toLowerCase()
      const e = m.get(k) || { word: o.src, n: 0, typed: [] }
      e.n++
      if (o.typed) e.typed.push(o.typed)
      m.set(k, e)
    }
  }
  return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 20)
})
const progressPct = computed(() => queue.value.length ? Math.round((cursor.value / queue.value.length) * 100) : 0)
const wrongIdx = computed(() => (record.value?.items || []).filter(i => i.accuracy < 100).map(i => i.sentIdx))
const shownItems = computed(() => {
  const list = record.value?.items || []
  return resultView.value === 'wrong' ? list.filter(i => i.accuracy < 100) : list
})

/* ---------- 进度草稿：中途离开下次接着听 ---------- */
const DRAFT_KEY = computed(() => `lb-sd-draft:${articleId.value}`)
interface Draft { queue: number[]; items: DictationItem[]; cursor: number; startedAt: number }
const draft = ref<Draft | null>(null)
function loadDraft() {
  try { draft.value = JSON.parse(localStorage.getItem(DRAFT_KEY.value) || 'null') } catch { draft.value = null }
}
function saveDraft() {
  if (phase.value !== 'run') return
  const d: Draft = { queue: queue.value, items: items.value, cursor: cursor.value, startedAt: startedAt.value }
  localStorage.setItem(DRAFT_KEY.value, JSON.stringify(d))
}
function clearDraft() { localStorage.removeItem(DRAFT_KEY.value); draft.value = null }

function blankItem(idx: number): DictationItem {
  const s = sentences.value[idx]
  return { sentIdx: idx, original: s.en, zh: s.zh, typed: '', replays: 0, ops: [], accuracy: 0 }
}

function start(indices?: number[]) {
  const n = sentences.value.length
  const a = Math.max(1, Math.min(n, rangeFrom.value || 1))
  const b = Math.max(a, Math.min(n, rangeTo.value || n))
  queue.value = indices?.length ? indices : Array.from({ length: b - a + 1 }, (_, k) => a - 1 + k)
  items.value = queue.value.map(blankItem)
  cursor.value = 0
  startedAt.value = Date.now()
  record.value = null
  enterSentence()
  phase.value = 'run'
  clearDraft()
}

function resume() {
  const d = draft.value
  if (!d) return
  queue.value = d.queue.filter(i => i < sentences.value.length)
  items.value = d.items.slice(0, queue.value.length)
  cursor.value = Math.min(d.cursor, queue.value.length - 1)
  startedAt.value = d.startedAt
  phase.value = 'run'
  enterSentence()
}

function enterSentence() {
  const it = items.value[cursor.value]
  typed.value = it?.typed || ''
  judged.value = !!it && (it.ops.length > 0 || !!it.skipped) && cfg.instant
  hintLevel.value = 0
  nextTick(() => inputEl.value?.focus())
  if (!judged.value) setTimeout(() => play(), 250)
}

/* ---------- 播放 ---------- */
let audio: HTMLAudioElement | null = null
let stopTimer: ReturnType<typeof setTimeout> | null = null
let playToken = 0

function segmentOf(s: ArticleSentence): [number, number] | null {
  if (cfg.source === 'tts' || !article.value?.audioUrl) return null
  if (s.audioStart == null || s.audioEnd == null) return null
  const end = s.audioZhStart != null && s.audioZhStart > s.audioStart ? s.audioZhStart : s.audioEnd
  return [s.audioStart, end]
}

async function playOnce(s: ArticleSentence, token: number) {
  const seg = segmentOf(s)
  if (!seg) { await playSentence(s.en, 0.92 * cfg.rate); return }
  if (!audio) audio = new Audio(article.value!.audioUrl!)
  audio.playbackRate = cfg.rate
  audio.currentTime = seg[0]
  await audio.play().catch(() => undefined)
  await new Promise<void>(res => {
    const ms = ((seg[1] - seg[0]) / cfg.rate) * 1000 + 60
    stopTimer = setTimeout(() => { audio?.pause(); res() }, ms)
    const onPause = () => { audio?.removeEventListener('pause', onPause); res() }
    audio!.addEventListener('pause', onPause)
  })
  if (token !== playToken) return
}

async function play(idx?: number) {
  const s = idx != null ? sentences.value[idx] : current.value
  if (!s) return
  stopPlay()
  const token = ++playToken
  playing.value = true
  if (idx == null && currentItem.value) currentItem.value.replays++
  try {
    const times = idx == null && currentItem.value?.replays === 1 ? cfg.repeat : 1
    for (let k = 0; k < times && token === playToken; k++) {
      await playOnce(s, token)
      if (k + 1 < times) await new Promise(r => setTimeout(r, 600))
    }
  } finally {
    if (token === playToken) playing.value = false
  }
}
function playIdx(i: number) { play(i) }

/** 按当前语速的七成再放一遍，不改设置 */
async function playSlow() {
  const keep = cfg.rate
  cfg.rate = Math.max(0.5, Math.round(keep * 0.7 * 100) / 100)
  try { await play() } finally { cfg.rate = keep }
}

function stopPlay() {
  playToken++
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null }
  audio?.pause()
  stopAll()
  playing.value = false
}

/* ---------- 判定 ---------- */
function judgeCurrent(skipped = false) {
  const it = currentItem.value
  if (!it) return
  it.typed = typed.value.trim()
  it.skipped = skipped
  it.blanks = cfg.mode === 'cloze' ? blankIdx.value : undefined
  it.ops = alignWords(cfg.mode === 'cloze' ? targetText.value : it.original, skipped ? '' : it.typed, { strict: cfg.strict })
  it.accuracy = scoreOps(it.ops)
  saveDraft()
}

function submit() {
  if (!current.value) return
  if (judged.value) { next(); return }
  judgeCurrent()
  if (cfg.instant) { judged.value = true; stopPlay() }
  else next()
}

function next() {
  if (cursor.value + 1 >= queue.value.length) { finish(); return }
  cursor.value++
  enterSentence()
}

function go(d: number) {
  const to = cursor.value + d
  if (to < 0 || to >= queue.value.length) return
  // 离开前把没提交的输入也存下
  if (!judged.value && typed.value.trim()) judgeCurrent()
  else if (currentItem.value) currentItem.value.typed = typed.value
  cursor.value = to
  stopPlay()
  enterSentence()
}

/** 提示：每点一次多露一个字母，露到三个后再点就收起 */
function hint() {
  hintLevel.value = hintLevel.value >= 3 ? 0 : hintLevel.value + 1
  if (hintLevel.value && currentItem.value) currentItem.value.hints = (currentItem.value.hints || 0) + 1
  if (hintLevel.value && !cfg.slots) cfg.slots = true
  nextTick(() => inputEl.value?.focus())
}

async function finish() {
  stopPlay()
  for (let k = 0; k < items.value.length; k++) {
    const it = items.value[k]
    if (!it.ops.length) {
      // 没提交也没输入就翻过去的句子算跳过：结算里标「跳过」，也不计入复习
      if (!it.typed?.trim()) it.skipped = true
      const target = cfg.mode === 'cloze' ? blanksOf(tokenize(it.original)).map(i => tokenize(it.original)[i]).join(' ') : it.original
      it.ops = alignWords(target, it.typed, { strict: cfg.strict })
      it.accuracy = scoreOps(it.ops)
    }
  }
  const all = items.value.flatMap(i => i.ops)
  const counts = countOps(all)
  const rec: DictationRecord = {
    id: newRecordId('dict'),
    type: 'dictation',
    articleId: articleId.value,
    articleTitle: article.value?.title || '',
    date: todayStr(),
    createdAt: new Date().toISOString(),
    durationSec: Math.round((Date.now() - startedAt.value) / 1000),
    items: JSON.parse(JSON.stringify(items.value)),
    accuracy: Math.round(items.value.reduce((s, i) => s + i.accuracy, 0) / Math.max(1, items.value.length)),
    counts,
    mode: cfg.mode
  }
  record.value = rec
  phase.value = 'result'
  resultView.value = 'all'
  clearDraft()
  try {
    await saveStudyRecord(rec)
    for (const it of items.value) if (!it.skipped) await recordReview(it.accuracy === 100)
    toast('已保存到学习记录', 'ok')
  } catch (e) {
    toast('保存失败：' + (e instanceof Error ? e.message : String(e)), 'error')
  }
}

function retryWrong() {
  const idx = wrongIdx.value.slice()
  if (idx.length) start(idx)
}

function exportText() {
  const r = record.value
  if (!r) return
  const mark = (o: AlignOp) =>
    o.kind === 'ok' ? o.src : o.kind === 'miss' ? `[${o.src}]` : o.kind === 'extra' ? `{+${o.typed}}` : `${o.src}(${o.typed})`
  const lines = [
    `# ${r.articleTitle} 听写 ${r.date}`,
    `正确率 ${r.accuracy} · 用时 ${fmtDur(r.durationSec)}`,
    '',
    ...r.items.flatMap(i => [`${i.sentIdx + 1}. ${i.ops.map(mark).join(' ')}  ${i.accuracy}`, `   ${i.typed}`])
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `听写-${r.articleTitle}-${r.date}.md`
  a.click()
  URL.revokeObjectURL(a.href)
}

/* ---------- 键盘 ---------- */
function onInputKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); hint(); return }
  if (e.key === 'Enter') { e.preventDefault(); submit(); return }
}
function onKey(e: KeyboardEvent) {
  if (phase.value !== 'run') return
  if (e.key === 'Control' && e.shiftKey && !e.repeat) { playSlow(); return }
  if (e.key === 'Shift' && e.ctrlKey && !e.repeat) { playSlow(); return }
  if (e.key === 'Control' && !e.repeat) { play(); return }
  if (e.ctrlKey && e.key === 'ArrowLeft') { e.preventDefault(); go(-1); return }
  if (e.ctrlKey && e.key === 'ArrowRight') { e.preventDefault(); go(1); return }
  if (e.key === 'Escape') leave()
}

function leave() {
  stopPlay()
  if (phase.value === 'run') {
    saveDraft()
    if (!confirm('退出听写？')) return
  }
  if (readonlyRecord.value) router.push('/study-notes')
  else {
    reader.selectArticle(articleId.value)
    router.push('/reading')
  }
}

/* ---------- 工具 ---------- */
function scoreClass(v: number) { return v === 100 ? 's-full' : v >= 80 ? 's-good' : v >= 50 ? 's-mid' : 's-low' }
function fmtDur(s: number) { const m = Math.floor(s / 60); return m ? `${m} 分 ${s % 60} 秒` : `${s} 秒` }

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  if (readonlyRecord.value) {
    const r = await getStudyRecord(String(route.params.rid || ''))
    if (r && r.type === 'dictation') { record.value = r; phase.value = 'result' }
    if (!reader.articles.length) reader.loadArticles()
    return
  }
  if (!reader.articles.length) await reader.loadArticles()
  rangeFrom.value = 1
  rangeTo.value = sentences.value.length
  loadDraft()
  loading.value = false
  // 不要准备页：有进度就接着听，没有就从第一句开始
  if (!sentences.value.length) return
  if (draft.value && draft.value.cursor < draft.value.queue.length) resume()
  else start()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  saveDraft()
  stopPlay()
  audio = null
})
</script>

<style scoped>
.sd { min-height: 100%; display: flex; flex-direction: column; background: var(--c-bg); color: var(--c-text); }
.sd-head {
  display: flex; align-items: center; gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md); border-bottom: 1px solid var(--c-line-soft);
}
.sd-title { flex: 1; min-width: 0; font-size: var(--text-base); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sd-count { color: var(--c-text-2); font-size: var(--text-sm); font-variant-numeric: tabular-nums; }
.sd-bar { height: 3px; background: var(--c-surface-2); }
.sd-bar-fill { height: 100%; background: var(--c-accent); transition: width var(--dur-slow) var(--ease-std); }

.sd-settings {
  display: flex; flex-wrap: wrap; gap: var(--space-sm) var(--space-md); align-items: center;
  padding: var(--space-sm) var(--space-md); background: var(--c-surface-2); font-size: var(--text-sm);
}
.sd-settings label { display: inline-flex; align-items: center; gap: var(--space-xs); color: var(--c-text-2); }
.sd-settings select { border: 1px solid var(--c-line); border-radius: var(--radius-sm); background: var(--c-surface); color: var(--c-text); padding: 2px 6px; font: inherit; }

.sd-main {
  flex: 1; width: min(860px, 100%); margin: 0 auto; box-sizing: border-box;
  padding: var(--space-xl) var(--space-md);
  display: flex; flex-direction: column; align-items: center; gap: var(--space-md);
}
.sd-ready { justify-content: center; }
.sd-meta { color: var(--c-text-2); margin: 0; }
.sd-num { width: 4.5em; padding: 2px 6px; border: 1px solid var(--c-line); border-radius: var(--radius-sm); background: var(--c-surface); color: var(--c-text); font: inherit; }
.sd-rate { padding: 4px 6px; border: 1px solid var(--c-line); border-radius: var(--radius-md); background: var(--c-surface); color: var(--c-text); font: inherit; font-size: var(--text-xs); }
.sd-range { display: flex; gap: var(--space-md); }
.sd-range label { display: flex; align-items: center; gap: var(--space-xs); color: var(--c-text-2); font-size: var(--text-sm); }
.sd-range input { width: 5em; padding: 5px 8px; border: 1px solid var(--c-line); border-radius: var(--radius-md); background: var(--c-surface); color: var(--c-text); font: inherit; }
.sd-ready-btns { display: flex; gap: var(--space-sm); }

.sd-play {
  width: 88px; height: 88px; border-radius: 50%; border: none; cursor: pointer;
  background: var(--c-accent); color: var(--c-text-on-accent); font-size: 38px;
  box-shadow: var(--c-shadow); transition: transform var(--dur-fast), box-shadow var(--dur-base);
}
.sd-play:active { transform: scale(.94); }
.sd-play.playing { animation: sd-pulse 1.2s ease-in-out infinite; }
@keyframes sd-pulse { 50% { box-shadow: 0 0 0 12px var(--c-accent-soft); } }
.sd-replays {
  display: inline-flex; align-items: center; gap: 3px;
  margin-top: calc(-1 * var(--space-sm)); color: var(--c-text-3); font-size: var(--text-xs);
}
.sd-zh { margin: 0; color: var(--c-text-2); text-align: center; }

.sd-slots { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-xs) var(--space-sm); max-width: 100%; }
.sd-slot {
  display: inline-block; height: 1.6em; border-bottom: 2px solid var(--c-line);
  color: var(--c-text-3); font-size: var(--text-base); text-align: left;
  transition: border-color var(--dur-base);
}
.sd-slot.filled { border-color: var(--c-accent); }

.sd-input {
  width: 100%; box-sizing: border-box; resize: none;
  padding: var(--space-sm) var(--space-sm); border: 1px solid var(--c-line); border-radius: var(--radius-lg);
  background: var(--c-surface); color: var(--c-text);
  font: inherit; font-size: var(--text-lg); line-height: 1.6; text-align: center; outline: none;
  transition: border-color var(--dur-base), box-shadow var(--dur-base);
}
.sd-input:focus { border-color: var(--c-accent); box-shadow: 0 0 0 3px var(--c-accent-soft); }

.sd-judge { display: flex; align-items: flex-start; gap: var(--space-sm); width: 100%; animation: ui-rise var(--dur-enter) var(--ease-enter); }
.sd-score, .sd-row-score { flex-shrink: 0; min-width: 2.6em; text-align: center; font-weight: 700; font-variant-numeric: tabular-nums; }
.sd-score { font-size: var(--text-xl); }

.sd-ctrl {
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: var(--space-sm);
  width: 100%;
}
.sd-ctrl-left { display: flex; align-items: center; gap: var(--space-xs); }
.sd-ctrl-main { display: flex; align-items: center; gap: var(--space-xs); }
.sd-ctrl-right { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-xs); }
.sd-ctrl .ghost-btn { height: 38px; padding: 0 14px; }
.sd-ctrl .ghost-btn.on { background: var(--c-warn-soft); border-color: var(--c-warn); color: var(--c-warn); }
.sd-submit { min-width: 132px; height: 42px; gap: var(--space-xs); }
.sd-submit kbd {
  font: inherit; font-size: var(--text-2xs); padding: 1px 5px; border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, .22);
}
.sd-live-score { font-weight: 700; color: var(--c-accent); font-variant-numeric: tabular-nums; }
.sd-given { color: var(--c-text-2); font-size: var(--text-base); line-height: 1.6em; }
.sd-slot.ok, .sd-slot.filled.ok { border-color: var(--c-success); color: var(--c-success); }
.sd-slot.bad, .sd-slot.filled.bad { border-color: var(--c-danger); color: var(--c-danger); }
.sd-tricky { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-xs); }
.sd-tricky-label { font-size: var(--text-xs); color: var(--c-text-3); }
.sd-tricky .chip small { margin-left: 2px; color: var(--c-danger); }
.sd-row-hint { flex-shrink: 0; padding-top: 6px; font-size: var(--text-xs); color: var(--c-warn); }
@media (max-width: 900px) {
  .sd-ctrl { grid-template-columns: 1fr; justify-items: center; }
  .sd-ctrl-right { justify-content: center; }
}
.sd-keys { margin: 0; color: var(--c-text-3); font-size: var(--text-xs); }

.sd-ops { margin: 0; font-size: var(--text-base); line-height: 2; }
:deep(.op) { display: inline-block; margin-right: .32em; padding: 0 3px; border-radius: var(--radius-sm); position: relative; }
:deep(.op sub) { font-size: var(--text-2xs); margin-left: 2px; color: var(--c-text-2); }
:deep(.op.ok) { color: var(--c-success); }
:deep(.op.typo) { background: var(--c-warn-soft); color: var(--c-warn); }
:deep(.op.moved) { background: var(--c-accent-soft); color: var(--c-accent); }
:deep(.op.miss) { background: var(--c-surface-2); color: var(--c-text-3); text-decoration: underline dotted; }
:deep(.op.extra) { color: var(--c-danger); text-decoration: line-through; }

.s-full { color: var(--c-success); }
.s-good { color: var(--c-accent); }
.s-mid { color: var(--c-warn); }
.s-low { color: var(--c-danger); }

.sd-result { align-items: stretch; padding-top: var(--space-md); }
.sd-sum {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-md);
  padding: var(--space-sm) var(--space-md); border-radius: var(--radius-xl); background: var(--c-surface-2);
}
.sd-big { font-size: 44px; font-weight: 800; font-variant-numeric: tabular-nums; }
.sd-sum-grid { display: flex; flex-wrap: wrap; gap: var(--space-2xs) var(--space-sm); flex: 1; font-size: var(--text-sm); color: var(--c-text-2); }
.k-ok { color: var(--c-success); } .k-typo { color: var(--c-warn); } .k-moved { color: var(--c-accent); }
.k-miss { color: var(--c-text-3); } .k-extra { color: var(--c-danger); }
.sd-sum-btns { display: flex; align-items: center; gap: var(--space-xs); }

.sd-list { list-style: none; margin: 0; padding: 0; }
.sd-row {
  display: flex; align-items: flex-start; gap: var(--space-sm);
  padding: var(--space-sm) 0; border-bottom: 1px solid var(--c-line-soft);
}
.sd-no { flex-shrink: 0; width: 2em; padding-top: 6px; color: var(--c-text-3); font-size: var(--text-xs); text-align: right; }
.sd-row-body { flex: 1; min-width: 0; }
.sd-mine { margin: 0; color: var(--c-text-2); font-size: var(--text-sm); }
.sd-row-zh { margin: 2px 0 0; color: var(--c-text-3); font-size: var(--text-xs); }
.sd-row-score { padding-top: 6px; }
.sd-row.perfect .sd-mine { display: none; }

@media (max-width: 900px) {
  .sd-main { padding: var(--space-md) var(--space-sm); }
  .sd-play { width: 72px; height: 72px; font-size: 30px; }
}
</style>

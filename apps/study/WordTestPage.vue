<template>
  <div class="test-page">
    <div v-if="phase === 'setup'" class="setup">
      <header class="page-head">
        <button class="ghost-btn small" @click="$router.push('/home')">← 主页</button>
        <div>
          <h2 class="title">单词测试</h2>
          <p class="sub">给中文选英文，四选一。测完出成绩，错的进错词本。</p>
        </div>
      </header>

      <div v-if="fromOutside" class="scope-note">
        已带入 <b>{{ source.length }}</b> 个单词，可直接开始。
      </div>

      <div v-else class="form">
        <div class="row">
          <label>范围</label>
          <select v-model="scopeId">
            <option value="">全部单词（{{ wordStore.words.length }}）</option>
            <option v-for="g in books" :key="g.id" :value="g.id">{{ g.name }}（{{ g.wordIds.length }}）</option>
          </select>
        </div>
        <div class="row">
          <label>题量</label>
          <select v-model.number="count">
            <option :value="10">10 题</option>
            <option :value="20">20 题</option>
            <option :value="50">50 题</option>
          </select>
        </div>
      </div>

      <p class="cand">可出题：<b>{{ source.length }}</b> 个单词</p>
      <button class="dark-btn" :disabled="source.length < 4" @click="start">开始测试</button>
      <p v-if="source.length < 4" class="warn-line">至少要 4 个词才能出四选一。</p>
    </div>

    <div v-else-if="phase === 'running'" class="run">
      <div class="run-bar">
        <span class="run-stat">{{ index + 1 }} / {{ questions.length }}</span>
        <span class="run-stat ok">正确 {{ correct }}</span>
        <span class="spacer"></span>
        <button class="quit-btn" @click="finish">结束测试</button>
      </div>
      <div class="progress-bar"><div class="fill" :style="{ width: percent + '%' }"></div></div>

      <div v-if="q" class="q-area">
        <p class="q-stem">{{ q.stem }}</p>
        <button class="q-speak" title="听一下" @click="speakAnswer">
          <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>
        </button>

        <div class="opts">
          <button
            v-for="(c, i) in q.options"
            :key="i"
            class="opt"
            :class="{
              picked: q.picked === i,
              right: q.picked !== null && i === q.answer,
              wrong: q.picked === i && i !== q.answer
            }"
            @click="pick(i)"
          >
            <kbd>{{ KEYS[i] }}</kbd>
            <span>{{ c }}</span>
          </button>
        </div>

        <p class="q-tip">按 {{ KEYS.join(' / ') }} 也能选</p>
      </div>
    </div>

    <div v-else class="done">
      <div class="face">☺</div>
      <h2>测试完成</h2>
      <div class="stats">
        <div><span>题数</span><b>{{ answeredCount }}</b></div>
        <div class="ok"><span>正确</span><b>{{ correct }}</b></div>
        <div class="rate"><span>正确率</span><b>{{ rate }}%</b></div>
      </div>

      <ul v-if="wrongs.length" class="wrong-list">
        <li v-for="w in wrongs" :key="w.word">
          <span class="ww">{{ w.word }}</span>
          <span class="wz">{{ w.stem }}</span>
          <span class="wy">你选了 {{ w.picked }}</span>
        </li>
      </ul>

      <div class="acts">
        <button class="a-btn" @click="$router.push('/wrong-book')">查看错词本</button>
        <button class="a-btn" @click="start">再来一次</button>
        <button class="a-btn primary" :disabled="!wrongs.length" @click="retryWrong">只测错的</button>
        <button class="a-btn" @click="phase = 'setup'">退出</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useWordStore } from '@/shared/stores/wordStore'
import { playWord } from '@/shared/core/audio'
import { recordReview } from '@/shared/core/activityLog'
import type { WordItem } from '@/shared/types/WordItem'

const wordStore = useWordStore()
const route = useRoute()

const KEYS = ['A', 'B', 'C', 'D']

type Phase = 'setup' | 'running' | 'done'
const phase = ref<Phase>('setup')
const scopeId = ref('')
const count = ref(20)

const books = computed(() => wordStore.groups.filter(g => g.id.startsWith('book-') && !g.parentId))
const fromOutside = computed(() => wordStore.studyList.length > 0)

const source = computed<WordItem[]>(() => {
  if (fromOutside.value) return wordStore.studyList
  if (!scopeId.value) return wordStore.words
  const g = wordStore.groups.find(x => x.id === scopeId.value)
  if (!g) return wordStore.words
  const ids = new Set(g.wordIds)
  return wordStore.words.filter(w => ids.has(w.id))
})

interface Question {
  word: WordItem
  stem: string
  options: string[]
  answer: number
  picked: number | null
}

const questions = ref<Question[]>([])
const index = ref(0)
const correct = ref(0)
const q = computed(() => questions.value[index.value] || null)
const percent = computed(() =>
  questions.value.length ? Math.round((index.value / questions.value.length) * 100) : 0
)
const answeredCount = computed(() => questions.value.filter(x => x.picked !== null).length)
const rate = computed(() =>
  answeredCount.value ? Math.round((correct.value / answeredCount.value) * 100) : 0
)
const wrongs = computed(() =>
  questions.value
    .filter(x => x.picked !== null && x.picked !== x.answer)
    .map(x => ({ word: x.word.word, stem: x.stem, picked: x.options[x.picked as number] }))
)

function zhOf(w: WordItem): string {
  return w.meanings?.map(m => [m.partOfSpeech, m.chinese].filter(Boolean).join(' ')).join('；') || w.word
}
function posOf(w: WordItem): string {
  return w.meanings?.[0]?.partOfSpeech || ''
}

function relVariants(w: WordItem, pool: WordItem[]): WordItem[] {
  const fam = new Set((w.word_family || []).map(x => String(x).toLowerCase()))
  const root = w.morphemes?.root?.form
  return pool.filter(x => {
    if (x.word.toLowerCase() === w.word.toLowerCase()) return false
    if (fam.has(x.word.toLowerCase())) return true
    return !!root && x.morphemes?.root?.form === root
  })
}
function synonyms(w: WordItem, pool: WordItem[]): WordItem[] {
  const syn = new Set((w.synonyms || []).map(s => String(s.word).toLowerCase()))
  return pool.filter(x => syn.has(x.word.toLowerCase()))
}
function samePos(w: WordItem, pool: WordItem[]): WordItem[] {
  const p = posOf(w)
  if (!p) return []
  return pool.filter(x => x.word.toLowerCase() !== w.word.toLowerCase() && posOf(x) === p)
}

function pickOne(list: WordItem[], used: Set<string>): WordItem | null {
  const avail = list.filter(x => !used.has(x.word.toLowerCase()))
  if (!avail.length) return null
  return avail[Math.floor(Math.random() * avail.length)]
}

function buildQuestion(w: WordItem, pool: WordItem[]): Question {
  const used = new Set<string>([w.word.toLowerCase()])
  const picks: WordItem[] = []
  for (let i = 0; i < 3; i++) {
    const c =
      pickOne(relVariants(w, pool), used) ||
      pickOne(synonyms(w, pool), used) ||
      pickOne(samePos(w, pool), used) ||
      pickOne(pool, used)
    if (!c) break
    used.add(c.word.toLowerCase())
    picks.push(c)
  }
  const options = [w.word, ...picks.map(x => x.word)]
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[options[i], options[j]] = [options[j], options[i]]
  }
  return { word: w, stem: zhOf(w), options, answer: options.indexOf(w.word), picked: null }
}

function start() {
  const pool = source.value.filter(w => w.meanings?.length)
  if (pool.length < 4) return
  const shuffled = [...pool].sort(() => Math.random() - 0.5)
  const take = fromOutside.value ? shuffled : shuffled.slice(0, count.value)
  questions.value = take.map(w => buildQuestion(w, pool))
  index.value = 0
  correct.value = 0
  phase.value = 'running'
  wordStore.setStudyList([])
}

function pick(i: number) {
  const cur = q.value
  if (!cur || cur.picked !== null) return
  cur.picked = i
  const ok = i === cur.answer
  if (ok) correct.value++
  recordReview(ok)
  if (!ok) {
    wordStore.recordDictationResult(cur.word.id, false, cur.options[i])
  }
  setTimeout(() => {
    if (index.value >= questions.value.length - 1) finish()
    else index.value++
  }, ok ? 420 : 900)
}

function finish() { phase.value = 'done' }

function retryWrong() {
  const names = new Set(wrongs.value.map(w => w.word.toLowerCase()))
  const list = wordStore.words.filter(w => names.has(w.word.toLowerCase()))
  if (list.length < 4) {
    const pool = wordStore.words.filter(w => w.meanings?.length)
    questions.value = list.map(w => buildQuestion(w, pool))
  } else {
    questions.value = list.map(w => buildQuestion(w, list))
  }
  index.value = 0
  correct.value = 0
  phase.value = 'running'
}

function speakAnswer() {
  if (q.value?.picked !== null && q.value) playWord(q.value.word.word)
}

function onKey(e: KeyboardEvent) {
  if (phase.value !== 'running' || !q.value || q.value.picked !== null) return
  const i = KEYS.indexOf(e.key.toUpperCase())
  if (i >= 0 && i < (q.value.options.length || 0)) {
    e.preventDefault()
    pick(i)
  }
}

onMounted(async () => {
  await wordStore.loadWords()
  if (route.query.auto === '1' && source.value.length >= 4) start()
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped lang="scss">
.test-page { max-width: 860px; margin: 0 auto; padding: 26px 20px 60px; }
.page-head { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 20px; }
.title { margin: 0; font-size: 22px; }
.sub { margin: 5px 0 0; font-size: 13px; color: var(--r-ink2, #888); }
.scope-note {
  padding: 12px 16px; border-radius: 10px; margin-bottom: 18px; font-size: 14px;
  background: color-mix(in srgb, #3a8a5c 10%, transparent);
}
.form { display: grid; gap: 14px; margin-bottom: 18px; max-width: 420px; }
.row { display: flex; align-items: center; gap: 12px; }
.row label { width: 52px; font-size: 13px; color: var(--r-ink2, #777); }
.row select { flex: 1; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--r-border, #ddd); background: var(--r-paper, #fff); color: inherit; }
.cand { font-size: 13px; color: var(--r-ink2, #888); }
.warn-line { font-size: 12.5px; color: #b5493c; }

.run-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.run-stat { font-size: 13px; padding: 4px 10px; border-radius: 7px; background: var(--r-ui, #f2f2f2); color: var(--r-ink2, #666); }
.run-stat.ok { background: color-mix(in srgb, #3a8a5c 14%, transparent); color: #2f6f4a; }
.spacer { flex: 1; }
.progress-bar { height: 5px; border-radius: 3px; background: var(--r-ui, #eee); overflow: hidden; }
.progress-bar .fill { height: 100%; background: var(--r-accent, #8a4b3a); transition: width .2s ease; }

.q-area { margin-top: 44px; text-align: center; }
.q-stem { font-size: 26px; font-weight: 700; line-height: 1.5; margin: 0 0 10px; }
.q-speak {
  width: 38px; height: 38px; border-radius: 50%; cursor: pointer; margin-bottom: 26px;
  border: 1px solid var(--r-border, #ddd); background: var(--r-paper, #fff); color: var(--r-ink, #333);
}
.opts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; max-width: 620px; margin: 0 auto; }
.opt {
  display: flex; align-items: center; gap: 10px; text-align: left;
  padding: 14px 16px; border-radius: 11px; font-size: 16px; cursor: pointer;
  border: 1px solid var(--r-border, #ddd);
  background: var(--r-paper, #fff); color: var(--r-ink, #222);
  transition: background-color .15s ease, border-color .15s ease;
}
.opt:hover { background: var(--r-ui, #f4f4f4); }
.opt kbd { opacity: 0.5; font-size: 12px; }
.opt.right { border-color: #3a8a5c; background: color-mix(in srgb, #3a8a5c 14%, transparent); }
.opt.wrong { border-color: #b5493c; background: color-mix(in srgb, #b5493c 14%, transparent); }
.q-tip { margin-top: 20px; font-size: 12.5px; color: var(--r-ink2, #999); }

.done { text-align: center; padding-top: 30px; }
.face { font-size: 66px; }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; max-width: 420px; margin: 18px auto 0; }
.stats > div { padding: 14px 8px; border-radius: 11px; border: 1px solid var(--r-border, #e6e6e6); }
.stats span { display: block; font-size: 12.5px; color: var(--r-ink2, #888); }
.stats b { display: block; margin-top: 4px; font-size: 25px; }
.stats .ok { background: color-mix(in srgb, #3a8a5c 8%, transparent); }
.stats .rate { background: color-mix(in srgb, #d99a2b 10%, transparent); }
.wrong-list { list-style: none; padding: 0; margin: 22px auto 0; max-width: 560px; text-align: left; }
.wrong-list li { display: flex; gap: 10px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid var(--r-border, #eee); font-size: 14px; }
.ww { font-weight: 700; }
.wz { flex: 1; color: var(--r-ink2, #888); font-size: 13px; }
.wy { color: #b5493c; font-size: 12.5px; }
.acts { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 26px; }
.a-btn {
  padding: 9px 16px; border-radius: 9px; font-size: 14px; cursor: pointer;
  border: 1px solid color-mix(in srgb, var(--r-accent, #8a4b3a) 24%, transparent);
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff));
  color: var(--r-ink, #333);
}
.a-btn.primary { background: var(--r-accent, #8a4b3a); border-color: transparent; color: #fff; }
.a-btn:disabled { opacity: 0.4; cursor: default; }
.quit-btn { padding: 6px 12px; border-radius: 8px; cursor: pointer; border: 1px solid color-mix(in srgb, #b5493c 40%, transparent); background: transparent; color: #b5493c; }
.dark-btn { border: none; background: var(--r-accent, #8a4b3a); color: #fff; border-radius: 9px; padding: 10px 22px; font-size: 15px; cursor: pointer; }
.dark-btn:disabled { opacity: 0.4; cursor: default; }
</style>

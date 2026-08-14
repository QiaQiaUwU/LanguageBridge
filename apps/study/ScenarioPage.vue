<template>
  <div class="scenario-page">
    <header class="page-head">
      <button class="ghost-btn small" @click="$router.push('/home')">← 主页</button>
      <div>
        <h2 class="title">场景学习</h2>
        <p class="sub">
          围绕一个话题生成整套材料：核心词 + 对话 + 短文 + 写作题，学完做实战检测，AI 批改评分，
          整份记录存进学习笔记。跟「按话题筛选」不一样——筛选给的是词表，这里给的是这些词怎么用。
        </p>
      </div>
    </header>

    <section v-if="!material" class="card">
      <h3 class="card-title">选一个主题</h3>

      <div class="row">
        <label class="row-label">来源</label>
        <div class="chip-row">
          <button class="chip" :class="{ on: sourceKind === 'topic' }" @click="sourceKind = 'topic'">话题</button>
          <button class="chip" :class="{ on: sourceKind === 'morpheme' }" @click="sourceKind = 'morpheme'">词根词缀</button>
          <button class="chip" :class="{ on: sourceKind === 'custom' }" @click="sourceKind = 'custom'">自己写</button>
        </div>
      </div>

      <p v-if="sourceKind !== 'custom' && !options.length" class="hint warn">
        还没有{{ sourceKind === 'topic' ? '话题' : '词根词缀' }}数据。去「设置 → AI 补全」跑一次，
        或者用「自己写」直接输入一个主题。
      </p>

      <div v-if="sourceKind !== 'custom' && options.length" class="row">
        <label class="row-label">主题</label>
        <div class="chip-row wrap">
          <button
            v-for="o in options"
            :key="o.name"
            class="chip"
            :class="{ on: picked === o.name }"
            @click="picked = o.name"
          >{{ o.name }}<span class="c">{{ o.count }}</span></button>
        </div>
      </div>

      <div v-if="sourceKind === 'custom'" class="row">
        <label class="row-label">主题</label>
        <input v-model="customTopic" class="text-input" placeholder="比如：机场值机与登机" />
      </div>

      <div class="row">
        <label class="row-label">难度</label>
        <div class="chip-row">
          <button v-for="l in LEVELS" :key="l" class="chip" :class="{ on: level === l }" @click="level = l">{{ l }}</button>
        </div>
        <span class="hint">
          生成 {{ LEVEL_PARAMS[level].vocab }} 词 · {{ LEVEL_PARAMS[level].dialogues }} 段对话 ·
          1 篇短文 · {{ LEVEL_PARAMS[level].writing }} 道写作题
        </span>
      </div>

      <p v-if="seedWords.length" class="hint">
        会围绕你正在学的这 {{ Math.min(seedWords.length, LEVEL_PARAMS[level].vocab) }} 个词展开，
        不是让 AI 另挑一批——否则学完教材，原本要学的词一个也没练到。
      </p>

      <div class="actions">
        <button class="dark-btn" :disabled="!canGenerate || generating" @click="doGenerate">
          {{ generating ? '生成中，大约需要半分钟…' : '生成场景材料' }}
        </button>
      </div>
      <p v-if="errorMsg" class="hint warn">{{ errorMsg }}</p>
    </section>

    <template v-else>
      <section class="card">
        <div class="material-head">
          <h3 class="card-title">{{ material.scenario }} <span class="lv">{{ material.level }}</span></h3>
          <div class="head-actions">
            <button class="ghost-btn small" @click="saveAsWordBook">存成词表</button>
            <button class="ghost-btn small" @click="material = null">换一个主题</button>
          </div>
        </div>

        <div class="tabs">
          <button v-for="t in TABS" :key="t.key" class="tab" :class="{ on: tab === t.key }" @click="tab = t.key">
            {{ t.label }}
          </button>
        </div>

        <div v-if="tab === 'vocab'" class="pane">
          <ul class="vocab-list">
            <li v-for="v in material.vocabulary" :key="v.word" class="vocab-row">
              <span class="v-word">{{ v.word }}</span>
              <span class="v-ph">{{ v.phonetic }}</span>
              <span class="v-mean">{{ v.meaning }}</span>
              <span v-if="v.usage" class="v-usage">{{ v.usage }}</span>
            </li>
          </ul>
        </div>

        <div v-else-if="tab === 'dialogue'" class="pane">
          <div v-for="(d, i) in material.dialogues" :key="i" class="dialogue">
            <h4 class="d-title">{{ d.title }}</h4>
            <div v-for="(t, j) in d.turns" :key="j" class="turn" :class="{ b: t.speaker === 'B' }">
              <span class="spk">{{ t.speaker }}</span>
              <div class="turn-body">
                <p class="en">{{ t.en }}</p>
                <p class="zh">{{ t.zh }}</p>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="tab === 'reading'" class="pane">
          <h4 class="d-title">{{ material.reading.title }}</h4>
          <div v-for="(p, i) in material.reading.paragraphs" :key="i" class="para">
            <p class="en">{{ p.en }}</p>
            <p class="zh">{{ p.zh }}</p>
          </div>
          <button class="ghost-btn small" @click="sendToReading">发到阅读助手</button>
        </div>

        <div v-else class="pane">
          <div v-for="(w, i) in material.writing" :key="i" class="task">
            <p class="q-en">{{ w.prompt_en }}</p>
            <p class="q-zh">{{ w.prompt_zh }}</p>
            <textarea
              v-model="answers[i]"
              class="answer"
              rows="7"
              placeholder="用英文作答。写完点下面「提交批改」，AI 会指出具体哪一句有问题、该怎么改。"
            ></textarea>
            <div class="task-actions">
              <button class="dark-btn small" :disabled="!answers[i]?.trim() || reviewing === i" @click="doReview(i)">
                {{ reviewing === i ? '批改中…' : '提交批改' }}
              </button>
            </div>

            <div v-if="reviews[i]" class="review">
              <div class="score-row">
                <span class="score">{{ reviews[i]!.score }}</span>
                <p class="score-summary">{{ reviews[i]!.summary }}</p>
              </div>
              <div v-if="reviews[i]!.strengths.length" class="rv-block">
                <h5>做得好的</h5>
                <ul><li v-for="(x, k) in reviews[i]!.strengths" :key="k">{{ x }}</li></ul>
              </div>
              <div v-if="reviews[i]!.issues.length" class="rv-block">
                <h5>需要改的</h5>
                <div v-for="(it, k) in reviews[i]!.issues" :key="k" class="issue">
                  <p class="i-quote">{{ it.quote }}</p>
                  <p class="i-problem">{{ it.problem }}</p>
                  <p class="i-better">改成：{{ it.better }}</p>
                </div>
              </div>
              <div v-if="reviews[i]!.nextFocus.length" class="rv-block">
                <h5>接下来重点练</h5>
                <ul><li v-for="(x, k) in reviews[i]!.nextFocus" :key="k">{{ x }}</li></ul>
              </div>
              <button class="ghost-btn small" @click="saveNote(i)">存进学习笔记</button>
              <span v-if="savedIdx === i" class="saved">已存入学习笔记</span>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useWordStore } from '@/shared/stores/wordStore'
import { useReaderStore } from '@/apps/reading-assistant/stores/readerStore'
import type { WordItem } from '@/shared/types/WordItem'
import {
  generateScenario, reviewScenarioAnswer, scenarioToNoteHtml,
  LEVEL_PARAMS, type ScenarioLevel, type ScenarioMaterial, type ScenarioReview
} from '@/shared/core/scenarioLearning'

const router = useRouter()
const wordStore = useWordStore()
const readerStore = useReaderStore()

const LEVELS: ScenarioLevel[] = ['CET4', 'CET6', 'IELTS', 'TOEFL']
const TABS = [
  { key: 'vocab', label: '核心词' },
  { key: 'dialogue', label: '对话' },
  { key: 'reading', label: '短文' },
  { key: 'practice', label: '实战检测' }
]

const sourceKind = ref<'topic' | 'morpheme' | 'custom'>('topic')
const picked = ref('')
const customTopic = ref('')
const level = ref<ScenarioLevel>('IELTS')
const generating = ref(false)
const errorMsg = ref('')
const material = ref<ScenarioMaterial | null>(null)
const tab = ref('vocab')
const answers = ref<string[]>([])
const reviews = ref<(ScenarioReview | null)[]>([])
const reviewing = ref<number | null>(null)
const savedIdx = ref<number | null>(null)

const options = computed(() => {
  const count = new Map<string, number>()
  for (const w of wordStore.words) {
    if (sourceKind.value === 'topic') {
      for (const t of w.topics || []) count.set(t, (count.get(t) || 0) + 1)
    } else {
      const r = w.morphemes?.root?.form
      if (r) count.set(r, (count.get(r) || 0) + 1)
    }
  }
  return [...count.entries()]
    .filter(([, c]) => c >= 3)
    .map(([name, c]) => ({ name, count: c }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40)
})

const themeName = computed(() =>
  sourceKind.value === 'custom' ? customTopic.value.trim() : picked.value
)
const canGenerate = computed(() => !!themeName.value)

const seedWords = computed<WordItem[]>(() => {
  if (!themeName.value || sourceKind.value === 'custom') return []
  return wordStore.words.filter(w =>
    sourceKind.value === 'topic'
      ? w.topics?.includes(themeName.value)
      : w.morphemes?.root?.form === themeName.value
  )
})

async function doGenerate() {
  generating.value = true
  errorMsg.value = ''
  try {
    const m = await generateScenario(themeName.value, level.value, seedWords.value)
    if (!m) {
      errorMsg.value = 'AI 没有返回可用的内容，可能是模型输出格式不对。可以再试一次，或换个主题。'
      return
    }
    material.value = m
    answers.value = m.writing.map(() => '')
    reviews.value = m.writing.map(() => null)
    tab.value = 'vocab'
  } catch (e) {
    errorMsg.value = `生成失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    generating.value = false
  }
}

async function doReview(i: number) {
  if (!material.value) return
  reviewing.value = i
  try {
    const r = await reviewScenarioAnswer(
      material.value,
      material.value.writing[i].prompt_en,
      answers.value[i]
    )
    reviews.value[i] = r
    if (!r) errorMsg.value = 'AI 批改没有返回可用结果，可以再提交一次。'
  } finally {
    reviewing.value = null
  }
}

async function saveAsWordBook() {
  const m = material.value
  if (!m?.vocabulary.length) return
  const now = new Date().toISOString()
  const ids: string[] = []
  for (const v of m.vocabulary) {
    const exist = wordStore.words.find(w => w.word.toLowerCase() === v.word.toLowerCase())
    if (exist) {
      ids.push(exist.id)
      continue
    }
    const item: WordItem = {
      id: `w-scenario-${Date.now()}-${ids.length}`,
      word: v.word,
      phonetic: v.phonetic || '',
      meanings: [{ chinese: v.meaning, partOfSpeech: '' }],
      level: 'IELTS',
      topics: [m.scenario],
      status: 'unmarked',
      createdAt: now,
      updatedAt: now
    }
    await wordStore.addWord(item)
    ids.push(item.id)
  }
  await wordStore.createGroup({
    id: `book-scenario-${Date.now()}`,
    name: `场景 · ${m.scenario}`,
    description: `${m.level} 场景学习生成的 ${ids.length} 个核心词`,
    wordIds: ids,
    createdAt: now,
    updatedAt: now
  })
  errorMsg.value = `已存成词表「场景 · ${m.scenario}」，可以在主页选它开始打字练习。`
}

async function sendToReading() {
  const m = material.value
  if (!m?.reading?.paragraphs?.length) return
  const now = new Date().toISOString()
  await readerStore.saveArticle({
    id: `art-scenario-${Date.now()}`,
    title: `${m.reading.title || m.scenario}（场景学习）`,
    sentences: m.reading.paragraphs.map(p => ({ en: p.en, zh: p.zh })),
    notes: '',
    createdAt: now,
    updatedAt: now
  } as any)
  router.push('/reading')
}

async function saveNote(i: number) {
  const m = material.value
  if (!m) return
  const html = scenarioToNoteHtml(m, m.writing[i].prompt_en, answers.value[i], reviews.value[i])
  const now = new Date().toISOString()
  await readerStore.saveArticle({
    id: `art-scenario-note-${Date.now()}`,
    title: `场景实战：${m.scenario}`,
    sentences: [],
    notes: html,
    createdAt: now,
    updatedAt: now
  } as any)
  savedIdx.value = i
}

onMounted(async () => {
  await wordStore.loadWords()
  await readerStore.loadArticles()
})
</script>

<style scoped lang="scss">
.scenario-page { max-width: 900px; margin: 0 auto; padding: 18px 20px 60px; }
.page-head { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 16px; }
.title { font-size: 19px; margin: 0 0 4px; }
.sub { font-size: 12.5px; color: var(--r-ink2, #888); margin: 0; line-height: 1.7; }
.card {
  border: 1px solid var(--r-border, #e4e4e4);
  border-radius: 14px;
  padding: 18px 20px;
  margin-bottom: 16px;
  background: var(--r-paper, #fff);
}
.card-title { font-size: 15.5px; margin: 0 0 12px; }
.row { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.row-label { width: 46px; flex-shrink: 0; font-size: 13px; color: var(--r-ink2, #888); padding-top: 5px; }
.chip-row { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; &.wrap { max-height: 132px; overflow-y: auto; } }
.chip {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  padding: 5px 12px; border-radius: 9999px; font-size: 13px; cursor: pointer;
  border: 1px solid var(--r-border, #ddd); background: transparent; color: inherit;
  display: inline-flex; align-items: center; gap: 5px;
  &.on { background: var(--r-accent, #8a4b3a); color: var(--r-paper, #fff); border-color: transparent; }
  .c { font-size: 11px; opacity: 0.6; }
}
.text-input {
  flex: 1; min-width: 200px; padding: 7px 11px;
  border: 1px solid var(--r-border, #ddd); border-radius: 8px;
  background: var(--r-ui, #fafafa); color: inherit; font-size: 13.5px;
}
.hint { font-size: 12.5px; color: var(--r-ink2, #999); line-height: 1.7; margin: 0; }
.hint.warn { color: #d9822b; }
.actions { margin-top: 16px; }

.material-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.lv { font-size: 12px; color: var(--r-ink2, #999); font-weight: 400; margin-left: 6px; }
.head-actions { display: flex; gap: 8px; }
.tabs { display: flex; gap: 4px; margin: 14px 0 16px; border-bottom: 1px solid var(--r-border, #eee); }
.tab {
  border: none; background: none; padding: 8px 14px; cursor: pointer;
  font-size: 13.5px; color: var(--r-ink2, #888); border-bottom: 2px solid transparent;
  &.on { color: var(--r-ink, #1c1c1c); border-bottom-color: var(--r-accent, #8a4b3a); font-weight: 600; }
}
.pane { font-size: 14px; }

.vocab-list { list-style: none; padding: 0; margin: 0; }
.vocab-row {
  display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap;
  padding: 8px 0; border-bottom: 1px solid var(--r-border, #f0f0f0);
}
.v-word { font-weight: 600; min-width: 120px; }
.v-ph { font-size: 12.5px; color: var(--r-ink2, #aaa); min-width: 100px; }
.v-mean { color: var(--r-ink2, #666); font-size: 13px; }
.v-usage { flex: 1 1 100%; font-size: 12.5px; color: var(--r-ink2, #999); padding-left: 4px; }

.dialogue { margin-bottom: 22px; }
.d-title { font-size: 14.5px; margin: 0 0 10px; }
.turn { display: flex; gap: 10px; margin-bottom: 10px; }
.spk {
  width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; background: var(--r-ui, #f0f0f0); color: var(--r-ink2, #777);
}
.turn.b .spk { background: var(--r-accent, #8a4b3a); color: #fff; }
.turn-body { flex: 1; min-width: 0; }
.en { margin: 0 0 2px; line-height: 1.7; }
.zh { margin: 0; font-size: 13px; color: var(--r-ink2, #888); line-height: 1.7; }
.para { margin-bottom: 16px; }

.task { margin-bottom: 26px; padding-bottom: 20px; border-bottom: 1px solid var(--r-border, #f0f0f0); }
.q-en { font-weight: 600; margin: 0 0 3px; line-height: 1.7; }
.q-zh { font-size: 13px; color: var(--r-ink2, #888); margin: 0 0 10px; }
.answer {
  width: 100%; padding: 10px 12px; border-radius: 9px;
  border: 1px solid var(--r-border, #ddd); background: var(--r-ui, #fafafa);
  color: inherit; font-size: 14px; line-height: 1.8; resize: vertical;
}
.task-actions { margin-top: 10px; }

.review { margin-top: 16px; padding: 14px 16px; border-radius: 10px; background: var(--r-ui, #f7f7f7); }
.score-row { display: flex; gap: 14px; align-items: flex-start; }
.score { font-size: 30px; font-weight: 700; color: var(--r-accent, #8a4b3a); line-height: 1; }
.score-summary { margin: 0; font-size: 13.5px; line-height: 1.8; flex: 1; }
.rv-block { margin-top: 14px; h5 { font-size: 13px; margin: 0 0 6px; color: var(--r-ink2, #777); } }
.rv-block ul { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.8; }
.issue { margin-bottom: 10px; padding-left: 10px; border-left: 2px solid #d9822b; }
.i-quote { margin: 0 0 2px; font-size: 13px; }
.i-problem { margin: 0 0 2px; font-size: 12.5px; color: #b8701f; }
.i-better { margin: 0; font-size: 13px; color: #2f7a3f; }
.saved { font-size: 12.5px; color: #2f7a3f; margin-left: 8px; }
</style>

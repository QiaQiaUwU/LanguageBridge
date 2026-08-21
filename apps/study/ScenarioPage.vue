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
          1 篇短文 · {{ LEVEL_PARAMS[level].writing }} 道写作题
        </span>
      </div>



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
          <div class="pod-row">
            <button class="ghost-btn small" @click="sendToReading">发到阅读助手</button>
            <button class="ghost-btn small" :disabled="podBusy" @click="makePodcast">
              {{ podBusy ? '生成中…' : '改写成沉浸式播客稿' }}
            </button>
          </div>
          <p v-if="podMsg" class="pod-msg">{{ podMsg }}</p>
        </div>

        <div v-else-if="tab === 'practice'" class="pane">
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

        <div v-else-if="tab === 'sentence'" class="pane">
          <!-- 造句训练：用目标词写一句，即时查语法 -->
          <div class="task make-sent">
            <p class="q-en">造句训练</p>
            <p class="q-zh">挑一个词，用它写一句话，写完点检查</p>
            <div class="word-chips">
              <button
                v-for="v in material.vocabulary"
                :key="v.word"
                class="chip"
                :class="{ on: sentWord === v.word }"
                @click="sentWord = v.word"
              >{{ v.word }}</button>
            </div>
            <textarea
              v-model="sentDraft"
              class="answer"
              rows="3"
              :placeholder="sentWord ? `用「${sentWord}」写一句话` : '先选一个词'"
            ></textarea>
            <div class="task-actions">
              <button class="dark-btn small" :disabled="!sentDraft.trim() || sentChecking" @click="doCheckSentence">
                {{ sentChecking ? '检查中…' : '检查语法' }}
              </button>
              <span v-if="sentStats.length" class="pod-msg">
                常错：{{ sentStats.map(x => `${x.type}×${x.n}`).join('、') }}
              </span>
            </div>

            <div v-if="sentResult" class="check-box">
              <p class="check-line">
                <template v-for="(part, k) in sentParts" :key="k">
                  <span v-if="part.issue" class="bad" :title="`${part.issue.type}：${part.issue.why}`">{{ part.text }}</span>
                  <span v-else>{{ part.text }}</span>
                </template>
              </p>
              <p v-if="sentResult.ok" class="check-ok">没问题，这句可以直接用</p>
              <div v-for="(it, k) in sentResult.issues" :key="k" class="check-issue">
                <span class="ci-type">{{ it.type }}</span>
                <span class="ci-fix">{{ it.span }} → {{ it.fix }}</span>
                <span class="ci-why">{{ it.why }}</span>
              </div>
              <p v-if="sentResult.better" class="check-better">更地道：{{ sentResult.better }}</p>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
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
const ALL_TABS = [
  { key: 'vocab', label: '核心词', need: 'vocabulary' },
  { key: 'dialogue', label: '对话', need: 'dialogues' },
  { key: 'reading', label: '短文', need: 'reading' },
  { key: 'practice', label: '实战检测', need: 'writing' },
  { key: 'sentence', label: '造句训练', need: 'sentence' }
] as const

/**
 * 只显示这次勾选要练的部分。
 *
 * 「这次要练」那一排选项之前是摆设 —— parts 声明了却没有任何地方读它，
 * 勾不勾结果都一样，造句训练还硬塞在写作题上面。
 */
const TABS = computed(() => ALL_TABS.filter(t => parts.value[t.need as PartKey]))

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

/**
 * 生成场景材料。
 *
 * 登记到右下角任务中心：这一步要调好几次 AI，几十秒到一两分钟，
 * 期间用户不该被钉在这个页面上干等 —— 可以去背单词、去看文章，
 * 跑完了回来点开就能学。失败也会留一条写明原因。
 */
async function doGenerate() {
  generating.value = true
  errorMsg.value = ''

  const { startTask, updateTask, finishTask, failTask } = await import('@/shared/core/taskCenter')
  const taskId = 'scenario:' + Date.now().toString(36)
  const picked = Object.entries(parts.value).filter(([, on]) => on).map(([k]) => k)
  startTask({
    id: taskId,
    kind: '场景',
    subject: themeName.value || '场景材料',
    detail: `准备生成：${picked.join('、')}`
  })

  try {
    updateTask(taskId, { detail: '正在生成…' })
    const m = await generateScenario(themeName.value, level.value, seedWords.value)
    if (!m) {
      const msg = 'AI 没有返回可用的内容，可能是模型输出格式不对。可以再试一次，或换个主题。'
      errorMsg.value = msg
      failTask(taskId, msg)
      return
    }
    material.value = m
    answers.value = m.writing.map(() => '')
    reviews.value = m.writing.map(() => null)
    tab.value = TABS.value[0]?.key || 'vocab'
    finishTask(taskId, `${m.vocabulary.length} 个词 · ${m.dialogues.length} 段对话，可以开始学了`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    errorMsg.value = `生成失败：${msg}`
    failTask(taskId, msg)
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

/**
 * 把当前场景改写成中英交替的沉浸式播客稿。
 *
 * 跟「发到阅读助手」的区别：那个是把 reading 段落原样搬过去（教材体），
 * 这个是重新生成成口播体 —— 一句中文陈述紧跟一句英文表达，
 * 存成文章后就能配音频、对轴、跟读，跟别的播客稿一样用。
 */
/**
 * 学之前先勾要练什么。
 *
 * 之前是生成完再在各处加按钮（「改写成播客稿」「造句训练」），
 * 用户得先生成一堆用不上的东西，再去找入口 —— 顺序反了。
 */
/**
 * 要生成哪几部分 —— 读首页「更改进度」里存的那份设置。
 * 这里原来自己摆了一排选项，跟学习计划各存各的，容易对不上。
 */
type PartKey = 'vocabulary' | 'dialogues' | 'reading' | 'writing' | 'sentence' | 'podcast'

const parts = computed<Record<PartKey, boolean>>(() => {
  const def: Record<PartKey, boolean> = {
    vocabulary: true, dialogues: true, reading: true,
    writing: true, sentence: false, podcast: false
  }
  try {
    return { ...def, ...JSON.parse(localStorage.getItem('lb-scene-parts') || '{}') }
  } catch {
    return def
  }
})

/* ---------- 造句训练 ---------- */

const sentWord = ref('')
const sentDraft = ref('')
const sentChecking = ref(false)
const sentResult = ref<import('@/shared/core/scenarioLearning').SentenceCheck | null>(null)
const sentParts = ref<{ text: string; issue?: any }[]>([])

/**
 * 错误类型统计。
 * 单次检查只能告诉你这句哪错了，攒起来才看得出自己老犯哪一类 ——
 * 那才是该专门去练的东西。存 localStorage，跨会话累积。
 */
const errorTally = ref<Record<string, number>>(
  (() => {
    try { return JSON.parse(localStorage.getItem('lb-grammar-tally') || '{}') } catch { return {} }
  })()
)
const sentStats = computed(() =>
  Object.entries(errorTally.value)
    .map(([type, n]) => ({ type, n: n as number }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
)

async function doCheckSentence() {
  const text = sentDraft.value.trim()
  if (!text || sentChecking.value) return
  sentChecking.value = true
  sentResult.value = null
  try {
    const { checkSentenceGrammar, splitByIssues } = await import('@/shared/core/scenarioLearning')
    const r = await checkSentenceGrammar(text, sentWord.value)
    if (!r) return
    sentResult.value = r
    sentParts.value = splitByIssues(text, r.issues)

    const tally = { ...errorTally.value }
    for (const it of r.issues) tally[it.type] = (tally[it.type] || 0) + 1
    errorTally.value = tally
    localStorage.setItem('lb-grammar-tally', JSON.stringify(tally))
  } finally {
    sentChecking.value = false
  }
}

const podBusy = ref(false)
const podMsg = ref('')

async function makePodcast() {
  const m = material.value
  if (!m || podBusy.value) return
  podBusy.value = true
  podMsg.value = ''
  try {
    const { generatePodcastArticle } = await import('@/shared/core/scenarioLearning')
    const seeds = (m.vocabulary || []).map(v => v.word).filter(Boolean)
    const draft = await generatePodcastArticle(m.scenario, seeds)
    if (!draft?.sentences.length) {
      podMsg.value = '没能生成内容，可以再试一次'
      return
    }
    const now = new Date().toISOString()
    await readerStore.saveArticle({
      id: `art-pod-${Date.now()}`,
      title: draft.title || m.scenario,
      sentences: draft.sentences,
      notes: '',
      // 这个 source 是学习记录页认「AI 生成、花过钱」的依据，别改
      source: 'scenario-podcast',
      createdAt: now,
      updatedAt: now
    } as any)
    podMsg.value = `已生成《${draft.title}》，${draft.sentences.length} 句${draft.covered.length ? `，用上了 ${draft.covered.length} 个目标词` : ''}。可以去阅读助手里配音频、跟读。`
  } catch (e) {
    podMsg.value = '生成失败：' + (e instanceof Error ? e.message : String(e))
  } finally {
    podBusy.value = false
  }
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
    // 同上：这批也是调 AI 生成的，要能在学习记录里找回来
    source: 'scenario-reading',
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
    source: 'scenario-note',
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
.make-sent { border-left: 3px solid var(--r-accent, #8a4b3a); }
.word-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.chip {
  padding: 3px 9px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--r-border, #e5e7eb); background: none;
  font-size: 12.5px; font-family: inherit; color: var(--r-ink2, #6b7280);
  &:hover { border-color: var(--r-accent, #8a4b3a); }
  &.on { background: var(--r-accent, #8a4b3a); border-color: var(--r-accent, #8a4b3a); color: #fff; }
}
.check-box {
  margin-top: 10px; padding: 10px 12px; border-radius: 8px;
  background: var(--r-ui, #f7f8fa);
}
.check-line { margin: 0 0 8px; line-height: 1.9; font-size: 14px; }
.check-line .bad {
  background: color-mix(in srgb, #b5493c 16%, transparent);
  border-bottom: 2px solid #b5493c; padding: 1px 2px; cursor: help;
}
.check-ok { margin: 0; color: #3a8a5c; font-size: 13px; }
.check-issue { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; font-size: 12.5px; }
.ci-type {
  flex-shrink: 0; padding: 0 6px; border-radius: 5px; font-size: 11.5px;
  background: color-mix(in srgb, #b5493c 12%, transparent); color: #b5493c;
}
.ci-fix { color: var(--r-ink, #1f2328); }
.ci-why { color: var(--r-ink2, #9aa0a6); }
.check-better { margin: 8px 0 0; font-size: 13px; color: #3a8a5c; }

.pod-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.pod-msg { margin: 8px 0 0; font-size: 12.5px; color: var(--r-ink2, #6b7280); line-height: 1.6; }

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

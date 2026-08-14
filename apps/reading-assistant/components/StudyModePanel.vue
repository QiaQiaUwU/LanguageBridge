<template>
  <div class="study-overlay" @click.self="$emit('close')">
    <div class="study-panel">
      <div class="study-head">
        <span>学习模式</span>
        <button class="close-btn" @click="$emit('close')">×</button>
      </div>

      <div v-if="phase === 'setup'" class="study-setup">
        <p class="setup-label">选择要学习的范围（第几句到第几句）</p>
        <div class="range-row">
          <span>第</span>
          <input type="number" v-model.number="rangeStart" :min="1" :max="sentences.length" />
          <span>句 到第</span>
          <input type="number" v-model.number="rangeEnd" :min="1" :max="sentences.length" />
          <span>句</span>
          <button class="ghost-btn small" @click="rangeStart = 1; rangeEnd = sentences.length">全文</button>
        </div>
        <p class="range-hint">已选 {{ selectedCount }} 句{{ selectedCount > 60 ? '（范围较大，AI 处理可能要久一点）' : '' }}</p>

        <div class="setup-actions">
          <button class="study-act" :disabled="running || !aiReady" @click="run('points')">梳理知识点</button>
          <button class="study-act" :disabled="running || !aiReady" @click="run('structure')">知识架构</button>
          <button class="study-act primary" :disabled="running || !aiReady" @click="run('quiz')">出题自测</button>
        </div>
        <p v-if="!aiReady" class="hint">请先点右下角悬浮按钮配置好 API Key</p>
      </div>

      <div v-else-if="phase === 'loading'" class="study-loading">
        {{ loadingText }}
      </div>

      <div v-else-if="phase === 'error'" class="study-error">
        <p>{{ errorMsg }}</p>
        <button class="ghost-btn" @click="phase = 'setup'">返回重试</button>
      </div>

      <div v-else-if="phase === 'points'" class="study-body">
        <div class="point-card" v-for="(p, i) in points" :key="i">
          <div class="point-title">{{ p.title }}</div>
          <div class="point-detail">{{ p.detail }}</div>
          <div class="point-quote">「{{ sentences[p.sentenceIndex]?.en || '' }}」</div>
          <div class="point-acts">
            <span class="act-link" @click="$emit('jump', p.sentenceIndex)">跳转原文</span>
            <span class="act-link" @click="saveOne(p)">存为笔记</span>
          </div>
        </div>
        <button class="ghost-btn" @click="saveAll">全部存为笔记</button>
      </div>

      <div v-else-if="phase === 'quiz'" class="study-body">
        <div class="quiz-card" v-for="(q, qi) in quiz" :key="qi">
          <div class="point-title">{{ qi + 1 }}. {{ q.question }}</div>
          <div class="quiz-opts">
            <label class="quiz-opt" v-for="(o, oi) in q.options" :key="oi" :class="optClass(qi, oi)">
              <input type="radio" :name="`q${qi}`" :disabled="submitted" @change="answers[qi] = oi" />
              <span>{{ o }}</span>
            </label>
          </div>
          <div v-if="submitted" class="quiz-feedback">
            <b :class="answers[qi] === q.answer ? 'ok' : 'bad'">{{ answers[qi] === q.answer ? '答对了' : '答错了' }}</b>
            <span v-if="q.explanation"> · {{ q.explanation }}</span>
            <span class="act-link" @click="$emit('jump', q.sentenceIndex)">跳到原文</span>
          </div>
        </div>
        <button v-if="!submitted" class="study-act primary" @click="submitQuiz">提交答案</button>
        <div v-else class="quiz-score">得分 {{ score }} / {{ quiz.length }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ArticleSentence } from '@/shared/types/Article'
import { makeOutline, makeQuiz, type StudyPoint, type StudyQuizQuestion } from '@/shared/core/studyMode'
import { AiError } from '@/shared/core/aiClient'
import { isAiConfigured } from '@/shared/core/aiSettings'

const props = defineProps<{ sentences: ArticleSentence[] }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'jump', sentenceIndex: number): void
  (e: 'save-note', text: string): void
}>()

const aiReady = computed(() => isAiConfigured())

const rangeStart = ref(1)
const rangeEnd = ref(Math.min(props.sentences.length, 40))
const selectedCount = computed(() => Math.max(0, rangeEnd.value - rangeStart.value + 1))

type Phase = 'setup' | 'loading' | 'points' | 'quiz' | 'error'
const phase = ref<Phase>('setup')
const running = ref(false)
const loadingText = ref('')
const errorMsg = ref('')

const points = ref<StudyPoint[]>([])
const quiz = ref<StudyQuizQuestion[]>([])
const answers = ref<Record<number, number>>({})
const submitted = ref(false)

async function run(kind: 'points' | 'structure' | 'quiz') {
  const start = Math.max(0, rangeStart.value - 1)
  const end = Math.min(props.sentences.length, rangeEnd.value)
  if (end <= start) {
    errorMsg.value = '范围为空，请调整'
    phase.value = 'error'
    return
  }
  running.value = true
  phase.value = 'loading'
  loadingText.value = kind === 'quiz' ? '正在生成检测题…' : kind === 'structure' ? '正在分析知识架构…' : '正在梳理知识点…'
  try {
    if (kind === 'quiz') {
      quiz.value = await makeQuiz(props.sentences, start, end, 4)
      answers.value = {}
      submitted.value = false
      if (!quiz.value.length) throw new AiError('这段生成不了题，换一段试试')
      phase.value = 'quiz'
    } else {
      points.value = await makeOutline(props.sentences, start, end, kind)
      if (!points.value.length) throw new AiError('这段没提炼出明显的知识点，换一段试试')
      phase.value = 'points'
    }
  } catch (e) {
    errorMsg.value = e instanceof AiError ? e.message : '生成失败，请稍后重试'
    phase.value = 'error'
  } finally {
    running.value = false
  }
}

function optClass(qi: number, oi: number) {
  if (!submitted.value) return { selected: answers.value[qi] === oi }
  const q = quiz.value[qi]
  if (oi === q.answer) return { right: true }
  if (oi === answers.value[qi]) return { wrong: true }
  return {}
}

const score = computed(() => quiz.value.filter((q, i) => answers.value[i] === q.answer).length)

function submitQuiz() {
  submitted.value = true
}

function saveOne(p: StudyPoint) {
  const en = props.sentences[p.sentenceIndex]?.en || ''
  emit('save-note', `【${p.title}】${p.detail}${en ? `\n原文：${en}` : ''}`)
}

function saveAll() {
  for (const p of points.value) saveOne(p)
}
</script>

<style scoped>
.study-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 250;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.study-panel {
  background: #fff;
  border-radius: 14px;
  width: min(560px, 100%);
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
}
.study-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #f0f0f0;
  font-size: 16px;
  font-weight: 600;
  position: sticky;
  top: 0;
  background: #fff;
}
.close-btn { border: none; background: none; font-size: 22px; cursor: pointer; color: #999; line-height: 1; }
.close-btn:hover { color: #333; }

.study-setup { padding: 20px; }
.setup-label { font-size: 13.5px; color: #666; margin-bottom: 10px; }
.range-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 14px; color: #333; margin-bottom: 8px; }
.range-row input {
  width: 64px;
  border: 1px solid var(--r-border, #ddd);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 14px;
  text-align: center;
}
.range-hint { color: #999; font-size: 12.5px; margin-bottom: 18px; }
.setup-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.study-act {
  border: 1px solid var(--r-border, #ddd);
  background: #fff;
  border-radius: 9px;
  padding: 10px 18px;
  font-size: 14px;
  cursor: pointer;
  &:hover:not(:disabled) { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff)); }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
}
.study-act.primary { background: var(--r-accent, #8a4b3a); color: #fff; border-color: transparent; }
.study-act.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 82%, #000); }

.study-loading, .study-error { padding: 60px 20px; text-align: center; color: #666; }
.study-error button { margin-top: 14px; }

.study-body { padding: 18px 20px; }
.point-card, .quiz-card {
  border: 1px solid #eee;
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 12px;
}
.point-title { font-weight: 600; color: #1a1a1a; font-size: 14.5px; margin-bottom: 6px; }
.point-detail { color: #444; font-size: 13.5px; line-height: 1.6; margin-bottom: 8px; }
.point-quote { color: #999; font-size: 12.5px; font-style: italic; margin-bottom: 8px; }
.point-acts { display: flex; gap: 14px; }
.act-link { color: #555; font-size: 12.5px; cursor: pointer; text-decoration: underline; }
.act-link:hover { color: #000; }

.quiz-opts { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
.quiz-opt {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.quiz-opt.selected { background: var(--r-ui, #f2f2f2); }
.quiz-opt.right { background: #eef4e8; color: #4a7d3a; }
.quiz-opt.wrong { background: #f9ece9; color: #b05a4a; }
.quiz-feedback { font-size: 13px; color: #666; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.quiz-feedback b.ok { color: #4a7d3a; }
.quiz-feedback b.bad { color: #b05a4a; }
.quiz-score { text-align: center; font-size: 16px; font-weight: 600; color: #1a1a1a; padding: 10px 0; }

.ghost-btn {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  border: 1px solid var(--r-border, #ddd);
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff));
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
  color: #444;
}
.ghost-btn:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff)); }
.ghost-btn.small { padding: 5px 10px; font-size: 12px; }
.hint { color: #999; font-size: 13px; margin-top: 10px; }
</style>

<template>
  <div v-if="agentPanelOpen" class="agent-panel" :class="{ wide: viewMode === 'settings' }" :style="panelStyle">
    <div class="panel-header" @pointerdown="onDragStart">
      <span class="status-dot" :class="{ on: aiReady }"></span>
      <span class="panel-title">AI 助手</span>
      <div class="header-actions">
        <button class="header-btn" :class="{ active: viewMode === 'checkin' }" title="学习打卡" @click.stop="toggleView('checkin')">
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zM5 9h14v11H5V9z"/></svg>
        </button>
        <button class="header-btn" :class="{ active: viewMode === 'settings' }" title="设置" @click.stop="toggleView('settings')">
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19.4 13a7.4 7.4 0 0 0 .06-1 7.4 7.4 0 0 0-.06-1l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.4.96a7.5 7.5 0 0 0-1.73-1l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.63.25-1.2.59-1.73 1l-2.4-.96a.5.5 0 0 0-.6.22L2.73 8.78a.5.5 0 0 0 .12.64L4.88 11a7.4 7.4 0 0 0-.06 1c0 .34.02.67.06 1l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.42.32.6.22l2.4-.96c.53.41 1.1.75 1.73 1l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.63-.25 1.2-.59 1.73-1l2.4.96c.24.1.5 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64L19.4 13zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>
        </button>
        <button class="header-btn" title="关闭" @click.stop="agentPanelOpen = false">
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.88 18.3 9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.3-6.3z"/></svg>
        </button>
      </div>
    </div>

    <div v-if="viewMode === 'checkin'" class="checkin-view">
      <StreakHeatmap :weeks-to-show="14" />

      <div class="todo-section">
        <h4 class="section-title">学习习惯</h4>
        <div class="habit-row" v-for="h in habits" :key="h.id">
          <span class="habit-name">{{ h.name }}</span>
          <span class="habit-streak">连续 {{ h.streak }} 天{{ h.medalAt ? ' · 已达标' : ` / 目标 ${h.goal} 天` }}</span>
          <button class="habit-checkin" :class="{ done: h.today }" :disabled="h.today" @click="doCheckin(h)">
            {{ h.today ? '今日已打卡' : '打卡' }}
          </button>
          <button class="mini-del" @click="doDeleteHabit(h.id)">×</button>
        </div>
        <p v-if="!habits.length" class="empty-hint small">还没有习惯，比如"每天背10个词"</p>
        <div class="add-row">
          <input v-model="newHabitName" placeholder="新习惯名称…" @keyup.enter="doAddHabit" />
          <button class="ghost-btn small" :disabled="!newHabitName.trim()" @click="doAddHabit">+</button>
        </div>
      </div>

      <div class="todo-section">
        <h4 class="section-title">学习待办</h4>
        <div class="todo-row" v-for="t in todos" :key="t.id" :class="{ done: t.done }">
          <input type="checkbox" :checked="t.done" @change="doToggleTodo(t)" />
          <span class="todo-text">{{ t.text }}</span>
          <span v-if="t.due" class="todo-due">{{ t.due }}</span>
          <button class="mini-del" @click="doDeleteTodo(t.id)">×</button>
        </div>
        <p v-if="!todos.length" class="empty-hint small">还没有待办</p>
        <div class="add-row">
          <input v-model="newTodoText" placeholder="新待办…" @keyup.enter="doAddTodo" />
          <input v-model="newTodoDue" type="date" class="todo-due-input" title="截止日期（可选）" />
          <button class="ghost-btn small" :disabled="!newTodoText.trim()" @click="doAddTodo">+</button>
        </div>
      </div>

      <button class="chip clear-chat-chip" @click="agentChat.clearChat()">清空对话记录</button>
    </div>

    <div v-else-if="viewMode === 'settings'" class="settings-view">
      <div class="profiles-row" v-if="aiProfiles.length">
        <span
          v-for="p in aiProfiles"
          :key="p.name"
          class="profile-chip"
          :class="{ on: p.name === activeProfileName }"
          @click="applyProfile(p.name)"
        >
          {{ p.name }}
          <span class="profile-x" @click.stop="deleteProfile(p.name)">×</span>
        </span>
      </div>
      <div class="save-profile-row">
        <input v-model="newProfileName" class="profile-name-input" placeholder="给当前配置起个名字…" autocomplete="off" />
        <button class="ghost-btn small" :disabled="!newProfileName.trim()" @click="doSaveProfile">存为配置档</button>
      </div>

      <label class="s-label">服务商</label>
      <select v-model="aiSettings.provider" class="s-input" @change="onProviderChange" autocomplete="off">
        <option value="anthropic">Anthropic（Claude）</option>
        <option value="openai">OpenAI 兼容接口</option>
      </select>

      <label class="s-label">Base URL（通常以 /v1 结尾）</label>
      <input v-model="aiSettings.baseUrl" class="s-input" autocomplete="off" :placeholder="aiSettings.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.deepseek.com/v1'" />

      <label class="s-label">API Key</label>
      <div class="key-row">
        <input :type="showKey ? 'text' : 'password'" v-model="aiSettings.apiKey" class="s-input" autocomplete="new-password" placeholder="sk-... / your-api-key" />
        <button class="ghost-btn small" @click="showKey = !showKey">{{ showKey ? '隐藏' : '显示' }}</button>
      </div>

      <label class="s-label">模型</label>
      <div class="key-row">
        <input v-model="aiSettings.model" class="s-input" autocomplete="off" placeholder="点右边拉取可选模型" />
        <button class="ghost-btn small" :disabled="loadingModels || !aiSettings.apiKey.trim()" @click="doFetchModels">
          {{ loadingModels ? '获取中…' : '获取模型列表' }}
        </button>
      </div>
      <p v-if="modelsError" class="models-error">{{ modelsError }}</p>
      <div v-if="availableModels.length" class="models-grid">
        <button v-for="m in availableModels" :key="m" class="model-item" @click="aiSettings.model = m">{{ m }}</button>
      </div>

      <p class="settings-note">Key 仅存本地浏览器，请求经本机本地服务转发（避开浏览器跨域限制），不经过任何我们自建的远程服务器。</p>
      <div class="test-row">
        <button class="dark-btn" :disabled="testing || !aiSettings.apiKey" @click="testConnection">
          {{ testing ? '测试中…' : '测试连接' }}
        </button>
        <span v-if="testResult" class="test-result" :class="testOk ? 'ok' : 'bad'">{{ testResult }}</span>
      </div>
    </div>

    <template v-else>
      <div class="quick-actions">
        <button class="chip" @click="doStats">学习统计</button>
        <button class="chip" :disabled="!wordStore.words.length" @click="doRandomWord">随机复习一词</button>
        <button class="chip" :disabled="!aiReady" @click="doAdvice">AI学习建议</button>
        <button class="chip" @click="prefill('请帮我讲解一下这个单词：')">单词讲解</button>
        <button class="chip" @click="prefill('请用这个单词造3个例句：')">造句练习</button>
        <button class="chip" @click="prefill('请把下面这段话翻译成英文：')">翻译</button>
      </div>

      <div v-if="articleQuickActions.length" class="article-actions">
        <h4 class="section-title">文章操作</h4>
        <div class="article-actions-row">
          <button
            v-for="a in articleQuickActions"
            :key="a.key"
            class="chip"
            :disabled="a.disabled"
            :title="a.title || ''"
            @click="a.run()"
          >{{ a.label }}</button>
        </div>
        <p v-if="lastQuickActionResult" class="action-result" :class="lastQuickActionResult.ok ? 'ok' : 'bad'">
          {{ lastQuickActionResult.message }}
          <span class="action-result-close" @click="lastQuickActionResult = null">×</span>
        </p>
      </div>

      <div class="panel-chat" ref="chatLogEl">
        <div v-for="(m, i) in agentChat.chatHistory" :key="i" class="msg" :class="m.role">
          <p>{{ m.content }}</p>
          <span v-if="m.role === 'assistant'" class="save-vocab-link" @click="saveToVocab(i)">存为词库讲解</span>
        </div>
        <p v-if="!agentChat.chatHistory.length" class="empty-hint">
          {{ aiReady ? '试试上面的快捷操作，或者直接问我问题' : '还没配置 API Key，点右上角设置一下' }}
        </p>
        <p v-if="agentChat.chatSending" class="thinking">思考中…</p>
      </div>

      <div v-if="agentSelectionContext" class="context-chip">
        <span class="context-chip-text">关于「{{ agentSelectionContext.text.length > 40 ? agentSelectionContext.text.slice(0, 40) + '…' : agentSelectionContext.text }}」</span>
        <button class="context-chip-close" title="不带这段上下文" @click="clearAgentSelectionContext">×</button>
      </div>
      <div class="panel-input">
        <input
          ref="inputEl"
          v-model="input"
          :placeholder="agentSelectionContext ? '问点什么，比如这段什么意思…' : '问 AI 助手：比如 abandon 什么意思…'"
          :disabled="!aiReady"
          @keyup.enter="send"
        />
        <button class="send-btn" :disabled="!input.trim() || agentChat.chatSending || !aiReady" @click="send">
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { agentPanelOpen, agentPanelPrefillText, agentSelectionContext, clearAgentSelectionContext, articleQuickActions, lastQuickActionResult, agentButtonRect } from '@/shared/core/agentPanelState'
import { useAgentChatStore } from '@/shared/stores/agentChatStore'
import { useWordStore } from '@/shared/stores/wordStore'
import { useReaderStore } from '@/apps/reading-assistant/stores/readerStore'
import { aiSettings, isAiConfigured, aiProfiles, saveCurrentAsProfile, loadProfile, deleteProfile } from '@/shared/core/aiSettings'
import { askAi, AiError, fetchAvailableModels } from '@/shared/core/aiClient'
import { playWord } from '@/shared/core/audio'
import StreakHeatmap from './StreakHeatmap.vue'
import { getTodos, addTodo, toggleTodo, deleteTodo, getHabits, addHabit, deleteHabit, checkinHabit, type Todo, type Habit } from '@/shared/core/studyTodos'

const agentChat = useAgentChatStore()
const wordStore = useWordStore()
const readerStore = useReaderStore()
const aiReady = computed(() => isAiConfigured())

type ViewMode = 'chat' | 'checkin' | 'settings'
const viewMode = ref<ViewMode>('chat')
function toggleView(v: ViewMode) {
  viewMode.value = viewMode.value === v ? 'chat' : v
  if (viewMode.value === 'checkin') loadTodosAndHabits()
}

const todos = ref<Todo[]>([])
const habits = ref<Habit[]>([])
const newTodoText = ref('')
const newTodoDue = ref('')
const newHabitName = ref('')

async function loadTodosAndHabits() {
  todos.value = await getTodos()
  habits.value = await getHabits()
}

async function doAddTodo() {
  if (!newTodoText.value.trim()) return
  await addTodo(newTodoText.value, newTodoDue.value)
  newTodoText.value = ''
  newTodoDue.value = ''
  todos.value = await getTodos()
}
async function doToggleTodo(t: Todo) {
  await toggleTodo(t.id, !t.done)
  todos.value = await getTodos()
}
async function doDeleteTodo(id: number) {
  await deleteTodo(id)
  todos.value = await getTodos()
}

watch(
  () => agentChat.lastToolCallAt,
  v => {
    if (v) loadTodosAndHabits()
  }
)

async function doAddHabit() {
  if (!newHabitName.value.trim()) return
  const r = await addHabit(newHabitName.value)
  if (r.ok) {
    newHabitName.value = ''
    habits.value = await getHabits()
  }
}
async function doDeleteHabit(id: number) {
  await deleteHabit(id)
  habits.value = await getHabits()
}
async function doCheckin(h: Habit) {
  const r = await checkinHabit(h.id)
  habits.value = await getHabits()
  if (r.reachedGoal) {
    agentChat.pushAssistantMessage(`"${h.name}" 连续打卡达到 ${h.goal} 天目标了，已经养成习惯啦！`)
  }
}

const input = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
const chatLogEl = ref<HTMLElement | null>(null)

function scrollDown() {
  nextTick(() => {
    if (chatLogEl.value) chatLogEl.value.scrollTop = chatLogEl.value.scrollHeight
  })
}
watch(() => agentChat.chatHistory.length, scrollDown)

async function send() {
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  const ctx = agentSelectionContext.value?.text
  clearAgentSelectionContext()
  scrollDown()
  await agentChat.sendChat(text, ctx)
  scrollDown()
}

function prefill(text: string) {
  input.value = text
  nextTick(() => inputEl.value?.focus())
}

function doStats() {
  const known = wordStore.words.filter(w => w.status === 'known').length
  const fuzzy = wordStore.words.filter(w => w.status === 'fuzzy').length
  const unknown = wordStore.words.filter(w => w.status === 'unknown').length
  const books = wordStore.groups.filter(g => g.id.startsWith('book-')).length
  agentChat.pushUserMessage('我的学习统计')
  agentChat.pushAssistantMessage(
    `总词数 ${wordStore.words.length}，认识 ${known}，模糊 ${fuzzy}，不认识 ${unknown}，共 ${books} 个词书，${readerStore.articles.length} 篇阅读文章。`
  )
  scrollDown()
}

function doRandomWord() {
  const pool =
    wordStore.words.filter(w => w.status === 'unknown' || w.status === 'fuzzy').length > 0
      ? wordStore.words.filter(w => w.status === 'unknown' || w.status === 'fuzzy')
      : wordStore.words
  if (!pool.length) return
  const w = pool[Math.floor(Math.random() * pool.length)]
  agentChat.pushUserMessage('给我随机抽一个词复习')
  const meaning = w.meanings?.map(m => [m.partOfSpeech, m.chinese].filter(Boolean).join(' ')).join('；') || '（暂无释义）'
  agentChat.pushAssistantMessage(`${w.word}${w.phonetic ? ` ${w.phonetic}` : ''}\n${meaning}`)
  playWord(w.word)
  scrollDown()
}

async function doAdvice() {
  if (!aiReady.value) return
  const known = wordStore.words.filter(w => w.status === 'known').length
  const unknown = wordStore.words.filter(w => w.status === 'unknown').length
  const fuzzy = wordStore.words.filter(w => w.status === 'fuzzy').length
  scrollDown()
  await agentChat.sendChat(
    `我目前词库总词数 ${wordStore.words.length}，认识 ${known}，模糊 ${fuzzy}，不认识 ${unknown}。请根据这个情况给我一些简短的学习建议（比如优先复习哪部分、多久复习一次），不超过150字。`
  )
  scrollDown()
}

function saveToVocab(assistantIdx: number) {
  const userMsg = agentChat.chatHistory[assistantIdx - 1]
  if (!userMsg || userMsg.role !== 'user') return
  const m = userMsg.content.match(/单词[：:]\s*(\S+)/) || userMsg.content.match(/^([a-zA-Z]+)\s*(什么意思|是什么)?$/)
  const word = (m?.[1] || userMsg.content.trim().split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z'-]/g, '')
  if (!word) return
  const now = new Date().toISOString()
  let existing = wordStore.words.find(x => x.word.toLowerCase() === word)
  if (!existing) {
    existing = {
      id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      word,
      phonetic: '',
      meanings: [{ chinese: '', partOfSpeech: '' }],
      level: 'IELTS',
      source: 'AI讲解',
      status: 'unmarked',
      createdAt: now,
      updatedAt: now
    }
    wordStore.addWord(existing)
  }
  existing.detailed_explanation = agentChat.chatHistory[assistantIdx].content
  existing.updatedAt = now
  wordStore.setWordStatus(existing.id, existing.status || 'unmarked')
  agentChat.pushAssistantMessage(`已存进词库：${word}`)
  scrollDown()
}

const showKey = ref(false)
const newProfileName = ref('')
const activeProfileName = ref('')
const availableModels = ref<string[]>([])
const loadingModels = ref(false)
const modelsError = ref('')
const testing = ref(false)
const testResult = ref('')
const testOk = ref(false)

const PROVIDER_DEFAULTS: Record<'anthropic' | 'openai', { baseUrl: string; model: string }> = {
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' },
  openai: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }
}

function onProviderChange() {
  const d = PROVIDER_DEFAULTS[aiSettings.provider]
  const otherBaseUrls = Object.values(PROVIDER_DEFAULTS).map(x => x.baseUrl)
  const otherModels = Object.values(PROVIDER_DEFAULTS).map(x => x.model)
  if (!aiSettings.baseUrl.trim() || otherBaseUrls.includes(aiSettings.baseUrl.trim())) {
    aiSettings.baseUrl = d.baseUrl
  }
  if (!aiSettings.model.trim() || otherModels.includes(aiSettings.model.trim())) {
    aiSettings.model = d.model
  }
}

function doSaveProfile() {
  if (!newProfileName.value.trim()) return
  saveCurrentAsProfile(newProfileName.value.trim())
  activeProfileName.value = newProfileName.value.trim()
  newProfileName.value = ''
}
function applyProfile(name: string) {
  loadProfile(name)
  activeProfileName.value = name
  availableModels.value = []
  modelsError.value = ''
}

async function doFetchModels() {
  loadingModels.value = true
  modelsError.value = ''
  availableModels.value = []
  try {
    availableModels.value = await fetchAvailableModels()
    if (!availableModels.value.length) {
      modelsError.value = '接口返回了空列表，可能不支持标准模型列表接口，需要手动填模型名'
    }
  } catch (e) {
    modelsError.value = e instanceof AiError ? e.message : '获取模型列表失败'
  } finally {
    loadingModels.value = false
  }
}

async function testConnection() {
  testing.value = true
  testResult.value = ''
  try {
    await askAi('只回复"连接成功"三个字', undefined, 10)
    testResult.value = '连接成功'
    testOk.value = true
    doFetchModels()
  } catch (e) {
    testResult.value = e instanceof AiError ? e.message : '连接失败，请检查配置'
    testOk.value = false
  } finally {
    testing.value = false
  }
}

const pos = ref<{ x: number; y: number } | null>(null)
const STORAGE_KEY = 'lb_agent_panel_pos_v2'
const PANEL_W = 360
const PANEL_H = 480
const MARGIN = 12

function clamp(x: number, y: number) {
  const w = viewMode.value === 'settings' ? 400 : PANEL_W
  return {
    x: Math.max(MARGIN, Math.min(window.innerWidth - w - MARGIN, x)),
    y: Math.max(MARGIN, Math.min(window.innerHeight - PANEL_H - MARGIN, y))
  }
}

function loadPos() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const p = JSON.parse(saved)
      pos.value = clamp(p.x, p.y)
      return
    }
  } catch {
  }
  if (agentButtonRect.value) {
    const r = agentButtonRect.value
    const w = viewMode.value === 'settings' ? 400 : PANEL_W
    pos.value = clamp(r.x + r.width - w, r.y - PANEL_H - 12)
    return
  }
  pos.value = clamp(320, 80)
}

watch(agentPanelOpen, open => {
  if (open) {
    if (!pos.value) loadPos()
    if (agentPanelPrefillText.value) {
      viewMode.value = 'chat'
      input.value = agentPanelPrefillText.value
      agentPanelPrefillText.value = ''
    }
    scrollDown()
    nextTick(() => inputEl.value?.focus())
    if (viewMode.value === 'checkin') loadTodosAndHabits()
  }
})
watch(agentPanelPrefillText, text => {
  if (text && agentPanelOpen.value) {
    viewMode.value = 'chat'
    input.value = text
    agentPanelPrefillText.value = ''
    nextTick(() => inputEl.value?.focus())
  }
})

const panelStyle = computed(() =>
  pos.value ? { left: pos.value.x + 'px', top: pos.value.y + 'px' } : {}
)

let startX = 0
let startY = 0
let originX = 0
let originY = 0

function onDragStart(e: PointerEvent) {
  if ((e.target as HTMLElement).closest('button')) return
  if (!pos.value) loadPos()
  const target = e.currentTarget as HTMLElement
  startX = e.clientX
  startY = e.clientY
  originX = pos.value!.x
  originY = pos.value!.y
  target.setPointerCapture(e.pointerId)
  target.addEventListener('pointermove', onDragMove)
  target.addEventListener('pointerup', onDragEnd)
}
function onDragMove(e: PointerEvent) {
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  pos.value = clamp(originX + dx, originY + dy)
}
function onDragEnd(e: PointerEvent) {
  const target = e.currentTarget as HTMLElement
  target.removeEventListener('pointermove', onDragMove)
  target.removeEventListener('pointerup', onDragEnd)
  if (pos.value) localStorage.setItem(STORAGE_KEY, JSON.stringify(pos.value))
}
</script>

<style scoped>
.agent-panel {
  position: fixed;
  width: 360px;
  height: 480px;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 600;
  border: 1px solid #eee;
  transition: width 0.15s;
}
.agent-panel.wide { width: 400px; }

@media (max-width: 480px) {
  .agent-panel, .agent-panel.wide {
    width: auto !important;
    left: 10px !important;
    right: 10px;
    top: auto !important;
    bottom: 10px !important;
    max-height: 78vh;
  }
}

.panel-header {
  background: var(--r-accent, #8a4b3a);
  color: #fff;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: grab;
  user-select: none;
  touch-action: none;
  flex-shrink: 0;
}
.panel-header:active { cursor: grabbing; }

.status-dot { width: 8px; height: 8px; border-radius: 50%; background: #888; flex-shrink: 0; }
.status-dot.on { background: #7fd88f; }

.panel-title { font-size: 14px; font-weight: 600; flex: 1; }

.header-actions { display: flex; gap: 4px; }
.header-btn { border: none; background: none; color: #ccc; cursor: pointer; padding: 4px; border-radius: 6px; line-height: 0; }
.header-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.12); }
.header-btn.active { color: #fff; background: rgba(255, 255, 255, 0.22); }

.checkin-view { flex: 1; overflow-y: auto; padding: 14px; }

.todo-section { margin-top: 16px; padding-top: 14px; border-top: 1px solid #f0f0f0; }
.section-title { font-size: 12.5px; font-weight: 600; color: #333; margin-bottom: 8px; }
.empty-hint.small { color: #999; font-size: 11.5px; margin: 4px 0 8px; }

.habit-row {
  display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 12px; flex-wrap: wrap;
}
.habit-name { font-weight: 600; color: #1a1a1a; flex-shrink: 0; }
.habit-streak { color: #999; font-size: 11px; flex: 1; }
.habit-checkin {
  border: 1px solid transparent; background: var(--r-accent, #8a4b3a); color: #fff; border-radius: 10px; padding: 3px 10px; font-size: 11px; cursor: pointer;
}
.habit-checkin.done { background: #eef4e8; color: #4a7d3a; border-color: #d8e4c8; cursor: default; }
.habit-checkin:hover:not(.done) { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 82%, #000); }
.mini-del { border: none; background: none; color: #ccc; cursor: pointer; font-size: 14px; line-height: 1; padding: 0 2px; }
.mini-del:hover { color: #b05a4a; }

.todo-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 12.5px; }
.todo-row.done .todo-text { color: #bbb; text-decoration: line-through; }
.todo-text { flex: 1; color: #333; }
.todo-due { color: #999; font-size: 11px; }

.add-row { display: flex; gap: 6px; margin-top: 8px; }
.add-row input {
  flex: 1; border: 1px solid var(--r-border, #ddd); border-radius: 8px; padding: 6px 10px; font-size: 12px; outline: none;
}
.add-row input:focus { border-color: #999; }
.todo-due-input { flex: 0 0 auto !important; width: 118px; }
.clear-chat-chip {
  margin-top: 14px; border: 1px solid color-mix(in srgb, var(--r-accent, #8a4b3a) 24%, transparent); background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff)); color: #666; font-size: 12px;
  padding: 6px 12px; border-radius: 14px; cursor: pointer;
}
.clear-chat-chip:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff)); }

.settings-view { flex: 1; overflow-y: auto; padding: 16px; }
.s-label { display: block; font-size: 12px; color: #666; margin: 10px 0 4px; }
.s-input {
  width: 100%; border: 1px solid var(--r-border, #ddd); border-radius: 8px; padding: 8px 10px; font-size: 13px; outline: none;
}
.s-input:focus { border-color: #999; }
.key-row { display: flex; gap: 6px; .s-input { flex: 1; } }
.profiles-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.profile-chip {
  display: flex; align-items: center; gap: 5px; background: var(--r-ui, #f2f2f2); border-radius: 14px; padding: 5px 10px;
  font-size: 12px; cursor: pointer; color: #333;
}
.profile-chip:hover { background: #e6e6e6; }
.profile-chip.on { background: var(--r-accent, #8a4b3a); color: #fff; }
.profile-x { opacity: 0.55; &:hover { opacity: 1; } }
.save-profile-row { display: flex; gap: 6px; margin-bottom: 12px; }
.profile-name-input { flex: 1; border: 1px solid var(--r-border, #ddd); border-radius: 8px; padding: 7px 10px; font-size: 12.5px; outline: none; }
.profile-name-input:focus { border-color: #999; }
.models-error { color: #b05a4a; font-size: 12px; margin: 6px 0; }
.models-grid { display: flex; flex-wrap: wrap; gap: 5px; max-height: 120px; overflow-y: auto; padding: 8px; background: #fafafa; border-radius: 8px; margin: 6px 0; }
.model-item { border: 1px solid color-mix(in srgb, var(--r-accent, #8a4b3a) 24%, transparent); background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff)); border-radius: 10px; padding: 3px 9px; font-size: 11px; cursor: pointer; }
.model-item:hover { background: var(--r-accent, #8a4b3a); color: #fff; border-color: transparent; }
.settings-note { color: #999; font-size: 11px; margin: 12px 0 10px; line-height: 1.6; }
.test-row { display: flex; align-items: center; gap: 10px; }
.test-result { font-size: 12.5px; }
.test-result.ok { color: #4a7d3a; }
.test-result.bad { color: #b05a4a; }

.ghost-btn {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  border: 1px solid color-mix(in srgb, var(--r-accent, #8a4b3a) 24%, transparent); background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff)); border-radius: 8px; padding: 7px 12px; font-size: 12px; cursor: pointer; color: #444;
}
.ghost-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff)); }
.ghost-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.ghost-btn.small { padding: 6px 10px; font-size: 11.5px; }
.dark-btn {
  box-shadow: 0 1px 2px color-mix(in srgb, var(--r-accent, #8a4b3a) 22%, transparent);
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease; border: none; background: var(--r-accent, #8a4b3a); color: #fff; border-radius: 8px; padding: 9px 18px; font-size: 13px; cursor: pointer; }
.dark-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 82%, #000); }
.dark-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.quick-actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px; border-bottom: 1px solid #f0f0f0; flex-shrink: 0; }
.chip {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease; border: none; background: var(--r-ui, #f2f2f2); color: #333; font-size: 12px; padding: 6px 11px; border-radius: 14px; cursor: pointer; white-space: nowrap; }
.chip:hover:not(:disabled) { background: #e6e6e6; }
.chip:disabled { opacity: 0.4; cursor: not-allowed; }
.article-actions { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; flex-shrink: 0; }
.article-actions-row { display: flex; flex-wrap: wrap; gap: 6px; }
.action-result {
  margin: 8px 0 0; font-size: 12px; padding: 6px 10px; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  &.ok { background: #eef4e8; color: #4a7d3a; }
  &.bad { background: #f9ece9; color: #b05a4a; }
}
.action-result-close { cursor: pointer; opacity: 0.6; &:hover { opacity: 1; } }

.panel-chat { flex: 1; overflow-y: auto; padding: 12px 14px; }
.msg { margin-bottom: 12px; display: flex; flex-direction: column; }
.msg.user { align-items: flex-end; }
.msg.assistant { align-items: flex-start; }
.msg p {
  max-width: 82%; font-size: 13px; line-height: 1.6; white-space: pre-wrap; padding: 8px 12px; border-radius: 12px; margin: 0;
}
.msg.user p { background: var(--r-accent, #8a4b3a); color: #fff; border-bottom-right-radius: 4px; }
.msg.assistant p { background: var(--r-ui, #f2f2f2); color: #222; border-bottom-left-radius: 4px; }
.save-vocab-link { font-size: 11px; color: #999; cursor: pointer; margin-top: 3px; text-decoration: underline; }
.save-vocab-link:hover { color: #555; }

.empty-hint { color: #999; font-size: 12.5px; text-align: center; margin-top: 40px; }
.thinking { color: #999; font-size: 12.5px; padding-left: 2px; }

.panel-input { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #f0f0f0; flex-shrink: 0; }
.panel-input input { flex: 1; border: 1px solid var(--r-border, #ddd); border-radius: 18px; padding: 8px 14px; font-size: 13px; outline: none; }
.panel-input input:focus { border-color: #999; }
.context-chip {
  display: flex; align-items: center; gap: 8px; margin: 0 12px 8px; padding: 6px 10px;
  background: #fdf3e0; border: 1px solid #ecd9ad; border-radius: 8px; flex-shrink: 0;
}
.context-chip-text { flex: 1; font-size: 12px; color: #8a6d2f; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.context-chip-close { border: none; background: none; color: #c2a15f; cursor: pointer; font-size: 15px; line-height: 1; flex-shrink: 0; }
.context-chip-close:hover { color: #8a6d2f; }
.send-btn {
  width: 34px; height: 34px; border-radius: 50%; border: none; background: var(--r-accent, #8a4b3a); color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.send-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 82%, #000); }
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>

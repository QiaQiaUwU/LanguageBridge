<template>
  <div class="coach">
    <h1>AI 助手</h1>
    <p class="sub">连接你自己的大模型 API Key，用于单词讲解、文章笔记与答疑</p>

    <!-- API 设置 -->
    <section class="card">
      <div class="card-head">
        <h3>API 设置</h3>
        <span class="status" :class="{ ok: aiReady }">{{ aiReady ? '已配置' : '未配置' }}</span>
      </div>

      <!-- 连接配置档：保存多套接口，点一下切换 -->
      <div class="profiles-row" v-if="aiProfiles.length">
        <span
          v-for="p in aiProfiles"
          :key="p.name"
          class="profile-chip"
          :class="{ on: p.name === activeProfileName }"
          @click="applyProfile(p.name)"
        >
          {{ p.name }}
          <span class="profile-model">{{ p.model }}</span>
          <span class="profile-x" @click.stop="deleteProfile(p.name)">×</span>
        </span>
      </div>
      <div class="save-profile-row">
        <input v-model="newProfileName" class="profile-name-input" placeholder="给当前配置起个名字…" autocomplete="off" />
        <button class="ghost-btn small" :disabled="!newProfileName.trim()" @click="doSaveProfile">保存为配置档</button>
      </div>

      <div class="settings-grid" autocomplete="off">
        <div class="field">
          <label>服务商</label>
          <select v-model="aiSettings.provider" @change="onProviderChange" autocomplete="off">
            <option value="anthropic">Anthropic（Claude）</option>
            <option value="openai">OpenAI 兼容接口</option>
          </select>
        </div>
        <div class="field">
          <label>Base URL（中转站/反代地址，通常以 /v1 结尾）</label>
          <input v-model="aiSettings.baseUrl" autocomplete="off" name="lb-ai-baseurl" :placeholder="aiSettings.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.deepseek.com/v1'" />
        </div>
        <div class="field">
          <label>API Key</label>
          <div class="key-row">
            <input :type="showKey ? 'text' : 'password'" v-model="aiSettings.apiKey" autocomplete="new-password" name="lb-ai-key" placeholder="sk-... / your-api-key" />
            <button class="ghost-btn small" @click="showKey = !showKey">{{ showKey ? '隐藏' : '显示' }}</button>
          </div>
        </div>
        <div class="field">
          <label>模型</label>
          <div class="key-row">
            <input v-model="aiSettings.model" autocomplete="off" name="lb-ai-model" placeholder="点右边按钮从服务商拉取可选模型" />
            <button class="ghost-btn small" :disabled="loadingModels || !aiSettings.apiKey.trim()" @click="doFetchModels">
              {{ loadingModels ? '获取中…' : '获取模型列表' }}
            </button>
          </div>
        </div>
      </div>

      <p v-if="modelsError" class="models-error">{{ modelsError }}</p>
      <div v-if="availableModels.length" class="models-list">
        <p class="models-list-title">模型列表（{{ availableModels.length }} 个，点条目填入）</p>
        <div class="models-grid">
          <button v-for="m in availableModels" :key="m" class="model-item" @click="aiSettings.model = m">{{ m }}</button>
        </div>
      </div>

      <p class="settings-note">Key 仅保存在本地浏览器，请求会经过本机本地服务转发（避开浏览器跨域限制），不会经过任何我们自建的远程服务器。</p>
      <div class="test-row">
        <button class="dark-btn" :disabled="testing || !aiSettings.apiKey" @click="testConnection">
          {{ testing ? '测试中…' : '测试连接' }}
        </button>
        <span v-if="testResult" class="test-result" :class="testOk ? 'ok' : 'bad'">{{ testResult }}</span>
      </div>
    </section>

    <!-- 学习打卡（真实数据） -->
    <section class="card">
      <h3>学习打卡</h3>
      <StreakHeatmap />
    </section>

    <!-- 学习统计（真实数据） -->
    <section class="card">
      <h3>词库统计</h3>
      <div class="stat-grid">
        <div class="stat"><b>{{ wordStore.totalWords }}</b><span>总词数</span></div>
        <div class="stat"><b>{{ knownCount }}</b><span>认识</span></div>
        <div class="stat"><b>{{ fuzzyCount }}</b><span>模糊</span></div>
        <div class="stat"><b>{{ unknownCount }}</b><span>不认识</span></div>
        <div class="stat"><b>{{ bookCount }}</b><span>词书数</span></div>
        <div class="stat"><b>{{ articleCount }}</b><span>阅读文章</span></div>
      </div>
    </section>

    <!-- 功能 Tab -->
    <section class="card">
      <div class="tabs">
        <button class="tab" :class="{ on: tab === 'word' }" @click="tab = 'word'">单词讲解</button>
        <button class="tab" :class="{ on: tab === 'chat' }" @click="tab = 'chat'">智能对话</button>
      </div>

      <!-- 单词讲解 -->
      <div v-if="tab === 'word'" class="tab-panel">
        <div class="word-input-row">
          <input v-model="wordInput" placeholder="输入一个单词，如 abandon" @keyup.enter="explainWord" />
          <button class="dark-btn" :disabled="explaining || !wordInput.trim() || !aiReady" @click="explainWord">
            {{ explaining ? '生成中…' : '讲解' }}
          </button>
        </div>
        <p v-if="!aiReady" class="hint">请先在上方配置 API Key</p>
        <div v-if="wordExplanation" class="explanation-box">
          <pre>{{ wordExplanation }}</pre>
          <button class="ghost-btn" @click="saveExplanationToVocab">保存到词库</button>
        </div>
      </div>

      <!-- 智能对话 -->
      <div v-else class="tab-panel chat-panel">
        <div class="chat-log" ref="chatLogEl">
          <div v-for="(m, i) in agentChat.chatHistory" :key="i" class="msg" :class="m.role">
            <b>{{ m.role === 'user' ? '我' : 'AI' }}</b>
            <p>{{ m.content }}</p>
          </div>
          <p v-if="!agentChat.chatHistory.length" class="hint">可以问语法、词汇辨析、翻译或任何英语学习问题</p>
        </div>
        <div class="chat-input-row">
          <input v-model="chatInput" placeholder="输入问题…" :disabled="!aiReady" @keyup.enter="sendChat" />
          <button class="dark-btn" :disabled="agentChat.chatSending || !chatInput.trim() || !aiReady" @click="sendChat">
            {{ agentChat.chatSending ? '思考中…' : '发送' }}
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue'
import { useWordStore } from '@/shared/stores/wordStore'
import { useReaderStore } from '@/apps/reading-assistant/stores/readerStore'
import { aiSettings, isAiConfigured, aiProfiles, saveCurrentAsProfile, loadProfile, deleteProfile } from '@/shared/core/aiSettings'
import { askAi, AiError, fetchAvailableModels } from '@/shared/core/aiClient'
import { useAgentChatStore } from '@/shared/stores/agentChatStore'
import StreakHeatmap from '@/src/components/StreakHeatmap.vue'

const wordStore = useWordStore()
const readerStore = useReaderStore()
const aiReady = computed(() => isAiConfigured())

const showKey = ref(false)
const newProfileName = ref('')
const activeProfileName = ref('')
const availableModels = ref<string[]>([])
const loadingModels = ref(false)
const modelsError = ref('')

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
      modelsError.value = '接口返回了空列表，可能这个服务不支持标准的模型列表接口，需要手动填写模型名'
    }
  } catch (e) {
    modelsError.value = e instanceof AiError ? e.message : '获取模型列表失败'
  } finally {
    loadingModels.value = false
  }
}
const testing = ref(false)
const testResult = ref('')
const testOk = ref(false)

const PROVIDER_DEFAULTS: Record<'anthropic' | 'openai', { baseUrl: string; model: string }> = {
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' },
  openai: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }
}

function onProviderChange() {
  const d = PROVIDER_DEFAULTS[aiSettings.provider]
  // 只在还是"另一种服务商的默认值（或者干脆是空）"时才自动替换，避免覆盖用户自己填的内容
  const otherBaseUrls = Object.values(PROVIDER_DEFAULTS).map(x => x.baseUrl)
  const otherModels = Object.values(PROVIDER_DEFAULTS).map(x => x.model)
  if (!aiSettings.baseUrl.trim() || otherBaseUrls.includes(aiSettings.baseUrl.trim())) {
    aiSettings.baseUrl = d.baseUrl
  }
  if (!aiSettings.model.trim() || otherModels.includes(aiSettings.model.trim())) {
    aiSettings.model = d.model
  }
}

// 打开页面时如果模型名称是空的（比如之前不小心清空过），立刻按当前服务商补一个合理默认值，
// 不用等切换服务商才触发，也不用等下次刷新才生效
onMounted(() => {
  if (!aiSettings.model.trim()) {
    aiSettings.model = PROVIDER_DEFAULTS[aiSettings.provider].model
  }
})

async function testConnection() {
  testing.value = true
  testResult.value = ''
  try {
    await askAi('请只回复"连接成功"三个字，不要说其他内容')
    testResult.value = '连接成功'
    testOk.value = true
    // 测通了顺便把可选模型拉出来，省得再点一次
    doFetchModels()
  } catch (e) {
    testResult.value = e instanceof AiError ? e.message : '连接失败，请检查配置'
    testOk.value = false
  } finally {
    testing.value = false
  }
}

const knownCount = computed(() => wordStore.words.filter(w => w.status === 'known').length)
const fuzzyCount = computed(() => wordStore.words.filter(w => w.status === 'fuzzy').length)
const unknownCount = computed(() => wordStore.words.filter(w => w.status === 'unknown').length)
const bookCount = computed(() => wordStore.groups.filter(g => g.id.startsWith('book-')).length)
const articleCount = computed(() => readerStore.articles.length)

const tab = ref<'word' | 'chat'>('word')

// ===== 单词讲解 =====
const wordInput = ref('')
const explaining = ref(false)
const wordExplanation = ref('')

async function explainWord() {
  if (!wordInput.value.trim() || !aiReady.value) return
  explaining.value = true
  wordExplanation.value = ''
  try {
    const result = await askAi(
      `请详细讲解英语单词 "${wordInput.value.trim()}"，用中文输出，包含：音标、词性与中文释义、词源、记忆技巧、2个例句（中英对照）、1-2个易混词辨析。不要使用表情符号，简洁分点列出。`
    )
    wordExplanation.value = result
  } catch (e) {
    wordExplanation.value = e instanceof AiError ? e.message : '生成失败，请稍后重试'
  } finally {
    explaining.value = false
  }
}

async function saveExplanationToVocab() {
  const w = wordInput.value.trim().toLowerCase()
  if (!w) return
  let existing = wordStore.words.find(x => x.word.toLowerCase() === w)
  const now = new Date().toISOString()
  if (!existing) {
    existing = {
      id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      word: w,
      phonetic: '',
      meanings: [{ chinese: '', partOfSpeech: '' }],
      level: 'IELTS',
      source: 'AI讲解',
      status: 'unmarked',
      createdAt: now,
      updatedAt: now
    }
    await wordStore.addWord(existing)
  }
  existing.detailed_explanation = wordExplanation.value
  existing.updatedAt = now
  await wordStore.setWordStatus(existing.id, existing.status || 'unmarked')
}

// ===== 智能对话（状态在共享 store 里，和悬浮面板共用同一份对话历史） =====
const agentChat = useAgentChatStore()
const chatInput = ref('')
const chatLogEl = ref<HTMLElement | null>(null)

async function sendChat() {
  const text = chatInput.value.trim()
  if (!text || !aiReady.value) return
  chatInput.value = ''
  scrollChat()
  await agentChat.sendChat(text)
  scrollChat()
}

function scrollChat() {
  nextTick(() => {
    if (chatLogEl.value) chatLogEl.value.scrollTop = chatLogEl.value.scrollHeight
  })
}
</script>

<style lang="scss" scoped>
.coach {
  max-width: 760px;
  margin: 0 auto;
  padding: 24px 24px 60px;
}
h1 { font-size: 24px; color: #1a1a1a; }
.sub { color: #888; margin: 6px 0 22px; font-size: 14px; }

.card {
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 18px 20px;
  margin-bottom: 18px;
}
.card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.card h3 { font-size: 16px; color: #1a1a1a; margin-bottom: 14px; }
.card-head h3 { margin-bottom: 0; }

.status {
  font-size: 12.5px;
  color: #999;
  background: #f2f2f2;
  padding: 3px 10px;
  border-radius: 10px;
  &.ok { background: #eef4e8; color: #4a7d3a; }
}

.profiles-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.profile-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #f2f2f2;
  border-radius: 16px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
  color: #333;
  &:hover { background: #e6e6e6; }
  &.on { background: #1c1c1c; color: #fff; }
}
.profile-model { font-size: 11px; opacity: 0.65; }
.profile-x { opacity: 0.55; padding: 0 2px; &:hover { opacity: 1; } }

.save-profile-row { display: flex; gap: 8px; margin-bottom: 16px; }
.profile-name-input {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  outline: none;
  flex: 1;
  max-width: 240px;
  &:focus { border-color: #999; }
}

.models-error { color: #b05a4a; font-size: 12.5px; margin-bottom: 10px; }
.models-list { margin-bottom: 14px; }
.models-list-title { font-size: 12.5px; color: #666; margin-bottom: 8px; }
.models-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 200px;
  overflow-y: auto;
  padding: 10px;
  background: #fafafa;
  border-radius: 8px;
}
.model-item {
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 12px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
  color: #333;
  &:hover { background: #1c1c1c; color: #fff; border-color: #1c1c1c; }
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
  margin-bottom: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  label { font-size: 12.5px; color: #666; }
  input, select {
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 9px 11px;
    font-size: 13.5px;
    outline: none;
    &:focus { border-color: #999; }
  }
}
.key-row { display: flex; gap: 8px; input { flex: 1; } }
.settings-note { color: #999; font-size: 12px; margin-bottom: 12px; }
.test-row { display: flex; align-items: center; gap: 12px; }
.test-result { font-size: 13px; &.ok { color: #4a7d3a; } &.bad { color: #b05a4a; } }

.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  text-align: center;
  b { display: block; font-size: 22px; color: #1a1a1a; }
  span { color: #888; font-size: 12.5px; }
}

.tabs { display: inline-flex; background: #f2f2f2; border-radius: 10px; padding: 4px; margin-bottom: 16px; }
.tab {
  border: none; background: none; padding: 8px 18px; border-radius: 8px; font-size: 14px; cursor: pointer; color: #444;
  &.on { background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.1); font-weight: 600; }
}

.word-input-row { display: flex; gap: 10px; margin-bottom: 10px; input { flex: 1; border: 1px solid #ddd; border-radius: 8px; padding: 10px 14px; font-size: 14px; outline: none; &:focus { border-color: #999; } } }
.hint { color: #999; font-size: 13px; }
.explanation-box {
  margin-top: 14px;
  background: #fafafa;
  border-radius: 10px;
  padding: 16px;
  pre { white-space: pre-wrap; font-family: inherit; font-size: 14px; color: #333; line-height: 1.7; margin-bottom: 12px; }
}

.chat-panel { display: flex; flex-direction: column; height: 420px; }
.chat-log { flex: 1; overflow-y: auto; padding: 4px 2px; margin-bottom: 12px; }
.msg { margin-bottom: 14px; b { font-size: 12px; color: #999; display: block; margin-bottom: 3px; } p { font-size: 14px; color: #1a1a1a; line-height: 1.6; white-space: pre-wrap; } &.user p { color: #444; } }
.chat-input-row { display: flex; gap: 10px; input { flex: 1; border: 1px solid #ddd; border-radius: 8px; padding: 10px 14px; font-size: 14px; outline: none; &:focus { border-color: #999; } } }

.dark-btn {
  border: none; background: #1c1c1c; color: #fff; border-radius: 8px; padding: 9px 18px; font-size: 13.5px; cursor: pointer;
  &:hover:not(:disabled) { background: #000; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
}
.ghost-btn {
  border: 1px solid #ddd; background: #fff; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; color: #444;
  &:hover { background: #f5f5f5; }
  &.small { padding: 6px 10px; }
}
</style>

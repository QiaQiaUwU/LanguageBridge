import { reactive, watch } from 'vue'

export type AiProvider = 'anthropic' | 'openai'

export interface AiSettings {
  provider: AiProvider
  apiKey: string
  baseUrl: string
  model: string
  /**
   * 长任务专用模型（整理转录稿、批量翻译这类）。
   *
   * 有些中转站**按模型的上下文窗口整个预扣费**，跟我们发多少 max_tokens 无关：
   * 选了百万上下文的模型，一次请求就要预扣几百块，余额不够直接 403，
   * 而同一个 key 跑短请求完全正常。
   * 留一个单独的槽位，长任务换个小窗口的便宜模型，主模型不用动。
   * 留空就用上面那个 model。
   */
  heavyModel?: string
}

const STORAGE_KEY = 'lb_ai_settings'

function defaults(): AiSettings {
  return {
    provider: 'anthropic',
    apiKey: '',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    heavyModel: ''
  }
}

function load(): AiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      for (const key of Object.keys(parsed)) {
        if (parsed[key] === '') delete parsed[key]
      }
      return { ...defaults(), ...parsed }
    }
  } catch {
  }
  return defaults()
}

export const aiSettings = reactive<AiSettings>(load())

watch(
  aiSettings,
  v => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v))
  },
  { deep: true }
)

export interface AiProfile {
  name: string
  provider: AiProvider
  baseUrl: string
  apiKey: string
  model: string
}

const PROFILES_KEY = 'lb_ai_profiles'

function loadProfiles(): AiProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
  }
  return []
}

export const aiProfiles = reactive<AiProfile[]>(loadProfiles())

function persistProfiles() {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(aiProfiles))
}

export function saveCurrentAsProfile(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return
  const profile: AiProfile = {
    name: trimmed,
    provider: aiSettings.provider,
    baseUrl: aiSettings.baseUrl,
    apiKey: aiSettings.apiKey,
    model: aiSettings.model
  }
  const idx = aiProfiles.findIndex(p => p.name === trimmed)
  if (idx >= 0) aiProfiles[idx] = profile
  else aiProfiles.push(profile)
  persistProfiles()
}

export function loadProfile(name: string) {
  const p = aiProfiles.find(x => x.name === name)
  if (!p) return
  aiSettings.provider = p.provider
  aiSettings.baseUrl = p.baseUrl
  aiSettings.apiKey = p.apiKey
  aiSettings.model = p.model
}

export function deleteProfile(name: string) {
  const idx = aiProfiles.findIndex(p => p.name === name)
  if (idx >= 0) aiProfiles.splice(idx, 1)
  persistProfiles()
}

export function isAiConfigured(): boolean {
  return !!aiSettings.apiKey.trim()
}

/** 长任务该用哪个模型：设了专用的就用专用的，没设就用主模型 */
export function modelForHeavyTask(): string {
  return (aiSettings.heavyModel || '').trim() || aiSettings.model
}

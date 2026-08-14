import { reactive, watch } from 'vue'

export type AiProvider = 'anthropic' | 'openai'

export interface AiSettings {
  provider: AiProvider
  apiKey: string
  baseUrl: string
  model: string
}

const STORAGE_KEY = 'lb_ai_settings'

function defaults(): AiSettings {
  return {
    provider: 'anthropic',
    apiKey: '',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5'
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

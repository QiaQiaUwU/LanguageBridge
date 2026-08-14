import { defineStore } from 'pinia'
import { ref, computed, watchEffect } from 'vue'

export interface Skin {
  id: string
  name: string
  paper: string
  ink: string
  ink2: string
  accent: string
  ui: string
  border: string
}

export const SKINS: Skin[] = [
  { id: 'minimal', name: '简约', paper: '#ffffff', ink: '#1f2328', ink2: '#8a9099', accent: '#5b7a99', ui: '#f4f5f7', border: '#e5e7eb' },
  { id: 'white', name: '白色', paper: '#fbfbfc', ink: '#23262b', ink2: '#6b7280', accent: '#5b7a99', ui: '#f1f2f5', border: '#dfe1e6' },
  { id: 'paper', name: '羊皮纸', paper: '#f4ecd8', ink: '#3a3226', ink2: '#6b5d48', accent: '#8a4b3a', ui: '#ece3cf', border: '#d3c5a6' },
  { id: 'cream', name: '米白', paper: '#faf6ed', ink: '#4a4234', ink2: '#7a6e58', accent: '#9c6644', ui: '#f2ece0', border: '#ddd0b8' },
  { id: 'green', name: '豆沙绿', paper: '#c7d9c0', ink: '#33402d', ink2: '#566b4c', accent: '#5a7d4f', ui: '#bcd0b4', border: '#a3bb9b' },
  { id: 'sepia', name: '怀旧棕', paper: '#e4d5b7', ink: '#4a3826', ink2: '#7a6448', accent: '#8a5a2a', ui: '#dccaa8', border: '#c9b896' },
  { id: 'dark', name: '夜间', paper: '#1a1a1a', ink: '#b8b0a0', ink2: '#888070', accent: '#a87850', ui: '#242420', border: '#3a3632' },
  { id: 'darkblue', name: '深蓝', paper: '#15202b', ink: '#a8b0b8', ink2: '#788088', accent: '#5a8aaa', ui: '#1c2832', border: '#2a3640' },
  { id: 'black', name: '纯黑', paper: '#000000', ink: '#999088', ink2: '#666058', accent: '#886644', ui: '#141414', border: '#2a2a2a' }
]

const STORAGE_KEY = 'lb_reader_skin' // 沿用阅读区原来的 key，已经选过主题的人不用重选一次
const MIGRATION_KEY = 'lb_skin_migrated_minimal'
const OLD_DEFAULTS = new Set(['white', 'paper', 'cream'])

function initialSkin(): string {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (!saved) return 'minimal'
  if (!localStorage.getItem(MIGRATION_KEY)) {
    localStorage.setItem(MIGRATION_KEY, '1')
    if (OLD_DEFAULTS.has(saved)) {
      localStorage.setItem(STORAGE_KEY, 'minimal')
      return 'minimal'
    }
  }
  return saved
}

export const useThemeStore = defineStore('theme', () => {
  const currentId = ref(initialSkin())

  const current = computed(() => SKINS.find(s => s.id === currentId.value) || SKINS[0])

  function setSkin(id: string) {
    if (!SKINS.some(s => s.id === id)) return
    currentId.value = id
    localStorage.setItem(STORAGE_KEY, id)
  }

  watchEffect(() => {
    const s = current.value
    const root = document.documentElement.style
    root.setProperty('--r-paper', s.paper)
    root.setProperty('--r-ink', s.ink)
    root.setProperty('--r-ink2', s.ink2)
    root.setProperty('--r-accent', s.accent)
    root.setProperty('--r-ui', s.ui)
    root.setProperty('--r-border', s.border)
  })

  return { currentId, skins: SKINS, current, setSkin }
})

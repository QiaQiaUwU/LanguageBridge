import { ref } from 'vue'

export const agentPanelOpen = ref(false)

export const agentButtonRect = ref<{ x: number; y: number; width: number; height: number } | null>(null)

export function toggleAgentPanel(buttonRect?: { x: number; y: number; width: number; height: number }) {
  if (!agentPanelOpen.value && buttonRect) agentButtonRect.value = buttonRect
  agentPanelOpen.value = !agentPanelOpen.value
}

export const agentPanelPrefillText = ref('')

export function openAgentPanelWithPrefill(text: string) {
  agentPanelPrefillText.value = text
  agentPanelOpen.value = true
}

export const agentSelectionContext = ref<{ text: string } | null>(null)

export function setAgentSelectionContext(text: string) {
  const t = text.trim()
  agentSelectionContext.value = t ? { text: t } : null
}

export function clearAgentSelectionContext() {
  agentSelectionContext.value = null
}

export interface ArticleQuickAction {
  key: string
  label: string
  run: () => void | Promise<void>
  disabled?: boolean
  title?: string
}
export const articleQuickActions = ref<ArticleQuickAction[]>([])

export function setArticleQuickActions(actions: ArticleQuickAction[]) {
  articleQuickActions.value = actions
}

export function clearArticleQuickActions() {
  articleQuickActions.value = []
}

export const lastQuickActionResult = ref<{ ok: boolean; message: string } | null>(null)

export function setLastQuickActionResult(ok: boolean, message: string) {
  lastQuickActionResult.value = { ok, message }
}

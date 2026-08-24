import { ref, readonly } from 'vue'
import { type EnrichField, enrichWordsWithAi, type EnrichAiProgress } from './aiEnrich'
import type { WordItem } from '@/shared/types/WordItem'

const running = ref(false)
const finished = ref(false)
const saved = ref(0)
const progress = ref<EnrichAiProgress>({ done: 0, total: 0, current: '', failed: 0 })
const errorMsg = ref('')

let stopFlag = false

export interface StartOptions {
  targets: WordItem[]
  force?: boolean
  /** 只重跑这几项 */
  redo?: EnrichField[]
  canBackfillTags?: (w: WordItem) => boolean
  onBatchDone: (batch: WordItem[]) => Promise<void>
}

let lastProgressAt = 0

function looksStuck(): boolean {
  return running.value && lastProgressAt > 0 && Date.now() - lastProgressAt > 15 * 60_000
}
export const aiRunStuck = looksStuck

export async function startAiRun(opts: StartOptions): Promise<void> {
  if (running.value && !looksStuck()) return
  if (running.value) {
    console.warn('[AI 补全] 上一轮超过 5 分钟没有进展，判定为卡死，强制重开')
    stopFlag = true
  }
  running.value = true
  finished.value = false
  saved.value = 0
  errorMsg.value = ''
  stopFlag = false
  lastProgressAt = Date.now()
  progress.value = { done: 0, total: 0, current: '', failed: 0 }
  try {
    await enrichWordsWithAi(
      opts.targets,
      p => {
        progress.value = p
        lastProgressAt = Date.now()
      },
      {
        shouldStop: () => stopFlag,
        force: opts.force,
        redo: opts.redo,
        canBackfillTags: opts.canBackfillTags,
        onBatchDone: async batch => {
          await opts.onBatchDone(batch)
          saved.value += batch.length
          lastProgressAt = Date.now()
        }
      }
    )
    finished.value = true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    errorMsg.value = msg
    progress.value = { ...progress.value, current: '', lastError: msg }
  } finally {
    running.value = false
    lastProgressAt = 0
  }
}

export function stopAiRun() {
  stopFlag = true
}

export const aiRunState = {
  running: readonly(running),
  finished: readonly(finished),
  saved: readonly(saved),
  progress: readonly(progress),
  errorMsg: readonly(errorMsg)
}

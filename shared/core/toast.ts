/**
 * 全局通知。页面不再各自渲染 toast，统一由右下角 CornerStack 显示，
 * 与任务面板上下排开，不会互相遮挡。
 */
import { reactive } from 'vue'

export interface ToastItem { id: number; text: string; kind: 'info' | 'ok' | 'error' }

export const toasts = reactive<ToastItem[]>([])
let seq = 0

export function toast(text: string, kind: ToastItem['kind'] = 'info', ms = 4200) {
  if (!text) return
  // 同一句话不叠两条
  const dup = toasts.find(t => t.text === text)
  if (dup) return
  const id = ++seq
  toasts.push({ id, text, kind })
  if (toasts.length > 3) toasts.splice(0, toasts.length - 3)
  if (ms > 0) setTimeout(() => dismissToast(id), ms)
  return id
}

export function dismissToast(id: number) {
  const i = toasts.findIndex(t => t.id === id)
  if (i >= 0) toasts.splice(i, 1)
}

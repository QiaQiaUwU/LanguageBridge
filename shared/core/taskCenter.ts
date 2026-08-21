/**
 * 后台任务登记处。
 *
 * 之前每个功能各自把进度写进自己页面的一个 ref，于是：
 *  - 切走页面就看不到进度了
 *  - 多篇文章同时跑时，进度会串到别的文章那一行
 *  - 任务失败了没人说，只能干等
 *  - 跑完就消失，回头看不到结果
 *
 * 集中登记之后：右下角统一显示，每条带自己的 id 互不干扰；
 * 完成和失败的会**留在列表里等用户点掉**，不会跑完就没影。
 */
import { reactive } from 'vue'

export type TaskStatus = 'running' | 'done' | 'error'

export interface RunningTask {
  id: string
  /** 任务名，比如「对轴」「整理」「AI 补全」 */
  kind: string
  /** 关联对象，比如文章标题 */
  subject: string
  status: TaskStatus
  /** 0–1，没有确切进度就留空 */
  ratio?: number
  /** 当前在做什么 / 完成结果 / 失败原因 */
  detail?: string
  startedAt: number
  endedAt?: number
  /** 有的话，用户可以点「停止」 */
  cancel?: () => void
}

export const tasks = reactive<RunningTask[]>([])

/** 兼容旧名字 */
export const runningTasks = tasks

export function startTask(t: Omit<RunningTask, 'startedAt' | 'status'>): string {
  const rec: RunningTask = { ...t, status: 'running', startedAt: Date.now() }
  const i = tasks.findIndex(x => x.id === t.id)
  if (i >= 0) tasks.splice(i, 1, rec)
  else tasks.push(rec)
  return t.id
}

export function updateTask(id: string, patch: Partial<RunningTask>) {
  const t = tasks.find(x => x.id === id)
  if (t) Object.assign(t, patch)
}

/**
 * 任务成功结束。
 * 不从列表里删掉 —— 留一条「已完成」等用户点掉，
 * 否则后台跑完的东西用户根本不知道跑没跑过。
 */
export function finishTask(id: string, detail = '已完成') {
  const t = tasks.find(x => x.id === id)
  if (!t) return
  t.status = 'done'
  t.detail = detail
  t.ratio = 1
  t.endedAt = Date.now()
  t.cancel = undefined
}

/** 任务失败。同样留在列表里，把原因写清楚 */
export function failTask(id: string, reason: string) {
  const t = tasks.find(x => x.id === id)
  if (!t) return
  t.status = 'error'
  t.detail = reason
  t.endedAt = Date.now()
  t.cancel = undefined
}

/** 用户点掉某一条（确认看到了） */
export function dismissTask(id: string) {
  const i = tasks.findIndex(x => x.id === id)
  if (i >= 0) tasks.splice(i, 1)
}

/** 点掉所有已结束的 */
export function dismissFinished() {
  for (let i = tasks.length - 1; i >= 0; i--) {
    if (tasks[i].status !== 'running') tasks.splice(i, 1)
  }
}

/** 直接移除（任务被取消时用，不需要留痕） */
export function endTask(id: string) {
  dismissTask(id)
}

/** 某个对象上有没有任务在跑（用来只在对应的那一行显示进度） */
export function taskFor(subjectId: string): RunningTask | undefined {
  return tasks.find(x => x.id.endsWith(':' + subjectId) && x.status === 'running')
}

export function runningNum(): number {
  return tasks.filter(t => t.status === 'running').length
}

/**
 * 卡死检测：超过这个时间没有任何进度更新，就认为可能卡住了。
 * 只是提示，不自动杀 —— 有些长音频确实要跑很久。
 */
const STALL_MS = 3 * 60 * 1000

export function isStalled(t: RunningTask): boolean {
  if (t.status !== 'running') return false
  const last = (t as any).__lastTick || t.startedAt
  return Date.now() - last > STALL_MS
}

/** 每次有进度就打个时间戳，用来判断有没有卡住 */
export function tickTask(id: string) {
  const t = tasks.find(x => x.id === id)
  if (t) (t as any).__lastTick = Date.now()
}

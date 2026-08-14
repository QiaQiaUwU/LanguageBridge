/**
 * 后端同步状态。
 *
 * 所有 beSaveXxx 都是即发即忘、失败静默返回 null。后端没起、超时、CORS 挡掉
 * 的时候，数据只落在本地 IndexedDB 里，而 IndexedDB 是会坏的（浏览器数据目录
 * 被清理、磁盘满、异常断电）。两边都没有 = 数据没了，而且全程没有任何提示。
 *
 * 这里把每次同步的成败记下来，失败到一定数量就让界面报出来。
 */

export interface SyncStatus {
  ok: number
  failed: number
  lastError: string
  lastFailAt: number
  /** 最近一次成功的时间，0 表示这次会话里从没成功过 */
  lastOkAt: number
}

const status: SyncStatus = { ok: 0, failed: 0, lastError: '', lastFailAt: 0, lastOkAt: 0 }

type Listener = (s: SyncStatus) => void
const listeners = new Set<Listener>()

function emit() {
  for (const fn of listeners) {
    try {
      fn({ ...status })
    } catch {
      /* 监听器自己出错不该影响同步 */
    }
  }
}

export function onSyncStatus(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getSyncStatus(): SyncStatus {
  return { ...status }
}

export function markSyncOk() {
  status.ok++
  status.lastOkAt = Date.now()
  emit()
}

export function markSyncFailed(what: string) {
  status.failed++
  status.lastError = what
  status.lastFailAt = Date.now()
  emit()
}

export function resetSyncStatus() {
  status.ok = 0
  status.failed = 0
  status.lastError = ''
  status.lastFailAt = 0
  emit()
}

/**
 * 包一个即发即忘的同步调用：失败不抛出（不能因为备份失败就中断本地操作），
 * 但会被记进状态里。
 */
export function trackSync(what: string, p: Promise<boolean | unknown>): void {
  Promise.resolve(p)
    .then(r => {
      if (r === false || r === null) markSyncFailed(what)
      else markSyncOk()
    })
    .catch(() => markSyncFailed(what))
}

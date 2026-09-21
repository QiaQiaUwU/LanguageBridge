/**
 * localStorage 和 JSON 的兜底。
 *
 * 两类崩法在这个项目里都真实存在：
 * - setItem 在隐私模式、配额写满时直接抛，调用处大多没接，一抛就把整个流程打断
 *   （收藏按钮被永久禁用那个 bug 就是同一类）。
 * - 存坏的 JSON（写到一半断电、手动改过）会让 parse 抛，页面直接白屏。
 *
 * install() 在应用启动时把 Storage.prototype 的写入包一层，
 * 这样几十处散落的 setItem 不用逐个改；读取侧用 readJson 拿默认值。
 */

let installed = false

export function installStorageGuards(): void {
  if (installed || typeof Storage === 'undefined') return
  installed = true
  const proto = Storage.prototype
  const set = proto.setItem
  const remove = proto.removeItem
  proto.setItem = function (key: string, value: string) {
    try {
      set.call(this, key, value)
    } catch (e) {
      // 写不进去就算了：这些都是界面偏好、草稿一类，丢了不致命，但不能把流程打断
      console.warn(`[storage] 写入失败（${key}）：`, e)
    }
  }
  proto.removeItem = function (key: string) {
    try {
      remove.call(this, key)
    } catch (e) {
      console.warn(`[storage] 删除失败（${key}）：`, e)
    }
  }
}

/** 读 localStorage 里的 JSON，坏了就用默认值，并把坏数据清掉 */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null || raw === '') return fallback
    const v = JSON.parse(raw)
    return (v ?? fallback) as T
  } catch (e) {
    console.warn(`[storage] ${key} 里的内容坏了，按默认值处理：`, e)
    try { localStorage.removeItem(key) } catch { /* 删不掉就算了 */ }
    return fallback
  }
}

/** 解析来源不可控的 JSON（接口返回、导入的文件），坏了给默认值 */
export function parseJson<T>(text: string, fallback: T): T {
  try {
    const v = JSON.parse(text)
    return (v ?? fallback) as T
  } catch {
    return fallback
  }
}

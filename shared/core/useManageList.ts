/**
 * 可管理列表的统一交互（不依赖第三方拖拽库，Pointer Events 实现，
 * 原生 HTML5 拖拽在 <button> 上不稳定，所以不用它）。
 *
 *  - 平时：点击条目 = 打开
 *  - 长按 500ms 或右键：进入编辑状态（条目轻微抖动，显示 ✎ ×，末尾 ＋）
 *  - 编辑状态：按住条目拖动排序；点列表外或调用 exit() 退出
 *
 * 用法：
 *   const m = useManageList({ onMove: (from, to) => ... })
 *   <div :class="['ui-manage', { editing: m.editing.value }]" :ref="m.bindList">
 *     <div v-for="(x, i) in list" class="ui-manage-item" v-bind="m.itemAttrs(i)" @click="m.guardClick(() => open(x))">
 */
import { onBeforeUnmount, ref } from 'vue'

export interface ManageOptions {
  /** 把第 from 项移到第 to 项的位置（to 是移除 from 之前的下标语义：插到原 to 项之前） */
  onMove?: (from: number, to: number) => void
  longPressMs?: number
  /** 平时也允许直接拖（主列表需要） */
  dragWithoutEdit?: boolean
}

export function useManageList(opts: ManageOptions = {}) {
  const editing = ref(false)
  const dragIndex = ref(-1)
  const dropIndex = ref(-1)
  const dropAfter = ref(false)

  let listEl: HTMLElement | null = null
  let pressTimer: ReturnType<typeof setTimeout> | null = null
  let startX = 0
  let startY = 0
  let pendingIndex = -1
  let pointerId = -1
  let ghost: HTMLElement | null = null
  let suppressClick = false
  let offsetY = 0
  let offsetX = 0

  function bindList(el: any) { listEl = (el as HTMLElement) || null }

  function enter() { editing.value = true; document.addEventListener('pointerdown', onOutside, true) }
  function exit() { editing.value = false; document.removeEventListener('pointerdown', onOutside, true) }
  function onOutside(e: PointerEvent) {
    if (listEl && !listEl.contains(e.target as Node)) exit()
  }

  function clearPress() { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null } }

  function items(): HTMLElement[] {
    return listEl ? Array.from(listEl.querySelectorAll<HTMLElement>(':scope .ui-manage-item')) : []
  }

  function onDown(i: number, e: PointerEvent) {
    if (e.button !== 0) return
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, select, [data-no-drag]')) return
    startX = e.clientX; startY = e.clientY
    pendingIndex = i
    pointerId = e.pointerId
    clearPress()
    if (!editing.value) {
      pressTimer = setTimeout(() => { enter(); suppressClick = true }, opts.longPressMs ?? 500)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    window.addEventListener('pointercancel', onUp, { once: true })
  }

  function beginDrag(e: PointerEvent) {
    const el = items()[pendingIndex]
    if (!el) return
    const r = el.getBoundingClientRect()
    offsetX = e.clientX - r.left; offsetY = e.clientY - r.top
    ghost = el.cloneNode(true) as HTMLElement
    ghost.classList.add('ui-manage-ghost')
    ghost.classList.remove('ui-manage-item')
    ghost.style.width = r.width + 'px'
    ghost.style.left = r.left + 'px'
    ghost.style.top = r.top + 'px'
    document.body.appendChild(ghost)
    dragIndex.value = pendingIndex
    try { el.setPointerCapture?.(pointerId) } catch { /* 部分元素不支持 */ }
  }

  function onMove(e: PointerEvent) {
    const dx = e.clientX - startX, dy = e.clientY - startY
    const far = Math.hypot(dx, dy) > 6
    if (dragIndex.value < 0) {
      if (!far) return
      clearPress()
      if (!editing.value && !opts.dragWithoutEdit) return
      if (!opts.onMove) return
      beginDrag(e)
    }
    e.preventDefault()
    if (ghost) {
      ghost.style.left = e.clientX - offsetX + 'px'
      ghost.style.top = e.clientY - offsetY + 'px'
    }
    const els = items()
    let hit = -1, after = false
    for (let k = 0; k < els.length; k++) {
      const r = els[k].getBoundingClientRect()
      if (e.clientY >= r.top && e.clientY <= r.bottom) { hit = k; after = e.clientY > r.top + r.height / 2; break }
    }
    dropIndex.value = hit
    dropAfter.value = after
    autoScroll(e.clientY)
  }

  function autoScroll(y: number) {
    let p: HTMLElement | null = listEl
    while (p && p !== document.body) {
      const s = getComputedStyle(p)
      if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight) break
      p = p.parentElement
    }
    if (!p) return
    const r = p.getBoundingClientRect()
    if (y < r.top + 30) p.scrollTop -= 12
    else if (y > r.bottom - 30) p.scrollTop += 12
  }

  function onUp() {
    clearPress()
    window.removeEventListener('pointermove', onMove)
    if (dragIndex.value >= 0) {
      suppressClick = true
      const from = dragIndex.value
      let to = dropIndex.value
      if (to >= 0) {
        if (dropAfter.value) to += 1
        if (to > from) to -= 1
        if (to !== from) opts.onMove?.(from, to)
      }
    }
    ghost?.remove(); ghost = null
    dragIndex.value = -1; dropIndex.value = -1
    pendingIndex = -1
  }

  function itemAttrs(i: number) {
    return {
      class: {
        dragging: dragIndex.value === i,
        'drop-before': dragIndex.value >= 0 && dropIndex.value === i && !dropAfter.value,
        'drop-after': dragIndex.value >= 0 && dropIndex.value === i && dropAfter.value
      },
      onPointerdown: (e: PointerEvent) => onDown(i, e),
      onContextmenu: (e: MouseEvent) => { e.preventDefault(); enter() }
    }
  }

  /** 包一层点击：长按或拖动刚结束时吞掉这次 click */
  function guardClick(fn: () => void) {
    if (suppressClick) { suppressClick = false; return }
    if (editing.value) return
    fn()
  }

  onBeforeUnmount(() => { exit(); clearPress(); ghost?.remove() })

  return { editing, enter, exit, bindList, itemAttrs, guardClick, dragIndex }
}

/** 数组就地移动 */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const out = arr.slice()
  const [x] = out.splice(from, 1)
  out.splice(to, 0, x)
  return out
}

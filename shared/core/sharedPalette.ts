/**
 * 共用色卡。
 *
 * 这个软件里所有"自己挑的颜色"都从这一组里来：划线荧光笔、词汇宇宙的
 * 来源/话题/掌握度上色。做成一组而不是各处各配一个取色器，是因为它们本来
 * 就该是同一套视觉体系 —— 从一张图里取出来的颜色，用在划线上和用在星图上
 * 应该是同几个色。
 *
 * 模型照搬 MyLibrary 书房那套（frontend/home/js/30_theme.js）：
 *   色卡是一组颜色 → 可以整组另存、可以逐个改和删
 *   平时点一下色块是"上膛"，再点目标就把颜色赋过去
 *   图片取色的结果直接进色卡
 *
 * 存 localStorage。它是偏好不是资料，跟着这台机器走就够了。
 */

const KEY = 'lb-shared-palette'

/**
 * 出厂色卡。
 *
 * 取自划线高亮原来那六个色（暖黄/草绿/雾蓝/藕粉/淡紫/砖红），
 * 那组颜色在浅色正文上压得住又不刺眼，是这个项目里验证过的。
 */
export const DEFAULT_PALETTE = [
  '#e8c86a', '#8fbf7f', '#8fb0c9', '#d99fae', '#b49bd0', '#c98b6b'
]

export function readPalette(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return [...DEFAULT_PALETTE]
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr) || !arr.length) return [...DEFAULT_PALETTE]
    return arr.filter(c => typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c))
  } catch {
    return [...DEFAULT_PALETTE]
  }
}

export function savePalette(cols: string[]): void {
  try {
    // 去重但保留顺序：取色经常会出来两个很接近的，留一个就够
    const seen = new Set<string>()
    const out: string[] = []
    for (const c of cols) {
      const k = c.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      out.push(c)
    }
    localStorage.setItem(KEY, JSON.stringify(out.slice(0, 24)))
  } catch {
    /* 存不下就这次会话有效，不影响用 */
  }
}

export function resetPalette(): void {
  try { localStorage.removeItem(KEY) } catch { /* 忽略 */ }
}

/**
 * 把取到的一批颜色并进色卡。
 *
 * 是"并进"不是"替换"：从第二张图取色时，第一张图里挑中的那几个色
 * 不该凭空消失。想清空用重置。
 */
export function mergeIntoPalette(cols: string[]): string[] {
  const next = [...readPalette(), ...cols]
  savePalette(next)
  return readPalette()
}

/* ---------- 多套色卡 ---------- */

/**
 * 存好几套色卡，随时切换。
 *
 * 照 MyLibrary 书房那套做（bgPalSaveAs / 内置 + 用户色卡 / 下拉切换）：
 * 调出一套满意的颜色不容易，换个主题想换回来时不该从头再调一遍。
 * 内置的那套不可删；自己存的可以删。
 */
const SETS_KEY = 'lb-palette-sets'

export interface PaletteSet {
  name: string
  colors: string[]
  builtin?: boolean
}

const BUILTIN_SETS: PaletteSet[] = [
  { name: '默认', colors: [...DEFAULT_PALETTE], builtin: true },
  { name: '灰调', colors: ['#8a9099', '#a8b0b8', '#c3cad1', '#6f7780', '#565d66', '#dfe4e9'], builtin: true },
  { name: '暖木', colors: ['#c98b6b', '#e0b088', '#a9714f', '#d9c3a5', '#8a5a3c', '#f0dcc4'], builtin: true }
]

export function listPaletteSets(): PaletteSet[] {
  let mine: PaletteSet[] = []
  try {
    const raw = JSON.parse(localStorage.getItem(SETS_KEY) || '[]')
    if (Array.isArray(raw)) {
      mine = raw.filter(x => x && typeof x.name === 'string' && Array.isArray(x.colors))
    }
  } catch { /* 读坏了就只给内置的 */ }
  return [...BUILTIN_SETS, ...mine]
}

/** 把当前色卡另存成一套。同名覆盖 —— 那多半是想更新它 */
export function savePaletteSet(name: string, colors: string[]): void {
  const clean = name.trim()
  if (!clean) return
  if (BUILTIN_SETS.some(b => b.name === clean)) return   // 别占内置的名字
  try {
    const raw = JSON.parse(localStorage.getItem(SETS_KEY) || '[]')
    const mine: PaletteSet[] = Array.isArray(raw) ? raw : []
    const i = mine.findIndex(x => x.name === clean)
    const item = { name: clean, colors: [...colors] }
    if (i >= 0) mine[i] = item
    else mine.push(item)
    localStorage.setItem(SETS_KEY, JSON.stringify(mine.slice(0, 20)))
  } catch { /* 存不下就算了 */ }
}

export function deletePaletteSet(name: string): void {
  try {
    const raw = JSON.parse(localStorage.getItem(SETS_KEY) || '[]')
    const mine: PaletteSet[] = Array.isArray(raw) ? raw : []
    localStorage.setItem(SETS_KEY, JSON.stringify(mine.filter(x => x.name !== name)))
  } catch { /* 忽略 */ }
}

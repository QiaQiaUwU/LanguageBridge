/**
 * 分类树的标签覆盖层。
 *
 * 树是本地算出来的：按释义字符重合度聚类，标签取组内最常见的中文词条。
 * 这种标签是「挑出来的词」而不是「概括」，所以会出现「迁移·移居」下面是
 * twinkle、fire 这种看不懂的组合。
 *
 * 这里不动树的结构，只把标签换掉：
 * - 键用**成员词**算，不用节点 id —— id 里含标签，一改名就对不上了；
 *   成员不变，重启、换设备、重建索引之后仍然认得出是同一个节点。
 * - 覆盖层单独存，随时可以清掉回到算法原名。
 */
import { askAi } from './aiClient'
import { extractJsonArray } from './aiEnrich'
import { readJson } from './safeStorage'

const KEY = 'lb-tree-labels'

export interface TreeNodeLike {
  id: string
  label: string
  words?: string[]
  children?: TreeNodeLike[]
}

/** 成员词的稳定指纹（FNV-1a），跟顺序无关 */
export function nodeKey(words: string[]): string {
  const s = [...new Set(words.map(w => w.toLowerCase()))].sort().join(' ')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36) + '-' + s.length
}

let overrides: Record<string, string> | null = null
function load(): Record<string, string> {
  if (!overrides) overrides = readJson<Record<string, string>>(KEY, {})
  return overrides
}
function persist() {
  localStorage.setItem(KEY, JSON.stringify(load()))   // 写入失败已由 storage 守卫兜住
}

export function labelOverrideCount(): number { return Object.keys(load()).length }
export function clearLabelOverrides() { overrides = {}; persist() }

export function setNodeLabel(words: string[], label: string) {
  const l = label.trim()
  if (!l) return
  load()[nodeKey(words)] = l
  persist()
}

/** 把覆盖层套到一棵树上（就地改 label） */
export function applyLabelOverrides<T extends TreeNodeLike>(nodes: T[]): T[] {
  const map = load()
  const walk = (n: TreeNodeLike) => {
    if (n.words?.length) {
      const hit = map[nodeKey(n.words)]
      if (hit) n.label = hit
    }
    n.children?.forEach(walk)
  }
  nodes.forEach(walk)
  return nodes
}

export interface RenameTarget { key: string; label: string; words: string[]; level: number }

/**
 * 摊平出需要改名的节点。
 *
 * 只收第 3 层往下的：第 1、2 层是「人与社会」「环境」这种话题名，本来就是对的。
 * 成员太少的也跳过 —— 三四个词的组，标签写什么都差不多。
 */
export function collectRenameTargets(nodes: TreeNodeLike[], minWords = 4, fromLevel = 3): RenameTarget[] {
  const out: RenameTarget[] = []
  const walk = (n: TreeNodeLike, level: number) => {
    if (level >= fromLevel && (n.words?.length || 0) >= minWords) {
      out.push({ key: nodeKey(n.words!), label: n.label, words: n.words!, level })
    }
    n.children?.forEach(c => walk(c, level + 1))
  }
  nodes.forEach(n => walk(n, 1))
  // 同一批成员只问一次
  const seen = new Set<string>()
  return out.filter(t => (seen.has(t.key) ? false : (seen.add(t.key), true)))
}

export interface RenameProgress { done: number; total: number; current?: string }

export interface RenameResult {
  /** 这次新改好的节点数 */
  changed: number
  /** 这次要跑的节点数（已经梳理过的不算） */
  total: number
  /** 失败的批次 */
  failedBatches: number
  /** 最近一次失败的原因，直接给界面显示 */
  lastError?: string
  /** 连续失败提前停下了 */
  aborted?: boolean
}

const SYSTEM = `你在给英语单词的分类节点起名字。
规则：
1. 只看这组词本身，给一个概括它们共同点的中文标签。
2. 2 到 6 个汉字，不要标点、不要「的」「类」「相关」这种后缀，不要英文。
3. 概括不出共同点时，用这组里最有代表性的那个意思，不要编。
4. 只返回 JSON 数组，每项 {"i": 序号, "label": "标签"}，不要任何别的文字。`

/**
 * 把模型回复解析成「序号 → 标签」。
 *
 * 模型不一定照着 {"i","label"} 写：有的写 index / id，有的写 name，
 * 有的干脆回一个 {"0":"标签","1":"标签"}，还有的只给标签数组。
 * 之前只认 i + label，别的写法一律静默丢弃 —— 界面上就是「改好 0 个」，看不出原因。
 */
export function parseLabelReply(raw: string, batchLen: number): Map<number, string> {
  const out = new Map<number, string>()
  const put = (k: unknown, v: unknown) => {
    const i = Number(k)
    const label = String(v ?? '').trim().replace(/^["「『]|["」』]$/g, '')
    if (Number.isInteger(i) && i >= 0 && i < batchLen && label) out.set(i, label)
  }
  const text = String(raw || '').replace(/```json/gi, '').replace(/```/g, '').trim()
  let data: any = null
  try { data = JSON.parse(text) } catch {
    // 夹着解释文字：取最外层的 [..] 或 {..}
    for (const [o, c] of [['[', ']'], ['{', '}']]) {
      const a = text.indexOf(o), b = text.lastIndexOf(c)
      if (a >= 0 && b > a) { try { data = JSON.parse(text.slice(a, b + 1)); break } catch { /* 继续 */ } }
    }
  }
  if (!data) return out

  // {"labels":[...]} / {"result":[...]} 这种外包一层的
  if (!Array.isArray(data) && typeof data === 'object') {
    const inner = Object.values(data).find(v => Array.isArray(v))
    if (inner) data = inner
  }
  if (Array.isArray(data)) {
    data.forEach((item, pos) => {
      if (typeof item === 'string') return put(pos, item)
      if (!item || typeof item !== 'object') return
      const idx = item.i ?? item.index ?? item.idx ?? item.id ?? item.no ?? item['序号'] ?? pos
      const label = item.label ?? item.name ?? item.title ?? item['标签'] ?? item['名称']
      put(idx, label)
    })
  } else if (typeof data === 'object') {
    // {"0":"标签", "1":"标签"}
    for (const [k, v] of Object.entries(data)) if (typeof v === 'string') put(k, v)
  }
  return out
}

/**
 * 批量重命名。
 *
 * 一批 10 个节点、每个节点最多给 20 个词：再多模型只会看前面几个，
 * 还把上下文撑爆。每批跑完立刻存，中断了下次接着跑没跑过的。
 *
 * 失败不再静默吞掉：原因记进 lastError 交给界面；
 * 开头连续两批都失败（多半是没配 Key、模型名不对、模型不吐 JSON），
 * 直接停下报原因，不把几百批请求白白烧完。
 */
export async function renameTreeLabels(
  targets: RenameTarget[],
  onProgress?: (p: RenameProgress) => void,
  opts: { batchSize?: number; shouldStop?: () => boolean; wordZh?: (w: string) => string } = {}
): Promise<RenameResult> {
  const size = opts.batchSize ?? 10
  const map = load()
  const todo = targets.filter(t => !map[t.key])
  const res: RenameResult = { changed: 0, total: todo.length, failedBatches: 0 }
  let done = 0
  let streak = 0

  for (let i = 0; i < todo.length; i += size) {
    if (opts.shouldStop?.()) break
    const batch = todo.slice(i, i + size)
    const lines = batch.map((t, k) => {
      const words = t.words.slice(0, 20).map(w => {
        const zh = opts.wordZh?.(w)
        return zh ? `${w}(${zh.slice(0, 12)})` : w
      })
      return `${k}. 现名「${t.label}」：${words.join('、')}`
    })

    let got = 0
    let rejected = 0
    try {
      // 推理模型的思考也算输出配额，800 常常不够写完；askAi 截断时还会再加大一次
      const raw = await askAi(lines.join('\n'), SYSTEM, 2000, 90_000, true)
      const parsed = parseLabelReply(raw, batch.length)
      for (const [k, label] of parsed) {
        // 模型偶尔会把整句话塞回来，太长的不要
        if (label.length > 10 || /[，。,.;；:：]/.test(label)) { rejected++; continue }
        map[batch[k].key] = label
        got++
      }
      if (got) persist()
      else {
        res.lastError = parsed.size
          ? `回复里的 ${rejected} 个标签都太长或带标点，已丢弃`
          : `回复不是能读懂的 JSON：${String(raw || '（空）').trim().slice(0, 120)}`
      }
    } catch (e) {
      res.lastError = e instanceof Error ? e.message : String(e)
    }

    if (got) { res.changed += got; streak = 0 }
    else {
      res.failedBatches++
      streak++
      if (streak >= 2 && res.changed === 0) { res.aborted = true; break }
    }

    done += batch.length
    onProgress?.({ done, total: todo.length, current: batch[0]?.label })
  }
  return res
}

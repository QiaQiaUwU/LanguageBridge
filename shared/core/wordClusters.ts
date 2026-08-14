
export interface ClusterEdge {
  a: string
  b: string
  w: number
}

interface CompactGraph {
  n: number
  nb: number[][]
  nw: number[][]
  self: number[]
  deg: number[]
  m2: number
}

function buildCompact(n: number, edges: Array<{ a: number; b: number; w: number }>): CompactGraph {
  const nb: number[][] = Array.from({ length: n }, () => [])
  const nw: number[][] = Array.from({ length: n }, () => [])
  const self = new Array<number>(n).fill(0)
  const deg = new Array<number>(n).fill(0)
  let total = 0
  for (const e of edges) {
    total += e.w
    if (e.a === e.b) {
      self[e.a] += e.w
      deg[e.a] += 2 * e.w
      continue
    }
    nb[e.a].push(e.b); nw[e.a].push(e.w)
    nb[e.b].push(e.a); nw[e.b].push(e.w)
    deg[e.a] += e.w
    deg[e.b] += e.w
  }
  return { n, nb, nw, self, deg, m2: total * 2 || 1 }
}

function oneLevel(g: CompactGraph): { comm: Int32Array; moved: boolean } {
  const comm = new Int32Array(g.n)
  const tot = new Float64Array(g.n)
  for (let i = 0; i < g.n; i++) { comm[i] = i; tot[i] = g.deg[i] }

  let movedAny = false
  for (let round = 0; round < 20; round++) {
    let moved = false
    for (let i = 0; i < g.n; i++) {
      const ci = comm[i]
      const ki = g.deg[i]
      const wTo = new Map<number, number>()
      const nb = g.nb[i], nw = g.nw[i]
      for (let k = 0; k < nb.length; k++) {
        const c = comm[nb[k]]
        wTo.set(c, (wTo.get(c) || 0) + nw[k])
      }
      tot[ci] -= ki
      let bestC = ci
      let bestGain = (wTo.get(ci) || 0) - (tot[ci] * ki) / g.m2
      for (const [c, w] of wTo) {
        if (c === ci) continue
        const gain = w - (tot[c] * ki) / g.m2
        if (gain > bestGain + 1e-12) { bestGain = gain; bestC = c }
      }
      tot[bestC] += ki
      if (bestC !== ci) { comm[i] = bestC; moved = true; movedAny = true }
    }
    if (!moved) break
  }
  return { comm, moved: movedAny }
}

function renumber(comm: Int32Array): { map: Int32Array; count: number } {
  const seen = new Map<number, number>()
  const out = new Int32Array(comm.length)
  for (let i = 0; i < comm.length; i++) {
    let v = seen.get(comm[i])
    if (v === undefined) { v = seen.size; seen.set(comm[i], v) }
    out[i] = v
  }
  return { map: out, count: seen.size }
}

export function detectCommunities(words: string[], edges: ClusterEdge[]): Map<string, number> {
  const result = new Map<string, number>()

  const active = new Set<string>()
  for (const e of edges) {
    if (e.a !== e.b) { active.add(e.a); active.add(e.b) }
  }
  const known = new Set(words)
  const nodes = words.filter(w => active.has(w) && known.has(w))

  const idx = new Map<string, number>()
  nodes.forEach((w, i) => idx.set(w, i))

  const e0: Array<{ a: number; b: number; w: number }> = []
  for (const e of edges) {
    const a = idx.get(e.a), b = idx.get(e.b)
    if (a === undefined || b === undefined || a === b) continue
    e0.push({ a, b, w: e.w })
  }

  if (!e0.length) {
    words.forEach((w, i) => result.set(w, i))
    return result
  }

  let g = buildCompact(nodes.length, e0)
  let belong = new Int32Array(nodes.length)
  for (let i = 0; i < nodes.length; i++) belong[i] = i

  for (let level = 0; level < 8; level++) {
    const { comm, moved } = oneLevel(g)
    const { map, count } = renumber(comm)
    for (let i = 0; i < belong.length; i++) belong[i] = map[belong[i]]
    if (!moved || count === g.n) break

    const agg = new Map<number, number>()
    const key = (a: number, b: number) => (a < b ? a * count + b : b * count + a)
    for (let i = 0; i < g.n; i++) {
      const ci = map[i]
      if (g.self[i]) agg.set(key(ci, ci), (agg.get(key(ci, ci)) || 0) + g.self[i])
      const nb = g.nb[i], nw = g.nw[i]
      for (let k = 0; k < nb.length; k++) {
        const j = nb[k]
        if (j < i) continue // 每条边只算一次
        const cj = map[j]
        agg.set(key(ci, cj), (agg.get(key(ci, cj)) || 0) + nw[k])
      }
    }
    const nextEdges: Array<{ a: number; b: number; w: number }> = []
    for (const [k, w] of agg) {
      const a = Math.floor(k / count), b = k % count
      nextEdges.push({ a, b, w })
    }
    g = buildCompact(count, nextEdges)
  }

  nodes.forEach((w, i) => result.set(w, belong[i]))
  let next = nodes.length
  for (const w of words) if (!result.has(w)) result.set(w, next++)
  return result
}

export interface ConstellationInput {
  words: string[]
  edges: ClusterEdge[]
  limit: number
  pinned?: Set<string>
  communities?: Map<string, number>
}

export interface ConstellationResult {
  keep: string[]
  clusterOf: Map<string, string>
  cores: Set<string>
  clusterCount: number
  hidden: number
}

export function membersPerCluster(limit: number): number {
  if (limit <= 150) return 3
  if (limit <= 400) return 4
  if (limit <= 800) return 6
  if (limit <= 2000) return 8
  return 10
}

export function pickConstellations(input: ConstellationInput): ConstellationResult {
  const { words, edges, limit } = input
  const pinned = input.pinned || new Set<string>()

  const comm = input.communities ?? detectCommunities(words, edges)

  const wdeg = new Map<string, number>()
  for (const w of words) wdeg.set(w, 0)
  for (const e of edges) {
    if (!wdeg.has(e.a) || !wdeg.has(e.b)) continue
    wdeg.set(e.a, (wdeg.get(e.a) || 0) + e.w)
    wdeg.set(e.b, (wdeg.get(e.b) || 0) + e.w)
  }

  const groups = new Map<number, string[]>()
  for (const w of words) {
    const c = comm.get(w)
    if (c === undefined) continue
    const g = groups.get(c)
    if (g) g.push(w)
    else groups.set(c, [w])
  }

  const scoreOf = (w: string) =>
    (pinned.has(w.toLowerCase()) ? 1000 : 0) + (wdeg.get(w) || 0)

  const adj = new Map<string, Array<{ n: string; w: number }>>()
  for (const e of edges) {
    if (!wdeg.has(e.a) || !wdeg.has(e.b) || e.a === e.b) continue
    const la = adj.get(e.a); if (la) la.push({ n: e.b, w: e.w }); else adj.set(e.a, [{ n: e.b, w: e.w }])
    const lb = adj.get(e.b); if (lb) lb.push({ n: e.a, w: e.w }); else adj.set(e.b, [{ n: e.a, w: e.w }])
  }

  const orderFromCore = (core: string, members: string[]): string[] => {
    const inCluster = new Set(members)
    const order: string[] = [core]
    const taken = new Set<string>([core])
    const cand = new Map<string, number>()
    const offer = (from: string) => {
      for (const { n, w } of adj.get(from) || []) {
        if (!inCluster.has(n) || taken.has(n)) continue
        const s = w * 10 + scoreOf(n)
        if (s > (cand.get(n) ?? -1)) cand.set(n, s)
      }
    }
    offer(core)
    while (order.length < members.length) {
      let best = '', bestS = -1
      for (const [n, s] of cand) if (s > bestS) { bestS = s; best = n }
      if (!best) {
        let alt = '', altS = -1
        for (const m of members) {
          if (taken.has(m)) continue
          const s = scoreOf(m)
          if (s > altS) { altS = s; alt = m }
        }
        if (!alt) break
        best = alt
      }
      cand.delete(best)
      taken.add(best)
      order.push(best)
      offer(best)
    }
    return order
  }

  interface Cluster { core: string; members: string[]; weight: number }
  const clusters: Cluster[] = []
  for (const raw of groups.values()) {
    let core = raw[0]
    let best = -1
    for (const w of raw) { const s = scoreOf(w); if (s > best) { best = s; core = w } }
    const members = raw.length > 1 ? orderFromCore(core, raw) : raw.slice()
    clusters.push({
      core,
      members,
      weight:
        members.reduce((s, w) => s + (pinned.has(w.toLowerCase()) ? 100 : 0), 0) +
        members.reduce((s, w) => s + (wdeg.get(w) || 0), 0) +
        Math.min(members.length, 20) * 2
    })
  }
  clusters.sort((a, b) => {
    const sa = a.members.length > 1 ? 1 : 0
    const sb = b.members.length > 1 ? 1 : 0
    if (sa !== sb) return sb - sa
    return b.weight - a.weight
  })

  const cap = membersPerCluster(limit)
  const keep: string[] = []
  const clusterOf = new Map<string, string>()
  const cores = new Set<string>()
  let clusterCount = 0
  const taken = new Array<number>(clusters.length).fill(0)

  const takeFrom = (ci: number, n: number) => {
    const c = clusters[ci]
    const from = taken[ci]
    const to = Math.min(c.members.length, from + n)
    for (let i = from; i < to; i++) {
      keep.push(c.members[i])
      clusterOf.set(c.members[i], c.core)
    }
    if (from === 0 && to > 0) { cores.add(c.core); clusterCount++ }
    taken[ci] = to
    return to - from
  }

  for (let ci = 0; ci < clusters.length && keep.length < limit; ci++) {
    const room = limit - keep.length
    const c = clusters[ci]
    if (room < 2 && c.members.length > 1) continue
    takeFrom(ci, Math.min(cap, room))
  }

  let guard = 0
  while (keep.length < limit && guard++ < 200) {
    let added = 0
    for (let ci = 0; ci < clusters.length && keep.length < limit; ci++) {
      if (taken[ci] >= clusters[ci].members.length) continue
      added += takeFrom(ci, Math.min(cap, limit - keep.length))
    }
    if (!added) break // 所有团都取完了，范围内就这么多词
  }

  let hidden = 0
  for (let ci = 0; ci < clusters.length; ci++) hidden += clusters[ci].members.length - taken[ci]

  return { keep, clusterOf, cores, clusterCount, hidden }
}

export function filterConstellationLinks<T extends { source: string; target: string; weight?: number }>(
  links: T[],
  clusterOf: Map<string, string>,
  cores: Set<string>,
  maxBridges = 24
): { kept: T[]; bridges: Set<T> } {
  const kept: T[] = []
  const bridges = new Set<T>()
  const bestBridge = new Map<string, { link: T; w: number }>()

  for (const l of links) {
    const ca = clusterOf.get(l.source)
    const cb = clusterOf.get(l.target)
    if (ca === undefined || cb === undefined) continue
    if (ca === cb) { kept.push(l); continue }
    if (!cores.has(l.source) || !cores.has(l.target)) continue
    const key = ca < cb ? `${ca}\u0001${cb}` : `${cb}\u0001${ca}`
    const w = l.weight ?? 0.5
    const cur = bestBridge.get(key)
    if (!cur || w > cur.w) bestBridge.set(key, { link: l, w })
  }
  const top = [...bestBridge.values()].sort((a, b) => b.w - a.w).slice(0, maxBridges)
  for (const b of top) {
    kept.push(b.link)
    bridges.add(b.link)
  }
  return { kept, bridges }
}


function toHex(r: number, g: number, b: number): string {
  const one = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${one(r)}${one(g)}${one(b)}`
}

export interface PaletteOptions {
  sampleSize?: number
  clusters?: number
  max?: number
  minDistance?: number
}

export async function extractPaletteFromImage(file: File, opts: PaletteOptions = {}): Promise<string[]> {
  const S = opts.sampleSize ?? 72
  const K = opts.clusters ?? 16
  const MAX = opts.max ?? 16
  const MIN_D = opts.minDistance ?? 42

  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('这张图读不了'))
      im.src = url
    })

    const cv = document.createElement('canvas')
    cv.width = cv.height = S
    const ctx = cv.getContext('2d')
    if (!ctx) throw new Error('浏览器不支持 canvas，取不了色')
    ctx.drawImage(img, 0, 0, S, S)
    const data = ctx.getImageData(0, 0, S, S).data

    const pts: number[][] = []
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 200) pts.push([data[i], data[i + 1], data[i + 2]])
    }
    if (pts.length < K) throw new Error('这张图取不出足够的颜色')

    const cs: number[][] = [pts[0].slice()]
    while (cs.length < K) {
      let best: number[] | null = null
      let bd = -1
      for (let i = 0; i < pts.length; i += 7) {
        const p = pts[i]
        let m = Infinity
        for (const c of cs) {
          const dd = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2
          if (dd < m) m = dd
        }
        if (m > bd) { bd = m; best = p }
      }
      if (!best) break
      cs.push(best.slice())
    }

    for (let it = 0; it < 10; it++) {
      const sum = cs.map(() => [0, 0, 0, 0])
      for (const p of pts) {
        let bi = 0
        let bd = Infinity
        for (let i = 0; i < cs.length; i++) {
          const c = cs[i]
          const dd = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2
          if (dd < bd) { bd = dd; bi = i }
        }
        const t = sum[bi]
        t[0] += p[0]; t[1] += p[1]; t[2] += p[2]; t[3]++
      }
      sum.forEach((t, i) => { if (t[3]) cs[i] = [t[0] / t[3], t[1] / t[3], t[2] / t[3], t[3]] })
    }

    cs.sort((a, b) => (b[3] || 0) - (a[3] || 0))
    const picked: number[][] = []
    for (const c of cs) {
      if (picked.length >= MAX) break
      const hx = [c[0], c[1], c[2]]
      const tooClose = picked.some(
        o => Math.abs(o[0] - hx[0]) + Math.abs(o[1] - hx[1]) + Math.abs(o[2] - hx[2]) < MIN_D
      )
      if (!tooClose) picked.push(hx)
    }

    const cols = picked.map(c => toHex(c[0], c[1], c[2]))
    if (cols.length < 3) throw new Error('这张图取不出足够的颜色（颜色太单一）')
    return cols
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function ensureVisibleOnDark(colors: string[], minLuma = 96): string[] {
  return colors.map(hex => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
    if (!m) return hex
    const n = parseInt(m[1], 16)
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
    const luma = 0.299 * r + 0.587 * g + 0.114 * b
    if (luma >= minLuma) return hex
    const k = luma < 1 ? 1 : minLuma / luma
    r = Math.min(255, r * k); g = Math.min(255, g * k); b = Math.min(255, b * k)
    return toHex(r, g, b)
  })
}

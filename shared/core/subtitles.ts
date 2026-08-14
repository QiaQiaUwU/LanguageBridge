
export interface Cue {
  start: number
  end: number
  text: string
}

function parseTime(s: string): number {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/.exec(s.trim())
  if (!m) return NaN
  const h = Number(m[1] || 0)
  const min = Number(m[2])
  const sec = Number(m[3])
  const ms = Number(m[4].padEnd(3, '0'))
  return h * 3600 + min * 60 + sec + ms / 1000
}

function cleanText(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/^\s*-\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseSubtitles(raw: string): Cue[] {
  const text = raw.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '')
  const out: Cue[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const arrow = lines[i].indexOf('-->')
    if (arrow < 0) continue
    const start = parseTime(lines[i].slice(0, arrow))
    const rest = lines[i].slice(arrow + 3).trim().split(/\s+/)[0]
    const end = parseTime(rest)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue

    const body: string[] = []
    let j = i + 1
    while (j < lines.length && lines[j].trim() !== '' && lines[j].indexOf('-->') < 0) {
      body.push(lines[j])
      j++
    }
    if (body.length > 1 && /^\d+$/.test(body[body.length - 1].trim()) &&
        j < lines.length && lines[j].includes('-->')) {
      body.pop()
      j--
    }
    const t = cleanText(body.join(' '))
    if (t) out.push({ start, end, text: t })
    i = j - 1
  }
  return out
}

export function alignCuesToSentences(
  sentences: Array<{ en: string }>,
  cues: Cue[]
): Array<{ start: number; end: number } | null> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const out: Array<{ start: number; end: number } | null> = sentences.map(() => null)

  let ci = 0
  for (let si = 0; si < sentences.length; si++) {
    const target = norm(sentences[si].en)
    if (!target) continue
    let acc = ''
    let first = -1
    let last = -1
    for (let k = ci; k < cues.length; k++) {
      const piece = norm(cues[k].text)
      if (!piece) continue
      if (first < 0) {
        if (!target.startsWith(piece.slice(0, Math.min(8, piece.length))) &&
            !piece.startsWith(target.slice(0, Math.min(8, target.length)))) {
          continue
        }
        first = k
      }
      acc += piece
      last = k
      if (acc.length >= target.length) break
    }
    if (first >= 0 && last >= 0) {
      out[si] = { start: cues[first].start, end: cues[last].end }
      ci = last + 1
    }
  }
  return out
}

export function estimateTimings(
  sentences: Array<{ en: string }>,
  duration: number
): Array<{ start: number; end: number }> {
  const weights = sentences.map(s => Math.max(1, s.en.trim().length))
  const total = weights.reduce((a, b) => a + b, 0) || 1
  let t = 0
  return weights.map(w => {
    const d = (w / total) * duration
    const seg = { start: t, end: t + d }
    t += d
    return seg
  })
}

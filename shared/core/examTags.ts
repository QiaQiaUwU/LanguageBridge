
export const EXAM_TAGS = ['初中', '高中', 'CET4', 'CET6', '考研', '雅思', '托福', 'SAT', 'GRE']

const ALIAS: Record<string, string> = {
  'cet-4': 'CET4',
  'cet 4': 'CET4',
  cet4: 'CET4',
  四级: 'CET4',
  'cet-6': 'CET6',
  'cet 6': 'CET6',
  cet6: 'CET6',
  六级: 'CET6',
  toefl: '托福',
  ielts: '雅思',
  gre: 'GRE',
  sat: 'SAT',
  高考: '高中',
  中考: '初中'
}

export function canonicalExamTag(tag: string): string {
  const raw = String(tag ?? '').trim()
  if (!raw) return ''
  const key = raw.toLowerCase().replace(/\s+/g, ' ')
  return ALIAS[key] || raw
}

export function canonicalExamTags(tags: (string | undefined)[] | undefined): string[] {
  if (!tags?.length) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of tags) {
    const c = canonicalExamTag(String(t ?? ''))
    if (!c || seen.has(c)) continue
    seen.add(c)
    out.push(c)
  }
  return out
}

export function needsCanonicalize(tags: string[] | undefined): boolean {
  if (!tags?.length) return false
  const next = canonicalExamTags(tags)
  return next.length !== tags.length || next.some((t, i) => t !== tags[i])
}

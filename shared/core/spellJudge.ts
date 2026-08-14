
const VARIANT_RULES: Array<[RegExp, string]> = [
  [/our\b/g, 'or'],
  [/is(e|ed|es|ing|ation|ations)\b/g, 'iz$1'],
  [/ys(e|ed|es|ing)\b/g, 'yz$1'],
  [/([^aeiou])re\b/g, '$1er'],
  [/ogue\b/g, 'og'],
  [/ll(ed|ing|er|ers)\b/g, 'l$1'],
  [/ence\b/g, 'ense'],
  [/\bae/g, 'e'],
  [/\boe/g, 'e'],
  [/aeo/g, 'eo'],
  [/gramme\b/g, 'gram']
]

export interface SpellJudgeOptions {
  ignoreCase?: boolean
  ignoreSymbol?: boolean
  allowVariant?: boolean
}

function normalize(s: string, o: SpellJudgeOptions): string {
  let v = String(s ?? '').trim()
  if (o.ignoreCase !== false) v = v.toLowerCase()
  if (o.ignoreSymbol) v = v.replace(/[^a-z0-9]/gi, '')
  else v = v.replace(/[^a-z0-9' -]/gi, '').replace(/\s+/g, ' ')
  return v
}

function foldVariant(s: string): string {
  let v = s
  for (const [re, rep] of VARIANT_RULES) v = v.replace(re, rep)
  return v
}

export function isSpellingCorrect(input: string, answer: string, o: SpellJudgeOptions = {}): boolean {
  const a = normalize(input, o)
  const b = normalize(answer, o)
  if (!a) return false
  if (a === b) return true
  if (o.allowVariant === false) return false
  return foldVariant(a) === foldVariant(b)
}

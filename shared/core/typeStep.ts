export interface TypeState {
  input: string
  wrong: string
  inputLock: boolean
  waitClear: boolean
}

export interface TypeOpts {
  ignoreCase: boolean
  inputWrongClear: boolean
}

export interface TypeKey {
  key: string
  code: string
  shiftKey: boolean
}

export type TypeAction =
  | { kind: 'ignored' }
  | { kind: 'right'; state: TypeState }
  | { kind: 'wrong'; state: TypeState }
  | { kind: 'complete'; state: TypeState }

const SHIFT_MAP: Record<string, string> = {
  Digit1: '！', Digit4: '￥', Digit6: '…', Digit9: '（', Digit0: '）',
  Minus: '—', Slash: '？', Period: '》', Comma: '《', Semicolon: '：'
}

const PLAIN_MAP: Record<string, string> = {
  Slash: '、', Period: '。', Comma: '，', Semicolon: '；',
  BracketLeft: '【', BracketRight: '】'
}

function matchesPunctuation(expect: string, e: TypeKey): boolean {
  if (e.shiftKey) {
    if (e.code === 'Quote') return expect === '“' || expect === '”'
    return SHIFT_MAP[e.code] === expect
  }
  if (e.code === 'Quote') return expect === '‘' || expect === '’'
  return PLAIN_MAP[e.code] === expect
}

export function typeStep(
  st: TypeState,
  e: TypeKey,
  target: string,
  opts: TypeOpts
): TypeAction {
  if (st.waitClear) return { kind: 'ignored' }

  const expect = target[st.input.length]
  if (expect === undefined) return { kind: 'ignored' }

  let letter = e.key
  let right = opts.ignoreCase
    ? letter.toLowerCase() === expect.toLowerCase()
    : letter === expect

  if (!right && matchesPunctuation(expect, e)) {
    right = true
    letter = expect
  }

  if (right) {
    const input = st.input + letter
    const next: TypeState = { input, wrong: '', inputLock: true, waitClear: false }
    if (input.toLowerCase() === target.toLowerCase()) {
      return { kind: 'complete', state: next }
    }
    next.inputLock = false
    return { kind: 'right', state: next }
  }

  return {
    kind: 'wrong',
    state: { input: st.input, wrong: letter, inputLock: true, waitClear: true }
  }
}

export function clearAfterWrong(st: TypeState, opts: TypeOpts): TypeState {
  return {
    input: opts.inputWrongClear ? '' : st.input,
    wrong: '',
    inputLock: false,
    waitClear: false
  }
}

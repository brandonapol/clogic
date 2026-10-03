export type SecretInput =
  | { readonly kind: 'typing'; readonly buffer: string }
  | { readonly kind: 'submitted'; readonly value: string }
  | { readonly kind: 'cancelled' }

export const emptySecret: SecretInput = { kind: 'typing', buffer: '' }

const interrupt = '\u0003'
const endOfInput = '\u0004'
const erase: ReadonlySet<string> = new Set(['\u007f', '\b'])
const enter: ReadonlySet<string> = new Set(['\r', '\n'])

const escapeSequence = new RegExp(
  `${String.fromCharCode(27)}(?:\\[[0-9;]*[~A-Za-z]|O[A-Za-z]|.)?`,
  'g',
)

const isPrintable = (char: string): boolean => char >= ' ' && char !== '\u007f'

const typeChar = (state: SecretInput, char: string): SecretInput => {
  if (state.kind !== 'typing') return state
  if (char === interrupt) return { kind: 'cancelled' }
  if (char === endOfInput)
    return state.buffer.length === 0
      ? { kind: 'cancelled' }
      : { kind: 'submitted', value: state.buffer }
  if (enter.has(char)) return { kind: 'submitted', value: state.buffer }
  if (erase.has(char)) return { kind: 'typing', buffer: [...state.buffer].slice(0, -1).join('') }
  return isPrintable(char) ? { kind: 'typing', buffer: state.buffer + char } : state
}

export const typeSecret = (state: SecretInput, chunk: string): SecretInput =>
  [...chunk.replace(escapeSequence, '')].reduce(typeChar, state)

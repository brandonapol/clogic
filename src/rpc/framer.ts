export const defaultMaxLineBytes = 1024 * 1024

export type FramerState = {
  readonly maxLineBytes: number
  readonly pending: Uint8Array
  readonly discarding: boolean
  readonly discarded: number
}

export type FrameEvent =
  | { readonly kind: 'line'; readonly line: string }
  | { readonly kind: 'oversized'; readonly bytes: number }
  | { readonly kind: 'invalid_utf8'; readonly bytes: number }
  | { readonly kind: 'truncated'; readonly bytes: number }

export type FrameStep = {
  readonly state: FramerState
  readonly events: readonly FrameEvent[]
}

const newline = 0x0a
const carriageReturn = 0x0d
const empty = new Uint8Array(0)
const utf8 = new TextDecoder('utf-8', { fatal: true })

export const createFramer = (maxLineBytes: number = defaultMaxLineBytes): FramerState => ({
  maxLineBytes,
  pending: empty,
  discarding: false,
  discarded: 0,
})

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const joined = new Uint8Array(a.length + b.length)
  joined.set(a, 0)
  joined.set(b, a.length)
  return joined
}

const decodeLine = (bytes: Uint8Array): FrameEvent | undefined => {
  const end = bytes.at(-1) === carriageReturn ? bytes.length - 1 : bytes.length
  try {
    const line = utf8.decode(bytes.subarray(0, end))
    return line.trim().length === 0 ? undefined : { kind: 'line', line }
  } catch {
    return { kind: 'invalid_utf8', bytes: bytes.length }
  }
}

const completeLine = (state: FramerState, segment: Uint8Array): FrameEvent | undefined => {
  if (state.discarding) return { kind: 'oversized', bytes: state.discarded + segment.length }
  const total = state.pending.length + segment.length
  if (total > state.maxLineBytes) return { kind: 'oversized', bytes: total }
  return decodeLine(concat(state.pending, segment))
}

const holdRemainder = (state: FramerState, rest: Uint8Array): FramerState => {
  if (state.discarding) return { ...state, discarded: state.discarded + rest.length }
  const total = state.pending.length + rest.length
  if (total > state.maxLineBytes)
    return { ...state, pending: empty, discarding: true, discarded: total }
  return { ...state, pending: concat(state.pending, rest) }
}

export const pushChunk = (state: FramerState, chunk: Uint8Array): FrameStep => {
  const events: FrameEvent[] = []
  let current = state
  let start = 0
  for (let end = chunk.indexOf(newline); end !== -1; end = chunk.indexOf(newline, start)) {
    const event = completeLine(current, chunk.subarray(start, end))
    if (event !== undefined) events.push(event)
    current = { ...current, pending: empty, discarding: false, discarded: 0 }
    start = end + 1
  }
  return { state: holdRemainder(current, chunk.subarray(start)), events }
}

export const endFramer = (state: FramerState): readonly FrameEvent[] => {
  if (state.discarding) return [{ kind: 'oversized', bytes: state.discarded }]
  if (state.pending.length === 0) return []
  return [{ kind: 'truncated', bytes: state.pending.length }]
}

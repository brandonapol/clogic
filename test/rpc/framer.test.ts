import { describe, expect, it } from 'vitest'
import {
  createFramer,
  endFramer,
  pushChunk,
  type FrameEvent,
  type FramerState,
} from '../../src/rpc/framer.js'

const bytes = (text: string) => new TextEncoder().encode(text)

const feed = (chunks: readonly Uint8Array[], state: FramerState = createFramer()) =>
  chunks.reduce<{ state: FramerState; events: readonly FrameEvent[] }>(
    (acc, chunk) => {
      const step = pushChunk(acc.state, chunk)
      return { state: step.state, events: [...acc.events, ...step.events] }
    },
    { state, events: [] },
  )

const lines = (events: readonly FrameEvent[]) =>
  events.flatMap((event) => (event.kind === 'line' ? [event.line] : []))

describe('pushChunk', () => {
  it('emits one line per newline-terminated message', () => {
    expect(feed([bytes('{"a":1}\n')]).events).toEqual([{ kind: 'line', line: '{"a":1}' }])
  })

  it('splits several messages delivered in one chunk', () => {
    expect(lines(feed([bytes('{"a":1}\n{"b":2}\n{"c":3}\n')]).events)).toEqual([
      '{"a":1}',
      '{"b":2}',
      '{"c":3}',
    ])
  })

  it('reassembles a message split across chunks, holding the tail', () => {
    const { state, events } = feed([bytes('{"a"'), bytes(':1}\n{"b"'), bytes(':2')])
    expect(lines(events)).toEqual(['{"a":1}'])
    expect(lines(pushChunk(state, bytes('}\n')).events)).toEqual(['{"b":2}'])
  })

  it('reassembles a multi-byte UTF-8 character split between chunks', () => {
    const encoded = bytes('{"t":"Ünïcødé 🎚"}\n')
    const chunks = Array.from(encoded, (byte) => Uint8Array.of(byte))
    expect(lines(feed(chunks).events)).toEqual(['{"t":"Ünïcødé 🎚"}'])
  })

  it('strips a trailing carriage return and skips blank lines', () => {
    expect(lines(feed([bytes('\n  \n{"a":1}\r\n\r\n')]).events)).toEqual(['{"a":1}'])
  })

  it('reports invalid UTF-8 without stopping later lines', () => {
    const chunk = new Uint8Array([0xff, 0xfe, 0x0a, ...bytes('{"ok":true}\n')])
    expect(feed([chunk]).events).toEqual([
      { kind: 'invalid_utf8', bytes: 2 },
      { kind: 'line', line: '{"ok":true}' },
    ])
  })

  it('handles many lines in a single chunk', () => {
    const count = 50_000
    expect(feed([bytes('{}\n'.repeat(count))]).events).toHaveLength(count)
  })

  it('does not mutate the previous state or keep a view of the input chunk', () => {
    const start = createFramer()
    const chunk = bytes('{"a"')
    const { state } = feed([chunk], start)
    chunk.fill(0x20)
    expect(start.pending).toHaveLength(0)
    expect(lines(pushChunk(state, bytes(':1}\n')).events)).toEqual(['{"a":1}'])
  })
})

describe('oversized lines', () => {
  it('accepts a line exactly at the limit', () => {
    const framer = createFramer(7)
    expect(lines(feed([bytes('{"a":1}\n')], framer).events)).toEqual(['{"a":1}'])
  })

  it('drops a complete line over the limit and keeps the next one', () => {
    const framer = createFramer(8)
    expect(feed([bytes('{"a":"too long"}\n{"b":2}\n')], framer).events).toEqual([
      { kind: 'oversized', bytes: 16 },
      { kind: 'line', line: '{"b":2}' },
    ])
  })

  it('discards an oversized line spread over many chunks without buffering it', () => {
    const framer = createFramer(16)
    const { state, events } = feed(
      [bytes('{"a":"'), bytes('x'.repeat(40)), bytes('x'.repeat(40))],
      framer,
    )
    expect(events).toEqual([])
    expect(state.pending).toHaveLength(0)
    expect(state.discarding).toBe(true)
    expect(feed([bytes('"}\n{"b":2}\n')], state).events).toEqual([
      { kind: 'oversized', bytes: 88 },
      { kind: 'line', line: '{"b":2}' },
    ])
  })
})

describe('endFramer', () => {
  it('reports nothing when the stream ended on a line boundary', () => {
    expect(endFramer(feed([bytes('{}\n')]).state)).toEqual([])
  })

  it('reports a truncated final message', () => {
    expect(endFramer(feed([bytes('{}\n{"a"')]).state)).toEqual([{ kind: 'truncated', bytes: 4 }])
  })

  it('reports an oversized message cut off by the end of the stream', () => {
    expect(endFramer(feed([bytes('x'.repeat(10))], createFramer(4)).state)).toEqual([
      { kind: 'oversized', bytes: 10 },
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { emptySecret, typeSecret, type SecretInput } from '../../src/cli/secret.js'

const typeAll = (...chunks: readonly string[]): SecretInput =>
  chunks.reduce(typeSecret, emptySecret)

describe('typeSecret', () => {
  it('collects typed characters until enter', () => {
    expect(typeAll('test-', 'key', '\r')).toEqual({ kind: 'submitted', value: 'test-key' })
    expect(typeAll('test-key-openai\n')).toEqual({ kind: 'submitted', value: 'test-key-openai' })
  })

  it('keeps typing until a line ends', () => {
    expect(typeAll('test')).toEqual({ kind: 'typing', buffer: 'test' })
  })

  it('erases with backspace and delete', () => {
    expect(typeAll('testx\u007f', 'y\b', '\r')).toEqual({ kind: 'submitted', value: 'test' })
    expect(typeAll('\u007f\r')).toEqual({ kind: 'submitted', value: '' })
  })

  it('cancels on ctrl-c and on ctrl-d with nothing typed', () => {
    expect(typeAll('test\u0003')).toEqual({ kind: 'cancelled' })
    expect(typeAll('\u0004')).toEqual({ kind: 'cancelled' })
    expect(typeAll('test\u0004')).toEqual({ kind: 'submitted', value: 'test' })
  })

  it('drops control characters and escape sequences such as arrows and bracketed paste', () => {
    expect(typeAll('te\u001b[D', 'st\t', '\u001b[200~-key\u001b[201~', '\r')).toEqual({
      kind: 'submitted',
      value: 'test-key',
    })
  })

  it('ignores input after the secret is submitted', () => {
    expect(typeAll('test\rmore')).toEqual({ kind: 'submitted', value: 'test' })
  })
})

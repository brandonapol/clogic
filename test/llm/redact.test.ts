import { describe, expect, it } from 'vitest'
import { redactHeaders, redactSecrets } from '../../src/llm/redact.js'

describe('redactSecrets', () => {
  it('replaces every occurrence of a known secret', () => {
    expect(redactSecrets('a SECRETVALUE b SECRETVALUE', ['SECRETVALUE'])).toBe(
      'a [REDACTED] b [REDACTED]',
    )
  })

  it.each([
    'sk-ant-api03-abcdefghijklmnop',
    'sk-proj-abcdefghijklmnop',
    'sk-abcdefghijklmnopqrstu',
    'xai-abcdefghijklmnopqrst',
  ])('redacts key-shaped text %s even when the key is not known', (key) => {
    expect(redactSecrets(`key=${key} end`, [])).toBe('key=[REDACTED] end')
  })

  it('ignores empty secrets', () => {
    expect(redactSecrets('hello', [''])).toBe('hello')
  })
})

describe('redactHeaders', () => {
  it('hides auth headers regardless of case', () => {
    expect(
      redactHeaders({ Authorization: 'Bearer x', 'x-api-key': 'y', 'content-type': 'json' }),
    ).toEqual({ Authorization: '[REDACTED]', 'x-api-key': '[REDACTED]', 'content-type': 'json' })
  })
})

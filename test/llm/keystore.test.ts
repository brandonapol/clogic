import { describe, expect, it } from 'vitest'
import { memoryKeyStore, normalizeApiKey } from '../../src/llm/keystore.js'

describe('normalizeApiKey', () => {
  it('trims surrounding whitespace from a pasted key', () => {
    expect(normalizeApiKey('  sk-abc123\n')).toEqual({ ok: true, value: 'sk-abc123' })
  })

  it.each(['', '   ', 'sk-abc 123', 'sk-abc\n123', 'sk-é', 'x'.repeat(513)])(
    'rejects %j',
    (raw) => {
      expect(normalizeApiKey(raw).ok).toBe(false)
    },
  )
})

describe('memoryKeyStore', () => {
  it('stores, reads and removes keys per provider', async () => {
    const store = memoryKeyStore({ xai: 'xai-existing' })
    expect(await store.get('xai')).toEqual({ ok: true, value: 'xai-existing' })
    expect(await store.get('openai')).toEqual({ ok: true, value: undefined })
    expect(await store.set('openai', ' sk-new ')).toEqual({ ok: true, value: undefined })
    expect(await store.get('openai')).toEqual({ ok: true, value: 'sk-new' })
    await store.remove('xai')
    expect(await store.get('xai')).toEqual({ ok: true, value: undefined })
  })

  it('refuses an invalid key without storing it', async () => {
    const store = memoryKeyStore()
    expect((await store.set('anthropic', 'two words')).ok).toBe(false)
    expect(await store.get('anthropic')).toEqual({ ok: true, value: undefined })
  })
})

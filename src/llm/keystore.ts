import { err, ok, type Result } from './result.js'
import type { ProviderId } from './types.js'

export type KeyStoreErrorKind = 'invalid_key' | 'unavailable' | 'command_failed'

export type KeyStoreError = {
  readonly kind: KeyStoreErrorKind
  readonly message: string
}

export type KeyStore = {
  readonly get: (provider: ProviderId) => Promise<Result<string | undefined, KeyStoreError>>
  readonly set: (provider: ProviderId, apiKey: string) => Promise<Result<void, KeyStoreError>>
  readonly remove: (provider: ProviderId) => Promise<Result<void, KeyStoreError>>
}

const maxKeyLength = 512
const printableAscii = /^[\x21-\x7e]+$/

export const normalizeApiKey = (raw: string): Result<string, KeyStoreError> => {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return err({ kind: 'invalid_key', message: 'The API key is empty.' })
  if (trimmed.length > maxKeyLength) {
    return err({ kind: 'invalid_key', message: 'The API key is too long.' })
  }
  if (!printableAscii.test(trimmed)) {
    return err({
      kind: 'invalid_key',
      message: 'The API key contains spaces, line breaks or other unexpected characters.',
    })
  }
  return ok(trimmed)
}

export const memoryKeyStore = (
  initial: Readonly<Partial<Record<ProviderId, string>>> = {},
): KeyStore => {
  const keys = new Map<ProviderId, string>(
    Object.entries(initial).flatMap(([provider, key]) =>
      key === undefined ? [] : [[provider as ProviderId, key] as const],
    ),
  )
  return {
    get: async (provider) => ok(keys.get(provider)),
    set: async (provider, apiKey) => {
      const normalized = normalizeApiKey(apiKey)
      if (!normalized.ok) return normalized
      keys.set(provider, normalized.value)
      return ok(undefined)
    },
    remove: async (provider) => {
      keys.delete(provider)
      return ok(undefined)
    },
  }
}

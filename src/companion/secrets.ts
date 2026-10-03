import type { KeyStore } from '../llm/keystore.js'

export type SecretCache = {
  readonly list: () => readonly string[]
  readonly remember: (secret: string) => void
}

export const secretCache = (): SecretCache => {
  const secrets = new Set<string>()
  return {
    list: () => [...secrets],
    remember: (secret) => {
      const trimmed = secret.trim()
      if (secret.length > 0) secrets.add(secret)
      if (trimmed.length > 0) secrets.add(trimmed)
    },
  }
}

export const trackingKeyStore = (store: KeyStore, cache: SecretCache): KeyStore => ({
  get: async (provider) => {
    const key = await store.get(provider)
    if (key.ok && key.value !== undefined) cache.remember(key.value)
    return key
  },
  set: async (provider, apiKey) => {
    cache.remember(apiKey)
    return store.set(provider, apiKey)
  },
  remove: (provider) => store.remove(provider),
})

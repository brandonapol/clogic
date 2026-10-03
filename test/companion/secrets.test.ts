import { describe, expect, it } from 'vitest'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import { readPackageVersion, systemEnvironment } from '../../src/companion/environment.js'
import { secretCache, trackingKeyStore } from '../../src/companion/secrets.js'
import { memoryKeyStore } from '../../src/llm/keystore.js'

const fakeKey = (seed: string) => [seed, 'unit', 'fixture', seed.repeat(12)].join('_')

describe('trackingKeyStore', () => {
  it('remembers keys it reads and keys it is asked to save', async () => {
    const stored = fakeKey('Qa')
    const saved = fakeKey('Zb')
    const cache = secretCache()
    const store = trackingKeyStore(memoryKeyStore({ anthropic: stored }), cache)

    expect(cache.list()).toEqual([])
    await store.get('anthropic')
    await store.set('openai', `  ${saved}\n`)

    expect(cache.list()).toEqual(expect.arrayContaining([stored, saved]))
    expect(await store.get('openai')).toEqual({ ok: true, value: saved })
  })

  it('remembers a key even when saving it fails', async () => {
    const cache = secretCache()
    const rejected = `${fakeKey('Xc')} with spaces`
    const result = await trackingKeyStore(memoryKeyStore(), cache).set('xai', rejected)
    expect(result.ok).toBe(false)
    expect(cache.list()).toContain(rejected)
  })
})

describe('systemEnvironment', () => {
  it('reports the package version, node version and OS details', () => {
    const packageJson: unknown = JSON.parse(readFileSync('package.json', 'utf8'))
    const environment = systemEnvironment()
    expect(environment.versions).toEqual({
      clogic: (packageJson as { version: string }).version,
      node: process.versions.node,
    })
    expect(Object.keys(environment.os)).toEqual(['platform', 'release', 'arch'])
    expect(environment.os['platform']).toBe(process.platform)
  })

  it('falls back to unknown when package.json cannot be read', () => {
    expect(readPackageVersion(pathToFileURL(join(tmpdir(), 'clogic-missing', 'p.json')))).toBe(
      'unknown',
    )
  })
})

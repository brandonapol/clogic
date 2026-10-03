import { describe, expect, it } from 'vitest'
import {
  basenamesOnly,
  circularMarker,
  contentOmittedMarker,
  isSensitiveKey,
  omitContent,
  redactFields,
  scrubPaths,
  toJsonSafe,
  truncatedMarker,
} from '../../src/log/redact.js'
import { anthropicLike, bearer, openAiLike, xaiLike } from './fixtures.js'

describe('isSensitiveKey', () => {
  it.each([
    'apiKey',
    'api_key',
    'x-api-key',
    'APIKey',
    'Authorization',
    'accessToken',
    'refresh_token',
    'clientSecret',
    'password',
    'privateKey',
    'Cookie',
    'credentials',
  ])('treats %s as sensitive', (key) => {
    expect(isSensitiveKey(key)).toBe(true)
  })

  it.each(['inputTokens', 'maxTokens', 'author', 'keyCount', 'track', 'monkey'])(
    'leaves %s alone',
    (key) => {
      expect(isSensitiveKey(key)).toBe(false)
    },
  )
})

describe('redactFields', () => {
  it('redacts key-shaped strings, bearer tokens and sensitive fields at any depth', () => {
    const fields = {
      provider: 'anthropic',
      request: {
        headers: { authorization: bearer(), 'x-api-key': anthropicLike() },
        attempts: [{ note: `retry with ${openAiLike()}` }, { auth: { user: 'u', pass: 'p' } }],
      },
      header: `Authorization: ${bearer()}`,
      usage: { inputTokens: 12, maxTokens: 1024 },
      level: -6,
    }
    const redacted = redactFields(fields)
    const encoded = JSON.stringify(redacted)
    expect(encoded).not.toContain(anthropicLike())
    expect(encoded).not.toContain(openAiLike())
    expect(encoded).not.toContain(bearer())
    expect(redacted).toEqual({
      provider: 'anthropic',
      request: {
        headers: { authorization: '[REDACTED]', 'x-api-key': '[REDACTED]' },
        attempts: [{ note: 'retry with [REDACTED]' }, { auth: '[REDACTED]' }],
      },
      header: 'Authorization: Bearer [REDACTED]',
      usage: { inputTokens: 12, maxTokens: 1024 },
      level: -6,
    })
  })

  it('redacts caller-supplied secrets that do not look like keys', () => {
    expect(redactFields({ note: 'value is plain-secret-ish' }, ['plain-secret-ish'])).toEqual({
      note: 'value is [REDACTED]',
    })
  })

  it('redacts errors, their causes and custom properties', () => {
    const cause = new Error(`upstream rejected ${xaiLike()}`)
    const error = Object.assign(new Error(`failed with ${anthropicLike()}`, { cause }), {
      status: 401,
      apiKey: 'short',
    })
    const redacted = redactFields({ error })
    const encoded = JSON.stringify(redacted)
    expect(encoded).not.toContain(anthropicLike())
    expect(encoded).not.toContain(xaiLike())
    expect(encoded).not.toContain('short')
    expect(redacted['error']).toMatchObject({
      name: 'Error',
      message: 'failed with [REDACTED]',
      status: 401,
      apiKey: '[REDACTED]',
      cause: { name: 'Error', message: 'upstream rejected [REDACTED]' },
    })
  })

  it('accepts an error as the whole field set', () => {
    expect(redactFields(new TypeError(`bad ${openAiLike()}`))).toMatchObject({
      name: 'TypeError',
      message: 'bad [REDACTED]',
    })
  })

  it('redacts keys inside Maps and Sets', () => {
    const encoded = JSON.stringify(
      redactFields({ m: new Map([['token', 'abc']]), s: new Set([anthropicLike()]) }),
    )
    expect(encoded).not.toContain('abc')
    expect(encoded).not.toContain(anthropicLike())
  })
})

describe('toJsonSafe', () => {
  it('replaces circular references and bounds depth', () => {
    const loop: { self?: unknown; name: string } = { name: 'loop' }
    loop.self = loop
    expect(toJsonSafe(loop)).toEqual({ name: 'loop', self: circularMarker })
    const deep = Array.from({ length: 20 }).reduce<unknown>((inner) => ({ inner }), 'bottom')
    expect(JSON.stringify(toJsonSafe(deep))).toContain(truncatedMarker)
  })

  it('converts values JSON cannot hold', () => {
    expect(
      toJsonSafe({
        n: Number.NaN,
        b: 10n,
        u: undefined,
        d: new Date(Date.UTC(2026, 0, 1)),
        f: function named() {},
      }),
    ).toEqual({ n: 'NaN', b: '10', u: null, d: '2026-01-01T00:00:00.000Z', f: '[function named]' })
  })

  it('clips very long strings', () => {
    const value = toJsonSafe('a'.repeat(10000))
    expect(typeof value === 'string' && value.length < 10000).toBe(true)
  })
})

describe('omitContent', () => {
  it('replaces message content fields at any depth', () => {
    expect(
      omitContent({
        text: 'my vocal sounds harsh',
        turn: { messages: [{ role: 'user' }], prompt: 'p', count: 2 },
        message: 'socket closed',
      }),
    ).toEqual({
      text: contentOmittedMarker,
      turn: { messages: contentOmittedMarker, prompt: contentOmittedMarker, count: 2 },
      message: 'socket closed',
    })
  })
})

describe('scrubPaths', () => {
  it('reduces audio paths, including ones with spaces, to basenames', () => {
    expect(basenamesOnly('ffmpeg failed on /Users/sam/Music/My Song/Bounces/lead vox.wav')).toBe(
      'ffmpeg failed on lead vox.wav',
    )
    expect(basenamesOnly('reading ~/Music/Mix.logicx now')).toBe('reading Mix.logicx now')
    expect(basenamesOnly('open file:///Users/sam/Music/kick.aif')).toBe('open kick.aif')
  })

  it('reduces other absolute paths and stack frames to basenames', () => {
    expect(basenamesOnly('at run (/Users/sam/app/dist/log/logger.js:10:5)')).toBe(
      'at run (logger.js:10:5)',
    )
  })

  it('leaves URLs and relative fragments alone', () => {
    const text = 'POST https://api.example.com/v1/messages returned 3/4 ok'
    expect(basenamesOnly(text)).toBe(text)
  })

  it('reduces path-named fields to their last segment', () => {
    expect(
      scrubPaths({ stemPath: '/Users/sam/My Mixes/Song A/drums bus.flac', dir: '/Users/sam/x/' }),
    ).toEqual({ stemPath: 'drums bus.flac', dir: 'x' })
  })
})

import { describe, expect, it } from 'vitest'
import { chat, toAssistantMessage, validateKey, type FetchLike } from '../../src/llm/client.js'
import { describeError } from '../../src/llm/errors.js'
import { adapters } from '../../src/llm/providers.js'
import { providerIds, type ChatRequest } from '../../src/llm/types.js'
import {
  fakeKeys,
  finalFixture,
  jsonResponse,
  loudnessRequest,
  scriptedFetch,
  toolCallFixture,
} from './fixtures.js'

const runLoudnessTool = (input: { readonly path?: unknown }) =>
  JSON.stringify({ path: input.path, integratedLufs: -9.8, truePeakDbtp: -0.9 })

describe.each(providerIds)('get_loudness round trip with %s', (provider) => {
  it('requests the tool, sends the result back, and returns the final answer', async () => {
    const { fetch, calls } = scriptedFetch([
      jsonResponse(toolCallFixture[provider]),
      jsonResponse(finalFixture[provider]),
    ])
    const key = fakeKeys[provider]
    const first = loudnessRequest(adapters[provider].defaultModel)

    const turn1 = await chat(fetch, provider, key, first)
    if (!turn1.ok) throw new Error(turn1.error.message)
    expect(turn1.value.stopReason).toBe('tool_use')
    const [call] = turn1.value.toolCalls
    expect(call).toMatchObject({ name: 'get_loudness', input: { path: '/tmp/mix.wav' } })
    if (call === undefined) throw new Error('no tool call')

    const second: ChatRequest = {
      ...first,
      messages: [
        ...first.messages,
        toAssistantMessage(turn1.value),
        {
          role: 'tool',
          results: [{ callId: call.id, content: runLoudnessTool(call.input), isError: false }],
        },
      ],
    }
    const turn2 = await chat(fetch, provider, key, second)
    expect(turn2.ok && turn2.value).toMatchObject({
      text: 'The mix is -9.8 LUFS integrated.',
      toolCalls: [],
      stopReason: 'end_turn',
    })
    expect(calls).toHaveLength(2)
    expect(JSON.stringify(calls[1]?.body)).toContain(call.id)
    expect(JSON.stringify(calls[1]?.body)).toContain('-9.8')
  })
})

describe('chat errors', () => {
  it.each([
    [401, 'auth'],
    [402, 'billing'],
    [403, 'permission'],
    [404, 'not_found'],
    [400, 'bad_request'],
    [429, 'rate_limit'],
    [500, 'server'],
    [503, 'overloaded'],
    [529, 'overloaded'],
  ] as const)('maps HTTP %i to %s', async (status, kind) => {
    const { fetch } = scriptedFetch([
      jsonResponse({ type: 'error', error: { type: 'x', message: 'Nope' } }, status),
    ])
    const result = await chat(fetch, 'anthropic', fakeKeys.anthropic, loudnessRequest('m'))
    expect(result).toEqual({
      ok: false,
      error: { kind, provider: 'anthropic', status, message: 'Nope' },
    })
  })

  it('reports a network failure as a value', async () => {
    const fetch: FetchLike = async () => {
      throw new Error('getaddrinfo ENOTFOUND api.x.ai')
    }
    const result = await chat(fetch, 'xai', fakeKeys.xai, loudnessRequest('m'))
    expect(result.ok || result.error.kind).toBe('network')
  })

  it('reports a non-JSON body as invalid_response', async () => {
    const { fetch } = scriptedFetch([{ status: 200, body: '<html>proxy</html>' }])
    const result = await chat(fetch, 'openai', fakeKeys.openai, loudnessRequest('m'))
    expect(result.ok || result.error.kind).toBe('invalid_response')
  })

  it('does not call the network without a key', async () => {
    const { fetch, calls } = scriptedFetch([])
    const result = await chat(fetch, 'openai', '', loudnessRequest('m'))
    expect(result.ok || result.error.kind).toBe('missing_key')
    expect(calls).toHaveLength(0)
  })

  it('has a user-facing description for every error kind', async () => {
    const { fetch } = scriptedFetch([jsonResponse({ error: { message: 'bad key' } }, 401)])
    const result = await validateKey(fetch, 'xai', fakeKeys.xai)
    if (result.ok) throw new Error('expected failure')
    expect(describeError(result.error)).toBe(
      'xAI rejected the API key. Check that it was copied in full and has not been revoked.',
    )
  })
})

describe('key redaction', () => {
  it.each(providerIds)(
    'removes the %s key when the server echoes it in an error',
    async (provider) => {
      const key = fakeKeys[provider]
      const { fetch } = scriptedFetch([
        jsonResponse({ error: { message: `Incorrect API key provided: ${key}` } }, 401),
      ])
      const result = await chat(fetch, provider, key, loudnessRequest('m'))
      if (result.ok) throw new Error('expected failure')
      expect(result.error.message).not.toContain(key)
      expect(result.error.message).toContain('[REDACTED]')
      expect(describeError(result.error)).not.toContain(key)
    },
  )

  it('removes the key from network error messages', async () => {
    const key = fakeKeys.openai
    const fetch: FetchLike = async () => {
      throw new Error(`socket hang up while sending Bearer ${key}`)
    }
    const result = await validateKey(fetch, 'openai', key)
    expect(JSON.stringify(result)).not.toContain(key)
  })

  it('removes a key that does not match a known prefix', async () => {
    const key = 'customkeyvalue123456'
    const { fetch } = scriptedFetch([jsonResponse({ error: { message: `bad ${key}` } }, 400)])
    const result = await chat(fetch, 'anthropic', key, loudnessRequest('m'))
    expect(JSON.stringify(result)).not.toContain(key)
  })
})

describe('validateKey', () => {
  it.each([
    ['anthropic', 'https://api.anthropic.com/v1/models?limit=1'],
    ['openai', 'https://api.openai.com/v1/models'],
    ['xai', 'https://api.x.ai/v1/models'],
  ] as const)('lists %s models with a GET to %s', async (provider, url) => {
    const { fetch, calls } = scriptedFetch([
      jsonResponse({ object: 'list', data: [{ id: 'model-a' }, { id: 'model-b' }] }),
    ])
    const result = await validateKey(fetch, provider, fakeKeys[provider])
    expect(result).toEqual({ ok: true, value: ['model-a', 'model-b'] })
    expect(calls[0]).toMatchObject({ url, method: 'GET', body: undefined })
  })

  it('rejects a models response without a data array', async () => {
    const { fetch } = scriptedFetch([jsonResponse({ models: [] })])
    const result = await validateKey(fetch, 'anthropic', fakeKeys.anthropic)
    expect(result.ok || result.error.kind).toBe('invalid_response')
  })
})

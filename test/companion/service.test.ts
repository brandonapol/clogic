import { afterEach, describe, expect, it } from 'vitest'
import { companionErrorCodes } from '../../src/companion/types.js'
import { defaultModels } from '../../src/companion/config.js'
import { memoryKeyStore } from '../../src/llm/keystore.js'
import { call, response } from '../agent/fixtures.js'
import {
  anthropicKey,
  gate,
  instanceId,
  isDone,
  methods,
  openaiKey,
  scriptedLlm,
  startHarness,
  type Harness,
} from './fixtures.js'

let harness: Harness | undefined

afterEach(async () => {
  await harness?.stop()
  harness = undefined
})

const start = async (options: Parameters<typeof startHarness>[0]) => {
  harness = await startHarness(options)
  return harness
}

const send = (h: Harness, text: string) => h.client.request('chat.send', { instanceId, text })

describe('chat turn over the socket', () => {
  it('runs a read tool and streams the turn back as notifications', async () => {
    const llm = scriptedLlm([
      response('Measuring the mix.', [call('c1', 'get_loudness', { path: '/tmp/mix.wav' })]),
      response('The mix is at -9.8 LUFS integrated.'),
    ])
    const h = await start({ llm: llm.factory, provider: 'anthropic' })

    expect(await send(h, 'How loud is my mix?')).toEqual({ ok: true, value: { turnId: 'turn-1' } })
    const done = await h.waitFor(isDone)

    expect(done.params).toEqual({ instanceId, turnId: 'turn-1', reason: 'end_turn' })
    expect(methods(h.notifications)).toEqual([
      'chat.delta',
      'chat.message',
      'usage',
      'tool.started',
      'tool.finished',
      'chat.delta',
      'chat.message',
      'usage',
      'chat.done',
    ])
    expect(h.notifications[0]?.params).toEqual({
      instanceId,
      turnId: 'turn-1',
      messageId: 'turn-1-m1',
      index: 0,
      text: 'Measuring the mix.',
    })
    expect(h.notifications[3]?.params).toEqual({
      instanceId,
      turnId: 'turn-1',
      callId: 'c1',
      name: 'get_loudness',
      kind: 'read',
      input: { path: '/tmp/mix.wav' },
    })
    expect(h.notifications[4]?.params).toMatchObject({
      callId: 'c1',
      name: 'get_loudness',
      status: 'ok',
    })
    expect(h.notifications[6]?.params).toMatchObject({
      messageId: 'turn-1-m2',
      text: 'The mix is at -9.8 LUFS integrated.',
    })
    expect(h.notifications[7]?.params).toEqual({
      instanceId,
      turnId: 'turn-1',
      inputTokens: 1000,
      outputTokens: 100,
    })

    expect(llm.calls.map((entry) => [entry.provider, entry.apiKey])).toEqual([
      ['anthropic', anthropicKey],
      ['anthropic', anthropicKey],
    ])
    const first = llm.calls[0]?.request
    expect(first?.model).toBe(defaultModels.anthropic)
    expect(first?.tools.map((tool) => tool.name)).toEqual([
      'get_loudness',
      'analyse_mix',
      'search_logic_docs',
      'set_fader_db',
    ])
    expect(llm.calls[1]?.request.messages.at(-1)).toMatchObject({
      role: 'tool',
      results: [{ callId: 'c1', isError: false }],
    })
  })

  it('answers search_logic_docs with guide links', async () => {
    const llm = scriptedLlm([
      response('', [call('d1', 'search_logic_docs', { query: 'sidechain compressor' })]),
      response('See the linked page.'),
    ])
    const h = await start({ llm: llm.factory, provider: 'anthropic' })

    await send(h, 'How do I sidechain?')
    await h.waitFor(isDone)

    const result = llm.calls[1]?.request.messages.at(-1)
    expect(result?.role).toBe('tool')
    const content = result?.role === 'tool' ? result.results[0]?.content : undefined
    expect(content).toContain('https://support.apple.com/guide/logicpro/')
  })

  it('rejects a second chat.send while the turn is running', async () => {
    const hold = gate()
    const llm = scriptedLlm([response('Hello.')], [hold])
    const h = await start({ llm: llm.factory, provider: 'anthropic' })

    await send(h, 'Hi')
    const second = await send(h, 'Hi again')
    hold.open()
    await h.waitFor(isDone)

    expect(second).toMatchObject({ ok: false, error: { code: companionErrorCodes.busy } })
    expect(llm.calls).toHaveLength(1)
  })

  it('refuses chat.send for another instanceId than the connection', async () => {
    const h = await start({ llm: scriptedLlm([]).factory, provider: 'anthropic' })

    const reply = await h.client.request('chat.send', { instanceId: 'other', text: 'Hi' })

    expect(reply).toMatchObject({
      ok: false,
      error: { code: companionErrorCodes.instanceMismatch },
    })
  })
})

describe('change proposals', () => {
  const proposeFader = () =>
    scriptedLlm([
      response('I will pull the vocal down.', [
        call('c1', 'set_fader_db', { track: 'Vox', db: -6 }),
      ]),
      response('Done.'),
    ])

  it('applies only the rows approved through change.decide', async () => {
    const llm = proposeFader()
    const h = await start({ llm: llm.factory, provider: 'anthropic' })

    await send(h, 'Turn the vocal down')
    const proposed = await h.waitFor((n) => n.method === 'change.proposed')
    expect(proposed.params).toEqual({
      instanceId,
      proposalId: 'proposal-c1',
      reason: 'I will pull the vocal down.',
      rows: [
        { id: 'Vox-fader', control: 'fader', location: 'Vox', before: -10, after: -6 },
        { id: 'Vox-mute', control: 'mute', location: 'Vox', before: true, after: false },
      ],
      expiresAt: '2026-10-02T12:05:00.000Z',
    })
    expect(h.applied).toEqual([])

    const decided = await h.client.request('change.decide', {
      instanceId,
      proposalId: 'proposal-c1',
      acceptedRowIds: ['Vox-fader'],
    })
    expect(decided).toEqual({ ok: true, value: { proposalId: 'proposal-c1', outcome: 'applying' } })

    await h.waitFor(isDone)
    expect(h.applied).toEqual([
      [{ id: 'Vox-fader', control: 'fader', location: 'Vox', before: -10, after: -6 }],
    ])
    const applied = await h.waitFor((n) => n.method === 'change.applied')
    expect(applied.params).toEqual({
      instanceId,
      proposalId: 'proposal-c1',
      status: 'applied',
      applied: ['Vox-fader'],
      declined: ['Vox-mute'],
      failed: [],
    })
    expect(llm.calls[1]?.request.messages.at(-1)).toMatchObject({
      role: 'tool',
      results: [{ callId: 'c1', isError: false }],
    })
  })

  it('applies nothing when the user declines', async () => {
    const llm = proposeFader()
    const h = await start({ llm: llm.factory, provider: 'anthropic' })

    await send(h, 'Turn the vocal down')
    await h.waitFor((n) => n.method === 'change.proposed')
    const decided = await h.client.request('change.decide', {
      instanceId,
      proposalId: 'proposal-c1',
      acceptedRowIds: [],
    })
    await h.waitFor(isDone)

    expect(decided).toEqual({ ok: true, value: { proposalId: 'proposal-c1', outcome: 'declined' } })
    expect(h.applied).toEqual([])
    const applied = await h.waitFor((n) => n.method === 'change.applied')
    expect(applied.params).toMatchObject({
      status: 'declined',
      applied: [],
      declined: ['Vox-fader', 'Vox-mute'],
    })
    const toolMessage = llm.calls[1]?.request.messages.at(-1)
    const content = toolMessage?.role === 'tool' ? toolMessage.results[0]?.content : ''
    expect(JSON.parse(content ?? '')).toMatchObject({ status: 'declined' })
  })

  it('rejects a decision for an unknown proposal', async () => {
    const h = await start({ llm: scriptedLlm([]).factory, provider: 'anthropic' })

    const decided = await h.client.request('change.decide', {
      instanceId,
      proposalId: 'proposal-nope',
      acceptedRowIds: ['x'],
    })

    expect(decided).toMatchObject({
      ok: false,
      error: { code: companionErrorCodes.unknownProposal },
    })
    expect(h.applied).toEqual([])
  })
})

describe('keys and providers', () => {
  it('reports a missing key as an error notification and ends the turn', async () => {
    const llm = scriptedLlm([response('unreachable')])
    const h = await start({ llm: llm.factory, provider: 'anthropic', keyStore: memoryKeyStore() })

    expect(await send(h, 'Hi')).toEqual({ ok: true, value: { turnId: 'turn-1' } })
    const done = await h.waitFor(isDone)

    expect(done.params).toMatchObject({ reason: 'llm_error' })
    const error = h.notifications.find((n) => n.method === 'error')
    expect(error?.params).toMatchObject({ instanceId, turnId: 'turn-1', code: 'missing_key' })
    expect(llm.calls).toEqual([])
  })

  it('refuses chat.send before any provider is selected', async () => {
    const h = await start({ llm: scriptedLlm([]).factory, keyStore: memoryKeyStore() })

    expect(await send(h, 'Hi')).toMatchObject({
      ok: false,
      error: { code: companionErrorCodes.noProvider },
    })
  })

  it('stores keys without echoing them and reports status', async () => {
    const keyStore = memoryKeyStore()
    const h = await start({ llm: scriptedLlm([]).factory, keyStore })

    const set = await h.client.request('keys.set', { provider: 'openai', key: `  ${openaiKey}\n` })
    const status = await h.client.request('keys.status', {})

    expect(set).toEqual({ ok: true, value: { provider: 'openai', configured: true } })
    expect(await keyStore.get('openai')).toEqual({ ok: true, value: openaiKey })
    expect(status).toEqual({
      ok: true,
      value: {
        providers: [
          { provider: 'anthropic', configured: false },
          { provider: 'openai', configured: true },
          { provider: 'xai', configured: false },
        ],
        activeProvider: 'openai',
      },
    })
    expect(JSON.stringify([set, status])).not.toContain(openaiKey)
    expect(h.raw()).not.toContain(openaiKey)
  })

  it('rejects an invalid key with invalid params and no echo', async () => {
    const h = await start({ llm: scriptedLlm([]).factory, keyStore: memoryKeyStore() })

    const set = await h.client.request('keys.set', { provider: 'xai', key: 'xai bad key' })

    expect(set).toMatchObject({ ok: false, error: { code: -32602 } })
    expect(JSON.stringify(set)).not.toContain('xai bad key')
  })

  it('switches provider and uses its key and model for the next turn', async () => {
    const llm = scriptedLlm([response('From Claude.'), response('From GPT.')])
    const keyStore = memoryKeyStore({ anthropic: anthropicKey })
    const h = await start({ llm: llm.factory, provider: 'anthropic', keyStore })

    await send(h, 'First')
    await h.waitFor(isDone)

    expect(await h.client.request('provider.select', { provider: 'xai' })).toMatchObject({
      ok: false,
      error: { code: companionErrorCodes.missingKey },
    })
    await h.client.request('keys.set', { provider: 'openai', key: openaiKey })
    expect(await h.client.request('provider.select', { provider: 'openai' })).toEqual({
      ok: true,
      value: { activeProvider: 'openai' },
    })

    await send(h, 'Second')
    await h.waitFor((n) => n.method === 'chat.done' && n.params.turnId === 'turn-2')

    expect(llm.calls.map((entry) => [entry.provider, entry.apiKey, entry.request.model])).toEqual([
      ['anthropic', anthropicKey, defaultModels.anthropic],
      ['openai', openaiKey, defaultModels.openai],
    ])
    expect(llm.calls[1]?.request.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
  })
})

describe('cancel', () => {
  it('ends the turn at once and ignores the late LLM reply', async () => {
    const hold = gate()
    const llm = scriptedLlm([response('Too late.'), response('Fresh answer.')], [hold])
    const h = await start({ llm: llm.factory, provider: 'anthropic' })

    await send(h, 'Slow question')
    expect(await h.client.request('chat.cancel', { instanceId, turnId: 'turn-1' })).toEqual({
      ok: true,
      value: { cancelled: true },
    })
    const done = await h.waitFor(isDone)
    expect(done.params).toEqual({ instanceId, turnId: 'turn-1', reason: 'cancelled' })

    hold.open()
    await send(h, 'Next question')
    await h.waitFor((n) => n.method === 'chat.done' && n.params.turnId === 'turn-2')

    const texts = h.notifications.flatMap((n) =>
      n.method === 'chat.message' ? [n.params.text] : [],
    )
    expect(texts).toEqual(['Fresh answer.'])
  })

  it('declines a pending proposal when the turn is cancelled', async () => {
    const llm = scriptedLlm([response('', [call('c1', 'set_fader_db', { track: 'Vox', db: -3 })])])
    const h = await start({ llm: llm.factory, provider: 'anthropic' })

    await send(h, 'Turn the vocal down')
    await h.waitFor((n) => n.method === 'change.proposed')
    const cancelled = await h.client.request('chat.cancel', { instanceId, turnId: null })
    await h.waitFor(isDone)

    expect(cancelled).toEqual({ ok: true, value: { cancelled: true } })
    expect(h.applied).toEqual([])
    const applied = await h.waitFor((n) => n.method === 'change.applied')
    expect(applied.params).toMatchObject({ status: 'declined' })
  })

  it('reports nothing to cancel for a stale turn id', async () => {
    const h = await start({ llm: scriptedLlm([]).factory, provider: 'anthropic' })

    expect(await h.client.request('chat.cancel', { instanceId, turnId: 'turn-9' })).toEqual({
      ok: true,
      value: { cancelled: false },
    })
  })
})

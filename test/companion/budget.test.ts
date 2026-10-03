import { afterEach, describe, expect, it } from 'vitest'
import { call, response } from '../agent/fixtures.js'
import { instanceId, isDone, scriptedLlm, startHarness, type Harness } from './fixtures.js'

let harness: Harness | undefined

afterEach(async () => {
  await harness?.stop()
  harness = undefined
})

const errors = (h: Harness) =>
  h.notifications.flatMap((n) => (n.method === 'error' ? [n.params] : []))

describe('companion budget', () => {
  it('warns once, then refuses further turns with a clear reason', async () => {
    const llm = scriptedLlm([response('One.'), response('Two.'), response('Three.')])
    harness = await startHarness({
      llm: llm.factory,
      provider: 'anthropic',
      settings: { budget: { sessionUsd: 0.007, monthlyUsd: null, warnFraction: 0.8 } },
    })
    const h = harness
    const turn = async (text: string, turnId: string) => {
      await h.client.request('chat.send', { instanceId, text })
      return h.waitFor((n) => isDone(n) && n.params.turnId === turnId)
    }

    await turn('a', 'turn-1')
    const second = await turn('b', 'turn-2')
    const third = await turn('c', 'turn-3')
    const fourth = await turn('d', 'turn-4')

    expect(second.params).toMatchObject({ reason: 'end_turn' })
    expect(third.params).toMatchObject({ reason: 'end_turn' })
    expect(fourth.params).toMatchObject({ reason: 'budget_exceeded' })
    expect(llm.calls).toHaveLength(3)
    expect(errors(h).map((e) => [e.turnId, e.code])).toEqual([
      ['turn-2', 'budget_warning'],
      ['turn-3', 'budget_exceeded'],
      ['turn-4', 'budget_exceeded'],
    ])
    expect(errors(h)[2]?.message).toContain('Raise or remove the limit')
  })

  it('records spending in the companion-wide budget', async () => {
    const llm = scriptedLlm([
      response('', [call('c1', 'get_loudness', { path: '/tmp/mix.wav' })]),
      response('Done.'),
    ])
    harness = await startHarness({
      llm: llm.factory,
      provider: 'anthropic',
      settings: { budget: { sessionUsd: 0.005, monthlyUsd: null } },
    })
    const h = harness
    await h.client.request('chat.send', { instanceId, text: 'Measure' })
    await h.waitFor(isDone)

    expect(h.companion.state().budget?.sessionSpentUsd).toBeCloseTo(0.006, 10)
    expect(h.notifications.find(isDone)?.params).toMatchObject({ reason: 'end_turn' })
  })
})

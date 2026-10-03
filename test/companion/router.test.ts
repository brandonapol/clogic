import { describe, expect, it } from 'vitest'
import { companionSettings, defaultModels } from '../../src/companion/config.js'
import { maxSummaryLength, summarize } from '../../src/companion/notifications.js'
import {
  handleAgentEvent,
  handleHello,
  handleRpc,
  initialCompanionState,
  rollBudgetMonth,
} from '../../src/companion/router.js'
import type { CompanionState } from '../../src/companion/types.js'
import { ok } from '../../src/llm/result.js'
import { readTools } from '../../src/companion/tools.js'
import { createBudget } from '../../src/usage/budget.js'
import { call, faderTool, response } from '../agent/fixtures.js'
import { toolDeps } from './fixtures.js'

const instanceId = 'instance-1'
const at = Date.parse('2026-10-02T12:00:00Z')

const ready = (): CompanionState =>
  handleHello(
    initialCompanionState(companionSettings([...readTools(toolDeps), faderTool([])]), 'anthropic'),
    { instanceId, contextName: null, sampleRate: null, protocolVersion: 1, client: 'test' },
  ).state

const sendText = (state: CompanionState, text: string) =>
  handleRpc(state, 'chat.send', { method: 'chat.send', params: { instanceId, text } })

describe('handleRpc', () => {
  it('turns chat.send into an LLM call for the active provider', () => {
    const routed = sendText(ready(), 'Hi')

    expect(routed.reply).toEqual(ok({ turnId: 'turn-1' }))
    expect(routed.effects).toMatchObject([
      {
        type: 'call_llm',
        instanceId,
        provider: 'anthropic',
        requestId: 1,
        request: { model: defaultModels.anthropic, messages: [{ role: 'user', text: 'Hi' }] },
      },
    ])
  })

  it('closes a turn left waiting on a proposal when a new message arrives', () => {
    const sent = sendText(ready(), 'Turn the vocal down')
    const proposedCall = call('c1', 'set_fader_db', { track: 'Vox', db: -6 })
    const answered = handleAgentEvent(sent.state, instanceId, {
      type: 'llm_response',
      requestId: 1,
      result: ok(response('', [proposedCall])),
    })
    const planned = handleAgentEvent(answered.state, instanceId, {
      type: 'change_planned',
      callId: 'c1',
      at,
      result: ok([{ id: 'r1', control: 'fader', location: 'Vox', before: 0, after: -6 }]),
    })

    const next = sendText(planned.state, 'Never mind')

    expect(next.reply).toEqual(ok({ turnId: 'turn-2' }))
    expect(
      next.effects.map((effect) =>
        effect.type === 'notify'
          ? [effect.notification.method, effect.notification.params]
          : [effect.type],
      ),
    ).toEqual([
      ['chat.done', { instanceId, turnId: 'turn-1', reason: 'cancelled' }],
      [
        'change.applied',
        {
          instanceId,
          proposalId: 'proposal-c1',
          status: 'expired',
          applied: [],
          declined: ['r1'],
          failed: [],
        },
      ],
      ['call_llm'],
    ])
  })

  it('updates the model of existing conversations on provider.select', () => {
    const selected = handleRpc(ready(), 'provider.select', {
      method: 'provider.select',
      provider: 'xai',
      configured: true,
    })

    expect(selected.state.activeProvider).toBe('xai')
    expect(selected.state.conversations[instanceId]?.agent.config.model).toBe(defaultModels.xai)
  })

  it('builds the system prompt for the active provider on every turn', () => {
    const state = ready()
    const first = sendText(state, 'Hi')
    const selected = handleRpc(first.state, 'provider.select', {
      method: 'provider.select',
      provider: 'xai',
      configured: true,
    })
    const second = sendText(
      handleAgentEvent(selected.state, instanceId, {
        type: 'llm_response',
        requestId: 1,
        result: ok(response('Hello')),
      }).state,
      'Again',
    )

    const systems = [...first.effects, ...second.effects].flatMap((effect) =>
      effect.type === 'call_llm' ? [effect.request.system] : [],
    )
    expect(systems).toEqual([state.settings.system('anthropic'), state.settings.system('xai')])
    expect(systems[1]).toContain('an xAI Grok model')
  })

  it('ignores agent events for unknown instances', () => {
    const state = ready()
    const routed = handleAgentEvent(state, 'nobody', { type: 'cancel' })

    expect(routed).toEqual({ state, effects: [] })
  })
})

describe('summarize', () => {
  it('truncates long tool output for tool.finished', () => {
    const summary = summarize('x'.repeat(500))

    expect(summary).toHaveLength(maxSummaryLength)
    expect(summary.endsWith('…')).toBe(true)
    expect(summarize('short')).toBe('short')
  })
})

describe('companion budget routing', () => {
  const budgeted = (sessionUsd: number) => {
    const settings = companionSettings(readTools(toolDeps))
    const budget = createBudget({ sessionUsd, monthlyUsd: null }, '2026-10')
    if (!budget.ok) throw new Error(budget.error.kind)
    const hello = (state: CompanionState, id: string) =>
      handleHello(state, {
        instanceId: id,
        contextName: null,
        sampleRate: null,
        protocolVersion: 1,
        client: 'test',
      }).state
    return hello(hello(initialCompanionState(settings, 'anthropic', budget.value), 'a'), 'b')
  }

  const answer = (state: CompanionState, id: string) =>
    handleAgentEvent(
      handleRpc(state, 'chat.send', { method: 'chat.send', params: { instanceId: id, text: 'Hi' } })
        .state,
      id,
      { type: 'llm_response', requestId: 1, result: ok(response('Hello')) },
    ).state

  it('charges every instance to one shared budget', () => {
    const after = answer(answer(budgeted(1), 'a'), 'b')
    expect(after.budget?.sessionSpentUsd).toBeCloseTo(0.006, 10)
  })

  it('blocks another instance once the shared budget is spent', () => {
    const spent = answer(budgeted(0.003), 'a')
    const blocked = handleRpc(spent, 'chat.send', {
      method: 'chat.send',
      params: { instanceId: 'b', text: 'Hi' },
    })
    expect(blocked.effects.some((effect) => effect.type === 'call_llm')).toBe(false)
    expect(blocked.effects).toContainEqual({
      type: 'notify',
      notification: expect.objectContaining({
        method: 'chat.done',
        params: { instanceId: 'b', turnId: 'turn-1', reason: 'budget_exceeded' },
      }) as unknown,
    })
  })

  it('rolls the monthly total over when the month changes', () => {
    const settings = companionSettings(readTools(toolDeps))
    const budget = createBudget({ sessionUsd: null, monthlyUsd: 5 }, '2026-09', 5)
    if (!budget.ok) throw new Error(budget.error.kind)
    const state = initialCompanionState(settings, 'anthropic', budget.value)
    expect(rollBudgetMonth(state, '2026-09')).toBe(state)
    expect(rollBudgetMonth(state, '2026-10').budget).toMatchObject({
      month: '2026-10',
      monthSpentUsd: 0,
    })
  })
})

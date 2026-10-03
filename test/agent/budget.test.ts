import { describe, expect, it } from 'vitest'
import { drive } from '../../src/agent/run.js'
import { initialState, step } from '../../src/agent/step.js'
import type {
  AgentEffect,
  AgentEvent,
  AgentNotification,
  AgentState,
} from '../../src/agent/types.js'
import { ok } from '../../src/llm/result.js'
import { createBudget, type BudgetLimitsInput } from '../../src/usage/budget.js'
import type { BudgetState } from '../../src/usage/types.js'
import { call, configFor, harness, response } from './fixtures.js'

const month = '2026-10'

const budgetOf = (limits: BudgetLimitsInput, spent = 0, at = month): BudgetState => {
  const budget = createBudget(limits, at, spent)
  if (!budget.ok) throw new Error(budget.error.kind)
  return { ...budget.value, sessionSpentUsd: spent }
}

const stateWith = (budget: BudgetState | null, model?: string): AgentState => {
  const h = harness([])
  return initialState(configFor(h.registry, model === undefined ? {} : { model }), [], budget)
}

const run = (state: AgentState, events: readonly AgentEvent[]) =>
  events.reduce<{ readonly state: AgentState; readonly effects: readonly AgentEffect[] }>(
    (acc, event) => {
      const next = step(acc.state, event)
      return { state: next.state, effects: [...acc.effects, ...next.effects] }
    },
    { state, effects: [] },
  )

const notifications = (effects: readonly AgentEffect[]): readonly AgentNotification[] =>
  effects.flatMap((effect) => (effect.type === 'notify' ? [effect.notification] : []))

const alerts = (effects: readonly AgentEffect[]) =>
  notifications(effects).filter((n) => n.type === 'budget')

const turn = (state: AgentState) =>
  run(state, [
    { type: 'user_message', text: 'Hi' },
    { type: 'llm_response', requestId: state.nextRequestId, result: ok(response('Hello')) },
  ])

describe('agent budget guard', () => {
  it('stops the turn before calling the model when the budget is used up', () => {
    const state = stateWith(budgetOf({ sessionUsd: 1, monthlyUsd: null }, 1))
    const next = step(state, { type: 'user_message', text: 'Hi' })

    expect(next.effects.filter((effect) => effect.type === 'call_llm')).toEqual([])
    expect(next.state.phase.kind).toBe('idle')
    expect(notifications(next.effects)).toEqual([
      {
        type: 'budget',
        level: 'block',
        message:
          'Session budget reached ($1.00 of $1.00). Raise or remove the limit to keep chatting.',
      },
      { type: 'turn_ended', reason: 'budget_exceeded' },
    ])
  })

  it('stops a tool loop once a call pushes spending over the limit', () => {
    const state = stateWith(budgetOf({ sessionUsd: 0.004, monthlyUsd: null }, 0.002))
    const { state: after, effects } = run(state, [
      { type: 'user_message', text: 'How loud?' },
      {
        type: 'llm_response',
        requestId: 1,
        result: ok(response('', [call('c1', 'get_loudness', { path: '/tmp/mix.wav' })])),
      },
      { type: 'tool_result', callId: 'c1', result: ok({ lufs: -9.8 }) },
    ])

    expect(effects.filter((effect) => effect.type === 'call_llm')).toHaveLength(1)
    expect(after.phase.kind).toBe('idle')
    expect(after.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool'])
    expect(alerts(effects)).toEqual([
      expect.objectContaining({ level: 'block' }) as AgentNotification,
    ])
    expect(notifications(effects).at(-1)).toEqual({
      type: 'turn_ended',
      reason: 'budget_exceeded',
    })
  })

  it('warns once when crossing the warning threshold, then blocks', () => {
    const first = turn(stateWith(budgetOf({ sessionUsd: 0.01, monthlyUsd: null })))
    const second = turn(first.state)
    const third = turn(second.state)
    const fourth = turn(third.state)
    const fifth = step(fourth.state, { type: 'user_message', text: 'Again' })

    expect(alerts(first.effects)).toEqual([])
    expect(alerts(second.effects)).toEqual([])
    expect(alerts(third.effects)).toEqual([
      {
        type: 'budget',
        level: 'warn',
        message: 'Session budget 90% used (<$0.01 of $0.01)',
      },
    ])
    expect(alerts(fourth.effects)).toEqual([
      expect.objectContaining({ level: 'block' }) as AgentNotification,
    ])
    expect(alerts(fifth.effects)).toEqual([
      expect.objectContaining({ level: 'block' }) as AgentNotification,
    ])
    expect(fifth.effects.some((effect) => effect.type === 'call_llm')).toBe(false)
  })

  it('counts calls to an unpriced model without adding a guessed cost', () => {
    const state = stateWith(budgetOf({ sessionUsd: 0.001, monthlyUsd: null }), 'mystery-model')
    const { state: after, effects } = turn(state)

    expect(after.budget).toMatchObject({ sessionSpentUsd: 0, monthSpentUsd: 0, unpricedCalls: 1 })
    expect(after.usage).toMatchObject({ calls: 1, pricedUsd: 0, unpricedCalls: 1 })
    expect(alerts(effects)).toEqual([])
  })

  it('prices cached input at the cached rate', () => {
    const cached = {
      ...response('Hello'),
      usage: { inputTokens: 0, cachedInputTokens: 1_000_000, outputTokens: 0 },
    }
    const { state } = run(stateWith(budgetOf({ sessionUsd: 10, monthlyUsd: null })), [
      { type: 'user_message', text: 'Hi' },
      { type: 'llm_response', requestId: 1, result: ok(cached) },
    ])
    expect(state.usage.pricedUsd).toBeCloseTo(0.2, 10)
    expect(state.budget?.sessionSpentUsd).toBeCloseTo(0.2, 10)
  })

  it('starts a fresh monthly budget when the month changes', async () => {
    const h = harness([response('Hello')])
    const exhausted = budgetOf({ sessionUsd: null, monthlyUsd: 1 }, 1, '2026-09')
    const state = initialState(configFor(h.registry), [], {
      ...exhausted,
      sessionSpentUsd: 0,
    })
    const after = await drive({ ...h.deps, now: () => Date.parse('2026-10-02T12:00:00Z') }, state, {
      type: 'user_message',
      text: 'Hi',
    })

    expect(h.requests).toHaveLength(1)
    expect(after.budget?.month).toBe('2026-10')
    expect(h.notifications.at(-1)).toEqual({ type: 'turn_ended', reason: 'end_turn' })
  })
})

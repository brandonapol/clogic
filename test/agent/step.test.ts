import { describe, expect, it } from 'vitest'
import { initialState, step } from '../../src/agent/step.js'
import type { AgentEvent, AgentState } from '../../src/agent/types.js'
import { ok } from '../../src/llm/result.js'
import { call, configFor, harness, response } from './fixtures.js'

const fader = call('c-fader', 'set_fader_db', { track: 'Vox', db: -6 })

const rows = [
  { id: 'r1', control: 'fader', location: 'Vox', before: -10, after: -6 },
  { id: 'r2', control: 'mute', location: 'Vox', before: true, after: false },
]

const run = (state: AgentState, events: readonly AgentEvent[]) =>
  events.reduce(
    (acc, event) => {
      const next = step(acc.state, event)
      return { state: next.state, effects: [...acc.effects, ...next.effects] }
    },
    { state, effects: [] as ReturnType<typeof step>['effects'] },
  )

const awaitingDecision = () => {
  const h = harness([])
  return run(initialState(configFor(h.registry)), [
    { type: 'user_message', text: 'Lower the vocal' },
    { type: 'llm_response', requestId: 1, result: ok(response('', [fader])) },
    { type: 'change_planned', callId: 'c-fader', at: 0, result: ok(rows) },
  ])
}

const workTypes = (effects: ReturnType<typeof step>['effects']) =>
  effects.filter((e) => e.type !== 'notify').map((e) => e.type)

describe('agent step', () => {
  it('is pure: the input state is not changed', () => {
    const h = harness([])
    const state = initialState(configFor(h.registry))
    const snapshot = structuredClone(state)
    step(state, { type: 'user_message', text: 'Hi' })
    expect(state).toEqual(snapshot)
  })

  it('plans a change but never emits apply_change without a decision', () => {
    const { state, effects } = awaitingDecision()
    expect(state.phase.kind).toBe('awaiting_decision')
    expect(workTypes(effects)).toEqual(['call_llm', 'plan_change'])
  })

  it('ignores a decision for another proposal', () => {
    const { state } = awaitingDecision()
    const next = step(state, {
      type: 'change_decision',
      proposalId: 'proposal-forged',
      acceptedRowIds: ['r1'],
      at: 1,
    })
    expect(next.state).toBe(state)
    expect(next.effects).toEqual([
      {
        type: 'notify',
        notification: {
          type: 'error',
          error: { kind: 'unknown_proposal', proposalId: 'proposal-forged' },
        },
      },
    ])
  })

  it('ignores row ids that were not proposed', () => {
    const { state } = awaitingDecision()
    const next = step(state, {
      type: 'change_decision',
      proposalId: 'proposal-c-fader',
      acceptedRowIds: ['r9'],
      at: 1,
    })
    expect(workTypes(next.effects)).toEqual(['call_llm'])
  })

  it('applies a proposal at most once', () => {
    const { state } = awaitingDecision()
    const decision: AgentEvent = {
      type: 'change_decision',
      proposalId: 'proposal-c-fader',
      acceptedRowIds: ['r1'],
      at: 1,
    }
    const first = step(state, decision)
    expect(workTypes(first.effects)).toEqual(['apply_change'])
    const second = step(first.state, decision)
    expect(workTypes(second.effects)).toEqual([])
  })

  it('reports accepted rows the executor did not mention as failed', () => {
    const { state } = awaitingDecision()
    const applying = step(state, {
      type: 'change_decision',
      proposalId: 'proposal-c-fader',
      acceptedRowIds: ['r1', 'r2'],
      at: 1,
    }).state
    const next = step(applying, {
      type: 'change_applied',
      proposalId: 'proposal-c-fader',
      report: { applied: ['r1', 'r7'], failed: [] },
    })
    const tool = next.state.messages.at(-1)
    expect(tool?.role === 'tool' && JSON.parse(tool.results[0]?.content ?? '')).toEqual({
      status: 'applied',
      applied: ['r1'],
      declined: [],
      failed: [{ id: 'r2', message: 'No result reported for this row' }],
    })
  })

  it('rejects a user message while a tool is running', () => {
    const h = harness([])
    const { state } = run(initialState(configFor(h.registry)), [
      { type: 'user_message', text: 'Loudness?' },
    ])
    const next = step(state, { type: 'user_message', text: 'Hello?' })
    expect(next.state).toBe(state)
    expect(next.effects).toEqual([
      {
        type: 'notify',
        notification: { type: 'error', error: { kind: 'busy', phase: 'awaiting_llm' } },
      },
    ])
  })

  it('ignores a stale LLM response after cancel', () => {
    const h = harness([])
    const { state } = run(initialState(configFor(h.registry)), [
      { type: 'user_message', text: 'Hi' },
      { type: 'cancel' },
    ])
    expect(state.phase.kind).toBe('idle')
    const next = step(state, { type: 'llm_response', requestId: 1, result: ok(response('Late')) })
    expect(next.state).toBe(state)
  })

  it('cancelling a pending proposal declines it and closes the tool batch', () => {
    const { state } = awaitingDecision()
    const next = step(state, { type: 'cancel' })
    expect(next.state.phase.kind).toBe('idle')
    const tool = next.state.messages.at(-1)
    expect(tool?.role === 'tool' && JSON.parse(tool.results[0]?.content ?? '')).toMatchObject({
      status: 'declined',
    })
    expect(workTypes(next.effects)).toEqual([])
  })

  it('leaves cost null when no pricing is configured', () => {
    const h = harness([])
    const { state } = run(initialState(configFor(h.registry, { pricing: null })), [
      { type: 'user_message', text: 'Hi' },
      { type: 'llm_response', requestId: 1, result: ok(response('Hello')) },
    ])
    expect(state.usage).toEqual({
      llmCalls: 1,
      inputTokens: 1000,
      outputTokens: 100,
      costUsd: null,
    })
  })
})

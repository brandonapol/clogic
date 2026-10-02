import { describe, expect, it } from 'vitest'
import { drive } from '../../src/agent/run.js'
import { initialState } from '../../src/agent/step.js'
import type { AgentState } from '../../src/agent/types.js'
import { err } from '../../src/llm/result.js'
import type { Message } from '../../src/llm/types.js'
import { defineReadTool } from '../../src/tools/define.js'
import { call, configFor, harness, response } from './fixtures.js'

const toolMessages = (state: AgentState) =>
  state.messages.flatMap((message: Message) => (message.role === 'tool' ? message.results : []))

const fader = call('c-fader', 'set_fader_db', { track: 'Vox', db: -6 })

describe('agent loop', () => {
  it('runs several read tools across steps and returns the final answer', async () => {
    const h = harness([
      response('Measuring loudness.', [call('c1', 'get_loudness', { path: '/tmp/mix.wav' })]),
      response('Now the full analysis.', [call('c2', 'analyse_mix', { path: '/tmp/mix.wav' })]),
      response('The mix is -9.8 LUFS and a little hot.'),
    ])
    const state = await drive(h.deps, initialState(configFor(h.registry)), {
      type: 'user_message',
      text: 'How is my mix at /tmp/mix.wav?',
    })

    expect(state.phase.kind).toBe('idle')
    expect(h.requests).toHaveLength(3)
    expect(h.requests[0]?.tools).toEqual(h.definitions)
    expect(h.requests[2]?.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
    ])
    const results = toolMessages(state)
    expect(results.map((r) => [r.callId, r.isError])).toEqual([
      ['c1', false],
      ['c2', false],
    ])
    expect(JSON.parse(results[0]?.content ?? '')).toMatchObject({ integratedLufs: -9.8 })
    expect(h.notifications.at(-1)).toEqual({ type: 'turn_ended', reason: 'end_turn' })
    expect(state.usage).toMatchObject({ llmCalls: 3, inputTokens: 3000, outputTokens: 300 })
    expect(state.usage.costUsd).toBeCloseTo(0.0135, 10)
  })

  it('runs every tool call in one response in order', async () => {
    const h = harness([
      response('', [
        call('a', 'get_loudness', { path: '/tmp/a.wav' }),
        call('b', 'get_loudness', { path: '/tmp/b.wav' }),
      ]),
      response('Both measured.'),
    ])
    const state = await drive(h.deps, initialState(configFor(h.registry)), {
      type: 'user_message',
      text: 'Compare',
    })
    expect(toolMessages(state).map((r) => r.callId)).toEqual(['a', 'b'])
    expect(state.messages.filter((m) => m.role === 'tool')).toHaveLength(1)
  })

  it('suspends on a change and applies nothing until the user decides', async () => {
    const h = harness([response('I will lower the vocal.', [fader])])
    const state = await drive(h.deps, initialState(configFor(h.registry)), {
      type: 'user_message',
      text: 'Turn the vocal down to -6',
    })
    expect(state.phase.kind).toBe('awaiting_decision')
    expect(h.applied).toEqual([])
    expect(h.requests).toHaveLength(1)
    expect(h.notifications).toContainEqual({
      type: 'change_proposed',
      proposal: {
        id: 'proposal-c-fader',
        call: fader,
        rows: [
          { id: 'Vox-fader', control: 'fader', location: 'Vox', before: -10, after: -6 },
          { id: 'Vox-mute', control: 'mute', location: 'Vox', before: true, after: false },
        ],
        expiresAt: 61_000,
      },
    })
  })

  it('applies only the rows the user approved', async () => {
    const h = harness([response('Lowering.', [fader]), response('Done, the vocal is at -6 dB.')])
    const proposed = await drive(h.deps, initialState(configFor(h.registry)), {
      type: 'user_message',
      text: 'Turn the vocal down to -6',
    })
    const state = await drive(h.deps, proposed, {
      type: 'change_decision',
      proposalId: 'proposal-c-fader',
      acceptedRowIds: ['Vox-fader'],
      at: 2_000,
    })

    expect(h.applied.map((rows) => rows.map((row) => row.id))).toEqual([['Vox-fader']])
    const [result] = toolMessages(state)
    expect(result?.isError).toBe(false)
    expect(JSON.parse(result?.content ?? '')).toEqual({
      status: 'applied',
      applied: ['Vox-fader'],
      declined: ['Vox-mute'],
      failed: [],
    })
    expect(h.requests).toHaveLength(2)
    expect(state.phase.kind).toBe('idle')
  })

  it('reports a denied change to the model without applying it', async () => {
    const h = harness([response('Lowering.', [fader]), response('OK, I left it alone.')])
    const proposed = await drive(h.deps, initialState(configFor(h.registry)), {
      type: 'user_message',
      text: 'Turn the vocal down',
    })
    const state = await drive(h.deps, proposed, {
      type: 'change_decision',
      proposalId: 'proposal-c-fader',
      acceptedRowIds: [],
      at: 2_000,
    })

    expect(h.applied).toEqual([])
    expect(JSON.parse(toolMessages(state)[0]?.content ?? '')).toEqual({
      status: 'declined',
      applied: [],
      declined: ['Vox-fader', 'Vox-mute'],
      failed: [],
    })
    expect(h.notifications.at(-1)).toEqual({ type: 'turn_ended', reason: 'end_turn' })
  })

  it('treats a decision after the proposal expired as declined', async () => {
    const h = harness([response('Lowering.', [fader]), response('That request expired.')])
    const proposed = await drive(h.deps, initialState(configFor(h.registry)), {
      type: 'user_message',
      text: 'Turn the vocal down',
    })
    const state = await drive(h.deps, proposed, {
      type: 'change_decision',
      proposalId: 'proposal-c-fader',
      acceptedRowIds: ['Vox-fader', 'Vox-mute'],
      at: 61_001,
    })
    expect(h.applied).toEqual([])
    expect(JSON.parse(toolMessages(state)[0]?.content ?? '')).toMatchObject({ status: 'expired' })
  })

  it('expires a pending proposal when the user sends a new message', async () => {
    const h = harness([response('Lowering.', [fader]), response('Sure, what next?')])
    const proposed = await drive(h.deps, initialState(configFor(h.registry)), {
      type: 'user_message',
      text: 'Turn the vocal down',
    })
    const state = await drive(h.deps, proposed, { type: 'user_message', text: 'Actually, wait' })
    expect(h.applied).toEqual([])
    expect(h.requests[1]?.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'user',
    ])
    expect(JSON.parse(toolMessages(state)[0]?.content ?? '')).toMatchObject({ status: 'expired' })
  })

  it('stops at the iteration cap', async () => {
    const loop = response('Again.', [call('c', 'get_loudness', { path: '/tmp/mix.wav' })])
    const h = harness([loop, loop, loop, loop])
    const state = await drive(h.deps, initialState(configFor(h.registry, { maxIterations: 3 })), {
      type: 'user_message',
      text: 'Loop forever',
    })
    expect(h.requests).toHaveLength(3)
    expect(state.phase.kind).toBe('idle')
    expect(state.messages.at(-1)?.role).toBe('tool')
    expect(h.notifications.at(-1)).toEqual({ type: 'turn_ended', reason: 'iteration_limit' })
  })

  it('resets the iteration count on the next user message', async () => {
    const loop = response('Again.', [call('c', 'get_loudness', { path: '/tmp/mix.wav' })])
    const h = harness([loop, response('Done.')])
    const config = configFor(h.registry, { maxIterations: 1 })
    const first = await drive(h.deps, initialState(config), { type: 'user_message', text: 'Go' })
    const second = await drive(h.deps, first, { type: 'user_message', text: 'Continue' })
    expect(h.requests).toHaveLength(2)
    expect(second.iterations).toBe(1)
  })

  it('returns tool errors to the model as error results and keeps going', async () => {
    const failing = defineReadTool({
      name: 'search_logic_docs',
      description: 'Search docs',
      surface: 'docs',
      params: {},
      run: async () => {
        throw new Error('index missing')
      },
    })
    const h = harness(
      [
        response('', [
          call('bad-path', 'get_loudness', { path: 'mix.wav' }),
          call('missing', 'not_a_tool', {}),
          call('throws', 'search_logic_docs', {}),
        ]),
        response('Those failed; give me an absolute path.'),
      ],
      [failing],
    )
    const state = await drive(h.deps, initialState(configFor(h.registry)), {
      type: 'user_message',
      text: 'Check it',
    })
    expect(toolMessages(state)).toEqual([
      { callId: 'bad-path', content: 'path must be absolute, got mix.wav', isError: true },
      { callId: 'missing', content: 'No tool named not_a_tool is available', isError: true },
      { callId: 'throws', content: 'index missing', isError: true },
    ])
    expect(h.requests).toHaveLength(2)
  })

  it('reports invalid change input without proposing anything', async () => {
    const h = harness([
      response('', [call('c', 'set_fader_db', { track: 'Vox', db: 40 })]),
      response('That level is out of range.'),
    ])
    const state = await drive(h.deps, initialState(configFor(h.registry)), {
      type: 'user_message',
      text: 'Make it +40',
    })
    expect(toolMessages(state)).toEqual([
      { callId: 'c', content: 'db must be at most 12', isError: true },
    ])
    expect(h.notifications.some((n) => n.type === 'change_proposed')).toBe(false)
  })

  it('ends the turn with an error value when the LLM fails', async () => {
    const h = harness([])
    const deps = {
      ...h.deps,
      chat: async () =>
        err({
          kind: 'rate_limit' as const,
          provider: 'anthropic' as const,
          status: 429,
          message: 'slow down',
        }),
    }
    const state = await drive(deps, initialState(configFor(h.registry)), {
      type: 'user_message',
      text: 'Hi',
    })
    expect(state.phase.kind).toBe('idle')
    expect(h.notifications).toEqual([
      {
        type: 'error',
        error: {
          kind: 'llm',
          error: { kind: 'rate_limit', provider: 'anthropic', status: 429, message: 'slow down' },
        },
      },
      { type: 'turn_ended', reason: 'llm_error' },
    ])
  })

  it('turns a thrown LLM client error into a value', async () => {
    const h = harness([])
    const state = await drive(h.deps, initialState(configFor(h.registry)), {
      type: 'user_message',
      text: 'Hi',
    })
    expect(state.phase.kind).toBe('idle')
    expect(h.notifications[0]).toEqual({
      type: 'error',
      error: {
        kind: 'llm',
        error: { kind: 'exception', message: 'No scripted response for request 1' },
      },
    })
  })
})

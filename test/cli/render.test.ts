import { describe, expect, it } from 'vitest'
import {
  initialRenderState,
  renderNotification,
  renderStatus,
  type RenderState,
} from '../../src/cli/render.js'
import type { CompanionNotification } from '../../src/rpc/messages.js'

const base = { instanceId: 'clogic-chat', turnId: 'turn-1' }

const delta = (messageId: string, text: string): CompanionNotification => ({
  kind: 'notification',
  method: 'chat.delta',
  params: { ...base, messageId, index: 0, text },
})

const message = (messageId: string, text: string): CompanionNotification => ({
  kind: 'notification',
  method: 'chat.message',
  params: { ...base, messageId, text },
})

const renderAll = (notifications: readonly CompanionNotification[]): string =>
  notifications.reduce<{ readonly state: RenderState; readonly output: string }>(
    (acc, notification) => {
      const rendered = renderNotification(acc.state, notification)
      return { state: rendered.state, output: acc.output + rendered.output }
    },
    { state: initialRenderState, output: '' },
  ).output

describe('renderNotification', () => {
  it('streams deltas and ends the line when the message completes', () => {
    expect(
      renderAll([
        delta('turn-1-m1', 'The mix '),
        delta('turn-1-m1', 'is loud.'),
        message('turn-1-m1', 'The mix is loud.'),
      ]),
    ).toBe('The mix is loud.\n')
  })

  it('prints a complete message that had no deltas', () => {
    expect(renderAll([message('turn-1-m1', 'Hello.')])).toBe('Hello.\n')
  })

  it('closes an open streamed line before other output', () => {
    expect(
      renderAll([
        delta('turn-1-m1', 'Measuring'),
        {
          kind: 'notification',
          method: 'tool.started',
          params: {
            ...base,
            callId: 'c1',
            name: 'get_loudness',
            kind: 'read',
            input: { path: '/tmp/mix.wav' },
          },
        },
        delta('turn-1-m2', 'Second'),
        delta('turn-1-m3', 'Third'),
      ]),
    ).toBe('Measuring\n  [tool] get_loudness {"path":"/tmp/mix.wav"}\nSecond\nThird')
  })

  it('renders tool results, usage, errors, analyses and unusual turn endings', () => {
    expect(
      renderAll([
        {
          kind: 'notification',
          method: 'tool.finished',
          params: {
            ...base,
            callId: 'c1',
            name: 'get_loudness',
            status: 'ok',
            summary: '-9.8 LUFS',
          },
        },
        {
          kind: 'notification',
          method: 'usage',
          params: { ...base, inputTokens: 1000, outputTokens: 100 },
        },
        {
          kind: 'notification',
          method: 'error',
          params: { instanceId: null, turnId: null, code: 'rate_limited', message: 'Slow down' },
        },
        {
          kind: 'notification',
          method: 'analysis.result',
          params: { ...base, callId: 'c1', analysis: 'loudness', summary: '-9.8 LUFS', data: {} },
        },
        { kind: 'notification', method: 'chat.done', params: { ...base, reason: 'end_turn' } },
        { kind: 'notification', method: 'chat.done', params: { ...base, reason: 'max_tokens' } },
      ]),
    ).toBe(
      [
        '  [tool] get_loudness ok: -9.8 LUFS',
        '  [usage] 1000 in / 100 out tokens',
        '  [error] rate_limited: Slow down',
        '  [analysis] loudness: -9.8 LUFS',
        '  [turn ended: max_tokens]',
        '',
      ].join('\n'),
    )
  })

  it('previews a proposed change as numbered rows', () => {
    expect(
      renderAll([
        {
          kind: 'notification',
          method: 'change.proposed',
          params: {
            instanceId: 'clogic-chat',
            proposalId: 'proposal-c1',
            reason: 'I will pull the vocal down.',
            rows: [
              { id: 'Vox-fader', control: 'fader', location: 'Vox', before: -10, after: -6 },
              { id: 'Vox-mute', control: 'mute', location: 'Vox', before: true, after: false },
              { id: 'Vox-name', control: 'name', location: 'Vox', before: 'Vox', after: 'Lead' },
            ],
            expiresAt: '2026-10-02T12:05:00.000Z',
          },
        },
      ]),
    ).toBe(
      [
        'Proposed change proposal-c1: I will pull the vocal down.',
        '  1. Vox fader: -10 -> -6',
        '  2. Vox mute: true -> false',
        '  3. Vox name: Vox -> Lead',
        '  expires 2026-10-02T12:05:00.000Z',
        '',
      ].join('\n'),
    )
  })

  it('summarises an applied change with failures', () => {
    expect(
      renderAll([
        {
          kind: 'notification',
          method: 'change.applied',
          params: {
            instanceId: 'clogic-chat',
            proposalId: 'proposal-c1',
            status: 'applied',
            applied: ['Vox-fader'],
            declined: [],
            failed: [{ id: 'Vox-mute', message: 'Control surface offline' }],
          },
        },
      ]),
    ).toBe(
      '  [change] proposal-c1 applied: 1 applied, 0 declined, 1 failed\n    Vox-mute: Control surface offline\n',
    )
  })
})

describe('renderStatus', () => {
  it('lists each provider and the active one', () => {
    expect(
      renderStatus({
        activeProvider: 'openai',
        providers: [
          { provider: 'anthropic', configured: false },
          { provider: 'openai', configured: true },
        ],
      }),
    ).toBe('Active provider: OpenAI\n  Anthropic  no key\n  OpenAI     key saved\n')
    expect(renderStatus({ activeProvider: null, providers: [] })).toBe('Active provider: none\n')
  })
})

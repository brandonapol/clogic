import { describe, expect, it } from 'vitest'
import {
  decodeConversation,
  decodeConversationValue,
  encodeConversation,
} from '../../src/history/codec.js'
import { assistant, conversation, proposal, toolResults, user } from './fixtures.js'

describe('encode / decode', () => {
  it('round-trips a full record', () => {
    const record = conversation(
      [
        user('hello'),
        {
          role: 'assistant',
          text: 'checking',
          toolCalls: [{ id: 'c1', name: 'set_fader_db', input: { db: -6 } }],
          replay: { provider: 'openai', items: [{ type: 'reasoning', summary: [] }] },
        },
        toolResults(['c1']),
      ],
      { pendingProposals: [proposal('c1')], droppedMessages: 3 },
    )
    expect(decodeConversation(encodeConversation(record))).toEqual({ ok: true, value: record })
  })

  it('reports invalid JSON', () => {
    const result = decodeConversation('{"version": 2, "id": ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('invalid_json')
  })

  it.each([null, 3, 'text', []])('rejects a non-object %#', (value) => {
    expect(decodeConversationValue(value)).toEqual({
      ok: false,
      error: { kind: 'invalid_record', message: 'record: expected object' },
    })
  })

  it.each([undefined, 0, 3, 1.5, '2'])('rejects unsupported version %#', (version) => {
    expect(decodeConversationValue({ ...conversation(), version })).toEqual({
      ok: false,
      error: { kind: 'unsupported_version', version },
    })
  })

  it('names the path of an invalid field', () => {
    const record = {
      ...conversation(),
      messages: [
        user('a'),
        { role: 'assistant', text: 'b', toolCalls: [{ id: 'c', name: 'n', input: [] }] },
      ],
    }
    expect(decodeConversationValue(record)).toEqual({
      ok: false,
      error: {
        kind: 'invalid_record',
        message: 'messages[1].toolCalls[0].input: expected JSON object',
      },
    })
  })

  it.each([
    [
      'unknown role',
      { messages: [{ role: 'system', text: 'x' }] },
      "messages[0].role: expected 'user', 'assistant' or 'tool'",
    ],
    [
      'bad provider',
      {
        messages: [
          { role: 'assistant', text: '', toolCalls: [], replay: { provider: 'acme', items: [] } },
        ],
      },
      'messages[0].replay.provider: expected provider id',
    ],
    [
      'bad proposal',
      { pendingProposals: [{ id: 'p' }] },
      'pendingProposals[0].callId: expected string',
    ],
    ['non-finite time', { createdAt: 'yesterday' }, 'createdAt: expected finite number'],
  ])('rejects %s', (_label, patch, message) => {
    expect(decodeConversationValue({ ...conversation(), ...patch })).toEqual({
      ok: false,
      error: { kind: 'invalid_record', message },
    })
  })
})

describe('version migration', () => {
  it('upgrades a version 1 record to the current schema', () => {
    const legacy = {
      version: 1,
      id: 'instance-legacy',
      system: 'old system',
      updatedAt: 42,
      messages: [user('hi'), assistant('hello')],
    }
    expect(decodeConversation(JSON.stringify(legacy))).toEqual({
      ok: true,
      value: {
        version: 2,
        id: 'instance-legacy',
        projectName: null,
        contextName: null,
        createdAt: 42,
        updatedAt: 42,
        system: 'old system',
        messages: [user('hi'), assistant('hello')],
        pendingProposals: [],
        droppedMessages: 0,
      },
    })
  })

  it('validates version 1 messages too', () => {
    const legacy = { version: 1, id: 'x', system: '', updatedAt: 1, messages: [{ role: 'user' }] }
    expect(decodeConversationValue(legacy)).toEqual({
      ok: false,
      error: { kind: 'invalid_record', message: 'messages[0].text: expected string' },
    })
  })

  it('ignores unknown extra fields', () => {
    const record = conversation([user('hi')])
    expect(decodeConversationValue({ ...record, futureField: true })).toEqual({
      ok: true,
      value: record,
    })
  })
})

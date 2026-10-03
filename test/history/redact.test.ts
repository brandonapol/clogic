import { describe, expect, it } from 'vitest'
import { encodeConversation } from '../../src/history/codec.js'
import { redactJson, redactRecord, redactText } from '../../src/history/redact.js'
import type { Message } from '../../src/llm/types.js'
import { anthropicLike, conversation, openAiLike, proposal, xaiLike } from './fixtures.js'

const keyShaped = [anthropicLike(), openAiLike(), xaiLike()]

describe('redactText', () => {
  it.each(keyShaped)('removes key-shaped text %#', (key) => {
    expect(redactText(`use ${key} please`)).toBe('use [REDACTED] please')
  })

  it('removes known secrets that do not look like keys', () => {
    expect(redactText('token is placeholder-value', ['placeholder-value'])).toBe(
      'token is [REDACTED]',
    )
  })

  it('removes bearer tokens and key assignments', () => {
    const bearer = ['Bearer', 'y'.repeat(12)].join(' ')
    const assignment = ['api_key', 'z'.repeat(12)].join('=')
    expect(redactText(`Authorization: ${bearer}`)).toBe('Authorization: Bearer [REDACTED]')
    expect(redactText(`set ${assignment} now`)).toBe('set api_key=[REDACTED] now')
  })

  it('leaves ordinary mixing text alone', () => {
    const text = 'Cut 3 dB at 250 Hz on the task-bus and set the skip-ahead marker'
    expect(redactText(text)).toBe(text)
  })
})

describe('redactJson', () => {
  it('redacts sensitive keys and nested strings', () => {
    expect(
      redactJson({ apiKey: 'short', nested: [{ note: `k ${xaiLike()}` }], level: -6 }),
    ).toEqual({ apiKey: '[REDACTED]', nested: [{ note: 'k [REDACTED]' }], level: -6 })
  })
})

describe('redactRecord', () => {
  const key = anthropicLike()
  const messages: readonly Message[] = [
    { role: 'user', text: `my key is ${key}` },
    {
      role: 'assistant',
      text: `do not share ${key}`,
      toolCalls: [{ id: 'c1', name: 'note', input: { text: key, x_api_key: 'short' } }],
      replay: { provider: 'anthropic', items: [{ type: 'text', text: key }] },
    },
    { role: 'tool', results: [{ callId: 'c1', content: key, isError: false }] },
  ]
  const record = conversation(messages, {
    system: `system ${key}`,
    projectName: key,
    contextName: key,
    pendingProposals: [
      {
        ...proposal('c1'),
        rows: [
          {
            ...proposal('c1').rows[0],
            location: key,
            id: 'r',
            control: 'c',
            before: key,
            after: 1,
          },
        ],
      },
    ],
  })

  it('strips key-shaped text from every field', () => {
    const encoded = JSON.stringify(redactRecord(record))
    expect(encoded).not.toContain(key)
    expect(encoded).toContain('[REDACTED]')
  })

  it('is applied by encodeConversation, including caller-supplied secrets', () => {
    const encoded = encodeConversation(
      conversation([{ role: 'user', text: 'known placeholder-secret here' }]),
      ['placeholder-secret'],
    )
    expect(encoded).not.toContain('placeholder-secret')
    expect(encodeConversation(record)).not.toContain(key)
  })

  it('does not mutate its input', () => {
    redactRecord(record)
    expect(record.messages[0]).toEqual({ role: 'user', text: `my key is ${key}` })
  })
})

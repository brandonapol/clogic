import { describe, expect, it } from 'vitest'
import {
  anthropicChatRequest,
  anthropicModelsRequest,
  parseAnthropicResponse,
  toAnthropicBody,
} from '../../src/llm/anthropic.js'
import { toAssistantMessage } from '../../src/llm/client.js'
import type { ChatRequest } from '../../src/llm/types.js'
import { anthropicToolUseResponse, fakeKeys, loudnessRequest } from './fixtures.js'

describe('anthropic request translation', () => {
  it('builds a Messages API request with the get_loudness tool', () => {
    const request = anthropicChatRequest(loudnessRequest('claude-sonnet-5-5'), fakeKeys.anthropic)
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.anthropic.com/v1/messages')
    expect(request.headers).toEqual({
      'x-api-key': fakeKeys.anthropic,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    })
    expect(JSON.parse(request.body ?? '')).toEqual({
      model: 'claude-sonnet-5-5',
      max_tokens: 1024,
      system: 'You are a mixing assistant.',
      messages: [{ role: 'user', content: 'How loud is /tmp/mix.wav?' }],
      tools: [
        {
          name: 'get_loudness',
          description: expect.stringContaining('LUFS') as unknown,
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string', description: expect.any(String) as unknown } },
            required: ['path'],
            additionalProperties: false,
          },
        },
      ],
      tool_choice: { type: 'auto' },
    })
  })

  it('omits system, tools and tool_choice when empty', () => {
    const body = toAnthropicBody({ ...loudnessRequest('m'), system: '', tools: [] })
    expect(body).toEqual({
      model: 'm',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'How loud is /tmp/mix.wav?' }],
    })
  })

  it('replays its own assistant content verbatim, including thinking blocks', () => {
    const parsed = parseAnthropicResponse(anthropicToolUseResponse)
    if (!parsed.ok) throw new Error(parsed.error)
    const request: ChatRequest = {
      ...loudnessRequest('m'),
      messages: [
        { role: 'user', text: 'How loud?' },
        toAssistantMessage(parsed.value),
        {
          role: 'tool',
          results: [{ callId: 'toolu_01', content: '{"integratedLufs":-9.8}', isError: false }],
        },
      ],
    }
    const body = toAnthropicBody(request) as { messages: unknown[] }
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: anthropicToolUseResponse.content,
    })
    expect(body.messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_01', content: '{"integratedLufs":-9.8}' },
      ],
    })
  })

  it('synthesises tool_use blocks for history from another provider and marks errors', () => {
    const body = toAnthropicBody({
      ...loudnessRequest('m'),
      messages: [
        { role: 'user', text: 'How loud?' },
        {
          role: 'assistant',
          text: '',
          toolCalls: [{ id: 'call_01', name: 'get_loudness', input: { path: '/x.wav' } }],
          replay: { provider: 'openai', items: [{ type: 'reasoning' }] },
        },
        { role: 'tool', results: [{ callId: 'call_01', content: 'No such file', isError: true }] },
      ],
    }) as { messages: unknown[] }
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'call_01', name: 'get_loudness', input: { path: '/x.wav' } },
      ],
    })
    expect(body.messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_01', content: 'No such file', is_error: true },
      ],
    })
  })

  it('builds a cheap models-list request for key validation', () => {
    expect(anthropicModelsRequest(fakeKeys.anthropic)).toEqual({
      method: 'GET',
      url: 'https://api.anthropic.com/v1/models?limit=1',
      headers: expect.objectContaining({ 'x-api-key': fakeKeys.anthropic }) as unknown,
    })
  })
})

describe('anthropic response parsing', () => {
  it('extracts text, tool calls, stop reason and usage', () => {
    const parsed = parseAnthropicResponse(anthropicToolUseResponse)
    expect(parsed.ok && parsed.value).toMatchObject({
      text: 'Measuring now.',
      toolCalls: [{ id: 'toolu_01', name: 'get_loudness', input: { path: '/tmp/mix.wav' } }],
      stopReason: 'tool_use',
      usage: { inputTokens: 412, cachedInputTokens: 0, outputTokens: 57 },
    })
  })

  it('reports cache reads separately from uncached input tokens', () => {
    const parsed = parseAnthropicResponse({
      content: [{ type: 'text', text: 'Hi' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 120,
        cache_read_input_tokens: 3000,
        cache_creation_input_tokens: 0,
        output_tokens: 9,
      },
    })
    expect(parsed.ok && parsed.value.usage).toEqual({
      inputTokens: 120,
      cachedInputTokens: 3000,
      outputTokens: 9,
    })
  })

  it.each([
    ['end_turn', 'end_turn'],
    ['max_tokens', 'max_tokens'],
    ['refusal', 'refusal'],
    ['pause_turn', 'other'],
  ])('maps stop_reason %s to %s', (raw, expected) => {
    const parsed = parseAnthropicResponse({ content: [], stop_reason: raw })
    expect(parsed.ok && parsed.value.stopReason).toBe(expected)
  })

  it('rejects a tool_use block without object input', () => {
    const parsed = parseAnthropicResponse({
      content: [{ type: 'tool_use', id: 't', name: 'get_loudness', input: 'oops' }],
    })
    expect(parsed).toEqual({ ok: false, error: expect.stringContaining('tool_use') as unknown })
  })

  it('rejects a non-object body', () => {
    expect(parseAnthropicResponse('nope').ok).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { toAssistantMessage } from '../../src/llm/client.js'
import {
  isStrictCompatible,
  parseResponsesResponse,
  responsesChatRequest,
  toResponsesBody,
  type ResponsesDialect,
} from '../../src/llm/openai-responses.js'
import { adapters } from '../../src/llm/providers.js'
import type { ChatRequest } from '../../src/llm/types.js'
import { fakeKeys, loudnessRequest, responsesToolCallResponse } from './fixtures.js'

const openai: ResponsesDialect = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  statelessReasoning: true,
}
const xai: ResponsesDialect = {
  provider: 'xai',
  baseUrl: 'https://api.x.ai/v1',
  statelessReasoning: false,
}

describe('responses request translation', () => {
  it('builds an OpenAI Responses request with a strict function tool', () => {
    const request = responsesChatRequest(openai, loudnessRequest('gpt-6.1-sol'), fakeKeys.openai)
    expect(request.url).toBe('https://api.openai.com/v1/responses')
    expect(request.headers).toEqual({
      authorization: `Bearer ${fakeKeys.openai}`,
      'content-type': 'application/json',
    })
    expect(JSON.parse(request.body ?? '')).toEqual({
      model: 'gpt-6.1-sol',
      instructions: 'You are a mixing assistant.',
      input: [{ role: 'user', content: 'How loud is /tmp/mix.wav?' }],
      max_output_tokens: 1024,
      tools: [
        {
          type: 'function',
          name: 'get_loudness',
          description: expect.stringContaining('LUFS') as unknown,
          parameters: expect.objectContaining({ required: ['path'] }) as unknown,
          strict: true,
        },
      ],
      tool_choice: 'auto',
      store: false,
      include: ['reasoning.encrypted_content'],
    })
  })

  it('targets the xAI base URL and does not send store/include', () => {
    const request = responsesChatRequest(xai, loudnessRequest('grok-4.7'), fakeKeys.xai)
    expect(request.url).toBe('https://api.x.ai/v1/responses')
    const body = JSON.parse(request.body ?? '') as Record<string, unknown>
    expect(body['store']).toBeUndefined()
    expect(body['include']).toBeUndefined()
  })

  it('disables strict mode when a property is optional', () => {
    expect(
      isStrictCompatible({
        type: 'object',
        properties: { path: { type: 'string' }, channel: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
      }),
    ).toBe(false)
  })

  it('replays its own output items and sends function_call_output', () => {
    const parsed = parseResponsesResponse('openai', responsesToolCallResponse)
    if (!parsed.ok) throw new Error(parsed.error)
    const request: ChatRequest = {
      ...loudnessRequest('m'),
      messages: [
        { role: 'user', text: 'How loud?' },
        toAssistantMessage(parsed.value),
        {
          role: 'tool',
          results: [{ callId: 'call_01', content: '{"lufs":-9.8}', isError: false }],
        },
      ],
    }
    const body = toResponsesBody(openai, request) as { input: unknown[] }
    expect(body.input).toEqual([
      { role: 'user', content: 'How loud?' },
      ...responsesToolCallResponse.output,
      { type: 'function_call_output', call_id: 'call_01', output: '{"lufs":-9.8}' },
    ])
  })

  it('synthesises function_call items for history from another provider and prefixes errors', () => {
    const body = toResponsesBody(xai, {
      ...loudnessRequest('m'),
      messages: [
        {
          role: 'assistant',
          text: 'Checking.',
          toolCalls: [{ id: 'toolu_01', name: 'get_loudness', input: { path: '/x.wav' } }],
          replay: { provider: 'anthropic', items: [{ type: 'thinking' }] },
        },
        { role: 'tool', results: [{ callId: 'toolu_01', content: 'No such file', isError: true }] },
      ],
    }) as { input: unknown[] }
    expect(body.input).toEqual([
      { role: 'assistant', content: 'Checking.' },
      {
        type: 'function_call',
        call_id: 'toolu_01',
        name: 'get_loudness',
        arguments: '{"path":"/x.wav"}',
      },
      { type: 'function_call_output', call_id: 'toolu_01', output: 'Error: No such file' },
    ])
  })
})

describe('responses response parsing', () => {
  it('parses function_call arguments into a tool call', () => {
    const parsed = parseResponsesResponse('xai', responsesToolCallResponse)
    expect(parsed.ok && parsed.value).toMatchObject({
      text: '',
      toolCalls: [{ id: 'call_01', name: 'get_loudness', input: { path: '/tmp/mix.wav' } }],
      stopReason: 'tool_use',
      usage: { inputTokens: 300, outputTokens: 40 },
      replay: { provider: 'xai' },
    })
  })

  it('rejects function_call arguments that are not a JSON object', () => {
    const parsed = parseResponsesResponse('openai', {
      status: 'completed',
      output: [
        { type: 'function_call', call_id: 'c', name: 'get_loudness', arguments: '{"path":' },
      ],
    })
    expect(parsed).toEqual({
      ok: false,
      error: expect.stringContaining('not a JSON object') as unknown,
    })
  })

  it('maps an incomplete max_output_tokens response to max_tokens', () => {
    const parsed = parseResponsesResponse('openai', {
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [],
    })
    expect(parsed.ok && parsed.value.stopReason).toBe('max_tokens')
  })

  it('maps a refusal content part to refusal', () => {
    const parsed = parseResponsesResponse('openai', {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No.' }] }],
    })
    expect(parsed.ok && parsed.value.stopReason).toBe('refusal')
  })

  it('returns the error message of a failed response', () => {
    const parsed = parseResponsesResponse('openai', {
      status: 'failed',
      error: { code: 'server_error', message: 'Something broke' },
    })
    expect(parsed).toEqual({ ok: false, error: 'Something broke' })
  })
})

describe('provider registry', () => {
  it('has a default model for every provider', () => {
    expect(Object.values(adapters).map((adapter) => adapter.defaultModel)).toEqual([
      'claude-sonnet-5-5',
      'gpt-6.1-sol',
      'grok-4.7',
    ])
  })
})
